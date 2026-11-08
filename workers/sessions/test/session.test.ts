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
import { resizeCloudTrack } from "../../../src/cloud-model";
import { resizeTensionTrack } from "../../../src/tension-model";
import { resizeVocalTrack } from "../../../src/vocal-model";
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
  versionSixProject,
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

function nextLegacyMessage(
  socket: WebSocket,
  type: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const receive = (event: MessageEvent) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      const message = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(event.data));
      if (message.type !== type) return;
      socket.removeEventListener("message", receive);
      resolve(message);
    };
    socket.addEventListener("message", receive);
  });
}

describe("session rooms in the Workers runtime", () => {
  it("preserves v7 vocal gain through v6 edits and hibernation without promoting the old host", async () => {
    const room = await create(),
      id = crypto.randomUUID();
    const response = await upgrade(
        room,
        room.hostToken,
        id,
        "grain-session-v6",
      ),
      old = response.webSocket;
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(
      "grain-session-v6",
    );
    if (!old) throw new Error("Missing v6 socket");
    peers.push(old);
    const first = nextLegacyMessage(old, "welcome");
    old.accept();
    const welcome = await first;
    expect(welcome).toMatchObject({
      supportsComposition: true,
      project: { version: 6 },
    });
    expect(welcome).not.toHaveProperty("supportsVocalGain");
    expect(welcome.project).not.toHaveProperty("vocal.gain");
    expect(welcome.project).not.toHaveProperty("vocal.automation.gain");
    const guest = await connect(room, room.guestToken),
      initial = await guest.next("welcome");
    expect(initial).toMatchObject({
      supportsComposition: true,
      supportsVocalGain: false,
    });
    const gain = Array.from({ length: 16 }, (_, index) => index / 16);
    const projected = nextLegacyMessage(old, "patch");
    guest.send({
      type: "patch",
      clientId: guest.clientId,
      sequence: 1,
      changes: [
        { path: ["vocal", "gain"], value: 0.75 },
        { path: ["vocal", "automation", "gain"], value: gain },
      ],
    });
    const hidden = await projected;
    expect(JSON.stringify(hidden)).not.toContain('"gain"');
    await guest.next("patch");
    const previous = versionSixProject(initial.project).vocal;
    for (const [sequence, changes] of [
      [1, [{ path: ["vocal"], value: { ...previous, tone: 0.77 } }]],
      [
        2,
        [
          {
            path: ["vocal", "automation"],
            value: { ...previous.automation, tone: Array(16).fill(0.6) },
          },
        ],
      ],
    ]) {
      const edited = nextLegacyMessage(old, "patch");
      old.send(
        JSON.stringify({ type: "patch", clientId: id, sequence, changes }),
      );
      await edited;
      await guest.next("patch");
    }
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    const restored = nextLegacyMessage(old, "welcome");
    old.send(JSON.stringify({ type: "sync" }));
    expect(await restored).toMatchObject({
      acknowledgedSequence: 2,
      revision: 3,
      supportsComposition: true,
    });
    guest.send({ type: "sync" });
    expect(await guest.next("welcome")).toMatchObject({
      supportsComposition: true,
      supportsVocalGain: false,
      project: {
        vocal: {
          gain: 0.75,
          tone: 0.77,
          automation: { gain, tone: Array(16).fill(0.6) },
        },
      },
    });
    const denied = nextLegacyMessage(old, "error");
    old.send(
      JSON.stringify({
        type: "patch",
        clientId: id,
        sequence: 3,
        changes: [{ path: ["vocal", "gain"], value: 0.2 }],
      }),
    );
    expect(await denied).toMatchObject({ code: "invalid-patch" });
    const closed = closeCode(old),
      host = await connect(room, room.hostToken, id);
    expect(await closed).toBe(4009);
    expect(await host.next("welcome")).toMatchObject({
      supportsVocalGain: true,
      project: { vocal: { gain: 0.75, automation: { gain } } },
    });
    host.send({ type: "end" });
    await guest.next("ended");
  });
  it("keeps a musical vocal sample intact when a v4 host edits its masked track", async () => {
    const room = await create(),
      id = crypto.randomUUID(),
      response = await upgrade(room, room.hostToken, id, "grain-session-v4"),
      old = response.webSocket;
    if (!old) throw new Error("Missing legacy socket");
    peers.push(old);
    const initial = nextLegacyMessage(old, "welcome");
    old.accept();
    const legacy = z
      .object({
        project: z.object({ vocal: z.record(z.string(), z.unknown()) }),
      })
      .parse(await initial);
    const guest = await connect(room, room.guestToken);
    const welcome = await guest.next("welcome");
    expect(welcome).toMatchObject({
      supportsVocal: true,
      supportsVocalMusic: false,
      supportsCloud: false,
    });
    const projection = nextLegacyMessage(old, "patch");
    guest.send({
      type: "patch",
      clientId: guest.clientId,
      sequence: 1,
      changes: [
        { path: ["vocal", "sound"], value: 47 },
        { path: ["vocal", "muted"], value: false },
      ],
    });
    expect(await projection).toMatchObject({
      revision: 1,
      changes: [{ path: ["vocal"], value: { sound: 0, muted: true } }],
    });
    await guest.next("patch");
    const masked = {
      ...legacy.project.vocal,
      sound: 0,
      muted: true,
      tone: 0.77,
    };
    const edited = nextLegacyMessage(old, "patch");
    old.send(
      JSON.stringify({
        type: "patch",
        clientId: id,
        sequence: 1,
        changes: [{ path: ["vocal"], value: masked }],
      }),
    );
    await edited;
    await guest.next("patch");
    guest.send({ type: "sync" });
    expect(await guest.next("welcome")).toMatchObject({
      revision: 2,
      project: { vocal: { sound: 47, muted: false, tone: 0.77 } },
    });
    const denied = nextLegacyMessage(old, "error");
    old.send(
      JSON.stringify({
        type: "patch",
        clientId: id,
        sequence: 2,
        changes: [{ path: ["vocal", "sound"], value: 46 }],
      }),
    );
    expect(await denied).toMatchObject({ code: "invalid-patch" });
    const ending = nextLegacyMessage(old, "ended");
    old.send(JSON.stringify({ type: "end" }));
    await ending;
    await guest.next("ended");
  });
  it("keeps v4 hosts and hidden v5 instruments across hibernation without capability promotion", async () => {
    const room = await create(),
      id = crypto.randomUUID();
    const response = await upgrade(
        room,
        room.hostToken,
        id,
        "grain-session-v4",
      ),
      old = response.webSocket;
    if (!old) throw new Error("Missing v4 socket");
    peers.push(old);
    const initial = nextLegacyMessage(old, "welcome");
    old.accept();
    const previous = await initial;
    expect(previous).toMatchObject({
      supportsVocal: true,
      project: { version: 4 },
    });
    expect(previous).not.toHaveProperty("supportsCloud");
    expect(previous.project).not.toHaveProperty("cloud");
    const guest = await connect(room, room.guestToken);
    expect(await guest.next("welcome")).toMatchObject({
      supportsVocal: true,
      supportsCloud: false,
      supportsTension: false,
    });
    const hidden = nextLegacyMessage(old, "patch");
    guest.send({
      type: "patch",
      clientId: guest.clientId,
      sequence: 1,
      changes: [
        { path: ["cloud", "scan"], value: 0.81 },
        { path: ["tension", "pick"], value: 0.23 },
      ],
    });
    expect(await hidden).toMatchObject({ revision: 1, changes: [] });
    await guest.next("patch");
    const invalid = nextLegacyMessage(old, "error");
    old.send(
      JSON.stringify({
        type: "patch",
        clientId: id,
        sequence: 1,
        changes: [{ path: ["cloud", "volume"], value: 1 }],
      }),
    );
    expect(await invalid).toMatchObject({ code: "invalid-patch" });
    const accepted = nextLegacyMessage(old, "patch");
    old.send(
      JSON.stringify({
        type: "patch",
        clientId: id,
        sequence: 1,
        changes: [
          { path: ["vocal", "sound"], value: 23 },
          { path: ["bpm"], value: 132 },
        ],
      }),
    );
    expect(await accepted).toMatchObject({ revision: 2 });
    await guest.next("patch");
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    const recovered = nextLegacyMessage(old, "welcome");
    old.send(JSON.stringify({ type: "sync" }));
    expect(await recovered).toMatchObject({
      revision: 2,
      acknowledgedSequence: 1,
      project: { version: 4, vocal: { sound: 23 } },
    });
    guest.send({ type: "sync" });
    expect(await guest.next("welcome")).toMatchObject({
      project: { version: 6, cloud: { scan: 0.81 }, tension: { pick: 0.23 } },
      supportsCloud: false,
    });
    const closed = closeCode(old),
      host = await connect(room, room.hostToken, id);
    expect(await host.next("welcome")).toMatchObject({
      supportsVocal: true,
      supportsCloud: true,
      supportsTension: true,
      playing: false,
      acknowledgedSequence: 1,
    });
    expect(await closed).toBe(4009);
    host.send({ type: "end" });
    expect(await guest.next("ended")).toMatchObject({ reason: "ended" });
  });
  it("keeps active v3 hosts editing beside current vocal guests through hibernation", async () => {
    const room = await create(),
      id = crypto.randomUUID();
    const response = await upgrade(
      room,
      room.hostToken,
      id,
      "grain-session-v3",
    );
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(
      "grain-session-v3",
    );
    const old = response.webSocket;
    if (!old) throw new Error("Missing legacy socket");
    peers.push(old);
    const initial = nextLegacyMessage(old, "welcome");
    old.accept();
    const previous = await initial;
    expect(previous).not.toHaveProperty("supportsVocal");
    expect(previous.project).toMatchObject({ version: 3 });
    expect(previous.project).not.toHaveProperty("vocal");
    const guest = await connect(room, room.guestToken);
    expect(await guest.next("welcome")).toMatchObject({
      role: "guest",
      supportsVocal: false,
      hostConnected: true,
    });
    const empty = nextLegacyMessage(old, "patch");
    guest.patch(1, ["vocal", "volume"], 0.71);
    expect(await guest.next("patch")).toMatchObject({ revision: 1 });
    expect(await empty).toMatchObject({ revision: 1, changes: [] });
    const oldEdit = nextLegacyMessage(old, "patch");
    old.send(
      JSON.stringify({
        type: "patch",
        clientId: id,
        sequence: 1,
        changes: [{ path: ["bpm"], value: 137 }],
      }),
    );
    expect(await oldEdit).toMatchObject({
      revision: 2,
      changes: [{ path: ["bpm"], value: 137 }],
    });
    expect(await guest.next("patch")).toMatchObject({ revision: 2 });
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    const recovered = nextLegacyMessage(old, "welcome");
    old.send(JSON.stringify({ type: "sync" }));
    expect(await recovered).toMatchObject({
      revision: 2,
      acknowledgedSequence: 1,
      project: { version: 3, bpm: 137 },
    });
    expect(old.readyState).toBe(WebSocket.OPEN);
    guest.send({ type: "sync" });
    expect(await guest.next("welcome")).toMatchObject({
      supportsVocal: false,
      revision: 2,
      project: { version: 6, vocal: { volume: 0.71 } },
    });
    const closed = closeCode(old);
    const modernHost = await connect(room, room.hostToken, id);
    expect(await modernHost.next("welcome")).toMatchObject({
      supportsVocal: true,
      playing: false,
      acknowledgedSequence: 1,
    });
    expect(await closed).toBe(4009);
    guest.send({ type: "sync" });
    expect(await guest.next("welcome")).toMatchObject({ supportsVocal: true });
    modernHost.send({ type: "end" });
    expect(await guest.next("ended")).toMatchObject({ reason: "ended" });
  });
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
    for (const protocol of ["grain-session-v1", "grain-session-v2"]) {
      const old = await upgrade(
        room,
        room.hostToken,
        crypto.randomUUID(),
        protocol,
      );
      expect(old.status).toBe(101);
      expect(old.headers.get("Sec-WebSocket-Protocol")).toBe(protocol);
      if (!old.webSocket) throw new Error("No legacy WebSocket");
      const closed = closeCode(old.webSocket);
      const peer = new Peer(old.webSocket, crypto.randomUUID());
      expect(await peer.next("error")).toMatchObject({
        code: "reload-required",
      });
      expect(await closed).toBe(4010);
    }
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
    expect(restored.project.version).toBe(6);
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
    project.drums = project.drums.map((track) => ({
      ...track,
      sound: track.id === "hat" ? 7 : 6,
    }));
    project.bass.sound = 10;
    project.keys.sound = 7;
    project.arp.sound = 7;
    project.pad.sound = 7;
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
    project.vocal = resizeVocalTrack(project.vocal, { ...timing, bars: 16 });
    project.vocal.sound = 47;
    project.cloud = resizeCloudTrack(project.cloud, { ...timing, bars: 16 });
    project.tension = resizeTensionTrack(project.tension, {
      ...timing,
      bars: 16,
    });
    project.cloud.sound = 5;
    project.tension.sound = 5;
    project.vocal.notes = Array.from(
      { length: trackStepCount(project.vocal.timing) },
      (_, start) => ({ start, length: 1, note: 60, accent: start % 3 === 0 }),
    );
    let seed = 9123;
    for (const track of [
      ...project.drums,
      project.bass,
      project.keys,
      project.arp,
      project.pad,
      project.vocal,
      project.cloud,
      project.tension,
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
    expect(cost.bytes).toBeGreaterThan(530000);
    expect(cost.bytes).toBeLessThan(MAX_SESSION_BYTES);
    await evictDurableObject(env.ROOMS.getByName(room.roomId));
    host.send({ type: "sync" });
    const restored = await host.next("welcome");
    expect(restored.project.cloud.steps).toHaveLength(480);
    expect(restored.project.tension.automation.coupling).toEqual(
      project.tension.automation.coupling,
    );
    expect(restored.project.cloud.automation.scan).toEqual(
      project.cloud.automation.scan,
    );
    expect(restored.project.vocal.notes).toHaveLength(480);
    expect(restored.project.vocal.automation.start).toEqual(
      project.vocal.automation.start,
    );
    expect(restored.project.vocal.sound).toBe(47);
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
  it.each([1005, 1006, 1015])(
    "clears host presence without echoing reserved close code %i",
    async (code) => {
      const room = await create();
      const host = await connect(room, room.hostToken),
        guest = await connect(room, room.guestToken);
      await host.next("welcome");
      await guest.next("welcome");
      host.send({ type: "clock", playing: true, absoluteTick: 82 });
      await guest.next("clock");
      const stub = env.ROOMS.getByName(room.roomId);
      await evictDurableObject(stub);
      await runInDurableObject(stub, (instance, state) => {
        const socket = state.getWebSockets().find((peer) => {
          const data = peer.deserializeAttachment();
          return data?.clientId === host.clientId;
        });
        if (!socket) throw new Error("Missing host socket");
        // Reserved codes describe runtime events and cannot be sent by close().
        if (!instance.webSocketClose) throw new Error("Missing close handler");
        instance.webSocketClose(socket, code, "", false);
        expect(socket.deserializeAttachment()).toMatchObject({
          active: false,
          playing: false,
        });
      });
      let presence = await guest.next("presence");
      while (presence.hostConnected) presence = await guest.next("presence");
      expect(presence).toMatchObject({
        hostConnected: false,
        playing: false,
        participants: 1,
      });
    },
  );
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
  it("closes hibernating v2 sockets on the catalog upgrade without losing room state", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    host.patch(1, ["bpm"], 139);
    await host.next("patch");
    const stub = env.ROOMS.getByName(room.roomId);
    await runInDurableObject(stub, (_instance, state) => {
      for (const socket of state.getWebSockets()) {
        const data = z
          .record(z.string(), z.unknown())
          .parse(socket.deserializeAttachment());
        socket.serializeAttachment({ ...data, protocol: 2 });
      }
    });
    const closed = closeCode(host.socket);
    await evictDurableObject(stub);
    host.send({ type: "sync" });
    expect(await host.next("error")).toMatchObject({ code: "reload-required" });
    expect(await closed).toBe(4010);
    const restored = await connect(room, room.hostToken, host.clientId);
    expect(await restored.next("welcome")).toMatchObject({
      role: "host",
      revision: 1,
      acknowledgedSequence: 1,
      project: { bpm: 139 },
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
  it("keeps transport and recovery available when only edits are throttled", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    for (let sequence = 1; sequence <= 25; sequence++)
      host.patch(sequence, ["bass", "cutoff"], 500 + sequence);
    expect(await host.next("error")).toMatchObject({
      code: "rate-limit",
      sequence: 25,
    });
    host.send({ type: "clock", playing: true, absoluteTick: 96 });
    expect(await host.next("clock")).toMatchObject({
      playing: true,
      absoluteTick: 96,
    });
    host.send({ type: "sync" });
    expect(await host.next("welcome")).toMatchObject({
      revision: 24,
      acknowledgedSequence: 24,
      project: { bass: { cutoff: 524 } },
    });
    host.send({ type: "transport", action: "stop" });
    expect(await host.next("transport")).toMatchObject({ action: "stop" });
    host.send({ type: "end" });
    expect(await host.next("ended")).toMatchObject({ reason: "ended" });
  });
  it("keeps a throttled room and its deduplication state available for reconnect", async () => {
    const room = await create(),
      host = await connect(room, room.hostToken);
    await host.next("welcome");
    host.patch(1, ["bpm"], 139);
    await host.next("patch");
    const closed = closeCode(host.socket);
    for (let index = 0; index < 61; index++) host.socket.send("{");
    expect(await closed).toBe(1013);
    const restored = await connect(room, room.hostToken, host.clientId);
    expect(await restored.next("welcome")).toMatchObject({
      revision: 1,
      acknowledgedSequence: 1,
      role: "host",
      playing: false,
      project: { bpm: 139 },
    });
    restored.send({ type: "end" });
    expect(await restored.next("ended")).toMatchObject({ reason: "ended" });
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
    expect(await closed).toBe(1013);
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
