import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionControls, normalizedTwistDelta } from "./motion-controls";
import type { MotionStatus } from "./motion-controls";

class SensorWindow extends EventTarget {
  isSecureContext = true;
}
class SensorDocument extends EventTarget {
  hidden = false;
}
class SensorEvent extends Event {
  readonly rotationRate: { alpha: number; beta: number; gamma: number | null };

  constructor(gamma: number | null, timestamp: number) {
    super("devicemotion");
    this.rotationRate = { alpha: 90, beta: 90, gamma };
    Object.defineProperty(this, "timeStamp", { value: timestamp });
  }
}

let sensorWindow: SensorWindow;
let sensorDocument: SensorDocument;
const controls: MotionControls[] = [];

function createControls() {
  const onDelta = vi.fn<(delta: number) => void>();
  const onStatus = vi.fn<(status: MotionStatus) => void>();
  const motion = new MotionControls(onDelta, onStatus);
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
      message: "Hold a knob and twist your phone.",
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
