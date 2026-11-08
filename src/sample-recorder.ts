import { z } from "zod";
import { CUSTOM_SAMPLE_SECONDS } from "./custom-sample-schema";
import { resampleRecording } from "./recording-wav";
import recordingWorkletUrl from "./recording-worklet.js?url&no-inline";

export interface RecordingStatus {
  phase: "idle" | "requesting" | "recording" | "processing";
  seconds: number;
}
interface RecorderOptions {
  onState: (status: RecordingStatus) => void;
  onComplete: (blob: Blob, signal: AbortSignal) => Promise<void>;
  onError: (message: string) => void;
}
const workletMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    seconds: z.number().min(0).max(CUSTOM_SAMPLE_SECONDS),
  }),
  z.object({
    type: z.literal("complete"),
    samples: z.instanceof(Float32Array),
    sampleRate: z.number().int().min(8000).max(192000),
  }),
]);
export function createSampleRecorder(options: RecorderOptions) {
  let generation = 0,
    phase: RecordingStatus["phase"] = "idle";
  let operation = new AbortController();
  let context: AudioContext | undefined,
    stream: MediaStream | undefined,
    node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function state(next: RecordingStatus["phase"], seconds = 0): void {
    phase = next;
    options.onState({ phase, seconds });
  }
  function release(): void {
    clearTimeout(timeout);
    stopInput();
    source?.disconnect();
    source = undefined;
    if (node) {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
      node = undefined;
    }
    const active = context;
    context = undefined;
    if (active && active.state !== "closed")
      void active.close().catch(() => undefined);
  }
  function stopInput(): void {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
  }
  function cancel(): void {
    generation++;
    operation.abort();
    release();
    state("idle");
  }
  async function complete(
    samples: Float32Array,
    rate: number,
    current: number,
  ): Promise<void> {
    release();
    state("processing", Math.min(CUSTOM_SAMPLE_SECONDS, samples.length / rate));
    try {
      const blob = await resampleRecording(samples, rate);
      if (current !== generation) return;
      await options.onComplete(blob, operation.signal);
    } catch (error) {
      if (current === generation)
        options.onError(
          error instanceof Error
            ? error.message
            : "The recording could not be saved.",
        );
    } finally {
      if (current === generation) state("idle");
    }
  }
  function stop(): void {
    if (phase === "requesting") {
      cancel();
      return;
    }
    if (phase !== "recording") return;
    clearTimeout(timeout);
    state("processing");
    node?.port.postMessage("stop");
    stopInput();
    const current = generation;
    timeout = setTimeout(() => {
      if (current !== generation || phase !== "processing") return;
      cancel();
      options.onError(
        "Recording stopped before its audio could be saved. Try again.",
      );
    }, 1500);
  }
  async function start(): Promise<void> {
    if (phase !== "idle") return;
    const current = ++generation;
    operation = new AbortController();
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioWorkletNode === "undefined"
    ) {
      options.onError("Microphone recording is unavailable in this browser.");
      return;
    }
    state("requesting");
    try {
      const active = new AudioContext();
      context = active;
      const resume = active.resume().then(
        () => null,
        (error: unknown) => error,
      );
      const granted = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (current !== generation) {
        granted.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = granted;
      const resumeError = await resume;
      if (resumeError) throw resumeError;
      await active.audioWorklet.addModule(recordingWorkletUrl);
      if (current !== generation) return;
      const processor = new AudioWorkletNode(active, "grain-recording", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node = processor;
      source = active.createMediaStreamSource(granted);
      source.connect(processor);
      processor.connect(active.destination);
      processor.port.onmessage = (event: MessageEvent<unknown>) => {
        if (current !== generation) return;
        const parsed = workletMessageSchema.safeParse(event.data);
        if (!parsed.success) {
          cancel();
          options.onError("The microphone returned invalid audio.");
          return;
        }
        if (parsed.data.type === "progress") {
          if (phase === "recording") state("recording", parsed.data.seconds);
        } else
          void complete(parsed.data.samples, parsed.data.sampleRate, current);
      };
      processor.onprocessorerror = () => {
        if (current === generation) {
          cancel();
          options.onError("Microphone recording stopped unexpectedly.");
        }
      };
      state("recording");
      timeout = setTimeout(stop, CUSTOM_SAMPLE_SECONDS * 1000 + 500);
    } catch (error) {
      if (current !== generation) return;
      release();
      state("idle");
      options.onError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow access in browser settings and try again."
          : error instanceof Error
            ? error.message
            : "The microphone could not be opened.",
      );
    }
  }
  window.addEventListener("pagehide", cancel);
  return {
    start,
    stop,
    cancel,
    destroy: () => {
      cancel();
      window.removeEventListener("pagehide", cancel);
    },
  };
}
