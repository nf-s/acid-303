import { describe, expect, it } from "vitest";
import {
  encodeWav,
  exportTailDuration,
  midiFrequency,
  saturationSample,
  tiesNextStep,
} from "./audio";
import { createProject, projectSchema, stepDuration } from "./model";
import { arpTailDuration } from "./arp-audio";
import { padTailDuration } from "./pad-audio";

describe("audio timing and project boundary", () => {
  it("ties only adjacent enabled notes and includes the loop boundary", () => {
    const steps = Array.from({ length: 16 }, () => ({
      on: false,
      slide: false,
    }));
    steps[0] = { on: true, slide: true };
    steps[1] = { on: true, slide: false };
    expect(tiesNextStep(steps, 0)).toBe(true);
    steps[1] = { on: false, slide: true };
    steps[2] = { on: true, slide: false };
    expect(tiesNextStep(steps, 0)).toBe(false);
    expect(tiesNextStep(steps, 1)).toBe(false);
    steps[15] = { on: true, slide: true };
    expect(tiesNextStep(steps, 15)).toBe(true);
    steps[0] = { on: false, slide: false };
    expect(tiesNextStep(steps, 15)).toBe(false);
  });

  it("preserves bar duration at maximum swing and the supported tempos", () => {
    for (const bpm of [60, 126, 180]) {
      const duration = Array.from({ length: 16 }, (_, step) =>
        stepDuration(bpm, 0.5, step),
      ).reduce((sum, value) => sum + value, 0);
      expect(duration).toBeCloseTo((60 / bpm) * 4, 10);
      expect(stepDuration(bpm, 0.5, 0)).toBeGreaterThan(
        stepDuration(bpm, 0.5, 1),
      );
    }
  });

  it("validates all presets and rejects invalid persisted audio settings", () => {
    for (const preset of [0, 1, 2])
      expect(projectSchema.safeParse(createProject(preset)).success).toBe(true);
    const project = createProject();
    expect(projectSchema.safeParse({ ...project, bpm: 0 }).success).toBe(false);
    expect(projectSchema.safeParse({ ...project, volume: 10 }).success).toBe(
      false,
    );
    expect(
      projectSchema.safeParse({ ...project, drums: project.drums.slice(1) })
        .success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...project,
        bass: { ...project.bass, cutoff: Infinity },
      }).success,
    ).toBe(false);
  });

  it("tunes MIDI notes to concert pitch", () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(33)).toBeCloseTo(55);
    expect(midiFrequency(45)).toBeCloseTo(110);
  });
});

describe("WAV export", () => {
  it("reserves the complete Arp and Pad releases on the shared export", () => {
    const project = createProject();
    project.bpm = 60;
    project.arp.muted = false;
    project.arp.decay = 1.5;
    project.arp.space = 1;
    project.arp.gate = 1;
    project.arp.rate = "1/8";
    project.pad.muted = false;
    project.pad.release = 1;
    project.pad.space = 1;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(
      arpTailDuration(project.arp, project.bpm),
    );
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(
      padTailDuration(project.pad, project.bpm),
    );
    project.arp.muted = true;
    project.pad.muted = true;
    expect(exportTailDuration(project)).toBeLessThan(2);
  });
  it("retains the longest keys release and echoes at the slowest tempo", () => {
    const project = createProject();
    project.bpm = 60;
    project.keys.decay = 2;
    project.keys.space = 1;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(3.55);
    project.keys.muted = true;
    const hat = project.drums.find((track) => track.id === "hat");
    if (!hat) throw new Error("Expected the default hi-hat track.");
    hat.sound = 1;
    hat.decay = 1.5;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(2.55);
  });

  it("retains the diffuse Haze room at fast tempos", () => {
    const project = createProject();
    project.bpm = 180;
    project.keys.sound = 1;
    project.keys.space = 1;
    project.keys.decay = 2;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(2.95);
  });

  it("retains long Dub taps, Ride cymbals and Room claps", () => {
    const project = createProject();
    project.bpm = 60;
    project.keys.sound = 4;
    project.keys.space = 1;
    project.keys.decay = 2;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(4.3);
    project.keys.muted = true;
    for (const track of project.drums) track.muted = true;
    const hat = project.drums.find((track) => track.id === "hat");
    const clap = project.drums.find((track) => track.id === "clap");
    if (!hat || !clap) throw new Error("Expected hi-hat and clap tracks.");
    hat.muted = false;
    hat.sound = 4;
    hat.decay = 1.5;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(3.1);
    hat.muted = true;
    clap.muted = false;
    clap.sound = 3;
    clap.decay = 1.5;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(2.85);
  });

  it("retains an automated release after a different step opens the echo", () => {
    const project = createProject();
    project.bpm = 60;
    project.keys.sound = 4;
    project.keys.decay = 0.08;
    project.keys.space = 0;
    project.keys.automation.decay = Array.from({ length: 16 }, (_, step) =>
      step === 15 ? 1 : 0,
    );
    project.keys.automation.space = Array.from({ length: 16 }, (_, step) =>
      step === 14 ? 1 : 0,
    );
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(4.3);
    project.keys.automation.volume = Array.from({ length: 16 }, () => 0);
    for (const drum of project.drums) drum.muted = true;
    expect(exportTailDuration(project)).toBe(0.35);
  });

  it("retains automated drum decay and room tails", () => {
    const project = createProject();
    project.keys.muted = true;
    const hat = project.drums.find((track) => track.id === "hat");
    if (!hat) throw new Error("Expected a hi-hat.");
    hat.sound = 4;
    hat.automation.decay = Array.from({ length: 16 }, (_, step) =>
      step === 15 ? 1 : 0,
    );
    hat.automation.space = Array.from({ length: 16 }, (_, step) =>
      step === 15 ? 1 : 0,
    );
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(4.04);
    hat.automation.volume = Array.from({ length: 16 }, () => 0);
    expect(exportTailDuration(project)).toBeLessThan(1);
  });

  it("retains Smear reverb and Vapor room tails at maximum decay", () => {
    const project = createProject();
    project.bpm = 180;
    project.drums.forEach((track) => {
      track.muted = true;
    });
    project.keys.muted = true;
    const clap = project.drums.find((track) => track.id === "clap");
    if (!clap) throw new Error("Expected clap");
    clap.muted = false;
    clap.sound = 6;
    clap.decay = 1.5;
    clap.space = 1;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(
      1.5 * 1.25 + 0.95 + 0.92,
    );
    clap.muted = true;
    project.keys.muted = false;
    project.keys.sound = 7;
    project.keys.decay = 2;
    project.keys.space = 1;
    expect(exportTailDuration(project)).toBeGreaterThanOrEqual(2.98);
  });

  it("writes an interleaved stereo PCM file with correctly clamped samples", async () => {
    const blob = encodeWav(
      [new Float32Array([-2, 0.5, NaN]), new Float32Array([2, -0.5, Infinity])],
      44100,
    );
    const data = await blob.arrayBuffer();
    const view = new DataView(data);
    expect(blob.type).toBe("audio/wav");
    expect(data.byteLength).toBe(56);
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(data.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(data.byteLength - 8);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(16384);
    expect(view.getInt16(50, true)).toBe(-16384);
    expect(view.getInt16(52, true)).toBe(0);
    expect(view.getInt16(54, true)).toBe(0);
  });

  it("rejects mismatched or absent channels instead of making a corrupt file", () => {
    expect(() => encodeWav([], 44100)).toThrow();
    expect(() =>
      encodeWav([new Float32Array(2), new Float32Array(1)], 44100),
    ).toThrow();
  });
});

describe("controlled saturation", () => {
  it("preserves quiet signals instead of multiplying bass gain as drive increases", () => {
    for (const drive of [0, 0.12, 0.28, 1]) {
      expect(saturationSample(0.001, drive)).toBeCloseTo(0.001, 6);
      expect(Math.abs(saturationSample(0.5, drive))).toBeLessThanOrEqual(0.5);
      expect(saturationSample(-0.5, drive)).toBeCloseTo(
        -saturationSample(0.5, drive),
        10,
      );
      expect(saturationSample(0, drive)).toBe(0);
    }
  });
});

describe("independent tick scheduling", () => {
  it("keeps old swing onsets and schedules triplets without cumulative drift", async () => {
    const { projectEventsAtTick } = await import("./audio");
    const { resizeDrumTrack } = await import("./model");
    const project = createProject();
    project.swing = 0.5;
    const snare = project.drums.find((track) => track.id === "snare");
    if (!snare) throw new Error("Missing snare");
    project.drums = project.drums.map((track) =>
      track.id === "snare"
        ? resizeDrumTrack(track, { bars: 2, meter: "5/4", grid: "triplet" })
        : track,
    );
    const events = Array.from({ length: 240 }, (_, tick) =>
      projectEventsAtTick(project, tick),
    ).flat();
    const kick = events.filter((event) => event.instrument === "kick");
    const triplets = events.filter((event) => event.instrument === "snare");
    expect(kick.slice(0, 4).map((event) => event.audibleTick)).toEqual([
      0, 9, 12, 21,
    ]);
    expect(triplets).toHaveLength(60);
    expect(
      triplets.every((event, index) => event.audibleTick === index * 4),
    ).toBe(true);
    expect(triplets.at(-1)?.index).toBe(59);
    expect(
      projectEventsAtTick(project, 240).find(
        (event) => event.instrument === "snare",
      )?.index,
    ).toBe(0);
  });
  it("wraps slides only at the instrument's own cycle", async () => {
    const { tiesNextStep } = await import("./audio");
    const steps = Array.from({ length: 48 }, (_, index) => ({
      on: index === 47 || index === 0,
      slide: index === 47,
    }));
    expect(tiesNextStep(steps, 47)).toBe(true);
    steps[0] = { on: false, slide: false };
    expect(tiesNextStep(steps, 47)).toBe(false);
  });
  it("bounds bipolar performance tails and bypasses them at center", async () => {
    const { performanceFxTail } = await import("./audio");
    const project = createProject();
    expect(performanceFxTail(project)).toBe(0);
    project.bpm = 60;
    project.fx = { sweep: 1, space: 1, echo: 1 };
    expect(performanceFxTail(project)).toBeGreaterThan(4.5);
    expect(performanceFxTail(project)).toBeLessThan(15);
    project.fx.echo = -1;
    expect(performanceFxTail(project)).toBeLessThan(8);
  });
});
