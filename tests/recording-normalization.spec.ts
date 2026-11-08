import { expect, test } from "@playwright/test";
import { build } from "vite";
import { z } from "zod";
import { encodeWav } from "../src/wav";

let moduleCode: Promise<string> | undefined;
async function normalizationModule(): Promise<string> {
  const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
  const entry = `${root}recording-normalization-probe.js`;
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [
      {
        name: entry,
        resolveId(id) {
          return id === entry ? `\0${entry}` : undefined;
        },
        load(id) {
          if (id !== `\0${entry}`) return;
          return `
            import { resampleRecording, normalizeImportedWav, readImportedWav } from ${JSON.stringify(`${root}src/recording-wav.ts`)};
            import { encodeWav } from ${JSON.stringify(`${root}src/wav.ts`)};
            import { storeCapturedRecording, getRecording } from ${JSON.stringify(`${root}src/custom-sample-store.ts`)};
            import { sampleDigest } from ${JSON.stringify(`${root}src/custom-sample-schema.ts`)};
            import { configureSampleApi } from ${JSON.stringify(`${root}src/custom-samples.ts`)};
            import { loadVocalSample, vocalSourceKey } from ${JSON.stringify(`${root}src/vocal-samples.ts`)};
            import { VocalInstrument } from ${JSON.stringify(`${root}src/vocal-audio.ts`)};
            import { createVocal } from ${JSON.stringify(`${root}src/vocal-model.ts`)};
            const sine = (rate, amplitude) => Float32Array.from({length:rate/2},(_,i)=>Math.sin(2*Math.PI*220*i/rate)*amplitude);
            const metrics = data => {
              let peak=0, sum=0, finite=true;
              for(const value of data) {finite=finite&&Number.isFinite(value);peak=Math.max(peak,Math.abs(value));sum+=value*value;}
              return {peak,rms:Math.sqrt(sum/data.length),finite};
            };
            export async function run(mode) {
              if(mode==='capture') {
                const original=sine(48000,.01), snapshot=original.slice();
                original[0]=NaN;original[1]=Infinity;original[2]=-Infinity;
                const captured=readImportedWav(await (await resampleRecording(original,48000)).arrayBuffer());
                const imported=readImportedWav(await (await normalizeImportedWav(encodeWav([snapshot,sine(48000,.005)],48000))).arrayBuffer());
                const silent=readImportedWav(await (await resampleRecording(new Float32Array(12000),24000)).arrayBuffer());
                const tiny=readImportedWav(await (await resampleRecording(sine(24000,.00001),24000)).arrayBuffer());
                return {captured:metrics(captured.samples),imported:metrics(imported.samples),silent:metrics(silent.samples),tiny:metrics(tiny.samples),rate:captured.sampleRate,length:captured.samples.length,inputUnchanged:Number.isNaN(original[0])&&original[1]===Infinity&&original[3]===snapshot[3]};
              }
              const original=encodeWav([sine(24000,.01)],24000);
              const local=await storeCapturedRecording(original,'Quiet legacy source');
              const originalHash=await sampleDigest(await original.arrayBuffer());
              if(mode==='gain') {
                const render=async(gain,automated)=>{
                  const context=new OfflineAudioContext(1,60000,24000);
                  const loaded=await loadVocalSample(context,0,undefined,local);
                  const track=createVocal();track.muted=false;track.loop=true;track.attack=0;track.release=0;track.drive=0;track.space=0;track.volume=.1;track.gain=gain;
                  track.notes=[{start:0,length:16,note:60,accent:false}];
                  if(automated)track.automation.gain=Array.from({length:16},(_,i)=>i<8?.5:.625);
                  const instrument=new VocalInstrument(context,context.destination,loaded);
                  for(let step=0;step<16;step++)instrument.scheduleTick(track,step*6,step*.125,120,0);
                  instrument.finish(track,15,2);
                  const data=(await context.startRendering()).getChannelData(0);
                  return {early:metrics(data.slice(2400,9600)).rms,late:metrics(data.slice(26400,33600)).rms,tail:metrics(data.slice(52800)).peak,...metrics(data)};
                };
                const base=await render(.5,false), boosted=await render(.625,false), automated=await render(.5,true);
                const stored=await getRecording(local.id);
                return {base,boosted,automated,sourceUnchanged:stored!==null&&await sampleDigest(await stored.blob.arrayBuffer())===originalHash};
              }
              const reference=JSON.stringify(local), key=vocalSourceKey(0,local);
              const render=async sample=>{
                const context=new OfflineAudioContext(1,12000,24000);
                const loaded=await loadVocalSample(context,0,undefined,sample);
                const cached=await loadVocalSample(context,0,undefined,sample);
                const source=context.createBufferSource();source.buffer=loaded.buffer;source.connect(context.destination);source.start();
                const output=await context.startRendering();
                return {...metrics(output.getChannelData(0)),cached:cached===loaded};
              };
              const localOutput=await render(local), repeated=await render(local);
              configureSampleApi(location.origin);
              const shared={...local,kind:'shared',id:'b'.repeat(32),readToken:'r'.repeat(43)};
              const sharedOutput=await render(shared);
              const silent=await storeCapturedRecording(encodeWav([new Float32Array(12000)],24000),'Silent source');
              const silentOutput=await render(silent);
              const stored=await getRecording(local.id);
              if(!stored)throw new Error('Recording source disappeared');
              const context=new OfflineAudioContext(1,1,24000);
              const builtin=await loadVocalSample(context,0);
              const raw=await context.decodeAudioData(await (await fetch(builtin.sample.url)).arrayBuffer());
              let difference=0;
              for(let i=0;i<raw.length;i++)difference=Math.max(difference,Math.abs(raw.getChannelData(0)[i]-builtin.buffer.getChannelData(0)[i]));
              return {local:localOutput,shared:sharedOutput,repeated,silent:silentOutput,storedPeak:metrics(readImportedWav(await stored.blob.arrayBuffer()).samples).peak,hashUnchanged:await sampleDigest(await stored.blob.arrayBuffer())===originalHash,referenceUnchanged:JSON.stringify(local)===reference,identityUnchanged:vocalSourceKey(0,local)===key,builtinDifference:difference};
            }
          `;
        },
      },
    ],
    build: {
      lib: {
        entry,
        formats: ["es"],
        fileName: () => "recording-normalization-probe.js",
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result)
    ? result
    : "output" in result
      ? [result]
      : [];
  const chunk = outputs
    .flatMap((output) => output.output)
    .find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk")
    throw new Error("Recording normalization probe did not build.");
  return chunk.code;
}

const metricsSchema = z.object({
  peak: z.number().finite(),
  rms: z.number().finite(),
  finite: z.literal(true),
});

test("vocal gain and its automation produce a settled six-decibel change without modifying the source", async ({
  page,
}) => {
  const renderSchema = metricsSchema.extend({
    early: z.number().positive(),
    late: z.number().positive(),
    tail: z.number().nonnegative(),
  });
  const result = z
    .object({
      base: renderSchema,
      boosted: renderSchema,
      automated: renderSchema,
      sourceUnchanged: z.boolean(),
    })
    .parse(
      await page.evaluate(async () => {
        const module = await import(
          /* @vite-ignore */ "/recording-normalization-probe.js"
        );
        return module.run("gain");
      }),
    );
  expect(result.boosted.early / result.base.early).toBeCloseTo(
    10 ** (6 / 20),
    3,
  );
  expect(result.automated.early / result.base.early).toBeCloseTo(1, 3);
  expect(result.automated.late / result.base.late).toBeCloseTo(
    10 ** (6 / 20),
    3,
  );
  for (const output of [result.base, result.boosted, result.automated]) {
    expect(output.peak).toBeLessThan(1);
    expect(output.tail).toBeLessThan(0.000001);
  }
  expect(result.sourceUnchanged).toBe(true);
});
test.beforeEach(async ({ page }) => {
  moduleCode ??= normalizationModule();
  await page.route("**/recording-normalization-probe.js", async (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: await moduleCode,
    }),
  );
  await page.goto("/");
});

test("capture and import normalize quiet PCM after resampling without amplifying silence", async ({
  page,
}) => {
  const result = z
    .object({
      captured: metricsSchema,
      imported: metricsSchema,
      silent: metricsSchema,
      tiny: metricsSchema,
      rate: z.number(),
      length: z.number(),
      inputUnchanged: z.boolean(),
    })
    .parse(
      await page.evaluate(async () => {
        const module = await import(
          /* @vite-ignore */ "/recording-normalization-probe.js"
        );
        return module.run("capture");
      }),
    );
  for (const output of [result.captured, result.imported]) {
    expect(output.peak).toBeCloseTo(0.8, 3);
    expect(output.rms).toBeGreaterThan(0.55);
  }
  expect(result.silent.peak).toBe(0);
  expect(result.tiny.peak).toBe(0);
  expect(result.rate).toBe(24000);
  expect(result.length).toBe(12000);
  expect(result.inputUnchanged).toBe(true);
});

test("legacy local and shared playback boost quiet audio while source hashes and built-in PCM stay unchanged", async ({
  page,
}) => {
  const samples = Float32Array.from(
    { length: 12000 },
    (_, index) => Math.sin((2 * Math.PI * 220 * index) / 24000) * 0.01,
  );
  await page.route("**/samples/**", async (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: Buffer.from(await encodeWav([samples], 24000).arrayBuffer()),
    }),
  );
  const result = z
    .object({
      local: metricsSchema.extend({ cached: z.literal(true) }),
      shared: metricsSchema.extend({ cached: z.literal(true) }),
      repeated: metricsSchema,
      silent: metricsSchema,
      storedPeak: z.number(),
      hashUnchanged: z.boolean(),
      referenceUnchanged: z.boolean(),
      identityUnchanged: z.boolean(),
      builtinDifference: z.number(),
    })
    .parse(
      await page.evaluate(async () => {
        const module = await import(
          /* @vite-ignore */ "/recording-normalization-probe.js"
        );
        return module.run("playback");
      }),
    );
  for (const output of [result.local, result.shared, result.repeated]) {
    expect(output.peak).toBeCloseTo(0.8, 5);
    expect(output.rms).toBeGreaterThan(0.55);
  }
  expect(result.silent.peak).toBe(0);
  expect(result.storedPeak).toBeCloseTo(0.01, 4);
  expect(result.hashUnchanged).toBe(true);
  expect(result.referenceUnchanged).toBe(true);
  expect(result.identityUnchanged).toBe(true);
  expect(result.builtinDifference).toBeLessThan(0.000001);
});
