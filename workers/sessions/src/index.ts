import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { readProject } from "../../../src/model";
import {
  applyProjectChanges,
  clientIdSchema,
  clientMessageSchema,
  createSessionSchema,
  diffProject,
  HOST_REPLACED_CODE,
  MAX_SESSION_BYTES,
  MAX_SESSION_CLIENTS,
  roomIdSchema,
  SESSION_LIFETIME_MS,
  SESSION_PROTOCOL,
  sessionTokenSchema,
  sessionProjectSchema,
} from "../../../src/session-protocol";
import type {
  ClientMessage,
  ServerMessage,
} from "../../../src/session-protocol";

type SessionEnv = Omit<Env, "ROOMS"> & {
  ROOMS: DurableObjectNamespace<SessionRoom>;
};

const roleSchema = z.enum(["host", "guest"]);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z.object({
  project: sessionProjectSchema,
  revision: z.number().int().nonnegative(),
  hostHash: hashSchema,
  guestHash: hashSchema,
  expiresAt: z.number().int().positive(),
  clients: z
    .record(
      clientIdSchema,
      z.object({ sequence: z.number().int().nonnegative(), role: roleSchema }),
    )
    .refine((clients) => Object.keys(clients).length <= 16),
});
type RoomRecord = z.infer<typeof recordSchema>;
const attachmentSchema = z.object({
  clientId: clientIdSchema,
  role: roleSchema,
  expiresAt: z.number().int().positive(),
  active: z.boolean(),
  playing: z.boolean(),
  absoluteTick: z.number().finite().nonnegative().default(0),
  protocol: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  window: z.number(),
  packets: z.number().int().nonnegative(),
  patches: z.number().int().nonnegative(),
});
type Attachment = z.infer<typeof attachmentSchema>;

function randomToken(bytes: number): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function sameHash(left: string, right: string): boolean {
  return crypto.subtle.timingSafeEqual(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  );
}
function attachment(socket: WebSocket): Attachment | null {
  const parsed = attachmentSchema.safeParse(socket.deserializeAttachment());
  return parsed.success ? parsed.data : null;
}
function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
}
function error(
  socket: WebSocket,
  code: string,
  message: string,
  sequence?: number,
): void {
  send(socket, {
    type: "error",
    code,
    message,
    ...(sequence === undefined ? {} : { sequence }),
  });
}

/** One bounded snapshot row; clocks and presence live exclusively in attachments. */
export class SessionRoom extends DurableObject<SessionEnv> {
  private record: RoomRecord | null | undefined;
  private closing = false;
  constructor(ctx: DurableObjectState, env: SessionEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    for (const socket of ctx.getWebSockets()) {
      const data = attachment(socket);
      if (data && data.protocol !== 3 && data.active) {
        error(
          socket,
          "reload-required",
          "Reload Grain to continue this session",
        );
        socket.serializeAttachment({ ...data, active: false, playing: false });
        socket.close(4010, "Reload Grain to continue");
      }
    }
  }
  private load(): RoomRecord | null {
    if (this.record !== undefined) return this.record;
    let row: { data: string } | undefined;
    try {
      row = this.ctx.storage.sql
        .exec<{ data: string }>("SELECT data FROM session_state WHERE id = 1")
        .toArray()[0];
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("no such table: session_state")
      )
        return (this.record = null);
      throw error;
    }
    if (!row) return (this.record = null);
    const result = recordSchema.safeParse(JSON.parse(row.data));
    if (!result.success) throw new Error("Invalid stored session");
    return (this.record = result.data);
  }
  private persist(record: RoomRecord): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO session_state (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      JSON.stringify(record),
    );
    this.record = record;
  }
  async initialize(input: unknown): Promise<void> {
    const record = recordSchema.parse(input);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session_state (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL)",
    );
    if (this.load()) throw new Error("Session already exists");
    this.persist(record);
    await this.ctx.storage.setAlarm(record.expiresAt);
  }
  private sockets(): { socket: WebSocket; data: Attachment }[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const data = attachment(socket);
      return data?.active && socket.readyState === WebSocket.OPEN
        ? [{ socket, data }]
        : [];
    });
  }
  private presence(): {
    hostConnected: boolean;
    playing: boolean;
    absoluteTick: number;
    participants: number;
  } {
    const sockets = this.sockets();
    const host = sockets.find(({ data }) => data.role === "host");
    return {
      hostConnected: host !== undefined,
      playing: host?.data.playing ?? false,
      absoluteTick: host?.data.absoluteTick ?? 0,
      participants: sockets.length,
    };
  }
  private broadcast(message: ServerMessage): void {
    for (const { socket } of this.sockets()) send(socket, message);
  }
  private welcome(
    socket: WebSocket,
    data: Attachment,
    record: RoomRecord,
  ): void {
    send(socket, {
      type: "welcome",
      project: record.project,
      revision: record.revision,
      role: data.role,
      expiresAt: record.expiresAt,
      acknowledgedSequence: record.clients[data.clientId]?.sequence ?? 0,
      ...this.presence(),
    });
  }
  async fetch(request: Request): Promise<Response> {
    const clientId = clientIdSchema.safeParse(
      new URL(request.url).searchParams.get("clientId"),
    );
    const protocols =
      request.headers
        .get("Sec-WebSocket-Protocol")
        ?.split(",")
        .map((part) => part.trim()) ?? [];
    const token = sessionTokenSchema.safeParse(protocols[1]);
    if (
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
      !clientId.success ||
      protocols.length !== 2 ||
      (protocols[0] !== SESSION_PROTOCOL &&
        protocols[0] !== "grain-session-v1" &&
        protocols[0] !== "grain-session-v2") ||
      !token.success
    )
      return new Response("Invalid connection", { status: 400 });
    const digest = await tokenHash(token.data);
    const record = this.load();
    if (!record || this.closing)
      return new Response("Session unavailable", { status: 404 });
    if (record.expiresAt <= Date.now()) {
      await this.finish("expired");
      return new Response("Session expired", { status: 410 });
    }
    const role = sameHash(digest, record.hostHash)
      ? "host"
      : sameHash(digest, record.guestHash)
        ? "guest"
        : null;
    if (!role) return new Response("Invalid credentials", { status: 403 });
    if (protocols[0] !== SESSION_PROTOCOL) {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({
        clientId: clientId.data,
        role,
        expiresAt: record.expiresAt,
        active: false,
        playing: false,
        absoluteTick: 0,
        protocol: protocols[0] === "grain-session-v2" ? 2 : 1,
        window: Date.now(),
        packets: 0,
        patches: 0,
      });
      error(
        pair[1],
        "reload-required",
        "Reload Grain to continue this session",
      );
      pair[1].close(4010, "Reload Grain to continue");
      return new Response(null, {
        status: 101,
        webSocket: pair[0],
        headers: {
          "Sec-WebSocket-Protocol": protocols[0] ?? "grain-session-v1",
        },
      });
    }
    const existing = this.sockets();
    if (
      (record.clients[clientId.data]?.role &&
        record.clients[clientId.data]?.role !== role) ||
      existing.some(
        ({ data }) => data.clientId === clientId.data && data.role !== role,
      )
    )
      return new Response("Client identity unavailable", { status: 409 });
    const replaced = existing.filter(({ data }) =>
      role === "host" ? data.role === "host" : data.clientId === clientId.data,
    );
    if (
      role === "guest" &&
      existing.filter(({ data }) => data.role === "guest").length -
        replaced.length >=
        MAX_SESSION_CLIENTS - 1
    )
      return new Response("Session full", { status: 409 });
    for (const { socket, data } of replaced) {
      socket.serializeAttachment({ ...data, active: false, playing: false });
      socket.close(HOST_REPLACED_CODE, "Connection replaced");
    }
    const pair = new WebSocketPair();
    const data: Attachment = {
      clientId: clientId.data,
      role,
      expiresAt: record.expiresAt,
      active: true,
      protocol: 3,
      playing: false,
      absoluteTick: 0,
      window: Date.now(),
      packets: 0,
      patches: 0,
    };
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(data);
    this.welcome(pair[1], data, record);
    this.broadcast({ type: "presence", ...this.presence() });
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { "Sec-WebSocket-Protocol": SESSION_PROTOCOL },
    });
  }
  async webSocketMessage(
    socket: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const data = attachment(socket);
    if (!data?.active || this.closing) return;
    if (data.expiresAt <= Date.now()) return this.finish("expired");
    if (typeof raw !== "string") {
      socket.close(1003, "Text messages required");
      return;
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_SESSION_BYTES) {
      socket.close(1009, "Message too large");
      return;
    }
    if (Date.now() - data.window >= 1000) {
      data.window = Date.now();
      data.packets = 0;
      data.patches = 0;
    }
    data.packets++;
    socket.serializeAttachment(data);
    if (data.packets > 60) {
      socket.close(1008, "Message rate exceeded");
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      error(socket, "invalid-message", "Invalid message");
      return;
    }
    const parsed = clientMessageSchema.safeParse(decoded);
    if (!parsed.success) {
      error(socket, "invalid-message", "Invalid message");
      return;
    }
    if (parsed.data.type === "patch") data.patches++;
    socket.serializeAttachment(data);
    if (data.patches > 24) {
      error(
        socket,
        "rate-limit",
        "Edit rate exceeded",
        parsed.data.type === "patch" ? parsed.data.sequence : undefined,
      );
      return;
    }
    if (parsed.data.type === "clock") {
      if (data.role !== "host") {
        error(socket, "host-only", "Only the host can send playback state");
        return;
      }
      socket.serializeAttachment({
        ...data,
        playing: parsed.data.playing,
        absoluteTick: parsed.data.absoluteTick,
      });
      this.broadcast(parsed.data);
      return;
    }
    if (parsed.data.type === "transport") {
      const host = this.sockets().find(
        ({ data: peer }) => peer.role === "host",
      );
      if (!host) {
        error(socket, "host-offline", "The host is disconnected");
        return;
      }
      send(host.socket, { ...parsed.data, clientId: data.clientId });
      return;
    }
    if (parsed.data.type === "end") {
      if (data.role !== "host") {
        error(socket, "host-only", "Only the host can end the session");
        return;
      }
      return this.finish("ended");
    }
    const record = this.load();
    if (!record) {
      error(socket, "unavailable", "Session unavailable");
      return;
    }
    if (parsed.data.type === "sync") this.welcome(socket, data, record);
    else this.patch(socket, data, record, parsed.data);
  }
  private patch(
    socket: WebSocket,
    data: Attachment,
    record: RoomRecord,
    message: Extract<ClientMessage, { type: "patch" }>,
  ): void {
    if (message.clientId !== data.clientId) {
      error(
        socket,
        "identity",
        "Client identity does not match",
        message.sequence,
      );
      return;
    }
    if (!this.presence().hostConnected) {
      error(
        socket,
        "host-offline",
        "The host is disconnected",
        message.sequence,
      );
      return;
    }
    const prior = record.clients[data.clientId];
    if (prior && message.sequence <= prior.sequence) {
      send(socket, {
        type: "ack",
        revision: record.revision,
        clientId: data.clientId,
        sequence: prior.sequence,
      });
      return;
    }
    if (!prior && Object.keys(record.clients).length >= 16) {
      error(
        socket,
        "client-limit",
        "This session has reached its device limit",
        message.sequence,
      );
      return;
    }
    const project = applyProjectChanges(record.project, message.changes);
    if (!project) {
      error(socket, "invalid-patch", "The edit is invalid", message.sequence);
      return;
    }
    const changes = diffProject(record.project, project);
    const revision = record.revision + 1;
    this.persist({
      ...record,
      project,
      revision,
      clients: {
        ...record.clients,
        [data.clientId]: { sequence: message.sequence, role: data.role },
      },
    });
    this.broadcast({
      type: "patch",
      revision,
      clientId: data.clientId,
      sequence: message.sequence,
      changes,
    });
  }
  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    const data = attachment(socket);
    if (data)
      socket.serializeAttachment({ ...data, active: false, playing: false });
    socket.close(code, reason);
    if (!this.closing) this.broadcast({ type: "presence", ...this.presence() });
  }
  webSocketError(socket: WebSocket): void {
    const data = attachment(socket);
    if (data)
      socket.serializeAttachment({ ...data, active: false, playing: false });
    socket.close(1011, "Connection error");
    if (!this.closing) this.broadcast({ type: "presence", ...this.presence() });
  }
  async alarm(): Promise<void> {
    await this.finish("expired");
  }
  private async finish(reason: "ended" | "expired"): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    try {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    } catch (error) {
      this.closing = false;
      throw error;
    }
    this.record = null;
    for (const { socket, data } of this.sockets()) {
      send(socket, { type: "ended", reason });
      socket.serializeAttachment({ ...data, active: false, playing: false });
      socket.close(
        1000,
        reason === "ended" ? "Session ended" : "Session expired",
      );
    }
  }
}

function allowedOrigin(request: Request, env: SessionEnv): string | null {
  const origin = request.headers.get("Origin");
  if (origin === env.ALLOWED_ORIGIN) return origin;
  if (origin && env.ALLOW_LOCALHOST === "true") {
    try {
      const url = new URL(origin);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
        url.origin === origin
      )
        return origin;
    } catch {
      return null;
    }
  }
  return null;
}
function response(body: unknown, status: number, origin?: string): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(origin
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
    },
  });
}
async function boundedJson(request: Request): Promise<unknown> {
  if (
    !request.body ||
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_SESSION_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  }
}
async function createSession(
  request: Request,
  env: SessionEnv,
  origin: string,
): Promise<Response> {
  const key = request.headers.get("CF-Connecting-IP") ?? "local";
  const limits = await Promise.all([
    env.CREATE_LIMIT.limit({ key }),
    env.GLOBAL_CREATE_LIMIT.limit({ key: "create" }),
  ]);
  if (limits.some((result) => !result.success))
    return response({ error: "Try again in a minute" }, 429, origin);
  const parsed = createSessionSchema.safeParse(await boundedJson(request));
  if (!parsed.success)
    return response({ error: "Invalid project" }, 400, origin);
  const project = readProject(parsed.data.project);
  if (!project) return response({ error: "Invalid project" }, 400, origin);
  const roomId = randomToken(16),
    hostToken = randomToken(32),
    guestToken = randomToken(32);
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  const [hostHash, guestHash] = await Promise.all([
    tokenHash(hostToken),
    tokenHash(guestToken),
  ]);
  await env.ROOMS.getByName(roomId).initialize({
    project,
    revision: 0,
    hostHash,
    guestHash,
    expiresAt,
    clients: {},
  });
  return response({ roomId, hostToken, guestToken, expiresAt }, 201, origin);
}
export default {
  async fetch(request: Request, env: SessionEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return response({ ok: true }, 200);
    const origin = allowedOrigin(request, env);
    if (!origin) return response({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS" && url.pathname === "/sessions")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        },
      });
    if (url.pathname === "/sessions" && request.method === "POST")
      return createSession(request, env, origin);
    const match = /^\/sessions\/([^/]+)$/.exec(url.pathname);
    const id = roomIdSchema.safeParse(match?.[1]);
    if (request.method === "GET" && id.success) {
      const result = await env.CONNECT_LIMIT.limit({
        key: request.headers.get("CF-Connecting-IP") ?? "local",
      });
      if (!result.success)
        return response({ error: "Try again in a minute" }, 429, origin);
      return env.ROOMS.getByName(id.data).fetch(request);
    }
    return response({ error: "Not found" }, 404, origin);
  },
} satisfies ExportedHandler<SessionEnv>;
