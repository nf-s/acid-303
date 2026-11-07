export type MotionMode = "tilt" | "move" | "twist";

export interface MotionStatus {
  state: "off" | "requesting" | "on" | "unavailable" | "denied" | "error";
  message: string;
}

interface MotionVector {
  x: number;
  y: number;
  z: number;
}
interface TiltSample {
  forward: number | null;
  side: number;
}

function readVector(
  value: DeviceMotionEventAcceleration | null,
): MotionVector | null {
  if (!value) return null;
  const { x, y, z } = value;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof z !== "number" ||
    !Number.isFinite(z)
  )
    return null;
  return { x, y, z };
}

function readTilt(value: MotionVector | null): TiltSample | null {
  if (!value || Math.hypot(value.x, value.y, value.z) < 1) return null;
  const forwardMagnitude = Math.hypot(value.y, value.z);
  return {
    forward:
      forwardMagnitude < 1
        ? null
        : (Math.atan2(value.y, value.z) * 180) / Math.PI,
    side: (Math.atan2(value.x, forwardMagnitude) * 180) / Math.PI,
  };
}

/** Uses the strongest linear acceleration axis without accumulating velocity. */
export function normalizedMoveDelta(
  acceleration: MotionVector | null,
  elapsedMilliseconds: number,
): number {
  if (
    !acceleration ||
    ![acceleration.x, acceleration.y, acceleration.z].every(Number.isFinite) ||
    !Number.isFinite(elapsedMilliseconds) ||
    elapsedMilliseconds <= 0 ||
    elapsedMilliseconds > 250
  )
    return 0;
  const axis = [acceleration.z, acceleration.y, acceleration.x].reduce(
    (strongest, value) =>
      Math.abs(value) > Math.abs(strongest) ? value : strongest,
    acceleration.z,
  );
  const strength = Math.min(20, Math.max(0, Math.abs(axis) - 0.35));
  if (strength === 0) return 0;
  const delta =
    (Math.sign(axis) * strength * Math.min(50, elapsedMilliseconds)) / 5000;
  return Math.max(-0.05, Math.min(0.05, delta));
}

/** One turn of 90 degrees spans a control's range; stale samples never catch up. */
export function normalizedTwistDelta(
  gamma: number | null,
  elapsedMilliseconds: number,
): number {
  if (
    gamma === null ||
    !Number.isFinite(gamma) ||
    !Number.isFinite(elapsedMilliseconds) ||
    elapsedMilliseconds <= 0 ||
    elapsedMilliseconds > 250 ||
    Math.abs(gamma) < 2
  )
    return 0;
  const rate = Math.max(-360, Math.min(360, gamma));
  const delta = (rate * Math.min(50, elapsedMilliseconds)) / 90000;
  return Math.max(-0.05, Math.min(0.05, delta));
}

/** Emits relative motion only. The gesture owner applies it to held controls. */
export class MotionControls {
  private active = false;
  private requesting = false;
  private destroyed = false;
  private revision = 0;
  private selectedMode: MotionMode = "tilt";
  private previousTime: number | null = null;
  private previousTilt: TiltSample | null = null;
  private receivedData = false;
  private blurred = false;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onDelta: (normalizedDelta: number) => void,
    private readonly onStatus: (status: MotionStatus) => void,
  ) {}

  get enabled(): boolean {
    return this.active;
  }
  get mode(): MotionMode {
    return this.selectedMode;
  }
  setMode(mode: MotionMode): void {
    if (this.selectedMode === mode || this.destroyed) return;
    this.selectedMode = mode;
    this.resetBaseline();
    this.receivedData = false;
    this.startProbe();
  }

  /** Call directly from a user gesture so iOS can request motion permission. */
  async enable(): Promise<boolean> {
    if (this.destroyed || this.requesting) return false;
    if (this.active) return true;
    if (!window.isSecureContext || typeof DeviceMotionEvent === "undefined") {
      this.report(
        "unavailable",
        "Motion control is unavailable in this browser.",
      );
      return false;
    }
    const revision = ++this.revision;
    this.requesting = true;
    this.report("requesting", "Allow motion access to use phone controls.");
    try {
      if (
        "requestPermission" in DeviceMotionEvent &&
        typeof DeviceMotionEvent.requestPermission === "function"
      ) {
        const permission: unknown = await DeviceMotionEvent.requestPermission();
        if (revision !== this.revision) return false;
        if (permission !== "granted") {
          this.report("denied", "Motion access was denied.");
          return false;
        }
      }
      if (revision !== this.revision) return false;
      this.active = true;
      this.resetBaseline();
      this.receivedData = false;
      this.blurred = false;
      window.addEventListener("devicemotion", this.motion);
      window.addEventListener("blur", this.blur);
      window.addEventListener("focus", this.focus);
      document.addEventListener("visibilitychange", this.visibilityChange);
      this.report("on", "Hold a knob and tilt or move your phone.");
      this.startProbe();
      return true;
    } catch {
      if (revision === this.revision)
        this.report("error", "Could not enable motion. Tap Motion to retry.");
      return false;
    } finally {
      if (revision === this.revision) this.requesting = false;
    }
  }

  disable(): void {
    this.revision++;
    this.requesting = false;
    this.stop();
    this.report("off", "Motion control off.");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disable();
  }

  private report(state: MotionStatus["state"], message: string): void {
    this.onStatus({ state, message });
  }

  private stop(): void {
    this.active = false;
    this.resetBaseline();
    this.clearProbe();
    window.removeEventListener("devicemotion", this.motion);
    window.removeEventListener("blur", this.blur);
    window.removeEventListener("focus", this.focus);
    document.removeEventListener("visibilitychange", this.visibilityChange);
  }

  private clearProbe(): void {
    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    this.probeTimer = null;
  }

  private startProbe(): void {
    this.clearProbe();
    if (!this.active || this.receivedData || document.hidden || this.blurred)
      return;
    this.probeTimer = setTimeout(() => {
      this.stop();
      this.report(
        "unavailable",
        "No motion sensor data. Try a phone with motion access.",
      );
    }, 2000);
  }

  private readonly motion = (event: DeviceMotionEvent): void => {
    if (!this.active || document.hidden || this.blurred) return;
    const gamma = event.rotationRate?.gamma;
    const gravity =
      this.selectedMode === "tilt"
        ? readTilt(readVector(event.accelerationIncludingGravity))
        : null;
    const acceleration =
      this.selectedMode === "move" ? readVector(event.acceleration) : null;
    if (
      this.selectedMode === "tilt"
        ? !gravity
        : this.selectedMode === "move"
          ? !acceleration
          : typeof gamma !== "number" || !Number.isFinite(gamma)
    ) {
      this.resetBaseline();
      return;
    }
    this.receivedData = true;
    this.clearProbe();
    if (!Number.isFinite(event.timeStamp)) {
      this.resetBaseline();
      return;
    }
    if (this.previousTime !== null && event.timeStamp <= this.previousTime)
      return;
    const elapsed =
      this.previousTime === null ? 0 : event.timeStamp - this.previousTime;
    this.previousTime = event.timeStamp;
    const delta =
      this.selectedMode === "tilt" && gravity
        ? this.tiltDelta(gravity, elapsed)
        : this.selectedMode === "move"
          ? normalizedMoveDelta(acceleration, elapsed)
          : normalizedTwistDelta(gamma ?? null, elapsed);
    if (delta !== 0) this.onDelta(delta);
  };

  private tiltDelta(tilt: TiltSample, elapsed: number): number {
    const previous = this.previousTilt;
    if (!previous || elapsed <= 0 || elapsed > 250) {
      this.previousTilt = tilt;
      return 0;
    }
    const forward =
      previous.forward === null || tilt.forward === null
        ? 0
        : ((tilt.forward - previous.forward + 540) % 360) - 180;
    const side = tilt.side - previous.side;
    const change = Math.abs(forward) >= Math.abs(side) ? forward : side;
    if (Math.abs(change) < 0.2) {
      if (previous.forward === null || tilt.forward === null)
        this.previousTilt = tilt;
      return 0;
    }
    this.previousTilt = tilt;
    return Math.max(-0.05, Math.min(0.05, change / 60));
  }

  private resetBaseline(): void {
    this.previousTime = null;
    this.previousTilt = null;
  }

  private readonly blur = (): void => {
    this.blurred = true;
    this.resetBaseline();
    this.clearProbe();
  };
  private readonly focus = (): void => {
    this.blurred = false;
    this.resetBaseline();
    this.startProbe();
  };
  private readonly visibilityChange = (): void => {
    this.resetBaseline();
    if (document.hidden) this.clearProbe();
    else this.startProbe();
  };
}
