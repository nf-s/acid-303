import {
  createIcons,
  AudioLines,
  Play,
  Square,
  RotateCcw,
  Download,
  Waves,
  Maximize2,
  Minimize2,
  Pause,
  Shuffle,
} from "lucide";
import {
  createProject,
  DRUM_META,
  drumIdSchema,
  noteName,
  readProject,
  KEYS_SOUNDS,
  remixProject,
} from "./model";
import type { BassStep, DrumId } from "./model";
import { AudioEngine } from "./audio";
import { FluidVisualizer } from "./visualizer";
import { BeatCanvas } from "./beat-canvas";
import { installGestures } from "./gestures";
import type { NoteAction } from "./gestures";
import "./style.css";

const storageKey = "acid-303-project-v1";
let project = createProject();
let storageAvailable = true;
try {
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    const parsed = readProject(JSON.parse(stored));
    if (parsed) project = parsed;
  }
} catch {
  storageAvailable = false;
}
let selectedDrum: DrumId = "kick";
let beforeRemix: ReturnType<typeof createProject> | null = null;
let starting = false;
let pendingDrum: DrumId | null = null;
let lastPaintPreview = 0;
let motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const icon = (name: string) =>
  `<i data-lucide="${name}" aria-hidden="true"></i>`;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application container is missing.");
app.innerHTML = `
    <section id="visualizer-panel" class="visualizer-panel" aria-label="Prismatic audio visualizer"><canvas id="fluid-canvas" aria-label="Audio-reactive prismatic distortion"></canvas></section>
  <header class="app-header"><a class="brand" href="/" aria-label="ACID 303 home"><span class="brand-icon">${icon("audio-lines")}</span><span>ACID<span class="brand-number">303</span></span><span class="brand-divider"></span><span class="brand-detail">BEAT MACHINE</span></a><div class="header-actions"><span id="save-state" class="save-state"><span class="status-dot"></span>${storageAvailable ? "Saved in this browser" : "Browser storage unavailable"}</span><button class="button secondary" id="export">${icon("download")}<span>Export WAV</span></button></div></header>
  <main class="workspace">
    <section class="transport panel" aria-label="Playback controls">
      <div class="playback"><button class="play-button" id="play" aria-label="Play pattern">${icon("play")}<span>Play</span></button><button class="icon-button restart" id="restart" aria-label="Restart pattern" title="Restart pattern">${icon("rotate-ccw")}</button></div>
      ${slider("bpm", "Tempo", 60, 180, project.bpm, `${project.bpm}`, "1")}
      ${slider("swing", "Swing", 0, 50, project.swing * 100, `${Math.round(project.swing * 100)}%`)}
      ${slider("drive", "Crunch", 0, 100, project.drive * 100, `${Math.round(project.drive * 100)}%`)}
      ${slider("volume", "Volume", 0, 100, project.volume * 100, `${Math.round(project.volume * 100)}%`)}
      <div class="position"><span id="position">01</span><span>/ 16</span><span class="beat-lights"><b></b><b></b><b></b><b></b></span></div>
    </section>
    <div class="studio-grid"><div class="sequencers">
      <section class="panel drums-panel" aria-labelledby="drums-title">
        <div class="section-header"><div class="section-title"><span class="section-number">01</span><h1 id="drums-title">Drum sequencer</h1><span class="small-tag">16 STEPS</span></div><button id="reset" class="text-button" title="Restore the selected preset">${icon("rotate-ccw")} Reset</button></div>
        <div class="preset-bar"><div class="preset-options"><button data-preset="0">Acid funk</button><button data-preset="1">After hours</button><button data-preset="2">Broken circuit</button></div><button id="remix" class="remix-button">${icon("shuffle")} Remix</button><button id="undo-remix" class="text-button undo-remix" disabled>Undo</button></div>
        <div class="instrument-tabs" role="group" aria-label="Drum instrument">${project.drums.map((track) => `<button data-drum="${track.id}" aria-label="Select and preview ${DRUM_META[track.id].name}" aria-pressed="${track.id === selectedDrum}">${DRUM_META[track.id].name}</button>`).join("")}</div><div id="instrument-controls" class="instrument-controls"></div>
        <div class="beat-surface"><canvas id="beat-canvas" aria-label="Paint drum beats" aria-describedby="paint-help"></canvas><div id="drum-grid" class="beat-keyboard" role="grid" aria-label="Drum steps"></div></div>
        <div class="section-footer"><span><span class="legend-pad"></span><span id="paint-help">Drag to paint · Drag a filled step to erase</span></span><span>Drag controls up / down</span></div>
      </section>
      <section class="panel bass-panel" aria-labelledby="bass-title">
        <div class="section-header"><div class="section-title"><span class="section-number">02</span><h2 id="bass-title">Acid bass</h2><span class="small-tag">303</span></div><div class="bass-actions"><button id="bass-mute" class="mute-button" aria-label="Mute acid bass" aria-pressed="${project.bass.muted}">M</button><button id="generate" class="text-button">${icon("shuffle")} Generate</button></div></div>
        <div class="bass-meta"><div class="waveform-switch" role="group" aria-label="Bass waveform"><button data-waveform="sawtooth">${icon("audio-lines")} Saw</button><button data-waveform="square">${icon("waves")} Square</button></div><span class="bass-key">A MINOR <span>·</span> 1 BAR</span></div>
        <div class="acid-controls">${slider("cutoff", "Cutoff", 0, 100, Math.round((Math.log(project.bass.cutoff / 80) / Math.log(100)) * 100), formatFrequency(project.bass.cutoff))}${slider("resonance", "Resonance", 0, 22, project.bass.resonance, `${Math.round((project.bass.resonance / 22) * 100)}%`, "0.1")}${slider("envelope", "Envelope", 0, 100, project.bass.envelope * 100, `${Math.round(project.bass.envelope * 100)}%`)}${slider("bass-decay", "Decay", 50, 1500, project.bass.decay * 1000, `${Math.round(project.bass.decay * 1000)} ms`, "10")}${slider("bass-volume", "Level", 0, 100, project.bass.volume * 100, `${Math.round(project.bass.volume * 100)}%`)}</div><div class="sequence-scroll"><div class="bass-grid" id="bass-grid"></div></div>
        <div class="section-footer note-help" id="bass-note-help"><span>↕ Pitch · Tap to play · Hold for accent</span><span>← Separate · Join next →</span></div>
      </section>
      <section class="panel bass-panel keys-panel" aria-labelledby="keys-title">
        <div class="section-header"><div class="section-title"><span class="section-number">03</span><h2 id="keys-title">Keys</h2></div><div class="bass-actions"><button id="keys-mute" class="mute-button" aria-label="Mute Keys" aria-pressed="${project.keys.muted}">M</button><button id="keys-generate" class="text-button">${icon("shuffle")} New melody</button></div></div>
        <div class="bass-meta"><div class="waveform-switch keys-sounds" role="group" aria-label="Keys sound">${KEYS_SOUNDS.map((sound, index) => `<button data-key-sound="${index}">${sound}</button>`).join("")}</div><span class="bass-key keys-key">A MINOR</span></div>
        <div class="acid-controls">${slider("keys-tone", "Tone", 0, 100, project.keys.tone * 100, `${Math.round(project.keys.tone * 100)}%`)}${slider("keys-decay", "Decay", 80, 2000, project.keys.decay * 1000, `${Math.round(project.keys.decay * 1000)} ms`, "10")}${slider("keys-space", "Space", 0, 100, project.keys.space * 100, `${Math.round(project.keys.space * 100)}%`)}${slider("keys-volume", "Level", 0, 100, project.keys.volume * 100, `${Math.round(project.keys.volume * 100)}%`)}</div>
        <div class="sequence-scroll"><div class="bass-grid" id="keys-grid"></div></div>
        <div class="section-footer note-help" id="keys-note-help"><span>↕ Pitch · Tap to play · Hold for accent</span><span>← Separate · Join next →</span></div>
      </section>
    </div>
</div>
<div class="visualizer-toolbar"><div class="visualizer-top"><span class="visualizer-label">${icon("waves")} VISUALIZER</span><span class="audio-status" id="audio-status">AUDIO IDLE</span></div><div class="visualizer-bottom"><span class="visualizer-mode"><span class="visualizer-dot"></span>PRISM</span><div class="visualizer-controls">${slider("intensity", "Intensity", 0, 100, 65, "65%")}<button id="motion" class="visualizer-button" aria-label="${motion ? "Pause" : "Enable"} visualizer motion" aria-pressed="${motion}">${icon(motion ? "pause" : "play")}</button><button id="fullscreen" class="visualizer-button" aria-label="Fullscreen visualizer">${icon("maximize-2")}</button></div></div></div>
    <footer class="app-footer"><span><kbd>SPACE</kbd> Play / stop</span><span>16 STEPS <span>·</span> 4/4</span><span id="project-name"></span></footer>
  </main><div id="toast" role="status" class="toast" hidden></div>`;

function slider(
  id: string,
  label: string,
  min: number,
  max: number,
  value: number,
  display: string,
  step = "1",
  ariaLabel = "",
): string {
  const name =
    ariaLabel ||
    (id === "bpm"
      ? "Tempo in BPM"
      : ["swing", "drive", "volume", "intensity"].includes(id)
        ? id === "drive"
          ? "Crunch distortion"
          : id === "volume"
            ? "Master volume"
            : id === "intensity"
              ? "Visualizer intensity"
              : "Swing"
        : `${id.startsWith("keys-") ? "Keys" : "Bass"} ${label.toLowerCase()}`);
  return `<div class="dial-control"><span class="dial-label">${label}</span><div class="gesture-control" id="${id}" role="slider" tabindex="0" title="Drag up/down · Shift for fine control · Double-tap to reset" aria-label="${name}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-valuetext="${display}" aria-orientation="vertical" data-step="${step}" data-reset="${value}" style="--knob-angle:${-135 + ((value - min) / (max - min)) * 270}deg"><span class="knob-face" aria-hidden="true"><span></span></span><output id="${id}-value">${display}</output></div></div>`;
}
function formatFrequency(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toFixed(1)} kHz`
    : `${Math.round(value)} Hz`;
}
function refreshIcons(): void {
  createIcons({
    icons: {
      AudioLines,
      Play,
      Square,
      RotateCcw,
      Download,
      Waves,
      Maximize2,
      Minimize2,
      Pause,
      Shuffle,
    },
    attrs: { "stroke-width": 1.7 },
  });
}
function renderInstrumentControls(): void {
  const track = project.drums.find((item) => item.id === selectedDrum);
  const controls = document.querySelector("#instrument-controls");
  if (!track || !controls) return;
  controls.innerHTML = `<div class="sound-buttons" role="group" aria-label="${DRUM_META[track.id].name} sounds">${DRUM_META[track.id].sounds.map((sound, index) => `<button data-sound="${index}" data-sound-track="${track.id}" aria-pressed="${track.sound === index}">${sound}</button>`).join("")}</div><div class="instrument-dials">${slider(`${track.id}-pitch`, "Pitch", -24, 24, track.pitch, `${track.pitch > 0 ? "+" : ""}${track.pitch} st`, "1", `${DRUM_META[track.id].name} pitch`)}${slider(`${track.id}-decay`, "Decay", 30, 1500, track.decay * 1000, `${Math.round(track.decay * 1000)} ms`, "10", `${DRUM_META[track.id].name} decay`)}${slider(`${track.id}-volume`, "Level", 0, 100, track.volume * 100, `${Math.round(track.volume * 100)}%`, "1", `${DRUM_META[track.id].name} level`)}<button class="mute-button" data-mute="${track.id}" aria-label="Mute ${DRUM_META[track.id].name}" aria-pressed="${track.muted}">M</button></div>`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-drum]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.drum === selectedDrum),
      ),
    );
  refreshIcons();
}
function renderDrums(): void {
  const grid = document.querySelector("#drum-grid");
  if (!grid) return;
  grid.innerHTML = project.drums
    .map((track, trackIndex) =>
      track.steps
        .map(
          (on, step) =>
            `<button class="step-pad ${on ? "on" : ""}" role="gridcell" tabindex="${trackIndex === 0 && step === 0 ? 0 : -1}" data-drum-step="${track.id}" data-step="${step}" data-grid-index="${trackIndex * 16 + step}" aria-label="${DRUM_META[track.id].name} step ${step + 1}" aria-pressed="${on}">${on ? "On" : "Off"}</button>`,
        )
        .join(""),
    )
    .join("");
  renderInstrumentControls();
  beatCanvas.update(project);
  beatCanvas.setSelectedDrum(selectedDrum);
}
type NoteTrack = "bass" | "keys";
function notePad(track: NoteTrack, step: BassStep, index: number): string {
  const id = track === "bass" ? `note-${index}` : `keys-note-${index}`;
  const label = track === "bass" ? "Bass" : "Keys";
  return `<div class="bass-step ${index % 4 === 0 ? "group-start" : ""}" data-${track}-index="${index}"><div class="note-cell gesture-control ${step.on ? "on" : ""} ${step.accent ? "accented" : ""} ${step.slide && step.on ? "joined" : ""}" id="${id}" data-note-pad="${track}" data-note-index="${index}" data-accent="${step.accent}" data-slide="${step.slide}" role="slider" tabindex="0" aria-label="${label} note step ${index + 1}" aria-describedby="${track}-note-help" aria-description="${noteDescription(step)}" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight A Enter Space" aria-valuemin="${track === "bass" ? 24 : 48}" aria-valuemax="${track === "bass" ? 60 : 84}" aria-valuenow="${step.note}" aria-valuetext="${noteName(step.note)}" aria-orientation="vertical" data-step="1"><span class="note-index">${String(index + 1).padStart(2, "0")}</span><output id="${id}-value">${noteName(step.note)}</output><span class="note-expression" aria-hidden="true"><i class="accent-mark">◆</i><i class="slide-mark">${index === 15 ? "↩" : "↗"}</i></span><span class="hold-progress" aria-hidden="true"></span><span class="slide-link" aria-hidden="true"></span></div><button class="bass-toggle gate ${step.on ? "on" : ""}" ${track === "bass" ? `data-bass-toggle="on" data-step="${index}"` : `data-keys-gate="${index}"`} aria-label="${label} gate step ${index + 1}" aria-pressed="${step.on}"><span></span></button></div>`;
}
function noteDescription(step: BassStep): string {
  return `${step.on ? "Playing" : "Rest"}. Accent ${step.accent ? "on" : "off"}. Slide ${step.slide ? "on" : "off"}. Up/down: pitch. Right: join next. Left: separate. A: accent. Enter: gate.`;
}
function refreshNoteStates(track: NoteTrack): void {
  project[track].steps.forEach((step, index) => {
    const pad = document.getElementById(
      track === "bass" ? `note-${index}` : `keys-note-${index}`,
    );
    if (!pad) return;
    pad.classList.toggle("on", step.on);
    pad.classList.toggle("accented", step.accent);
    pad.classList.toggle(
      "joined",
      step.slide &&
        step.on &&
        Boolean(project[track].steps[(index + 1) % 16]?.on),
    );
    pad.dataset.accent = String(step.accent);
    pad.dataset.slide = String(step.slide);
    pad.setAttribute("aria-description", noteDescription(step));
    const gate = pad.parentElement?.querySelector(".gate");
    gate?.classList.toggle("on", step.on);
    gate?.setAttribute("aria-pressed", String(step.on));
  });
}
function performNoteAction(control: HTMLElement, action: NoteAction): void {
  const track = control.dataset.notePad;
  if (track !== "bass" && track !== "keys") return;
  const index = Number(control.dataset.noteIndex);
  const step = project[track].steps[index];
  if (!step) return;
  if (action === "gate") step.on = !step.on;
  if (action === "accent") step.accent = !step.accent;
  if (action === "join") {
    step.slide = true;
    step.on = true;
    const next = project[track].steps[(index + 1) % 16];
    if (next) next.on = true;
  }
  if (action === "separate") step.slide = false;
  refreshNoteStates(track);
  persist();
  if (step.on && !engine.isPlaying) void previewNote(track, step);
}
async function previewNote(track: NoteTrack, step: BassStep): Promise<void> {
  try {
    if (track === "bass")
      await engine.auditionBass(project.bass, step.note, step.accent);
    else await engine.auditionKeys(project.keys, step.note, step.accent);
    visualizer.setAnalyser(engine.getAnalyser());
  } catch {
    toast("Note preview could not start.");
  }
}
function renderBass(): void {
  const grid = document.querySelector("#bass-grid");
  if (!grid) return;
  grid.innerHTML = `<div class="bass-labels"><span>NOTE</span><span>GATE</span></div><div class="bass-steps">${project.bass.steps.map((step, index) => notePad("bass", step, index)).join("")}</div>`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-waveform]")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.waveform === project.bass.waveform,
      );
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.waveform === project.bass.waveform),
      );
    });
  document
    .querySelector("#bass-mute")
    ?.setAttribute("aria-pressed", String(project.bass.muted));
  grid.classList.toggle("muted", project.bass.muted);
  refreshNoteStates("bass");
}
function renderKeys(): void {
  const grid = document.querySelector("#keys-grid");
  if (!grid) return;
  grid.innerHTML = `<div class="bass-labels"><span>NOTE</span><span>GATE</span></div><div class="bass-steps">${project.keys.steps.map((step, index) => notePad("keys", step, index)).join("")}</div>`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-key-sound]")
    .forEach((button) => {
      const selected = Number(button.dataset.keySound) === project.keys.sound;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  document
    .querySelector("#keys-mute")
    ?.setAttribute("aria-pressed", String(project.keys.muted));
  grid.classList.toggle("muted", project.keys.muted);
  refreshNoteStates("keys");
}
async function previewKeys(note: number): Promise<void> {
  try {
    await engine.auditionKeys(project.keys, note);
    visualizer.setAnalyser(engine.getAnalyser());
  } catch {
    toast("Keys preview could not start.");
  }
}
function setOutput(id: string, value: string): void {
  const output = document.getElementById(`${id}-value`);
  if (output) output.textContent = value;
  document.getElementById(id)?.setAttribute("aria-valuetext", value);
}
function setInput(id: string, value: number): void {
  const input = document.getElementById(id);
  if (!input) return;
  input.setAttribute("aria-valuenow", String(value));
  const min = Number(input.getAttribute("aria-valuemin"));
  const max = Number(input.getAttribute("aria-valuemax"));
  input.style.setProperty(
    "--knob-angle",
    `${-135 + ((value - min) / (max - min)) * 270}deg`,
  );
}
function clearRemixUndo(): void {
  beforeRemix = null;
  const undo = document.querySelector("#undo-remix");
  if (undo instanceof HTMLButtonElement) undo.disabled = true;
}
function updatePresetLabels(): void {
  document
    .querySelectorAll<HTMLButtonElement>("[data-preset]")
    .forEach((button) =>
      button.classList.toggle("active", button.textContent === project.name),
    );
  const label = document.querySelector("#project-name");
  if (label) label.textContent = project.name;
}
function refreshProject(): void {
  renderDrums();
  renderBass();
  renderKeys();
  updatePresetLabels();
  const bassKey = document.querySelector(".bass-key");
  if (bassKey)
    bassKey.innerHTML = `${project.name === "Broken circuit" ? "C" : "A"} MINOR <span>·</span> 1 BAR`;
  const keysKey = document.querySelector(".keys-key");
  if (keysKey)
    keysKey.textContent = `${project.name === "Broken circuit" ? "C" : "A"} MINOR`;
  setInput("keys-tone", project.keys.tone * 100);
  setOutput("keys-tone", `${Math.round(project.keys.tone * 100)}%`);
  setInput("keys-decay", project.keys.decay * 1000);
  setOutput("keys-decay", `${Math.round(project.keys.decay * 1000)} ms`);
  setInput("keys-space", project.keys.space * 100);
  setOutput("keys-space", `${Math.round(project.keys.space * 100)}%`);
  setInput("keys-volume", project.keys.volume * 100);
  setOutput("keys-volume", `${Math.round(project.keys.volume * 100)}%`);
  setInput("bpm", project.bpm);
  setOutput("bpm", String(project.bpm));
  setInput("swing", project.swing * 100);
  setInput("drive", project.drive * 100);
  setInput("volume", project.volume * 100);
  setOutput("volume", `${Math.round(project.volume * 100)}%`);
  setOutput("swing", `${Math.round(project.swing * 100)}%`);
  setOutput("drive", `${Math.round(project.drive * 100)}%`);
  setInput(
    "cutoff",
    Math.round((Math.log(project.bass.cutoff / 80) / Math.log(100)) * 100),
  );
  setOutput("cutoff", formatFrequency(project.bass.cutoff));
  setInput("resonance", project.bass.resonance);
  setOutput("resonance", `${Math.round((project.bass.resonance / 22) * 100)}%`);
  setInput("envelope", project.bass.envelope * 100);
  setOutput("envelope", `${Math.round(project.bass.envelope * 100)}%`);
  setInput("bass-decay", project.bass.decay * 1000);
  setOutput("bass-decay", `${Math.round(project.bass.decay * 1000)} ms`);
  setInput("bass-volume", project.bass.volume * 100);
  setOutput("bass-volume", `${Math.round(project.bass.volume * 100)}%`);
}
const engine = new AudioEngine((step) => {
  beatCanvas.setStep(step);
  document
    .querySelectorAll(".current")
    .forEach((element) => element.classList.remove("current"));
  document
    .querySelectorAll(
      `[data-drum-step][data-step="${step}"], [data-bass-toggle][data-step="${step}"], [data-bass-index="${step}"], [data-keys-index="${step}"]`,
    )
    .forEach((element) => element.classList.add("current"));
  document
    .querySelectorAll(".beat-lights b")
    .forEach((element, index) =>
      element.classList.toggle("active", index === Math.floor(step / 4)),
    );
  const position = document.querySelector("#position");
  if (position) position.textContent = String(step + 1).padStart(2, "0");
});
const canvas = document.querySelector("#fluid-canvas");
if (!(canvas instanceof HTMLCanvasElement))
  throw new Error("Visualizer canvas is missing.");
const visualizer = new FluidVisualizer(canvas);
engine.update(project);
visualizer.setIntensity(0.65);
visualizer.setMotion(motion);

const paintCanvas = document.querySelector("#beat-canvas");
if (!(paintCanvas instanceof HTMLCanvasElement))
  throw new Error("Beat canvas is missing.");
const beatCanvas = new BeatCanvas(
  paintCanvas,
  (id, step, on) => {
    const track = project.drums.find((item) => item.id === id);
    if (!track) return;
    track.steps[step] = on;
    if (on && !engine.isPlaying && performance.now() - lastPaintPreview > 55) {
      lastPaintPreview = performance.now();
      void audition(id);
    }
    const cell = document.querySelector(
      `[data-drum-step="${id}"][data-step="${step}"]`,
    );
    cell?.setAttribute("aria-pressed", String(on));
    cell?.classList.toggle("on", on);
    if (cell) cell.textContent = on ? "On" : "Off";
    persist();
  },
  (id) => {
    if (document.querySelector(".gesture-control.dragging")) {
      pendingDrum = id;
      return;
    }
    if (selectedDrum !== id) {
      selectedDrum = id;
      renderInstrumentControls();
    }
  },
);
installGestures(
  app,
  (control, value) => updateControl(control.id, value),
  performNoteAction,
);
const applyPendingInstrument = () => {
  if (pendingDrum && !document.querySelector(".gesture-control.dragging")) {
    selectedDrum = pendingDrum;
    pendingDrum = null;
    renderInstrumentControls();
    beatCanvas.setSelectedDrum(selectedDrum);
  }
};
app.addEventListener("pointerup", applyPendingInstrument);
app.addEventListener("pointercancel", applyPendingInstrument);

function persist(): void {
  engine.update(project);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const status = document.querySelector("#save-state");
    try {
      localStorage.setItem(storageKey, JSON.stringify(project));
      if (status)
        status.innerHTML =
          '<span class="status-dot"></span>Saved in this browser';
    } catch {
      if (status) status.textContent = "Browser storage unavailable";
    }
  }, 250);
}
function toast(message: string): void {
  const element = document.querySelector("#toast");
  if (!(element instanceof HTMLElement)) return;
  element.textContent = message;
  element.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 4000);
}
function updatePlayback(): void {
  const play = document.querySelector("#play");
  if (play) {
    play.innerHTML = `${icon(engine.isPlaying ? "square" : "play")}<span>${engine.isPlaying ? "Stop" : "Play"}</span>`;
    play.setAttribute(
      "aria-label",
      engine.isPlaying ? "Stop pattern" : "Play pattern",
    );
    play.classList.toggle("playing", engine.isPlaying);
  }
  visualizer.setAnalyser(engine.getAnalyser());
  visualizer.setPlaying(engine.isPlaying);
  const status = document.querySelector("#audio-status");
  if (status)
    status.textContent = engine.isPlaying ? "AUDIO LIVE" : "AUDIO IDLE";
  if (!engine.isPlaying) {
    document
      .querySelectorAll(".current, .beat-lights .active")
      .forEach((element) => {
        element.classList.remove("current");
        element.classList.remove("active");
      });
    const position = document.querySelector("#position");
    if (position) position.textContent = "01";
  }
  refreshIcons();
}
async function togglePlayback(): Promise<void> {
  if (starting) return;
  starting = true;
  try {
    if (engine.isPlaying) engine.stop();
    else await engine.play(project);
    updatePlayback();
  } catch {
    toast("Audio could not start. Try Play again.");
  } finally {
    starting = false;
  }
}
async function audition(id: DrumId = selectedDrum): Promise<void> {
  const track = project.drums.find((item) => item.id === id);
  if (!track) return;
  try {
    await engine.audition(track);
    visualizer.setAnalyser(engine.getAnalyser());
  } catch {
    toast("Audio preview could not start.");
  }
}
document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (!button) return;
  const { dataset, id } = button;
  if (id === "play") await togglePlayback();
  if (id === "restart") {
    const playing = engine.isPlaying;
    engine.stop();
    if (playing) {
      try {
        await engine.play(project);
      } catch {
        toast("Audio could not restart.");
      }
    }
    updatePlayback();
  }
  if (dataset.drum) {
    const parsed = drumIdSchema.safeParse(dataset.drum);
    if (parsed.success) {
      selectedDrum = parsed.data;
      renderInstrumentControls();
      beatCanvas.setSelectedDrum(selectedDrum);
      await audition();
    }
  }
  if (dataset.drumStep) {
    const track = project.drums.find((item) => item.id === dataset.drumStep);
    const step = Number(dataset.step);
    if (track && Number.isInteger(step) && step >= 0 && step < 16) {
      track.steps[step] = !track.steps[step];
      button.classList.toggle("on", track.steps[step]);
      button.setAttribute("aria-pressed", String(track.steps[step]));
      beatCanvas.update(project);
      persist();
    }
  }
  if (dataset.sound !== undefined) {
    const track = project.drums.find((item) => item.id === dataset.soundTrack);
    const value = Number(dataset.sound);
    if (track && [0, 1, 2].includes(value)) {
      track.sound = value;
      renderInstrumentControls();
      persist();
      void audition(track.id);
    }
  }
  if (dataset.mute) {
    const track = project.drums.find((item) => item.id === dataset.mute);
    if (track) {
      track.muted = !track.muted;
      renderDrums();
      persist();
    }
  }
  if (dataset.preset || dataset.preset === "0") {
    clearRemixUndo();
    project = createProject(Number(dataset.preset));
    refreshProject();
    persist();
  }
  if (id === "reset") {
    clearRemixUndo();
    const preset = ["Acid funk", "After hours", "Broken circuit"].indexOf(
      project.name,
    );
    project = createProject(Math.max(0, preset));
    refreshProject();
    persist();
    toast("Pattern reset.");
  }
  if (id === "remix") {
    beforeRemix = structuredClone(project);
    project = remixProject(project);
    refreshProject();
    persist();
    const undo = document.querySelector("#undo-remix");
    if (undo instanceof HTMLButtonElement) undo.disabled = false;
    if (!engine.isPlaying) await togglePlayback();
  }
  if (id === "undo-remix" && beforeRemix) {
    project = beforeRemix;
    beforeRemix = null;
    refreshProject();
    persist();
    button.disabled = true;
  }
  if (id === "bass-mute") {
    project.bass.muted = !project.bass.muted;
    renderBass();
    persist();
  }
  if (dataset.waveform === "sawtooth" || dataset.waveform === "square") {
    project.bass.waveform = dataset.waveform;
    renderBass();
    persist();
  }
  if (dataset.bassToggle) {
    const step = project.bass.steps[Number(dataset.step)];
    if (step) {
      if (dataset.bassToggle === "on") step.on = !step.on;
      refreshNoteStates("bass");
      persist();
    }
  }
  if (id === "generate") {
    project.bass.steps = remixProject(project).bass.steps;
    renderBass();
    persist();
  }
  if (id === "keys-generate") {
    project.keys.steps = remixProject(project).keys.steps;
    renderKeys();
    persist();
  }
  if (id === "keys-mute") {
    project.keys.muted = !project.keys.muted;
    renderKeys();
    persist();
  }
  if (dataset.keySound !== undefined) {
    const sound = Number(dataset.keySound);
    if ([0, 1, 2].includes(sound)) {
      project.keys.sound = sound;
      renderKeys();
      persist();
      if (!engine.isPlaying)
        void previewKeys(project.keys.steps[0]?.note ?? 57);
    }
  }
  if (dataset.keysGate !== undefined) {
    const step = project.keys.steps[Number(dataset.keysGate)];
    if (step) {
      step.on = !step.on;
      refreshNoteStates("keys");
      persist();
      if (step.on && !engine.isPlaying) void previewKeys(step.note);
    }
  }
  if (id === "motion") {
    motion = !motion;
    visualizer.setMotion(motion);
    button.innerHTML = icon(motion ? "pause" : "play");
    button.setAttribute("aria-pressed", String(motion));
    button.setAttribute(
      "aria-label",
      `${motion ? "Pause" : "Enable"} visualizer motion`,
    );
    refreshIcons();
  }
  if (id === "fullscreen") {
    const panel = document.querySelector("#visualizer-panel");
    if (panel instanceof HTMLElement) {
      if (panel.classList.contains("expanded"))
        panel.classList.remove("expanded");
      else if (document.fullscreenElement) await document.exitFullscreen();
      else {
        try {
          if (typeof document.documentElement.requestFullscreen === "function")
            await document.documentElement.requestFullscreen();
          else panel.classList.add("expanded");
        } catch {
          panel.classList.add("expanded");
        }
      }
      updateFullscreenButton();
    }
  }
  if (id === "export") {
    button.disabled = true;
    button.innerHTML = `${icon("download")}<span>Rendering…</span>`;
    refreshIcons();
    try {
      const blob = await engine.exportWav(structuredClone(project));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `acid-303-${project.bpm}bpm.wav`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("WAV exported.");
    } catch {
      toast("WAV export failed. Please try again.");
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon("download")}<span>Export WAV</span>`;
      refreshIcons();
    }
  }
});
function updateControl(id: string, value: number): void {
  if (id === "bpm") {
    project.bpm = value;
    setOutput(id, String(value));
  }
  if (id === "swing") {
    project.swing = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "drive") {
    project.drive = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "volume") {
    project.volume = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "cutoff") {
    project.bass.cutoff = 80 * 100 ** (value / 100);
    setOutput(id, formatFrequency(project.bass.cutoff));
  }
  if (id === "resonance") {
    project.bass.resonance = value;
    setOutput(id, `${Math.round((value / 22) * 100)}%`);
  }
  if (id === "envelope") {
    project.bass.envelope = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "bass-decay") {
    project.bass.decay = value / 1000;
    setOutput(id, `${value} ms`);
  }
  if (id === "bass-volume") {
    project.bass.volume = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "keys-tone") {
    project.keys.tone = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "keys-decay") {
    project.keys.decay = value / 1000;
    setOutput(id, `${value} ms`);
  }
  if (id === "keys-space") {
    project.keys.space = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "keys-volume") {
    project.keys.volume = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id.startsWith("keys-note-")) {
    const step = project.keys.steps[Number(id.slice(10))];
    if (step) {
      step.note = value;
      setOutput(id, noteName(value));
      if (!engine.isPlaying && performance.now() - lastPaintPreview > 110) {
        lastPaintPreview = performance.now();
        void previewNote("keys", step);
      }
    }
  }
  if (id.startsWith("note-")) {
    const index = Number(id.slice(5));
    const step = project.bass.steps[index];
    if (step) {
      step.note = value;
      setOutput(id, noteName(value));
      if (!engine.isPlaying && performance.now() - lastPaintPreview > 110) {
        lastPaintPreview = performance.now();
        void previewNote("bass", step);
      }
    }
  }
  for (const track of project.drums) {
    if (id === `${track.id}-pitch`) {
      track.pitch = value;
      setOutput(id, `${value > 0 ? "+" : ""}${value} st`);
    }
    if (id === `${track.id}-decay`) {
      track.decay = value / 1000;
      setOutput(id, `${value} ms`);
    }
    if (id === `${track.id}-volume`) {
      track.volume = value / 100;
      setOutput(id, `${value}%`);
    }
  }
  if (id === "intensity") {
    visualizer.setIntensity(value / 100);
    setOutput(id, `${value}%`);
    const stage = document.querySelector("#visualizer-panel");
    if (stage instanceof HTMLElement)
      stage.style.visibility = value === 0 ? "hidden" : "visible";
    return;
  }
  persist();
}
document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLElement &&
    event.target.dataset.gridIndex !== undefined &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    const index = Number(event.target.dataset.gridIndex);
    const next = Math.max(
      0,
      Math.min(
        79,
        index +
          (event.key === "ArrowLeft"
            ? -1
            : event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowUp"
                ? -16
                : 16),
      ),
    );
    const target = document.querySelector(`[data-grid-index="${next}"]`);
    if (target instanceof HTMLButtonElement) {
      event.target.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    }
    event.preventDefault();
    return;
  }
  if (event.code !== "Space" || event.repeat) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'input,select,button,textarea,a,[role="slider"],[contenteditable="true"]',
    )
  )
    return;
  event.preventDefault();
  void togglePlayback();
});
function updateFullscreenButton(): void {
  const expanded =
    Boolean(document.fullscreenElement) ||
    document
      .querySelector("#visualizer-panel")
      ?.classList.contains("expanded") === true;
  const button = document.querySelector("#fullscreen");
  if (button) {
    button.innerHTML = icon(expanded ? "minimize-2" : "maximize-2");
    button.setAttribute(
      "aria-label",
      expanded ? "Exit fullscreen visualizer" : "Fullscreen visualizer",
    );
    refreshIcons();
  }
  document.body.classList.toggle("visualizer-expanded", expanded);
}
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelector("#visualizer-panel")?.classList.remove("expanded");
    updateFullscreenButton();
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) updatePlayback();
});
window.addEventListener("pagehide", () => {
  engine.stop();
  visualizer.setPlaying(false);
  try {
    localStorage.setItem(storageKey, JSON.stringify(project));
  } catch {
    /* Storage may be disabled by the browser. */
  }
});
refreshProject();
