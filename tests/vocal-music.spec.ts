import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
  createProject,
  projectSchema,
  scaleNotes,
  snapNote,
} from "../src/model";
import type { Project } from "../src/model";
import {
  resizeVocalTrack,
  VOCAL_PATTERNS,
  withVocalPattern,
} from "../src/vocal-model";
import { stepsPerBar, trackStepCount } from "../src/timing";
import type { Timing } from "../src/timing";

const catalogSchema = z.object({
  samples: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      duration: z.number(),
      rootNote: z.number(),
    }),
  ),
});
declare global {
  interface Window {
    vocalMusicProbe: {
      sources: {
        when: number;
        stop: number | null;
        rate: number;
        duration: number;
      }[];
      wav?: Promise<ArrayBuffer>;
    };
  }
}
async function load(page: Page, project: Project = createProject()) {
  await page.addInitScript((project) => {
    if (sessionStorage.getItem("vocal-music-seeded")) return;
    localStorage.setItem("acid-303-project-v1", JSON.stringify(project));
    sessionStorage.setItem("vocal-music-seeded", "true");
  }, project);
  await page.goto("/");
  await expect(page.locator("#vocal-waveform-path")).toHaveAttribute(
    "data-sound",
    String(project.vocal.sound),
  );
}
async function saved(page: Page) {
  return projectSchema.parse(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("acid-303-project-v1"),
      )) ?? "null",
    ),
  );
}
async function probe(page: Page) {
  await page.addInitScript(() => {
    window.vocalMusicProbe = { sources: [] };
    const decoded = new WeakSet<AudioBuffer>();
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (
      data,
      success,
      failure,
    ) {
      const buffer = await decode.call(this, data, success, failure);
      decoded.add(buffer);
      return buffer;
    };
    const sources = new WeakMap<
      AudioBufferSourceNode,
      { when: number; stop: number | null; rate: number; duration: number }
    >();
    const start = AudioBufferSourceNode.prototype.start,
      stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      if (this.buffer && decoded.has(this.buffer)) {
        const source = {
          when: when ?? 0,
          stop: null,
          rate: this.playbackRate.value,
          duration: this.buffer.duration,
        };
        window.vocalMusicProbe.sources.push(source);
        sources.set(this, source);
      }
      start.call(this, when, offset, duration);
    };
    AudioBufferSourceNode.prototype.stop = function (when) {
      const source = sources.get(this);
      if (source) source.stop = when ?? this.context.currentTime;
      stop.call(this, when);
    };
    const objectUrl = URL.createObjectURL;
    URL.createObjectURL = (value) => {
      if (value instanceof Blob && value.type === "audio/wav")
        window.vocalMusicProbe.wav = value.arrayBuffer();
      return objectUrl.call(URL, value);
    };
  });
}

const timings: Timing[] = [
  { bars: 2, meter: "4/4", grid: "straight" },
  { bars: 4, meter: "7/8", grid: "triplet" },
];
for (const timing of timings) {
  test(`vocal rhythms follow ${timing.bars} bars of ${timing.meter} ${timing.grid}, preserve sound edits and Undo`, async ({
    page,
  }) => {
    const project = createProject();
    project.scale = { root: 6, mode: "dorian" };
    project.vocal = resizeVocalTrack(project.vocal, timing);
    project.vocal.notes = [{ start: 0, length: 1, note: 66, accent: false }];
    project.vocal.start = 0.15;
    project.vocal.end = 0.85;
    project.vocal.volume = 0.29;
    project.vocal.automation.tone = Array.from(
      { length: trackStepCount(timing) },
      (_, i) => i / (trackStepCount(timing) - 1),
    );
    await load(page, project);
    const before = (await saved(page)).vocal,
      variants = new Set<string>();
    for (const pattern of VOCAL_PATTERNS) {
      await page.locator(`[data-vocal-pattern="${pattern.id}"]`).click();
      await expect
        .poll(async () => (await saved(page)).vocal.muted)
        .toBe(false);
      const after = (await saved(page)).vocal;
      expect({ ...after, notes: before.notes, muted: before.muted }).toEqual(
        before,
      );
      const allowed = new Set(scaleNotes(project.scale, 36, 84));
      let end = 0;
      for (const note of after.notes) {
        expect(allowed.has(note.note)).toBe(true);
        expect(note.start).toBeGreaterThanOrEqual(end);
        expect(note.start + note.length).toBeLessThanOrEqual(
          trackStepCount(timing),
        );
        expect(Math.floor(note.start / stepsPerBar(timing))).toBe(
          Math.floor((note.start + note.length - 1) / stepsPerBar(timing)),
        );
        end = note.start + note.length;
      }
      for (let bar = 0; bar < timing.bars; bar++)
        expect(
          after.notes.some(
            (note) => Math.floor(note.start / stepsPerBar(timing)) === bar,
          ),
        ).toBe(true);
      variants.add(JSON.stringify(after.notes));
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await saved(page)).vocal).toEqual(before);
    }
    expect(variants.size).toBe(4);
  });
}

test("sample selection and Preview use the sample pitch reference without truncating it", async ({
  page,
}) => {
  await probe(page);
  const project = createProject();
  await load(page, project);
  const catalog = catalogSchema.parse(
    await (await page.request.get("/vocals/catalog-v2.json")).json(),
  );
  for (const [bank, sound] of [
    ["air", 32],
    ["soul", 24],
    ["dance", 40],
  ]) {
    if (typeof bank !== "string" || typeof sound !== "number")
      throw new Error("Invalid sample fixture.");
    const sample = catalog.samples[sound];
    if (!sample) throw new Error("Sample metadata missing.");
    const before = await page.evaluate(
      () => window.vocalMusicProbe.sources.length,
    );
    await page.locator(`[data-vocal-bank="${bank}"]`).click();
    await page.locator(`[data-vocal-sound="${sound}"]`).click();
    await expect
      .poll(() => page.evaluate(() => window.vocalMusicProbe.sources.length))
      .toBe(before + 1);
    const selected = await page.evaluate(() =>
      window.vocalMusicProbe.sources.at(-1),
    );
    if (!selected || selected.stop === null)
      throw new Error("Sample preview was not scheduled.");
    const rate =
      2 **
      ((snapNote(sample.rootNote, project.scale, 36, 84) - sample.rootNote) /
        12);
    expect(selected.rate).toBeCloseTo(rate, 5);
    expect(selected.stop - selected.when).toBeGreaterThanOrEqual(
      Math.min(2.5, sample.duration / rate),
    );
    await page.locator("#vocal-preview").click();
    await expect
      .poll(() => page.evaluate(() => window.vocalMusicProbe.sources.length))
      .toBe(before + 2);
    expect(
      (await page.evaluate(() => window.vocalMusicProbe.sources.at(-1)))?.rate,
    ).toBeCloseTo(rate, 5);
  }
});

test("legacy voice IDs retain their files and load alongside the musical banks", async ({
  page,
}) => {
  const original = catalogSchema.parse(
    await (await page.request.get("/vocals/catalog.json")).json(),
  );
  const expanded = catalogSchema.parse(
    await (await page.request.get("/vocals/catalog-v2.json")).json(),
  );
  expect(expanded.samples.slice(0, 24)).toEqual(original.samples);
  const project = createProject();
  project.vocal.sound = 16;
  await load(page, project);
  await expect(page.locator('[data-vocal-bank="fighter"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-vocal-sound="16"]')).toHaveText("Begin");
  await expect(page.locator("#vocal-pitch-reference")).toContainText(
    "unpitched",
  );
  await page.reload();
  await expect(page.locator("#vocal-waveform-path")).toHaveAttribute(
    "data-sound",
    "16",
  );
  expect((await saved(page)).vocal.notes).toEqual(project.vocal.notes);
});

test("all vocal banks and rhythm choices fit a 320px phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await load(page);
  for (const bank of ["soul", "air", "dance", "female", "male", "fighter"]) {
    await page.locator(`[data-vocal-bank="${bank}"]`).click();
    await expect(page.locator("[data-vocal-sound]")).toHaveCount(8);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    for (const selector of [
      ".vocal-banks",
      ".vocal-sounds",
      ".vocal-rhythms",
    ]) {
      const bounds = await page.locator(selector).boundingBox();
      if (!bounds) throw new Error("Vocal control group missing.");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    }
  }
  await page.locator('[data-vocal-pattern="chops"]').click();
  await expect
    .poll(async () => (await saved(page)).vocal.notes.length)
    .toBeGreaterThan(2);
});

test("new tuned chops render measurable unclipped audio inside a drum beat", async ({
  browser,
}) => {
  const renders: { peak: number; rms: number; starts: number }[] = [];
  for (const muted of [true, false]) {
    const page = await browser.newPage();
    try {
      const project = createProject();
      for (const track of [
        ...project.drums,
        project.bass,
        project.keys,
        project.arp,
        project.pad,
        project.cloud,
        project.tension,
      ])
        track.muted = true;
      const kick = project.drums.find((track) => track.id === "kick");
      if (!kick) throw new Error("Kick missing.");
      kick.muted = false;
      kick.volume = 0.22;
      kick.decay = 0.06;
      kick.steps = kick.steps.map((_, index) => index % 4 === 0);
      project.vocal = withVocalPattern(
        project.vocal,
        "offbeat",
        project.scale,
        63,
      );
      project.vocal.muted = muted;
      await probe(page);
      await load(page, project);
      await page.locator("#studio-tools").click();
      await page.locator("#export").click();
      await page.waitForFunction(
        () => window.vocalMusicProbe.wav !== undefined,
      );
      renders.push(
        await page.evaluate(async () => {
          const bytes = await window.vocalMusicProbe.wav;
          if (!bytes) throw new Error("WAV missing.");
          const view = new DataView(bytes),
            rate = view.getUint32(24, true);
          let peak = 0,
            sum = 0,
            count = 0;
          for (let frame = 0; 44 + frame * 4 < bytes.byteLength; frame++) {
            const sample = view.getInt16(44 + frame * 4, true) / 32768;
            peak = Math.max(peak, Math.abs(sample));
            if (frame >= rate * 0.27 && frame < rate * 0.39) {
              sum += sample * sample;
              count++;
            }
          }
          return {
            peak,
            rms: Math.sqrt(sum / count),
            starts: window.vocalMusicProbe.sources.length,
          };
        }),
      );
    } finally {
      await page.close();
    }
  }
  const base = renders[0],
    vocals = renders[1];
  if (!base || !vocals) throw new Error("Comparison render missing.");
  expect(base.starts).toBe(0);
  expect(vocals.starts).toBeGreaterThan(0);
  expect(vocals.rms).toBeGreaterThan(base.rms + 0.001);
  expect(vocals.peak).toBeGreaterThan(0.01);
  expect(vocals.peak).toBeLessThan(0.99);
});
