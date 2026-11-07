import { env } from "cloudflare:workers";
import {
  SELF,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createProject,
  resizeDrumTrack,
  resizeBassTrack,
  resizeKeysTrack,
} from "../../../src/model";
import { resizeArpTrack } from "../../../src/arp-model";
import { resizePadTrack } from "../../../src/pad-model";
import {
  sequenceTimingSchema,
  padTimingSchema,
  trackStepCount,
} from "../../../src/timing";
import {
  SESSION_PROTOCOL,
  MAX_SESSION_BYTES,
  diffProject,
  sessionCreatedSchema,
  serverMessageSchema,
} from "../../../src/session-protocol";
import type {
  ServerMessage,
  SessionCreated,
} from "../../../src/session-protocol";

const origin = "https://acid-303.pages.dev";
let ip = 0;
const peers: WebSocket[] = [];
afterEach(() => {
  for (const socket of peers.splice(0))
    if (socket.readyState === WebSocket.OPEN)
      socket.close(1000, "Test complete");
});
async function create(): Promise<SessionCreated> {
  const result = await SELF.fetch("https://sessions.test/sessions", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "CF-Connecting-IP": `192.0.2.${++ip}`,
    },
    body: JSON.stringify({ project: createProject() }),
  });
  expect(result.status).toBe(201);
  return sessionCreatedSchema.parse(await result.json());
}
async function upgrade(
  room: SessionCreated,
  token: string,
  clientId = crypto.randomUUID(),
  protocol = SESSION_PROTOCOL,
): Promise<Response> {
  return SELF.fetch(
    `https://sessions.test/sessions/${room.roomId}?clientId=${clientId}`,
    {
      headers: {
        Origin: origin,
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `${protocol}, ${token}`,
        "CF-Connecting-IP": `198.51.100.${++ip}`,
      },
    },
  );
}
class Peer {
  readonly messages: ServerMessage[] = [];
  private wake: (() => void) | undefined;
  constructor(
    readonly socket: WebSocket,
    readonly clientId: string,
  ) {
    peers.push(socket);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string")
        throw new Error("Unexpected binary data");
      if (event.data === "pong") return;
      this.messages.push(serverMessageSchema.parse(JSON.parse(event.data)));
      this.wake?.();
    });
    socket.accept();
  }
  async next<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    while (true) {
      const index = this.messages.findIndex((item) => item.type === type);
      const message = this.messages[index];
      if (message && message.type === type) {
        this.messages.splice(index, 1);
        return narrow(message, type);
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
  patch(sequence: number, path: (string | number)[], value: number): void {
    this.send({
      type: "patch",
      clientId: this.clientId,
      sequence,
      changes: [{ path, value }],
    });
  }
}
function narrow<T extends ServerMessage["type"]>(
  message: ServerMessage,
  type: T,
): Extract<ServerMessage, { type: T }> {
  const match = (
    value: ServerMessage,
  ): value is Extract<ServerMessage, { type: T }> => value.type === type;
  if (!match(message)) throw new Error("Unexpected message");
  return message;
}
async function connect(
  room: SessionCreated,
  token: string,
  clientId = crypto.randomUUID(),
): Promise<Peer> {
  const result = await upgrade(room, token, clientId);
  expect(result.status).toBe(101);
  expect(result.headers.get("Sec-WebSocket-Protocol")).toBe(SESSION_PROTOCOL);
  if (!result.webSocket) throw new Error("No WebSocket");
  return new Peer(result.webSocket, clientId);
}
function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) =>
    socket.addEventListener("close", (event) => resolve(event.code), {
      once: true,
    }),
  );
}

describe("session rooms in the Workers runtime", () => {
  it("preserves final arp and pad automation through concurrent edits and recovery", async () => {
    const room = await create();
    const host = await connect(room, room.hostToken);
    const guest = await connect(room, room.guestToken);
    await host.next("welcome");
    await guest.next("welcome");
    const ascending = Array.from({ length: 16 }, (_, index) => index / 15);
    const descending = Array.from(
      { length: 128 },
      (_, index) => 1 - index / 127,
    );
    host.send({
      type: "patch",
      clientId: host.clientId,
      sequence: 1,
      changes: [{ path: ["arp", "automation", "tone"], value: ascending }],
    });
    guest.send({
      type: "patch",
      clientId: guest.clientId,
      sequence: 1,
      changes: [{ path: ["pad", "automation", "motion"], value: descending }],
    });
    await guest.next("patch");
    await guest.next("patch");
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    guest.send({ type: "sync" });
    const restored = await guest.next("welcome");
    expect(restored.project.arp.automation.tone).toEqual(ascending);
    expect(restored.project.pad.automation.motion).toEqual(descending);
    guest.patch(2, ["arp", "automation", "tone", 4], 0.8);
    expect(await guest.next("patch")).toMatchObject({ revision: 3 });
    guest.send({ type: "sync" });
    const edited = await guest.next("welcome");
    expect(edited.project.arp.automation.tone?.[4]).toBe(0.8);
    expect(edited.project.pad.automation.motion).toEqual(descending);
  });
  it("rejects old clocks without replacing a valid host and migrates persisted v2 music", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    host.patch(1, ["bpm"], 137);
    await host.next("patch");
    const old = await upgrade(
      room,
      room.hostToken,
      crypto.randomUUID(),
      "grain-session-v1",
    );
    expect(old.status).toBe(101);
    if (!old.webSocket) throw new Error("No legacy WebSocket");
    const closed = closeCode(old.webSocket);
    const peer = new Peer(old.webSocket, crypto.randomUUID());
    expect(await peer.next("error")).toMatchObject({ code: "reload-required" });
    expect(await closed).toBe(4010);
    host.send({ type: "sync" });
    expect(await host.next("welcome")).toMatchObject({
      hostConnected: true,
      revision: 1,
    });
    const stub = env.ROOMS.getByName(room.roomId);
    await runInDurableObject(stub, (_instance, state) => {
      const row = z
        .object({ data: z.string() })
        .parse(
          state.storage.sql
            .exec("SELECT data FROM session_state WHERE id = 1")
            .one(),
        );
      const record = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(row.data));
      const project = createProject();
      const legacy = {
        ...project,
        version: 2,
        bpm: 137,
        pad: { ...project.pad, bars: 8 },
      };
      state.storage.sql.exec(
        "UPDATE session_state SET data = ? WHERE id = 1",
        JSON.stringify({ ...record, project: legacy }),
      );
    });
    await evictDurableObject(stub);
    host.send({ type: "sync" });
    const restored = await host.next("welcome");
    expect(restored).toMatchObject({
      revision: 1,
      acknowledgedSequence: 1,
      role: "host",
      hostConnected: true,
    });
    expect(restored.project.version).toBe(3);
    expect(restored.project.pad.timing.bars).toBe(8);
    expect(restored.project.bass.timing).toEqual({
      bars: 1,
      meter: "4/4",
      grid: "straight",
    });
    host.patch(1, ["bpm"], 99);
    expect(await host.next("ack")).toMatchObject({ revision: 1, sequence: 1 });
  });
  it("persists maximum-length automation in one indexed row and merges sparse remote cells", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    const original = await host.next("welcome");
    const project = structuredClone(original.project);
    const timing = sequenceTimingSchema.parse({
      bars: 8,
      meter: "5/4",
      grid: "triplet",
    });
    project.drums = project.drums.map((track) =>
      resizeDrumTrack(track, timing),
    );
    project.bass = resizeBassTrack(project.bass, timing);
    project.keys = resizeKeysTrack(project.keys, timing);
    project.arp = resizeArpTrack(project.arp, timing);
    project.pad = resizePadTrack(
      project.pad,
      padTimingSchema.parse({ ...timing, bars: 16 }),
    );
    let seed = 9123;
    for (const track of [
      ...project.drums,
      project.bass,
      project.keys,
      project.arp,
      project.pad,
    ]) {
      const automation: Record<string, number[] | null> = track.automation;
      for (const key of Object.keys(automation))
        automation[key] = Array.from(
          { length: trackStepCount(track.timing) },
          () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967295;
          },
        );
    }
    const changes = diffProject(original.project, project);
    const message = {
      type: "patch",
      clientId: host.clientId,
      sequence: 1,
      changes,
    };
    expect(
      new TextEncoder().encode(JSON.stringify(message)).length,
    ).toBeLessThan(MAX_SESSION_BYTES);
    host.send(message);
    expect(await host.next("patch")).toMatchObject({ revision: 1 });
    host.send({
      type: "patch",
      clientId: host.clientId,
      sequence: 2,
      changes: [
        {
          path: ["pad", "automation", "tone"],
          entries: [
            [478, 0.1],
            [479, 0.9],
          ],
        },
      ],
    });
    expect(await host.next("patch")).toMatchObject({ revision: 2 });
    const cost = await runInDurableObject(
      env.ROOMS.getByName(room.roomId),
      (_instance, state) => {
        const query = state.storage.sql.exec(
          "SELECT data FROM session_state WHERE id = 1",
        );
        const row = z.object({ data: z.string() }).parse(query.one());
        const update = state.storage.sql.exec(
          "UPDATE session_state SET data = ? WHERE id = 1",
          row.data,
        );
        return {
          read: query.rowsRead,
          written: update.rowsWritten,
          updateRead: update.rowsRead,
          bytes: new TextEncoder().encode(row.data).length,
        };
      },
    );
    expect(cost).toMatchObject({ read: 1, written: 1, updateRead: 1 });
    expect(cost.bytes).toBeGreaterThan(380000);
    expect(cost.bytes).toBeLessThan(MAX_SESSION_BYTES);
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    host.send({ type: "sync" });
    const restored = await host.next("welcome");
    expect(restored.project.pad.automation.tone?.slice(478)).toEqual([
      0.1, 0.9,
    ]);
    expect(restored.project.drums[0]?.automation.tone).toEqual(
      project.drums[0]?.automation.tone,
    );
  });
  it("authenticates distinct credentials and denies untrusted origins", async () => {
    const room = await create();
    expect(room.hostToken).not.toBe(room.guestToken);
    const denied = await SELF.fetch("https://sessions.test/sessions", {
      method: "POST",
      headers: {
        Origin: "https://other.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(denied.status).toBe(403);
    expect((await upgrade(room, "x".repeat(43))).status).toBe(403);
    const guest = await connect(room, room.guestToken);
    expect(await guest.next("welcome")).toMatchObject({
      role: "guest",
      hostConnected: false,
      playing: false,
    });
    guest.send({ type: "clock", playing: true, absoluteTick: 9 });
    expect(await guest.next("error")).toMatchObject({ code: "host-only" });
    guest.send({ type: "end" });
    expect(await guest.next("error")).toMatchObject({ code: "host-only" });
    guest.patch(1, ["bpm"], 145);
    expect(await guest.next("error")).toMatchObject({
      code: "host-offline",
      sequence: 1,
    });
  });
  it("orders simultaneous edits, persists before acknowledgement and deduplicates after hibernation", async () => {
    const room = await create();
    const host = await connect(room, room.hostToken);
    const guest = await connect(room, room.guestToken);
    await host.next("welcome");
    await guest.next("welcome");
    host.patch(1, ["bpm"], 141);
    guest.patch(1, ["bass", "volume"], 0.7);
    const first = await guest.next("patch"),
      second = await guest.next("patch");
    expect([first.revision, second.revision]).toEqual([1, 2]);
    const stub = env.ROOMS.getByName(room.roomId);
    await evictDurableObject(stub);
    guest.send({ type: "sync" });
    const synced = await guest.next("welcome");
    expect(synced.project.bpm).toBe(141);
    expect(synced.project.bass.volume).toBe(0.7);
    expect(synced.acknowledgedSequence).toBe(1);
    guest.patch(1, ["bpm"], 70);
    expect(await guest.next("ack")).toMatchObject({ revision: 2, sequence: 1 });
    guest.send({ type: "sync" });
    expect((await guest.next("welcome")).project.bpm).toBe(141);
  });
  it("routes transport to the host and preserves its clock through hibernation", async () => {
    const room = await create();
    const host = await connect(room, room.hostToken),
      guest = await connect(room, room.guestToken);
    await host.next("welcome");
    await guest.next("welcome");
    guest.send({ type: "transport", action: "restart" });
    expect(await host.next("transport")).toMatchObject({
      action: "restart",
      clientId: guest.clientId,
    });
    host.send({ type: "clock", playing: true, absoluteTick: 82 });
    expect(await guest.next("clock")).toMatchObject({
      playing: true,
      absoluteTick: 82,
    });
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    guest.send({ type: "sync" });
    expect(await guest.next("welcome")).toMatchObject({
      playing: true,
      absoluteTick: 82,
      hostConnected: true,
    });
    host.socket.close(1000, "Host left");
    let presence = await guest.next("presence");
    while (presence.hostConnected) presence = await guest.next("presence");
    expect(presence.playing).toBe(false);
    guest.send({ type: "transport", action: "play" });
    expect(await guest.next("error")).toMatchObject({ code: "host-offline" });
    const returned = await connect(room, room.hostToken);
    expect(await returned.next("welcome")).toMatchObject({
      role: "host",
      playing: false,
    });
  });
  it("replaces a host with a nonretryable close and never lets a guest steal its identity", async () => {
    const room = await create(),
      clientId = crypto.randomUUID();
    const host = await connect(room, room.hostToken, clientId);
    await host.next("welcome");
    expect((await upgrade(room, room.guestToken, clientId)).status).toBe(409);
    const closed = closeCode(host.socket);
    const replacement = await connect(room, room.hostToken, clientId);
    expect(await closed).toBe(4009);
    expect(await replacement.next("welcome")).toMatchObject({
      role: "host",
      participants: 1,
      playing: false,
    });
  });
  it("reserves the eighth slot for the host", async () => {
    const room = await create();
    for (let index = 0; index < 7; index++)
      await (await connect(room, room.guestToken)).next("welcome");
    expect((await upgrade(room, room.guestToken)).status).toBe(409);
    expect(
      await (await connect(room, room.hostToken)).next("welcome"),
    ).toMatchObject({ participants: 8 });
  });
  it("rejects malformed, oversized and invalid-result edits without changing the project", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    host.socket.send("{");
    expect(await host.next("error")).toMatchObject({ code: "invalid-message" });
    host.patch(1, ["bpm"], 999);
    expect(await host.next("error")).toMatchObject({ code: "invalid-patch" });
    host.send({
      type: "patch",
      clientId: host.clientId,
      sequence: 1,
      changes: [{ path: ["__proto__", "polluted"], value: 1 }],
    });
    expect(await host.next("error")).toMatchObject({ code: "invalid-message" });
    host.send({ type: "sync" });
    expect(await host.next("welcome")).toMatchObject({ revision: 0 });
    const closed = closeCode(host.socket);
    host.socket.send("x".repeat(MAX_SESSION_BYTES + 1));
    expect(await closed).toBe(1009);
  });
  it("revokes credentials and deletes storage on end and expiry", async () => {
    for (const method of ["end", "alarm"]) {
      const room = await create(),
        host = await connect(room, room.hostToken);
      await host.next("welcome");
      if (method === "end") host.send({ type: "end" });
      else
        expect(
          await runDurableObjectAlarm(env.ROOMS.getByName(room.roomId)),
        ).toBe(true);
      expect(await host.next("ended")).toMatchObject({
        reason: method === "end" ? "ended" : "expired",
      });
      expect((await upgrade(room, room.hostToken)).status).toBe(404);
    }
  });
  it("answers idle heartbeats after hibernation without changing session data", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    const pong = new Promise<string>((resolve) =>
      host.socket.addEventListener(
        "message",
        (event) => {
          if (event.data === "pong") resolve(event.data);
        },
        { once: true },
      ),
    );
    host.socket.send("ping");
    expect(await pong).toBe("pong");
    host.send({ type: "sync" });
    expect(await host.next("welcome")).toMatchObject({
      revision: 0,
      playing: false,
    });
  });
  it("does not allocate persisted room tables for unknown room IDs", async () => {
    const room = {
      roomId: "x".repeat(22),
      hostToken: "h".repeat(43),
      guestToken: "g".repeat(43),
      expiresAt: Date.now() + 10000,
    };
    expect((await upgrade(room, room.hostToken)).status).toBe(404);
    const tables = await runInDurableObject(
      env.ROOMS.getByName(room.roomId),
      (_instance, state) =>
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_state'",
          )
          .toArray(),
    );
    expect(tables).toEqual([]);
  });
  it("limits creation and malformed packet floods", async () => {
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.200",
    };
    const statuses: number[] = [];
    for (let index = 0; index < 7; index++)
      statuses.push(
        (
          await SELF.fetch("https://sessions.test/sessions", {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
      );
    expect(statuses.slice(0, 6)).toEqual(Array(6).fill(400));
    expect(statuses[6]).toBe(429);
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    const closed = closeCode(host.socket);
    for (let index = 0; index < 61; index++) host.socket.send("{");
    expect(await closed).toBe(1008);
  });
  it("uses indexed point reads and one row write while clocks do not touch persisted state", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    const stub = env.ROOMS.getByName(room.roomId);
    const measure = () =>
      runInDurableObject(stub, (_instance, state) => {
        const query = state.storage.sql.exec(
          "SELECT data FROM session_state WHERE id = 1",
        );
        const rows = query.toArray();
        const plan = state.storage.sql
          .exec(
            "EXPLAIN QUERY PLAN SELECT data FROM session_state WHERE id = 1",
          )
          .toArray();
        const row = z.object({ data: z.string() }).parse(rows[0]);
        const update = state.storage.sql.exec(
          "INSERT INTO session_state (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
          row.data,
        );
        return {
          read: query.rowsRead,
          updateRead: update.rowsRead,
          written: update.rowsWritten,
          rows,
          plan,
        };
      });
    const before = await measure();
    expect(before.read).toBe(1);
    expect(before.written).toBe(1);
    expect(before.updateRead).toBe(1);
    expect(JSON.stringify(before.plan)).toContain("USING INTEGER PRIMARY KEY");
    for (let index = 0; index < 16; index++)
      host.send({ type: "clock", playing: true, absoluteTick: index });
    for (let index = 0; index < 16; index++) await host.next("clock");
    expect((await measure()).rows).toEqual(before.rows);
    host.patch(1, ["bpm"], 144);
    await host.next("patch");
    const after = await measure();
    const row = z.object({ data: z.string() }).parse(after.rows[0]);
    expect(
      z.object({ revision: z.number() }).parse(JSON.parse(row.data)).revision,
    ).toBe(1);
  });
});
