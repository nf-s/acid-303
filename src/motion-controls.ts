export interface MotionStatus {
  state: "off" | "requesting" | "on" | "unavailable" | "denied" | "error";
  message: string;
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
  private previousTime: number | null = null;
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
    this.report("requesting", "Allow motion access to use phone twist.");
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
      this.previousTime = null;
      this.receivedData = false;
      this.blurred = false;
      window.addEventListener("devicemotion", this.motion);
      window.addEventListener("blur", this.blur);
      window.addEventListener("focus", this.focus);
      document.addEventListener("visibilitychange", this.visibilityChange);
      this.report("on", "Hold a knob and twist your phone.");
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
    this.previousTime = null;
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
    if (typeof gamma !== "number" || !Number.isFinite(gamma)) {
      this.previousTime = null;
      return;
    }
    this.receivedData = true;
    this.clearProbe();
    if (!Number.isFinite(event.timeStamp)) {
      this.previousTime = null;
      return;
    }
    if (this.previousTime !== null && event.timeStamp <= this.previousTime)
      return;
    const elapsed =
      this.previousTime === null ? 0 : event.timeStamp - this.previousTime;
    this.previousTime = event.timeStamp;
    const delta = normalizedTwistDelta(gamma, elapsed);
    if (delta !== 0) this.onDelta(delta);
  };

  private readonly blur = (): void => {
    this.blurred = true;
    this.previousTime = null;
    this.clearProbe();
  };
  private readonly focus = (): void => {
    this.blurred = false;
    this.previousTime = null;
    this.startProbe();
  };
  private readonly visibilityChange = (): void => {
    this.previousTime = null;
    if (document.hidden) this.clearProbe();
    else this.startProbe();
  };
}
