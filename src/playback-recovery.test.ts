import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackRecovery } from "./playback-recovery";
import type { PlaybackRecoveryState } from "./playback-recovery";

const key = "grain-playback-intent-v1";
class TabStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(name: string): string | null {
    return this.values.get(name) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(name: string): void {
    this.values.delete(name);
  }
  setItem(name: string, value: string): void {
    this.values.set(name, value);
  }
}
let storage: TabStorage;
let state: PlaybackRecoveryState;
let location: { hash: string };
let navigation: { type: string };
const helpers: ReturnType<typeof createPlaybackRecovery>[] = [];

function seed(
  role: "solo" | "host" = "solo",
  room: string | null = null,
  age = 0,
) {
  storage.setItem(
    key,
    JSON.stringify({ version: 1, at: Date.now() - age, role, room }),
  );
}
function create(
  onPlay = vi.fn(async () => {
    state.playing = true;
  }),
  isAudioReady?: () => boolean,
) {
  const onCancelStart = vi.fn(),
    onBlocked = vi.fn(),
    clearBlocked = vi.fn();
  const recovery = createPlaybackRecovery({
    getState: () => state,
    onPlay,
    isAudioReady,
    onCancelStart,
    onBlocked,
    clearBlocked,
  });
  helpers.push(recovery);
  return { recovery, onPlay, onCancelStart, onBlocked, clearBlocked };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-08T10:00:00Z"));
  storage = new TabStorage();
  location = { hash: "" };
  navigation = { type: "reload" };
  state = { playing: false, role: "solo", room: null, ready: true };
  vi.stubGlobal("window", { sessionStorage: storage, location });
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("performance", { getEntriesByType: () => [navigation] });
});
afterEach(() => {
  for (const helper of helpers.splice(0)) helper.destroy();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("playback recovery", () => {
  it("keeps a host's saved intent during initial false frames until the matching room is ready", async () => {
    seed("host", "room-one");
    state.ready = false;
    const { recovery, onPlay } = create();
    recovery.frame();
    recovery.check();
    expect(storage.getItem(key)).not.toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
    state = { playing: false, role: "host", room: "room-one", ready: true };
    recovery.check();
    await Promise.resolve();
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(state.playing).toBe(true);
    expect(JSON.parse(storage.getItem(key) ?? "null")).toMatchObject({
      role: "host",
      room: "room-one",
    });
  });

  it("resumes once after reload and does not resume again on a later network reconnect", async () => {
    seed();
    const { recovery, onPlay } = create();
    recovery.frame();
    recovery.check();
    await Promise.resolve();
    state.playing = false;
    recovery.frame();
    state.ready = false;
    recovery.check();
    state.ready = true;
    recovery.check();
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(storage.getItem(key)).toBeNull();
  });

  it.each([
    "expired",
    "future",
    "invalid",
    "navigate",
    "back_forward",
    "shared track",
    "new session",
  ])("ignores %s recovery state", (scenario) => {
    seed();
    if (scenario === "expired") seed("solo", null, 300001);
    if (scenario === "future") seed("solo", null, -1);
    if (scenario === "invalid")
      storage.setItem(key, '{"version":1,"role":"solo"}');
    if (scenario === "navigate" || scenario === "back_forward")
      navigation.type = scenario;
    if (scenario === "shared track") location.hash = "#track=incoming";
    if (scenario === "new session") location.hash = "#session=incoming";
    const { recovery, onPlay } = create();
    recovery.check();
    expect(onPlay).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBeNull();
  });

  it.each(["guest", "another room", "solo"])(
    "never starts audio for a saved host identity when the current identity is %s",
    (identity) => {
      seed("host", "room-one");
      if (identity === "guest")
        state = {
          playing: false,
          role: "guest",
          room: "room-one",
          ready: false,
        };
      if (identity === "another room")
        state = { playing: false, role: "host", room: "room-two", ready: true };
      const { recovery, onPlay } = create();
      recovery.check();
      expect(onPlay).not.toHaveBeenCalled();
      expect(storage.getItem(key)).toBeNull();
    },
  );

  it("cancels a start if the playback identity changes before it settles", async () => {
    seed();
    const { recovery, onCancelStart } = create();
    recovery.check();
    state.role = "guest";
    state.room = "room-one";
    await Promise.resolve();
    expect(onCancelStart).toHaveBeenCalledTimes(1);
    expect(storage.getItem(key)).toBeNull();
  });

  it("bounds an unresolved autoplay attempt and offers a gesture instead of leaving a pending start", async () => {
    seed();
    let finish: (() => void) | undefined;
    const onPlay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { recovery, onBlocked, onCancelStart } = create(onPlay);
    recovery.check();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onCancelStart).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    recovery.check();
    expect(onPlay).toHaveBeenCalledTimes(1);
    recovery.cancel();
    finish?.();
    await Promise.resolve();
    expect(storage.getItem(key)).toBeNull();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it("keeps an unlocked audio start alive while its sample download is pending", async () => {
    seed();
    let finish: (() => void) | undefined;
    const onPlay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            state.playing = true;
            resolve();
          };
        }),
    );
    const { recovery, onCancelStart, onBlocked } = create(onPlay, () => true);
    recovery.check();
    await vi.advanceTimersByTimeAsync(2500);
    expect(onCancelStart).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(state.playing).toBe(false);
    finish?.();
    await Promise.resolve();
    expect(state.playing).toBe(true);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(storage.getItem(key)).not.toBeNull();
  });

  it("offers a gesture after a pending reload loses and regains readiness without another autoplay attempt", async () => {
    seed("host", "room-one");
    state = { playing: false, role: "host", room: "room-one", ready: true };
    const onPlay = vi.fn(() => new Promise<void>(() => {}));
    const { recovery, onBlocked } = create(onPlay);
    recovery.check();
    state.ready = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onBlocked).not.toHaveBeenCalled();
    state.ready = true;
    recovery.check();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("lets explicit transport cancel recovery without a stale completion cancelling later playback", async () => {
    seed();
    let finish: (() => void) | undefined;
    const onPlay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { recovery, onCancelStart, onBlocked } = create(onPlay);
    recovery.check();
    recovery.userAction();
    expect(onCancelStart).toHaveBeenCalledTimes(1);
    state.playing = true;
    recovery.frame();
    finish?.();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onCancelStart).toHaveBeenCalledTimes(1);
    expect(onBlocked).not.toHaveBeenCalled();
    expect(state.playing).toBe(true);
    expect(storage.getItem(key)).not.toBeNull();
  });

  it("preserves navigation intent when suspend runs before the engine stops and throttles normal writes", () => {
    const write = vi.spyOn(storage, "setItem");
    const clear = vi.spyOn(storage, "removeItem");
    const { recovery } = create();
    for (let frame = 0; frame < 10; frame++) recovery.frame();
    expect(clear).toHaveBeenCalledTimes(1);
    state.playing = true;
    recovery.frame();
    recovery.frame();
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    recovery.frame();
    expect(write).toHaveBeenCalledTimes(2);
    recovery.suspend();
    state.playing = false;
    recovery.frame();
    expect(storage.getItem(key)).not.toBeNull();
    recovery.userAction();
    expect(storage.getItem(key)).toBeNull();
  });

  it("ignores unavailable storage without preventing normal playback", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("Denied");
    });
    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new Error("Denied");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Denied");
    });
    const { recovery, onPlay } = create();
    recovery.check();
    state.playing = true;
    expect(() => recovery.frame()).not.toThrow();
    expect(onPlay).not.toHaveBeenCalled();
  });
});
