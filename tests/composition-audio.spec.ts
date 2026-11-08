import { test, expect } from "@playwright/test";
import { build } from "vite";
import { z } from "zod";

let moduleCode: Promise<string> | undefined;
async function compositionModule(): Promise<string> {
  const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
  const entry = `${root}composition-probe.js`;
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
          import { AudioEngine, projectEventsAtTick } from ${JSON.stringify(`${root}src/audio.ts`)};
          import { createProject, resizeBassAutomation, projectSchema } from ${JSON.stringify(`${root}src/model.ts`)};
          import { PadInstrument } from ${JSON.stringify(`${root}src/pad-audio.ts`)};
          import { createArpPanel } from ${JSON.stringify(`${root}src/arp-panel.ts`)};
          import { createPadPanel } from ${JSON.stringify(`${root}src/pad-panel.ts`)};
          import { resizeArpTrack, arpEventsAtTick } from ${JSON.stringify(`${root}src/arp-model.ts`)};
          import { NoteMatrix } from ${JSON.stringify(`${root}src/note-matrix.ts`)};
          import { VocalInstrument } from ${JSON.stringify(`${root}src/vocal-audio.ts`)};
          import { createVocal } from ${JSON.stringify(`${root}src/vocal-model.ts`)};
          import { createProgression, progressionChordAtTick, progressionChordNotes } from ${JSON.stringify(`${root}src/progression-model.ts`)};
          import { encodeTrack, decodeTrack } from ${JSON.stringify(`${root}src/share.ts`)};
          import { ticksPerStep, tickSeconds, automationStepCount } from ${JSON.stringify(`${root}src/timing.ts`)};
          const rms = (values, start, end, rate) => {
            let sum = 0, count = 0;
            for (let i = Math.floor(start * rate); i < Math.min(values.length, Math.floor(end * rate)); i++) { sum += values[i] ** 2; count++; }
            return Math.sqrt(sum / Math.max(1, count));
          };
          export async function run(mode) {
            if(mode === 'pad-context') {
              const project=createProject();project.progression.timing={bars:2,meter:'7/8',grid:'straight'};
              project.pad.timing.grid='triplet';project.pad.followChords=true;
              let context=[];
              const update=NoteMatrix.prototype.update;
              NoteMatrix.prototype.update=function(steps,scale,muted){context=steps.map(step=>({...step}));return update.call(this,steps,scale,muted);};
              const container=document.createElement('div');document.body.append(container);
              const panel=createPadPanel(container,{getTrack:()=>project.pad,getScale:()=>project.scale,getProgression:()=>project.progression,onChange:()=>{},onProgressionEdit:()=>{},renderControl:()=>''});
              panel.setPosition(-1,.5);
              const result={context:context[11]?.note,audio:progressionChordNotes(project.progression,project.scale,progressionChordAtTick(project.progression,44,.5))[0]};
              panel.destroy();NoteMatrix.prototype.update=update;container.remove();return result;
            }
            if(mode === 'arp-context') {
              const project=createProject();project.swing=.5;project.progression.timing={bars:2,meter:'7/8',grid:'straight'};
              project.arp=resizeArpTrack(project.arp,{bars:1,meter:'4/4',grid:'triplet'});project.arp.followChords=true;project.arp.muted=false;project.arp.rate='1/16';project.arp.steps.fill(true);
              let context=[];
              const update=NoteMatrix.prototype.update;
              NoteMatrix.prototype.update=function(steps,scale,muted){context=steps.map(step=>({...step}));return update.call(this,steps,scale,muted);};
              const container=document.createElement('div');document.body.append(container);
              const panel=createArpPanel(container,{getTrack:()=>project.arp,getScale:()=>project.scale,getProgression:()=>project.progression,onChange:()=>{},onProgressionEdit:()=>{},renderControl:()=>''});
              panel.setPosition(42,.5);
              const result={context:context[11]?.note,audio:arpEventsAtTick(project.arp,project.scale,42,project.progression,42,.5)[0]?.note};
              panel.destroy();NoteMatrix.prototype.update=update;container.remove();return result;
            }
            if (mode === 'automation') {
              const project = createProject();
              for (const track of [...project.drums, project.keys, project.arp, project.pad, project.vocal, project.cloud, project.tension]) track.muted = true;
              project.bpm = 120; project.swing = 0;
              project.bass = resizeBassAutomation(project.bass, 8);
              project.bass.steps = project.bass.steps.map((step, index) => ({ ...step, on: index === 0, note: 33, slide: false }));
              project.bass.automation.volume = Array.from({length:128}, (_, index) => index < 32 ? 0 : .65);
              const engine = new AudioEngine(() => {});
              const wav = await engine.exportWav(project);
              const context = new OfflineAudioContext(2, 1, 44100);
              const buffer = await context.decodeAudioData(await wav.arrayBuffer());
              const data = buffer.getChannelData(0);
              return { early: rms(data, 0, 3.9, buffer.sampleRate), late: rms(data, 4, 4.4, buffer.sampleRate), final: rms(data, 14, 14.4, buffer.sampleRate), duration:buffer.duration, peak:Math.max(...Array.from({length: 2000},(_,i)=>Math.abs(data[Math.floor(i * data.length / 2000)]))) };
            }
            if (mode === 'pad' || mode === 'pad-reverse') {
              const project = createProject(); project.swing = .5; project.bpm = 120;
              project.progression.timing = {bars:2,meter:'7/8',grid:mode === 'pad' ? 'triplet' : 'straight'};
              if(mode === 'pad-reverse')project.pad.timing.grid='triplet';
              project.pad.muted = false; project.pad.attack = 0; project.pad.release = 0; project.pad.space = 0;
              const render = async (follow, sameGrid = false) => {
                const context = new OfflineAudioContext(2, 44100 * 5, 44100);
                const starts = [];
                const createOscillator = context.createOscillator.bind(context);
                context.createOscillator = () => {const node=createOscillator();const start=node.start.bind(node);node.start=time=>{starts.push(time);start(time);};return node;};
                const instrument = new PadInstrument(context, context.destination);
                const track = follow ? {...project.pad, timing:sameGrid?project.progression.timing:project.pad.timing} : {...project.pad, followChords:false, timing:project.progression.timing, chords:project.progression.chords};
                const state = {...project,pad:track};
                for (let tick=0;tick<168;tick++) for (const event of projectEventsAtTick(state,tick).filter(event=>event.instrument==='pad'))
                  instrument.scheduleTick(track, project.scale, tick, tickSeconds(event.audibleTick,120),120,.5,project.progression,event.audibleTick);
                return {data:(await context.startRendering()).getChannelData(0),starts:[...new Set(starts)]};
              };
              const differentGrid = await render(true), followed = await render(true,true), local = await render(false);
              let difference = 0;
              for(let i=0;i<followed.data.length;i++) difference = Math.max(difference, Math.abs(followed.data[i]-local.data[i]));
              return { difference, starts:differentGrid.starts, sustained:rms(differentGrid.data,.3,3.4,44100), tail:rms(differentGrid.data,4.5,5,44100) };
            }
            if (mode === 'vocal') {
              const context = new OfflineAudioContext(2, 44100 * 5, 44100);
              const source = context.createBuffer(1,44100,44100);
              for(let i=0;i<source.length;i++) source.getChannelData(0)[i]=Math.sin(2*Math.PI*261.625565*i/44100)*.2;
              const loaded = {buffer:source,sample:{rootNote:60,rms:.14}};
              const track = createVocal(); track.muted=false; track.loop=true; track.followChords=true; track.space=0; track.release=0;
              track.notes=[{start:0,length:16,note:60,accent:false}];
              const progression=createProgression(); progression.timing.bars=2;
              const rateEvents=[];
              const createSource=context.createBufferSource.bind(context);
              context.createBufferSource=()=>{const node=createSource(); const target=node.playbackRate.setTargetAtTime.bind(node.playbackRate); node.playbackRate.setTargetAtTime=(value,time,constant)=>{rateEvents.push({value,time});return target(value,time,constant);};return node;};
              const instrument=new VocalInstrument(context,context.destination,loaded);
              for(let tick=0;tick<192;tick+=6) instrument.scheduleTick(track,tick,tickSeconds(tick,120),120,0,{root:9,mode:'minor'},progression);
              instrument.finish(track,31,4);
              const rendered=await context.startRendering();
              return {rates:rateEvents.filter(event=>event.time<2).map(event=>event.value), next:rateEvents.filter(event=>event.time>=2).map(event=>event.value), rms:rms(rendered.getChannelData(0),.1,3.9,44100)};
            }
            const project=createProject(), timing={bars:16,meter:'5/4',grid:'triplet'};
            let seed=918273;
            for(const track of [...project.drums,project.bass,project.keys,project.arp,project.pad,project.vocal,project.cloud,project.tension]) {
              track.automationBars=16;track.timing={...timing,bars:track===project.pad||track===project.vocal||track===project.cloud||track===project.tension?16:8};
              if('steps' in track)track.steps=Array.from({length:track===project.cloud||track===project.tension?480:240},(_,i)=>structuredClone(track.steps[i%track.steps.length]));
              if('accents' in track)track.accents=Array.from({length:240},(_,i)=>i%4===0);
              for(const key of Object.keys(track.automation))track.automation[key]=Array.from({length:automationStepCount(track)},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967295;});
            }
            project.vocal.notes=Array.from({length:480},(_,start)=>({start,length:1,note:60,accent:start%2===0}));
            const expected=projectSchema.parse(project);
            const encoded=await encodeTrack(expected),decoded=await decodeTrack(encoded);
            history.replaceState(null,'','#track='+encoded);
            const fragment=location.hash.slice(7), roundTrip=await decodeTrack(fragment);
            return {length:encoded.length, bytes:new TextEncoder().encode(JSON.stringify(project)).length, equal:JSON.stringify(decoded)===JSON.stringify(expected), fragmentEqual:JSON.stringify(roundTrip)===JSON.stringify(expected)};
          }
        `;
        },
      },
    ],
    build: {
      lib: { entry, formats: ["es"], fileName: () => "composition-probe.js" },
      write: false,
    },
  });
  const outputs = Array.isArray(result)
    ? result
    : "output" in result
      ? [result]
      : [];
  const entryChunk = outputs
    .flatMap((output) => output.output)
    .find((output) => output.type === "chunk" && output.isEntry);
  if (!entryChunk || entryChunk.type !== "chunk")
    throw new Error("Composition probe did not build.");
  return entryChunk.code;
}

test.beforeEach(async ({ page }) => {
  moduleCode ??= compositionModule();
  const code = await moduleCode;
  await page.route("**/composition-probe.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: code }),
  );
  await page.route("**/composition-audio-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Composition audio test</title>",
    }),
  );
  await page.goto("/composition-audio-probe");
});

async function probe(
  page: import("@playwright/test").Page,
  mode: string,
): Promise<unknown> {
  return page.evaluate(async (mode) => {
    const path = "/composition-probe.js";
    const module = await import(path);
    return module.run(mode);
  }, mode);
}

test("a one-bar bass pattern renders eight bars of independent automation", async ({
  page,
}) => {
  const result = z
    .object({
      early: z.number(),
      late: z.number(),
      final: z.number(),
      duration: z.number(),
      peak: z.number(),
    })
    .parse(await probe(page, "automation"));
  expect(result.early).toBeLessThan(0.00005);
  expect(result.late).toBeGreaterThan(0.003);
  expect(result.final).toBeGreaterThan(0.003);
  expect(result.duration).toBeGreaterThan(16);
  expect(result.peak).toBeLessThan(1);
});

test("shared triplet chords preserve the local pad waveform with a different instrument grid", async ({
  page,
}) => {
  const result = z
    .object({
      difference: z.number(),
      starts: z.array(z.number()),
      sustained: z.number(),
      tail: z.number(),
    })
    .parse(await probe(page, "pad"));
  expect(result.difference).toBeLessThan(0.00001);
  expect(result.starts).toEqual([0, 0.875, 1.75, 2.625]);
  expect(result.sustained).toBeGreaterThan(0.001);
  expect(result.tail).toBeLessThan(0.00001);
});

test("Vocal follows at onset and holds its pitch through a chord change", async ({
  page,
}) => {
  const result = z
    .object({
      rates: z.array(z.number()),
      next: z.array(z.number()),
      rms: z.number(),
    })
    .parse(await probe(page, "vocal"));
  expect(result.rates.length).toBeGreaterThan(1);
  expect(new Set(result.rates).size).toBe(1);
  expect(new Set(result.next).size).toBe(1);
  expect(result.next[0]).not.toBe(result.rates[0]);
  expect(result.rms).toBeGreaterThan(0.001);
});

test("a maximum independent-automation share survives the browser URL fragment", async ({
  page,
}) => {
  const result = z
    .object({
      length: z.number(),
      bytes: z.number(),
      equal: z.boolean(),
      fragmentEqual: z.boolean(),
    })
    .parse(await probe(page, "share"));
  expect(result.length).toBeGreaterThan(500000);
  expect(result.length).toBeLessThan(600000);
  expect(result.bytes).toBeLessThan(1024 * 1024);
  expect(result.equal).toBe(true);
  expect(result.fragmentEqual).toBe(true);
});

test("swung shared chords never run before an earlier triplet automation event", async ({
  page,
}) => {
  const result = z
    .object({ starts: z.array(z.number()), sustained: z.number() })
    .parse(await probe(page, "pad-reverse"));
  expect(result.starts).toEqual([0, 0.9375, 1.75, 2.6875]);
  expect(result.sustained).toBeGreaterThan(0.001);
});

test("Arp automation context selects the chord active at the swung audible onset", async ({
  page,
}) => {
  const result = z
    .object({ context: z.number(), audio: z.number() })
    .parse(await probe(page, "arp-context"));
  expect(result.audio).toBe(67);
  expect(result.context).toBe(result.audio);
});

test("Pad automation context refreshes stopped swing and follows the audible shared chord", async ({
  page,
}) => {
  const result = z
    .object({ context: z.number(), audio: z.number() })
    .parse(await probe(page, "pad-context"));
  expect(result.audio).toBe(57);
  expect(result.context).toBe(result.audio);
});
