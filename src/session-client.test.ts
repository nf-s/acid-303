import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "./model";
import type { Project } from "./model";
import { SessionClient } from "./session-client";
import type { SessionStatus } from "./session-client";
import { clientMessageSchema } from "./session-protocol";
import type { ServerMessage } from "./session-protocol";

class SocketClose extends Event {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close");
  }
}
class TestSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly sockets: TestSocket[] = [];
  readyState = 1;
  readonly sent: string[] = [];
  constructor() {
    super();
    TestSocket.sockets.push(this);
  }
  send(value: string): void {
    this.sent.push(value);
  }
  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new SocketClose(code, reason));
  }
  receive(message: ServerMessage): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }
  messages() {
    return this.sent
      .filter((value) => value !== "ping")
      .map((value) => clientMessageSchema.parse(JSON.parse(value)));
  }
}
function latest(): TestSocket {
  const socket = TestSocket.sockets.at(-1);
  if (!socket) throw new Error("Missing test socket");
  return socket;
}
function welcome(
  socket: TestSocket,
  project = createProject(),
  role: "host" | "guest" = "host",
  hostConnected = true,
): void {
  socket.receive({
    type: "welcome",
    project,
    revision: 0,
    acknowledgedSequence: 0,
    role,
    hostConnected,
    participants: 1,
    playing: false,
    absoluteTick: 0,
    expiresAt: Date.now() + 86400000,
  });
}
async function connectClient(role: "host" | "guest" = "host") {
  const states: SessionStatus[] = [];
  const projects: Project[] = [];
  const stopped = vi.fn();
  const client = new SessionClient("http://localhost:8787", {
    onState: (state) => states.push(state),
    onProject: (project) => projects.push(project),
    onClock: vi.fn(),
    onTransport: vi.fn(),
    onReady: vi.fn(),
    onEnded: stopped,
  });
  if (role === "host") await client.create(createProject());
  else
    client.join(
      `http://localhost:4317/#session=${"r".repeat(22)}.${"g".repeat(43)}`,
    );
  welcome(latest(), createProject(), role);
  return { client, states, projects, stopped };
}

beforeEach(() => {
  vi.useFakeTimers();
  TestSocket.sockets.length = 0;
  const storage = new Map<string, string>();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", new URL("http://localhost:4317/"));
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("WebSocket", TestSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        roomId: "r".repeat(22),
        hostToken: "h".repeat(43),
        guestToken: "g".repeat(43),
        expiresAt: Date.now() + 86400000,
      }),
    ),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("session connection recovery", () => {
  it("paces reconnect replay together with new edits instead of flooding the room", async () => {
    const { client } = await connectClient();
    for (let i = 0; i < 43; i++) {
      const project = createProject();
      project.bass.cutoff = 200 + i * 30;
      client.edit(project);
      await vi.advanceTimersByTimeAsync(110);
    }
    expect(
      latest()
        .messages()
        .filter((message) => message.type === "patch"),
    ).toHaveLength(43);
    client.reconnect();
    const socket = latest();
    welcome(socket);
    expect(
      socket.messages().filter((message) => message.type === "patch").length,
    ).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(
      socket.messages().filter((message) => message.type === "patch").length,
    ).toBeLessThanOrEqual(10);
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      socket.messages().filter((message) => message.type === "patch"),
    ).toHaveLength(43);
    expect(client.connected).toBe(true);
    expect(socket.messages().some((message) => message.type === "end")).toBe(
      false,
    );
  });

  it("retains edits and requests one delayed snapshot after repeated throttling replies", async () => {
    const { client, projects } = await connectClient();
    const project = createProject();
    project.bass.cutoff = 2345;
    client.edit(project);
    await vi.advanceTimersByTimeAsync(100);
    const socket = latest();
    for (let i = 0; i < 8; i++)
      socket.receive({
        type: "error",
        code: "rate-limit",
        message: "Edit rate exceeded",
        sequence: 1,
      });
    expect(
      socket.messages().filter((message) => message.type === "sync"),
    ).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1100);
    expect(
      socket.messages().filter((message) => message.type === "sync"),
    ).toHaveLength(1);
    welcome(socket);
    expect(projects.at(-1)?.bass.cutoff).toBe(2345);
    await vi.advanceTimersByTimeAsync(100);
    expect(
      socket.messages().filter((message) => message.type === "patch"),
    ).toHaveLength(2);
  });

  it("distinguishes a reload-required deployment from a revoked room", async () => {
    const { client, states } = await connectClient();
    latest().close(4010, "Reload required");
    expect(states.at(-1)?.message).toMatch(/reload/i);
    expect(states.at(-1)?.message).not.toMatch(/no longer available/i);
    expect(client.role).toBe("host");
    expect(sessionStorage.getItem("grain-session-v1")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    expect(TestSocket.sockets).toHaveLength(1);
  });

  it.each([1013, 1008])(
    "retries transient throttling close %s without ending or restarting playback",
    async (code) => {
      const { client, states } = await connectClient();
      latest().close(code, "Message rate exceeded");
      expect(states.at(-1)?.phase).toBe("reconnecting");
      await vi.advanceTimersByTimeAsync(1000);
      expect(TestSocket.sockets).toHaveLength(2);
      welcome(latest());
      expect(client.connected).toBe(true);
      expect(
        latest()
          .messages()
          .some(
            (message) => message.type === "end" || message.type === "transport",
          ),
      ).toBe(false);
    },
  );

  it("keeps retrying a temporary outage while the authenticated room is unexpired", async () => {
    const { states } = await connectClient();
    for (let i = 0; i < 12; i++) {
      latest().close(1006, "");
      await vi.advanceTimersByTimeAsync(10000);
    }
    expect(states.at(-1)?.phase).toBe("reconnecting");
    expect(TestSocket.sockets.length).toBeGreaterThan(12);
  });

  it("holds guest edits through host loss and resumes after an authoritative snapshot", async () => {
    const { client, projects } = await connectClient("guest");
    const project = createProject();
    project.keys.tone = 0.73;
    client.edit(project);
    await vi.advanceTimersByTimeAsync(100);
    const socket = latest();
    socket.receive({
      type: "error",
      code: "host-offline",
      message: "The host is disconnected",
      sequence: 1,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      socket.messages().filter((message) => message.type === "patch"),
    ).toHaveLength(1);
    socket.receive({
      type: "presence",
      hostConnected: true,
      participants: 2,
      playing: false,
      absoluteTick: 0,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(
      socket.messages().filter((message) => message.type === "sync"),
    ).toHaveLength(1);
    welcome(socket, createProject(), "guest");
    expect(client.role).toBe("guest");
    expect(projects.at(-1)?.keys.tone).toBe(0.73);
    await vi.advanceTimersByTimeAsync(100);
    expect(
      socket.messages().filter((message) => message.type === "patch"),
    ).toHaveLength(2);
  });

  it("bounds hot recording edits plus playback clocks below the server packet budget", async () => {
    const { client } = await connectClient();
    for (let index = 0; index < 100; index++) {
      const project = createProject();
      project.bass.cutoff = 200 + index * 10;
      client.edit(project);
      client.clock(true, index);
      await vi.advanceTimersByTimeAsync(10);
      latest().receive({ type: "clock", playing: true, absoluteTick: index });
    }
    const messages = latest().messages();
    expect(
      messages.filter((message) => message.type === "patch").length,
    ).toBeLessThanOrEqual(10);
    expect(
      messages.filter((message) => message.type === "clock").length,
    ).toBeLessThanOrEqual(20);
    expect(messages.length).toBeLessThanOrEqual(30);
  });

  it("still stops retrying when another host explicitly replaces this one", async () => {
    const { states, stopped } = await connectClient();
    latest().close(4009, "Connection replaced");
    await vi.advanceTimersByTimeAsync(30000);
    expect(states.at(-1)?.message).toContain("another tab or device");
    expect(stopped).toHaveBeenCalled();
    expect(TestSocket.sockets).toHaveLength(1);
  });
});
