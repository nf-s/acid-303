import { describe, expect, it } from "vitest";
import {
  createProject,
  resizeDrumTrack,
  resizeBassTrack,
  resizeKeysTrack,
  projectSchema,
} from "./model";
import { resizeCloudTrack } from "./cloud-model";
import { resizeTensionTrack } from "./tension-model";
import { resizeArpTrack } from "./arp-model";
import { resizePadTrack } from "./pad-model";
import { resizeVocalTrack, VOCAL_SOUNDS } from "./vocal-model";
import {
  sequenceTimingSchema,
  padTimingSchema,
  trackStepCount,
  automationStepCount,
  MAX_PROJECT_BYTES,
} from "./timing";
import { encodeTrack, decodeTrack } from "./share";

describe("track links", () => {
  it("round-trips musical state, all automation, and unicode names", async () => {
    const track = createProject();
    track.name = "Night 🐈 café";
    for (const drum of track.drums)
      drum.automation.tone = Array.from({ length: 16 }, (_, step) => step / 15);
    track.bass.automation.cutoff = Array.from(
      { length: 16 },
      (_, step) => 1 - step / 15,
    );
    const link = await encodeTrack(track);
    expect(link).toMatch(/^v1\.[\w-]+$/);
    expect(link.length).toBeLessThan(6000);
    expect(await decodeTrack(link)).toEqual(track);
  });
  it("round-trips the longest patterns with all 96 independent automation lanes", async () => {
    const track = createProject();
    const timing = sequenceTimingSchema.parse({
      bars: 8,
      meter: "5/4",
      grid: "triplet",
    });
    track.drums = track.drums.map((drum) => resizeDrumTrack(drum, timing));
    track.bass = resizeBassTrack(track.bass, timing);
    track.keys = resizeKeysTrack(track.keys, timing);
    track.arp = resizeArpTrack(track.arp, timing);
    track.pad = resizePadTrack(
      track.pad,
      padTimingSchema.parse({ ...timing, bars: 16 }),
    );
    track.vocal = resizeVocalTrack(track.vocal, { ...timing, bars: 16 });
    track.cloud = resizeCloudTrack(track.cloud, { ...timing, bars: 16 });
    track.tension = resizeTensionTrack(track.tension, { ...timing, bars: 16 });
    track.vocal.sound = VOCAL_SOUNDS.length - 1;
    track.vocal.notes = Array.from(
      { length: trackStepCount(track.vocal.timing) },
      (_, start) => ({ start, length: 1, note: 60, accent: start % 2 === 0 }),
    );
    let seed = 918273;
    const fill = (
      automation: Record<string, number[] | null>,
      count: number,
    ): void => {
      for (const key of Object.keys(automation))
        automation[key] = Array.from({ length: count }, () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 4294967295;
        });
    };
    for (const instrument of [
      ...track.drums,
      track.bass,
      track.keys,
      track.arp,
      track.pad,
      track.vocal,
      track.cloud,
      track.tension,
    ]) {
      instrument.automationBars = 16;
      fill(instrument.automation, automationStepCount(instrument));
    }
    projectSchema.parse(track);
    expect(
      new TextEncoder().encode(JSON.stringify(track)).byteLength,
    ).toBeLessThan(MAX_PROJECT_BYTES);
    const link = await encodeTrack(track);
    expect(link.length).toBeGreaterThan(500000);
    expect(link.length).toBeLessThan(600000);
    expect(await decodeTrack(link)).toEqual(track);
  });
  it("bounds decompressed data before parsing", async () => {
    const data = new Uint8Array(
      await new Response(
        new Blob([" ".repeat(MAX_PROJECT_BYTES + 1)])
          .stream()
          .pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    const binary = Array.from(data, (byte) => String.fromCharCode(byte)).join(
      "",
    );
    const encoded =
      "v1." +
      btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    expect(await decodeTrack(encoded)).toBeNull();
  });
  it("rejects unsupported, damaged, oversized and invalid payloads", async () => {
    for (const value of [
      "v2.abc",
      "v1.!",
      "v1.abc",
      "v1." + "a".repeat(500001),
    ])
      expect(await decodeTrack(value)).toBeNull();
    const data = await new Response(
      new Blob(['{"version":2,"bpm":-10}'])
        .stream()
        .pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const binary = Array.from(new Uint8Array(data), (byte) =>
      String.fromCharCode(byte),
    ).join("");
    expect(
      await decodeTrack(
        "v1." +
          btoa(binary)
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", ""),
      ),
    ).toBeNull();
  });
});

it("keeps local recordings in saved projects but never transfers them through track links", async () => {
  const { readProject } = await import("./model");
  const project = createProject();
  project.vocal.recording = {
    kind: "local",
    id: "a".repeat(32),
    sha256: "b".repeat(64),
    name: "Recorded hit",
    rootNote: 60,
    duration: 0.5,
    peaks: Array(128).fill(0.2),
  };
  expect(readProject(project)?.vocal.recording).toEqual(
    project.vocal.recording,
  );
  await expect(encodeTrack(project)).rejects.toThrow("Upload this recording");
  const bytes = new Uint8Array(
    await new Response(
      new Blob([JSON.stringify(project)])
        .stream()
        .pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const encoded =
    "v1." +
    btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  expect(await decodeTrack(encoded)).toBeNull();
  project.vocal.recording = {
    ...project.vocal.recording,
    kind: "shared",
    readToken: "c".repeat(43),
  };
  expect(await decodeTrack(await encodeTrack(project))).toEqual(project);
});
