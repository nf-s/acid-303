import { z } from "zod";
import type { Project } from "./model";
import {
  HOST_REPLACED_CODE,
  MAX_SESSION_BYTES,
  SESSION_PROTOCOL,
  clientIdSchema,
  roomIdSchema,
  serverMessageSchema,
  sessionCreatedSchema,
  sessionTokenSchema,
} from "./session-protocol";
import type { ClientMessage, ServerMessage } from "./session-protocol";
import { SessionSync } from "./session-sync";

const credentialsSchema = z.object({
  roomId: roomIdSchema,
  token: sessionTokenSchema,
  guestToken: sessionTokenSchema,
  role: z.enum(["host", "guest"]),
  clientId: clientIdSchema,
  expiresAt: z.number().finite().nonnegative(),
});
type Credentials = z.infer<typeof credentialsSchema>;
const storageKey = "grain-session-v1";
export interface SessionStatus {
  phase:
    "idle" | "connecting" | "connected" | "reconnecting" | "ended" | "error";
  role: "host" | "guest" | null;
  participants: number;
  hostConnected: boolean;
  supportsVocal: boolean;
  inviteLink: string | null;
  message: string;
}
interface SessionCallbacks {
  onState: (state: SessionStatus) => void;
  onProject: (project: Project, initial: boolean) => void;
  onClock: (playing: boolean, absoluteTick: number) => void;
  onTransport: (action: "play" | "stop" | "restart") => void;
  onReady: () => void;
  onEnded: () => void;
}

export function sessionInvite(
  link: string,
): { roomId: string; token: string } | null {
  try {
    const value = new URLSearchParams(new URL(link).hash.slice(1)).get(
      "session",
    );
    if (!value) return null;
    const [room, token, extra] = value.split(".");
    const roomId = roomIdSchema.safeParse(room),
      secret = sessionTokenSchema.safeParse(token);
    if (extra !== undefined || !roomId.success || !secret.success) return null;
    return { roomId: roomId.data, token: secret.data };
  } catch {
    return null;
  }
}

export class SessionClient {
  private credentials: Credentials | null = null;
  private socket: WebSocket | null = null;
  private sync = new SessionSync();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private awaitingSync = false;
  private lastPatchSent = -Infinity;
  private sentSequence = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastReceived = 0;
  private lastPing = 0;
  private hostPlaying = false;
  private lastClockSent = -Infinity;
  private lastClockTick = -1;
  private terminal = false;
  private reconnects = 0;
  private generation = 0;
  private initial = true;
  private status: SessionStatus = {
    phase: "idle",
    role: null,
    participants: 0,
    hostConnected: false,
    supportsVocal: false,
    inviteLink: null,
    message: "",
  };

  constructor(
    private readonly api: string,
    private readonly callbacks: SessionCallbacks,
  ) {
    window.addEventListener("offline", () => {
      if (!this.terminal && this.credentials) {
        if (this.role === "host") this.callbacks.onEnded();
        this.disconnect();
        this.report({
          phase: "reconnecting",
          hostConnected: false,
          supportsVocal: false,
          message: "Offline. Waiting to reconnect…",
        });
        this.callbacks.onClock(false, 0);
      }
    });
    window.addEventListener("online", () => {
      if (!this.terminal && this.credentials && !this.connected)
        this.reconnect();
    });
  }

  get role(): "host" | "guest" | null {
    return this.credentials?.role ?? null;
  }
  get connected(): boolean {
    return this.status.phase === "connected";
  }
  get hostConnected(): boolean {
    return this.status.hostConnected;
  }
  get inviteLink(): string | null {
    return this.status.inviteLink;
  }

  private report(update: Partial<SessionStatus>): void {
    if (update.hostConnected === false)
      update = { ...update, supportsVocal: false };
    this.status = { ...this.status, ...update };
    this.callbacks.onState({ ...this.status });
  }

  private remember(): void {
    try {
      if (this.credentials)
        sessionStorage.setItem(storageKey, JSON.stringify(this.credentials));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The live connection still works without session storage. */
    }
  }

  resume(): boolean {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return false;
      const parsed = credentialsSchema.safeParse(JSON.parse(stored));
      if (
        !parsed.success ||
        (parsed.data.expiresAt > 0 && parsed.data.expiresAt < Date.now())
      ) {
        sessionStorage.removeItem(storageKey);
        return false;
      }
      this.begin(parsed.data);
      return true;
    } catch {
      return false;
    }
  }

  async create(project: Project): Promise<void> {
    if (this.credentials) {
      this.reconnect();
      return;
    }
    const generation = ++this.generation;
    this.report({ phase: "connecting", message: "Creating session…" });
    try {
      const response = await fetch(`${this.api}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Session limit reached. Try again shortly."
            : "Could not create a session.",
        );
      const parsed = sessionCreatedSchema.safeParse(await response.json());
      if (generation !== this.generation) return;
      if (!parsed.success) throw new Error("Invalid session response.");
      const room = parsed.data;
      this.begin({
        roomId: room.roomId,
        token: room.hostToken,
        guestToken: room.guestToken,
        role: "host",
        clientId: crypto.randomUUID(),
        expiresAt: room.expiresAt,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.report({
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create a session.",
      });
    }
  }

  join(link: string): boolean {
    const invite = sessionInvite(link);
    if (!invite) {
      this.report({ message: "Enter a valid session invite link." });
      return false;
    }
    if (
      this.credentials?.roomId === invite.roomId &&
      this.credentials.token === invite.token &&
      this.credentials.role === "guest"
    ) {
      this.reconnect();
      return true;
    }
    this.begin({
      ...invite,
      guestToken: invite.token,
      role: "guest",
      clientId: crypto.randomUUID(),
      expiresAt: 0,
    });
    return true;
  }

  private begin(credentials: Credentials): void {
    this.disconnect();
    this.credentials = credentials;
    this.terminal = false;
    this.sync = new SessionSync();
    this.initial = true;
    this.reconnects = 0;
    const link = new URL(location.href);
    link.hash = `session=${credentials.roomId}.${credentials.guestToken}`;
    this.report({
      phase: "connecting",
      role: credentials.role,
      participants: 0,
      hostConnected: false,
      supportsVocal: false,
      inviteLink: link.href,
      message: "Connecting…",
    });
    this.remember();
    this.connect();
  }

  private disconnect(): void {
    this.generation++;
    clearTimeout(this.retryTimer);
    clearTimeout(this.flushTimer);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    this.awaitingSync = false;
    this.hostPlaying = false;
    this.lastClockSent = -Infinity;
    this.lastClockTick = -1;
    this.retryTimer = undefined;
    this.flushTimer = undefined;
    this.heartbeatTimer = undefined;
    this.socket?.close();
    this.socket = null;
  }

  reconnect(): void {
    if (!this.credentials) return;
    if (this.role === "host") this.callbacks.onEnded();
    this.terminal = false;
    this.disconnect();
    this.reconnects = 0;
    this.report({ phase: "reconnecting", message: "Reconnecting…" });
    this.connect();
  }

  private connect(): void {
    const credentials = this.credentials;
    if (!credentials) return;
    const generation = ++this.generation;
    const url = new URL(`${this.api}/sessions/${credentials.roomId}`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("clientId", credentials.clientId);
    const socket = new WebSocket(url, [SESSION_PROTOCOL, credentials.token]);
    this.socket = socket;
    this.lastReceived = Date.now();
    this.lastPing = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (
        generation !== this.generation ||
        socket.readyState !== WebSocket.OPEN
      )
        return;
      if (
        this.role === "host" &&
        this.hostPlaying &&
        Date.now() - this.lastReceived > 3000
      ) {
        this.callbacks.onEnded();
        socket.close(4000, "Host connection stalled");
      } else if (Date.now() - this.lastReceived > 30000)
        socket.close(4000, "Connection timed out");
      else if (Date.now() - this.lastPing >= 15000) {
        this.lastPing = Date.now();
        socket.send("ping");
      }
    }, 1000);
    const timeout = setTimeout(() => socket.close(), 15000);
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (generation !== this.generation || typeof event.data !== "string")
        return;
      this.lastReceived = Date.now();
      if (event.data === "pong") return;
      if (event.data.length > MAX_SESSION_BYTES) {
        socket.close(1009);
        return;
      }
      try {
        const message = serverMessageSchema.safeParse(JSON.parse(event.data));
        if (!message.success) {
          this.fail("Invalid session data.");
          return;
        }
        clearTimeout(timeout);
        this.receive(message.data);
      } catch {
        this.fail("Invalid session data.");
      }
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      if (generation !== this.generation || !this.credentials) return;
      if (this.role === "host") this.callbacks.onEnded();
      this.disconnect();
      if (event.code === HOST_REPLACED_CODE) {
        this.fail("The host session is open in another tab or device.");
        return;
      }
      if (event.code === 4010) {
        this.fail(
          "Reload Grain to continue this session. Your room is still available.",
        );
        return;
      }
      const throttled =
        event.code === 1008 && event.reason === "Message rate exceeded";
      if (
        (!throttled && event.code === 1008) ||
        [4001, 4003, 4004].includes(event.code)
      ) {
        this.fail("This session is no longer available.");
        return;
      }
      this.report({
        phase: "reconnecting",
        hostConnected: false,
        supportsVocal: false,
        message: "Reconnecting…",
      });
      this.callbacks.onClock(false, 0);
      this.reconnects++;
      if (
        this.credentials.expiresAt > 0 &&
        this.credentials.expiresAt <= Date.now()
      ) {
        this.fail("Session expired.");
        return;
      }
      if (this.reconnects > 8 && this.credentials.expiresAt === 0) {
        this.fail(
          "Could not reconnect. Try again or leave the session.",
          false,
        );
        return;
      }
      this.retryTimer = setTimeout(
        () => this.connect(),
        Math.min(10000, 500 * 2 ** (this.reconnects - 1)),
      );
    });
  }

  private fail(message: string, terminal = true): void {
    this.terminal = terminal;
    this.disconnect();
    this.report({ phase: "error", hostConnected: false, message });
    this.callbacks.onEnded();
  }

  private receive(message: ServerMessage): void {
    const credentials = this.credentials;
    if (!credentials) return;
    if (message.type === "welcome") {
      if (message.role !== credentials.role) {
        this.fail("Session role did not match the invitation.");
        return;
      }
      const kept = this.sync.welcome(
        message.project,
        message.revision,
        message.acknowledgedSequence,
      );
      credentials.expiresAt = message.expiresAt;
      this.remember();
      this.reconnects = 0;
      this.report({
        phase: "connected",
        hostConnected: message.hostConnected,
        supportsVocal: message.supportsVocal,
        participants: message.participants,
        message: kept ? "" : "Some unsynced edits could not be restored.",
      });
      this.publishView(this.initial);
      this.initial = false;
      this.callbacks.onClock(message.playing, message.absoluteTick);
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
      this.awaitingSync = false;
      this.sentSequence = message.acknowledgedSequence;
      this.scheduleFlush();
      this.callbacks.onReady();
      return;
    }
    if (message.type === "patch") {
      if (message.revision <= this.sync.revision) return;
      if (
        !this.sync.patch(
          message.revision,
          message.changes,
          message.clientId === credentials.clientId
            ? message.sequence
            : undefined,
        )
      ) {
        this.requestSync();
        return;
      }
      this.publishView(false);
      this.scheduleFlush();
    } else if (message.type === "ack") {
      if (message.revision > this.sync.revision) this.requestSync();
      else if (message.clientId === credentials.clientId) {
        this.sync.acknowledge(message.sequence);
        this.scheduleFlush();
      }
    } else if (message.type === "presence") {
      const hostReturned = !this.hostConnected && message.hostConnected;
      this.report({
        hostConnected: message.hostConnected,
        supportsVocal: message.supportsVocal,
        participants: message.participants,
      });
      this.callbacks.onClock(message.playing, message.absoluteTick);
      if (hostReturned) this.requestSync();
    } else if (message.type === "clock") {
      this.callbacks.onClock(message.playing, message.absoluteTick);
    } else if (message.type === "transport") {
      if (credentials.role === "host")
        this.callbacks.onTransport(message.action);
    } else if (message.type === "ended") {
      this.terminal = true;
      this.disconnect();
      this.report({
        phase: "ended",
        hostConnected: false,
        supportsVocal: false,
        message:
          message.reason === "expired"
            ? "Session expired."
            : "The host ended this session.",
      });
      this.callbacks.onEnded();
    } else if (message.type === "error") {
      this.report({ message: message.message });
      if (message.code === "rate-limit") this.requestSync(1100);
      else if (message.code === "host-offline") {
        this.report({ hostConnected: false });
      } else if (message.sequence !== undefined) {
        this.sync.discardPending();
        this.requestSync();
      }
    }
  }

  private publishView(initial: boolean): void {
    const project = this.sync.view();
    if (project) this.callbacks.onProject(project, initial);
    else {
      this.sync.discardPending();
      this.requestSync();
    }
  }

  edit(project: Project): void {
    if (!this.connected) return;
    this.sync.edit(project);
    this.scheduleFlush();
  }

  private requestSync(delay = 0): void {
    if (this.awaitingSync || !this.connected) return;
    this.awaitingSync = true;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      this.send({ type: "sync" });
    }, delay);
  }

  private scheduleFlush(): void {
    if (
      this.flushTimer ||
      !this.connected ||
      this.awaitingSync ||
      !this.hostConnected
    )
      return;
    this.flushTimer = setTimeout(() => this.flush(), 100);
  }

  private flush(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (!this.connected || this.awaitingSync || !this.hostConnected) return;
    const remaining = 100 - (performance.now() - this.lastPatchSent);
    if (remaining > 0) {
      this.flushTimer = setTimeout(() => this.flush(), remaining);
      return;
    }
    const credentials = this.credentials;
    if (!credentials) return;
    const edit =
      this.sync.nextUnacknowledged(this.sentSequence) ?? this.sync.flush();
    if (!edit) return;
    this.sentSequence = edit.sequence;
    this.lastPatchSent = performance.now();
    this.send({ type: "patch", clientId: credentials.clientId, ...edit });
    this.scheduleFlush();
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const encoded = JSON.stringify(message);
    if (encoded.length > MAX_SESSION_BYTES) {
      this.fail("This edit is too large to sync.");
      return;
    }
    this.socket.send(encoded);
  }

  clock(playing: boolean, absoluteTick: number): void {
    const changed = playing !== this.hostPlaying;
    this.hostPlaying = playing;
    if (this.role !== "host" || !this.connected) return;
    const now = performance.now();
    const tick = Math.max(0, absoluteTick);
    if (!changed && tick >= this.lastClockTick && now - this.lastClockSent < 50)
      return;
    this.lastClockSent = now;
    this.lastClockTick = tick;
    this.send({ type: "clock", playing, absoluteTick: tick });
  }
  transport(action: "play" | "stop" | "restart"): void {
    if (this.connected) {
      this.flush();
      this.send({ type: "transport", action });
    }
  }
  end(): void {
    if (this.role === "host") this.send({ type: "end" });
  }
  suspend(): void {
    this.disconnect();
  }
  leave(): void {
    this.terminal = true;
    this.disconnect();
    this.credentials = null;
    this.sync = new SessionSync();
    this.remember();
    this.report({
      phase: "idle",
      role: null,
      participants: 0,
      hostConnected: false,
      supportsVocal: false,
      inviteLink: null,
      message: "",
    });
  }
}
