import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleRecorder } from "./sample-recorder";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("microphone release without a worklet response", () => {
  it.each(["manual", "deadline"])(
    "stops input immediately on%s Stop and closes an unresponsive context",
    async (mode) => {
      vi.useFakeTimers();
      const trackStop = vi.fn(),
        close = vi.fn(async () => undefined),
        onError = vi.fn(),
        onComplete = vi.fn(async () => undefined);
      class Context {
        state = "running";
        audioWorklet = { addModule: async () => undefined };
        destination = {};
        resume = async () => undefined;
        close = close;
        createMediaStreamSource = () => ({
          connect: () => undefined,
          disconnect: () => undefined,
        });
      }
      class Processor {
        port = {
          postMessage: () => undefined,
          close: () => undefined,
          onmessage: null,
        };
        connect = () => undefined;
        disconnect = () => undefined;
      }
      vi.stubGlobal("window", new EventTarget());
      vi.stubGlobal("navigator", {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop: trackStop }],
          }),
        },
      });
      vi.stubGlobal("AudioContext", Context);
      vi.stubGlobal("AudioWorkletNode", Processor);
      const states: string[] = [];
      const recorder = createSampleRecorder({
        onState: (state) => states.push(state.phase),
        onComplete,
        onError,
      });
      await recorder.start();
      expect(states.at(-1)).toBe("recording");
      if (mode === "manual") recorder.stop();
      else await vi.advanceTimersByTimeAsync(10500);
      expect(trackStop).toHaveBeenCalledTimes(1);
      expect(states.at(-1)).toBe("processing");
      await vi.advanceTimersByTimeAsync(1500);
      expect(close).toHaveBeenCalledTimes(1);
      expect(states.at(-1)).toBe("idle");
      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("stopped"));
      recorder.destroy();
    },
  );
});
