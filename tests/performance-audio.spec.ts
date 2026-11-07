import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { build } from "vite";
import { createProject } from "../src/model";
import type { Project } from "../src/model";

let harness: Promise<string> | undefined;
async function audioModule(): Promise<string> {
  const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
  const result = await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: `${root}src/audio.ts`,
        formats: ["es"],
        fileName: () => "audio.js",
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result)
    ? result
    : "output" in result
      ? [result]
      : [];
  const entry = outputs
    .flatMap((output) => output.output)
    .find((output) => output.type === "chunk" && output.isEntry);
  if (!entry || entry.type !== "chunk")
    throw new Error("Audio harness did not build");
  return entry.code;
}
async function prepare(page: Page): Promise<void> {
  harness ??= audioModule();
  const code = await harness;
  await page.route("**/performance-audio-module.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: code }),
  );
  await page.goto("/");
}
function isolated(instrument: "cloud" | "tension"): Project {
  const project = createProject();
  for (const track of [
    ...project.drums,
    project.bass,
    project.keys,
    project.arp,
    project.pad,
    project.vocal,
    project.cloud,
    project.tension,
  ])
    track.muted = true;
  project[instrument].muted = false;
  return project;
}

test("all twelve performance sounds render distinct bounded WAVs and complete tails", async ({
  page,
}) => {
  test.setTimeout(120000);
  await prepare(page);
  const results = await page.evaluate(
    async (projects) => {
      const modulePath = "/performance-audio-module.js",
        { AudioEngine } = await import(modulePath);
      const results = [];
      for (const [instrument, original] of projects) {
        const waveforms: Float32Array[] = [];
        for (let sound = 0; sound < 6; sound++)
          for (const extreme of [false, true]) {
            const project = structuredClone(original),
              track = project[instrument];
            track.sound = sound;
            if (extreme) {
              project.volume = 1;
              project.bpm = 180;
              const automation: Record<string, number[] | null> =
                track.automation;
              for (const key of Object.keys(automation))
                automation[key] = Array(track.steps.length).fill(1);
              track.steps = track.steps.map((step, index) => ({
                ...step,
                on: true,
                note: index % 2 ? 36 : 84,
                velocity: 1,
              }));
            }
            const bytes = await (
                await new AudioEngine(() => {}).exportWav(project)
              ).arrayBuffer(),
              view = new DataView(bytes),
              data = new Float32Array((bytes.byteLength - 44) / 2);
            let peak = 0,
              energy = 0,
              tail = 0;
            for (let index = 0; index < data.length; index++) {
              const value = view.getInt16(44 + index * 2, true) / 32768;
              data[index] = value;
              peak = Math.max(peak, Math.abs(value));
              energy += value * value;
              if (index > data.length - 8820)
                tail = Math.max(tail, Math.abs(value));
            }
            if (!extreme) waveforms.push(data);
            results.push({
              instrument,
              sound,
              extreme,
              peak,
              rms: Math.sqrt(energy / data.length),
              tail,
            });
          }
        for (let first = 0; first < waveforms.length; first++)
          for (let second = first + 1; second < waveforms.length; second++) {
            const a = waveforms[first],
              b = waveforms[second];
            if (!a || !b) throw new Error("Missing render");
            let xx = 0,
              yy = 0,
              xy = 0;
            for (let index = 0; index < Math.min(a.length, b.length); index++) {
              const x = a[index] ?? 0,
                y = b[index] ?? 0;
              xx += x * x;
              yy += y * y;
              xy += x * y;
            }
            if (xy / Math.sqrt(xx * yy) > 0.985)
              throw new Error(
                `Insufficient profile contrast: ${instrument} ${first}/${second}`,
              );
          }
      }
      return results;
    },
    [
      ["cloud", isolated("cloud")],
      ["tension", isolated("tension")],
    ] satisfies Array<["cloud" | "tension", Project]>,
  );
  expect(results).toHaveLength(24);
  for (const result of results) {
    expect(result.peak).toBeGreaterThan(0.001);
    expect(result.peak).toBeLessThan(0.96);
    expect(result.tail).toBeLessThan(0.001);
  }
});

test("all sixteen automation controls change rendered sound and saved seeds reproduce it", async ({
  page,
}) => {
  test.setTimeout(120000);
  await prepare(page);
  const results = await page.evaluate(
    async (projects) => {
      const modulePath = "/performance-audio-module.js",
        { AudioEngine } = await import(modulePath);
      const render = async (project: Project): Promise<Float32Array> => {
        const bytes = await (
            await new AudioEngine(() => {}).exportWav(project)
          ).arrayBuffer(),
          view = new DataView(bytes),
          data = new Float32Array((bytes.byteLength - 44) / 2);
        for (let index = 0; index < data.length; index++)
          data[index] = view.getInt16(44 + index * 2, true) / 32768;
        return data;
      };
      const results = [];
      for (const [instrument, project] of projects) {
        project[instrument].volume = 0.8;
        project[instrument].steps = project[instrument].steps.map(
          (step, index) => ({
            ...step,
            on: index % 4 === 0,
            note: 60,
            velocity: 0.9,
          }),
        );
        const original = await render(project),
          repeated = await render(project);
        let maximum = 0;
        for (let index = 0; index < original.length; index++)
          maximum = Math.max(
            maximum,
            Math.abs((original[index] ?? 0) - (repeated[index] ?? 0)),
          );
        if (maximum > 1 / 32768) throw new Error(`Seed changed ${instrument}`);
        for (const parameter of Object.keys(project[instrument].automation)) {
          const low = structuredClone(project),
            high = structuredClone(project),
            lowAutomation: Record<string, number[] | null> =
              low[instrument].automation,
            highAutomation: Record<string, number[] | null> =
              high[instrument].automation;
          lowAutomation[parameter] = Array(16).fill(0);
          highAutomation[parameter] = Array(16).fill(1);
          const a = await render(low),
            b = await render(high);
          let energy = 0;
          const count = Math.min(a.length, b.length);
          for (let index = 0; index < count; index++)
            energy += ((a[index] ?? 0) - (b[index] ?? 0)) ** 2;
          results.push({
            instrument,
            parameter,
            difference: Math.sqrt(energy / count),
          });
        }
      }
      return results;
    },
    [
      ["cloud", isolated("cloud")],
      ["tension", isolated("tension")],
    ] satisfies Array<["cloud" | "tension", Project]>,
  );
  expect(results).toHaveLength(16);
  for (const result of results)
    expect(result.difference).toBeGreaterThan(0.00001);
});

test("Cloud hold shares the sequence budget, release resumes it and Stop cleans every source", async ({
  page,
}) => {
  await prepare(page);
  const project = isolated("cloud");
  project.cloud.density = 1;
  project.cloud.size = 1;
  project.cloud.steps.forEach((step) => (step.on = true));
  const result = await page.evaluate(async (project) => {
    const modulePath = "/performance-audio-module.js",
      { AudioEngine } = await import(modulePath);
    let strikes = 0,
      starts = 0,
      ends = 0;
    const old = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      starts++;
      this.addEventListener("ended", () => ends++, { once: true });
      old.call(this, when, offset, duration);
    };
    const constant = ConstantSourceNode.prototype.start;
    ConstantSourceNode.prototype.start = function (when) {
      strikes++;
      starts++;
      this.addEventListener("ended", () => ends++, { once: true });
      constant.call(this, when);
    };
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const engine = new AudioEngine(() => {});
    engine.update(project);
    await engine.play(project);
    await wait(1000);
    const first = starts;
    await engine.auditionCloud(project.cloud, 60, 0.8, true);
    await wait(1000);
    const held = starts - first;
    engine.releaseCloudAudition();
    const before = starts;
    await wait(1000);
    const resumed = starts - before;
    await Promise.all([
      engine.auditionTension(project.tension, 60, 0.8),
      engine.auditionTension(project.tension, 64, 0.9),
    ]);
    engine.stop();
    await wait(300);
    const afterStop = { starts, ends };
    await engine.play(project);
    await wait(200);
    engine.stop();
    await wait(300);
    return { held, resumed, afterStop, starts, ends, strikes };
  }, project);
  expect(result.held).toBeGreaterThanOrEqual(25);
  expect(result.held).toBeLessThanOrEqual(40);
  expect(result.resumed).toBeGreaterThanOrEqual(25);
  expect(result.resumed).toBeLessThanOrEqual(40);
  expect(result.afterStop.starts).toBe(result.afterStop.ends);
  expect(result.starts).toBe(result.ends);
  expect(result.strikes).toBe(2);
});

test("silent guests create no audio context and release cancels a pending Cloud resume", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async (project) => {
    const modulePath = "/performance-audio-module.js",
      { AudioEngine } = await import(modulePath);
    let contexts = 0,
      starts = 0,
      held = true;
    let release: () => void = () => {};
    const Native = AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts++;
      }
      override get state(): AudioContextState {
        return held ? "suspended" : super.state;
      }
      override async resume(): Promise<void> {
        await new Promise<void>((resolve) => {
          release = () => {
            held = false;
            void super.resume().then(resolve);
          };
        });
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      starts++;
      start.call(this, when, offset, duration);
    };
    const engine = new AudioEngine(() => {});
    engine.update(project);
    engine.setSilent(true);
    await Promise.all(
      [
        engine.play(project),
        engine.auditionCloud(project.cloud, 60, 1, true),
        engine.auditionTension(project.tension, 60, 1),
        engine.exportWav(project),
      ].map((promise) => promise.catch(() => {})),
    );
    const guestContexts = contexts;
    engine.setSilent(false);
    const pending = engine.auditionCloud(project.cloud, 60, 1, true);
    await Promise.resolve();
    engine.releaseCloudAudition();
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 150));
    engine.stop();
    return { guestContexts, starts };
  }, isolated("cloud"));
  expect(result).toEqual({ guestContexts: 0, starts: 0 });
});
