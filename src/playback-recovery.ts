import { z } from "zod";

const storageKey = "grain-playback-intent-v1";
const maximumAge = 5 * 60 * 1000;
const intentSchema = z
  .object({
    version: z.literal(1),
    at: z.number().finite().nonnegative(),
    role: z.enum(["solo", "host"]),
    room: z.string().min(1).max(256).nullable(),
  })
  .refine((intent) =>
    intent.role === "solo" ? intent.room === null : intent.room !== null,
  );
type Intent = z.infer<typeof intentSchema>;

export interface PlaybackRecoveryState {
  playing: boolean;
  role: "solo" | "host" | "guest";
  room: string | null;
  ready: boolean;
}
interface RecoveryOptions {
  getState: () => PlaybackRecoveryState;
  onPlay: () => Promise<void>;
  isAudioReady?: () => boolean;
  onCancelStart: () => void;
  onBlocked: () => void;
  clearBlocked?: () => void;
}

export function createPlaybackRecovery(options: RecoveryOptions) {
  let pending: Intent | null = null;
  let attempting = false;
  let attempted = false;
  let suspended = false;
  let destroyed = false;
  let listening = false;
  let generation = 0;
  let lastWrite = -Infinity;
  let stored = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pointers = new Map<number, { x: number; y: number }>();

  function clearStored(): void {
    lastWrite = -Infinity;
    if (!stored) return;
    stored = false;
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Playback remains available when tab storage is disabled.
    }
  }
  function fresh(intent: Intent): boolean {
    const age = Date.now() - intent.at;
    return age >= 0 && age <= maximumAge;
  }
  function matches(state: PlaybackRecoveryState, intent: Intent): boolean {
    return state.role === intent.role && state.room === intent.room;
  }
  function stopListening(): void {
    if (!listening) return;
    document.removeEventListener("click", gesture);
    document.removeEventListener("keydown", gesture);
    document.removeEventListener("pointerdown", beginGesture, true);
    document.removeEventListener("pointerup", endGesture);
    document.removeEventListener("pointercancel", cancelGesture);
    pointers.clear();
    listening = false;
  }
  function cancel(): void {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    stopListening();
    pending = null;
    suspended = false;
    const wasAttempting = attempting;
    attempting = false;
    clearStored();
    options.clearBlocked?.();
    if (wasAttempting) options.onCancelStart();
  }
  function write(state: PlaybackRecoveryState, force = false): void {
    if (state.role === "guest" || !state.playing) return;
    const now = Date.now();
    if (!force && now - lastWrite < 1000) return;
    const value = intentSchema.safeParse({
      version: 1,
      at: now,
      role: state.role,
      room: state.room,
    });
    if (!value.success) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value.data));
      lastWrite = now;
      stored = true;
    } catch {
      // Playback remains available when tab storage is disabled.
    }
  }
  function eligible(): boolean {
    if (destroyed || suspended || !pending) return false;
    const state = options.getState();
    if (!fresh(pending) || state.role === "guest") {
      cancel();
      return false;
    }
    if (!state.ready) return false;
    if (!matches(state, pending)) {
      cancel();
      return false;
    }
    return true;
  }
  function blocked(request: number): void {
    if (request !== generation || destroyed || !pending) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    attempting = false;
    generation++;
    options.onCancelStart();
    offerGesture();
  }
  function offerGesture(): void {
    if (listening || !eligible()) return;
    options.onBlocked();
    document.addEventListener("click", gesture);
    document.addEventListener("keydown", gesture);
    document.addEventListener("pointerdown", beginGesture, true);
    document.addEventListener("pointerup", endGesture);
    document.addEventListener("pointercancel", cancelGesture);
    listening = true;
  }
  function attempt(): void {
    if (attempting || !eligible()) return;
    stopListening();
    attempting = true;
    attempted = true;
    const request = ++generation;
    timer = setTimeout(() => {
      timer = undefined;
      if (!options.isAudioReady?.()) blocked(request);
    }, 1000);
    let playback: Promise<void>;
    try {
      playback = options.onPlay();
    } catch {
      blocked(request);
      return;
    }
    void playback.then(
      () => {
        if (request !== generation || destroyed) return;
        const state = options.getState();
        if (
          !pending ||
          !state.ready ||
          !fresh(pending) ||
          !matches(state, pending)
        ) {
          cancel();
          return;
        }
        if (!state.playing) {
          blocked(request);
          return;
        }
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        attempting = false;
        pending = null;
        options.clearBlocked?.();
        write(state, true);
      },
      () => blocked(request),
    );
  }
  function beginGesture(event: PointerEvent): void {
    if (event.isTrusted)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  function cancelGesture(event: PointerEvent): void {
    pointers.delete(event.pointerId);
  }
  function endGesture(event: PointerEvent): void {
    const start = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6
    )
      gesture(event);
  }
  function gesture(event: Event): void {
    if (!event.isTrusted) return;
    if (
      event.target instanceof Element &&
      event.target.closest("#play, #restart")
    )
      return;
    if (
      event instanceof KeyboardEvent &&
      (event.code === "Space" ||
        event.key === "Enter" ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey)
    )
      return;
    attempt();
  }
  function frame(): void {
    if (destroyed || suspended) return;
    const state = options.getState();
    if (state.role === "guest") {
      if (pending || attempting || stored) cancel();
    } else if (state.playing) {
      write(state);
    } else if (!pending && !attempting) {
      clearStored();
    }
  }
  function check(): void {
    if (!eligible()) return;
    if (!attempted) attempt();
    else if (!attempting) offerGesture();
  }
  function suspend(): void {
    if (destroyed) return;
    const state = options.getState();
    if (state.playing) write(state, true);
    suspended = true;
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    stopListening();
    const wasAttempting = attempting;
    attempting = false;
    if (wasAttempting) options.onCancelStart();
  }
  function destroy(): void {
    if (destroyed) return;
    suspend();
    destroyed = true;
  }

  try {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const navigation = z
      .object({ type: z.literal("reload") })
      .safeParse(performance.getEntriesByType("navigation")[0]);
    const raw = window.sessionStorage.getItem(storageKey);
    const saved = intentSchema.safeParse(raw ? JSON.parse(raw) : null);
    if (
      navigation.success &&
      !hash.has("track") &&
      !hash.has("session") &&
      saved.success &&
      fresh(saved.data)
    )
      pending = saved.data;
    else clearStored();
  } catch {
    clearStored();
  }

  return { frame, suspend, check, cancel, userAction: cancel, destroy };
}
