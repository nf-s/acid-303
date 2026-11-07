import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MotionControls,
  normalizedMoveDelta,
  normalizedTwistDelta,
} from "./motion-controls";
import type { MotionMode, MotionStatus } from "./motion-controls";

class SensorWindow extends EventTarget {
  isSecureContext = true;
}
class SensorDocument extends EventTarget {
  hidden = false;
}
class SensorEvent extends Event {
  readonly rotationRate: { alpha: number; beta: number; gamma: number | null };
  readonly accelerationIncludingGravity: DeviceMotionEventAcceleration | null;
  readonly acceleration: DeviceMotionEventAcceleration | null;

  constructor(
    gamma: number | null,
    timestamp: number,
    gravity: DeviceMotionEventAcceleration | null = null,
    acceleration: DeviceMotionEventAcceleration | null = null,
  ) {
    super("devicemotion");
    this.rotationRate = { alpha: 90, beta: 90, gamma };
    this.accelerationIncludingGravity = gravity;
    this.acceleration = acceleration;
    Object.defineProperty(this, "timeStamp", { value: timestamp });
  }
}

let sensorWindow: SensorWindow;
let sensorDocument: SensorDocument;
const controls: MotionControls[] = [];

function createControls(mode: MotionMode = "twist") {
  const onDelta = vi.fn<(delta: number) => void>();
  const onStatus = vi.fn<(status: MotionStatus) => void>();
  const motion = new MotionControls(onDelta, onStatus);
  motion.setMode(mode);
  controls.push(motion);
  return { motion, onDelta, onStatus };
}
function permissionAPI(requestPermission: () => Promise<unknown>): void {
  class PermissionEvent extends SensorEvent {
    static requestPermission = requestPermission;
  }
  vi.stubGlobal("DeviceMotionEvent", PermissionEvent);
}
function sample(gamma: number | null, timestamp: number): void {
  sensorWindow.dispatchEvent(new SensorEvent(gamma, timestamp));
}
function tiltSample(forward: number, side: number, timestamp: number): void {
  const pitch = (forward * Math.PI) / 180;
  const roll = (side * Math.PI) / 180;
  sensorWindow.dispatchEvent(
    new SensorEvent(null, timestamp, {
      x: 9.81 * Math.sin(roll),
      y: 9.81 * Math.cos(roll) * Math.sin(pitch),
      z: 9.81 * Math.cos(roll) * Math.cos(pitch),
    }),
  );
}
function moveSample(x: number, y: number, z: number, timestamp: number): void {
  sensorWindow.dispatchEvent(
    new SensorEvent(null, timestamp, null, { x, y, z }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  sensorWindow = new SensorWindow();
  sensorDocument = new SensorDocument();
  vi.stubGlobal("window", sensorWindow);
  vi.stubGlobal("document", sensorDocument);
  vi.stubGlobal("DeviceMotionEvent", SensorEvent);
});
afterEach(() => {
  for (const control of controls.splice(0)) control.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("motion integration", () => {
  it("integrates sustained rotation in either direction over a 90-degree range", () => {
    const samples = Array.from({ length: 50 }, () =>
      normalizedTwistDelta(90, 20),
    );
    expect(samples.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(normalizedTwistDelta(-90, 20)).toBeCloseTo(-0.02);
  });

  it("rejects missing, non-finite, noisy and stale readings", () => {
    for (const gamma of [null, NaN, Infinity, -Infinity, 0, 1.9, -1.9])
      expect(normalizedTwistDelta(gamma, 16)).toBe(0);
    for (const elapsed of [NaN, Infinity, -Infinity, -20, 0, 251, 10000])
      expect(normalizedTwistDelta(90, elapsed)).toBe(0);
  });

  it("bounds both sampling delays and extreme finite angular velocities", () => {
    expect(normalizedTwistDelta(90, 200)).toBeCloseTo(0.05);
    expect(normalizedTwistDelta(100000, 50)).toBe(0.05);
    expect(normalizedTwistDelta(-100000, 50)).toBe(-0.05);
  });
});

describe("motion permission and availability", () => {
  it("requests permission only when explicitly enabled", async () => {
    const request = vi.fn(async () => "granted");
    permissionAPI(request);
    const { motion, onDelta, onStatus } = createControls();
    sample(90, 0);
    sample(90, 20);
    expect(request).not.toHaveBeenCalled();
    expect(onDelta).not.toHaveBeenCalled();
    expect(await motion.enable()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(motion.enabled).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith({
      state: "on",
      message: "Hold a knob and tilt or move your phone.",
    });
    expect(await motion.enable()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("leaves motion disabled after permission denial", async () => {
    permissionAPI(async () => "denied");
    const { motion, onDelta, onStatus } = createControls();
    expect(await motion.enable()).toBe(false);
    sample(90, 0);
    sample(90, 20);
    expect(onDelta).not.toHaveBeenCalled();
    expect(motion.enabled).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith({
      state: "denied",
      message: "Motion access was denied.",
    });
  });

  it("does not treat an unexpected permission response as a grant", async () => {
    permissionAPI(async () => ({ granted: true }));
    const { motion, onStatus } = createControls();
    expect(await motion.enable()).toBe(false);
    expect(onStatus.mock.lastCall?.[0].state).toBe("denied");
  });

  it("reports permission failures and permits an explicit retry", async () => {
    const request = vi.fn<() => Promise<unknown>>();
    request.mockRejectedValueOnce(new Error("NotAllowedError"));
    request.mockResolvedValueOnce("granted");
    permissionAPI(request);
    const { motion, onStatus } = createControls();
    expect(await motion.enable()).toBe(false);
    expect(motion.enabled).toBe(false);
    expect(onStatus.mock.lastCall?.[0].state).toBe("error");
    expect(await motion.enable()).toBe(true);
  });

  it("does not reactivate after disable while a permission request is pending", async () => {
    let resolvePermission: (permission: unknown) => void = () => {};
    permissionAPI(
      () =>
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
    );
    const { motion, onStatus } = createControls();
    const pending = motion.enable();
    expect(await motion.enable()).toBe(false);
    motion.disable();
    resolvePermission("granted");
    expect(await pending).toBe(false);
    expect(motion.enabled).toBe(false);
    expect(onStatus.mock.lastCall?.[0].state).toBe("off");
  });

  it("reports missing browser support and insecure contexts", async () => {
    const { motion, onStatus } = createControls();
    vi.stubGlobal("DeviceMotionEvent", undefined);
    expect(await motion.enable()).toBe(false);
    expect(onStatus.mock.lastCall?.[0].state).toBe("unavailable");
    vi.stubGlobal("DeviceMotionEvent", SensorEvent);
    sensorWindow.isSecureContext = false;
    expect(await motion.enable()).toBe(false);
    expect(onStatus.mock.lastCall?.[0].state).toBe("unavailable");
  });

  it("reports absent gyro data, including null values with other axes present", async () => {
    const { motion, onDelta, onStatus } = createControls();
    await motion.enable();
    sample(null, 0);
    sample(null, 20);
    vi.advanceTimersByTime(2000);
    expect(motion.enabled).toBe(false);
    expect(onDelta).not.toHaveBeenCalled();
    expect(onStatus.mock.lastCall?.[0].state).toBe("unavailable");
  });

  it("recognizes a stationary sensor as available without changing any value", async () => {
    const { motion, onDelta, onStatus } = createControls();
    await motion.enable();
    sample(0, 0);
    sample(0, 20);
    vi.advanceTimersByTime(3000);
    expect(motion.enabled).toBe(true);
    expect(onDelta).not.toHaveBeenCalled();
    expect(onStatus.mock.lastCall?.[0].state).toBe("on");
  });
});

describe("motion listener lifecycle", () => {
  it("primes the first sample and ignores stale, reordered and invalid event data", async () => {
    const { motion, onDelta } = createControls();
    await motion.enable();
    sample(90, 0);
    sample(90, 20);
    sample(90, 10);
    sample(90, 40);
    sample(90, 1000);
    sample(90, 1020);
    sample(Infinity, 1040);
    sample(90, 1060);
    sample(90, 1080);
    sample(90, NaN);
    sample(90, 1100);
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual([
      0.02, 0.02, 0.02, 0.02,
    ]);
  });

  it("resets integration while hidden and blurred without carrying motion forward", async () => {
    const { motion, onDelta } = createControls();
    await motion.enable();
    sample(90, 0);
    sensorDocument.hidden = true;
    sensorDocument.dispatchEvent(new Event("visibilitychange"));
    sample(90, 20);
    sensorDocument.hidden = false;
    sensorDocument.dispatchEvent(new Event("visibilitychange"));
    sample(90, 40);
    sample(90, 60);
    sensorWindow.dispatchEvent(new Event("blur"));
    sample(90, 80);
    sensorWindow.dispatchEvent(new Event("focus"));
    sample(90, 100);
    sample(90, 120);
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual([0.02, 0.02]);
  });

  it("suspends the availability deadline while the document is hidden", async () => {
    const { motion } = createControls();
    await motion.enable();
    sensorDocument.hidden = true;
    sensorDocument.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(10000);
    expect(motion.enabled).toBe(true);
    sensorDocument.hidden = false;
    sensorDocument.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(2000);
    expect(motion.enabled).toBe(false);
  });

  it("removes listeners and timers when disabled or destroyed", async () => {
    const { motion, onDelta, onStatus } = createControls();
    await motion.enable();
    sample(90, 0);
    motion.disable();
    sample(90, 20);
    vi.advanceTimersByTime(3000);
    expect(onDelta).not.toHaveBeenCalled();
    expect(onStatus.mock.lastCall?.[0].state).toBe("off");
    await motion.enable();
    sample(90, 40);
    sample(90, 60);
    expect(onDelta).toHaveBeenCalledTimes(1);
    motion.destroy();
    sample(90, 80);
    sensorWindow.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(3000);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(await motion.enable()).toBe(false);
    expect(motion.enabled).toBe(false);
  });
});

describe("relative tilt control", () => {
  it("defaults to tilt and primes at any starting angle without a jump", async () => {
    const onDelta = vi.fn<(delta: number) => void>();
    const motion = new MotionControls(onDelta, () => {});
    controls.push(motion);
    expect(motion.mode).toBe("tilt");
    await motion.enable();
    tiltSample(95, 28, 0);
    tiltSample(95, 28, 20);
    vi.advanceTimersByTime(2000);
    expect(onDelta).not.toHaveBeenCalled();
    expect(motion.enabled).toBe(true);
  });

  it("responds in both directions to forward/back tilt while held upright", async () => {
    const { motion, onDelta } = createControls("tilt");
    await motion.enable();
    tiltSample(90, 0, 0);
    tiltSample(91.2, 0, 20);
    tiltSample(90, 0, 40);
    expect(onDelta.mock.calls[0]?.[0]).toBeCloseTo(0.02);
    expect(onDelta.mock.calls[1]?.[0]).toBeCloseTo(-0.02);
  });

  it("also responds to sideways tilt and preserves the stronger diagonal direction", async () => {
    const { motion, onDelta } = createControls("tilt");
    await motion.enable();
    tiltSample(60, 0, 0);
    tiltSample(60, 1.2, 20);
    tiltSample(60, 0, 40);
    tiltSample(59.5, 1.2, 60);
    expect(onDelta.mock.calls[0]?.[0]).toBeCloseTo(0.02);
    expect(onDelta.mock.calls[1]?.[0]).toBeCloseTo(-0.02);
    expect(onDelta.mock.calls[2]?.[0]).toBeCloseTo(0.02);
  });

  it("rejects small sensor jitter but lets a slow deliberate tilt cross the deadband", async () => {
    const { motion, onDelta } = createControls("tilt");
    await motion.enable();
    tiltSample(45, 0, 0);
    tiltSample(45.1, 0.05, 20);
    tiltSample(44.9, -0.05, 40);
    expect(onDelta).not.toHaveBeenCalled();
    tiltSample(45.1, 0, 60);
    tiltSample(45.15, 0, 80);
    tiltSample(45.3, 0, 100);
    tiltSample(45.3, 0, 120);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta.mock.calls[0]?.[0]).toBeCloseTo(0.005);
  });

  it("handles angle wrapping and caps sudden reorientation", async () => {
    const { motion, onDelta } = createControls("tilt");
    await motion.enable();
    tiltSample(179, 0, 0);
    tiltSample(-179, 0, 20);
    tiltSample(-120, 0, 40);
    expect(onDelta.mock.calls[0]?.[0]).toBeCloseTo(2 / 60);
    expect(onDelta.mock.calls[1]?.[0]).toBe(0.05);
  });

  it("rejects invalid gravity and starts a fresh baseline after a data gap", async () => {
    const { motion, onDelta } = createControls("tilt");
    await motion.enable();
    tiltSample(45, 0, 0);
    for (const x of [null, Infinity, NaN])
      sensorWindow.dispatchEvent(
        new SensorEvent(null, 20, { x, y: 0, z: 9.81 }),
      );
    tiltSample(70, 0, 40);
    tiltSample(90, 0, 1000);
    tiltSample(91.2, 0, 1020);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta.mock.calls[0]?.[0]).toBeCloseTo(0.02);
  });

  it("resets tilt baselines after blur and page visibility changes", async () => {
    const { motion, onDelta } = createControls("tilt");
    await motion.enable();
    tiltSample(20, 0, 0);
    sensorWindow.dispatchEvent(new Event("blur"));
    tiltSample(50, 0, 20);
    sensorWindow.dispatchEvent(new Event("focus"));
    tiltSample(80, 0, 40);
    tiltSample(81.2, 0, 60);
    sensorDocument.hidden = true;
    sensorDocument.dispatchEvent(new Event("visibilitychange"));
    tiltSample(20, 0, 80);
    sensorDocument.hidden = false;
    sensorDocument.dispatchEvent(new Event("visibilitychange"));
    tiltSample(50, 0, 100);
    tiltSample(51.2, 0, 120);
    expect(onDelta).toHaveBeenCalledTimes(2);
    for (const [delta] of onDelta.mock.calls) expect(delta).toBeCloseTo(0.02);
  });
});

describe("linear movement control", () => {
  it("responds to either direction along each linear acceleration axis", () => {
    for (const acceleration of [
      { x: 5.35, y: 0, z: 0 },
      { x: 0, y: 5.35, z: 0 },
      { x: 0, y: 0, z: 5.35 },
    ]) {
      expect(normalizedMoveDelta(acceleration, 20)).toBeCloseTo(0.02);
      expect(
        normalizedMoveDelta(
          {
            x: -acceleration.x,
            y: -acceleration.y,
            z: -acceleration.z,
          },
          20,
        ),
      ).toBeCloseTo(-0.02);
    }
  });

  it("rejects noise, invalid values and stale samples, and bounds a large impulse", () => {
    for (const acceleration of [
      null,
      { x: 0, y: 0.1, z: -0.2 },
      { x: NaN, y: 0, z: 1 },
      { x: 0, y: Infinity, z: 1 },
    ])
      expect(normalizedMoveDelta(acceleration, 20)).toBe(0);
    expect(normalizedMoveDelta({ x: 0, y: 0, z: 5 }, 1000)).toBe(0);
    expect(normalizedMoveDelta({ x: 0, y: 0, z: 5 }, NaN)).toBe(0);
    expect(normalizedMoveDelta({ x: 0, y: 0, z: 100000 }, 100)).toBe(0.05);
  });

  it("uses gravity-free movement and stops immediately when acceleration stops", async () => {
    const { motion, onDelta } = createControls("move");
    await motion.enable();
    moveSample(0, 0, 0, 0);
    moveSample(0, 0, 5.35, 20);
    moveSample(0, 0, 0, 40);
    moveSample(0, 0, 0, 60);
    moveSample(0, 0, -5.35, 80);
    moveSample(0, 0, 0, 100);
    vi.advanceTimersByTime(2000);
    expect(motion.enabled).toBe(true);
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual([0.02, -0.02]);
  });
});

describe("motion modes and sensor availability", () => {
  it("resets timing and tilt references when switching modes", async () => {
    const { motion, onDelta } = createControls("tilt");
    await motion.enable();
    tiltSample(0, 0, 0);
    motion.setMode("move");
    expect(motion.mode).toBe("move");
    moveSample(0, 0, 5.35, 20);
    expect(onDelta).not.toHaveBeenCalled();
    moveSample(0, 0, 5.35, 40);
    motion.setMode("twist");
    sample(90, 60);
    sample(90, 80);
    motion.setMode("tilt");
    tiltSample(90, 0, 100);
    tiltSample(91.2, 0, 120);
    expect(onDelta).toHaveBeenCalledTimes(3);
    for (const [delta] of onDelta.mock.calls) expect(delta).toBeCloseTo(0.02);
  });

  it("requires data for the selected mode rather than any available sensor", async () => {
    const { motion, onStatus } = createControls("twist");
    await motion.enable();
    sample(0, 0);
    motion.setMode("tilt");
    sample(90, 20);
    sensorWindow.dispatchEvent(new SensorEvent(null, 40, { x: 0, y: 0, z: 0 }));
    vi.advanceTimersByTime(2000);
    expect(motion.enabled).toBe(false);
    expect(onStatus.mock.lastCall?.[0].state).toBe("unavailable");
    motion.setMode("move");
    await motion.enable();
    tiltSample(45, 0, 60);
    vi.advanceTimersByTime(2000);
    expect(motion.enabled).toBe(false);
  });
});
