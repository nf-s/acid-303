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
  BASS_SOUNDS,
  normalizedBassValue,
  normalizedKeysValue,
  normalizedDrumValue,
  remixProject,
  SCALE_MODES,
  withScale,
  snapNote,
} from "./model";
import type {
  BassStep,
  DrumId,
  BassAutomation,
  KeysAutomation,
  BassAutomationParameter,
  KeysAutomationParameter,
  DrumAutomationParameter,
} from "./model";
import { DrumEditor, DRUM_CONTROLS } from "./drum-editor";
import { EditHistory } from "./history";
import { encodeTrack, decodeTrack } from "./share";
import { AudioEngine } from "./audio";
import { FluidVisualizer } from "./visualizer";
import { BeatCanvas } from "./beat-canvas";
import { installGestures } from "./gestures";
import { MotionControls } from "./motion-controls";
import { NoteMatrix } from "./note-matrix";
import type { MatrixChange, MatrixParameter } from "./note-matrix";
import { PRESETS, createPreset } from "./presets";
import "./style.css";

type AutomationTarget =
  | { track: "bass"; parameter: BassAutomationParameter }
  | { track: "keys"; parameter: KeysAutomationParameter }
  | { track: "drums"; id: DrumId; parameter: DrumAutomationParameter };
interface AutomationControl {
  id: string;
  label: string;
  target: AutomationTarget;
}
const automationControls: AutomationControl[] = [
  {
    id: "cutoff",
    label: "Cutoff",
    target: { track: "bass", parameter: "cutoff" },
  },
  {
    id: "resonance",
    label: "Resonance",
    target: { track: "bass", parameter: "resonance" },
  },
  {
    id: "envelope",
    label: "Envelope",
    target: { track: "bass", parameter: "envelope" },
  },
  {
    id: "bass-decay",
    label: "Decay",
    target: { track: "bass", parameter: "decay" },
  },
  {
    id: "bass-volume",
    label: "Level",
    target: { track: "bass", parameter: "volume" },
  },
  {
    id: "bass-shape",
    label: "Shape",
    target: { track: "bass", parameter: "shape" },
  },
  {
    id: "bass-drive",
    label: "Drive",
    target: { track: "bass", parameter: "drive" },
  },
  {
    id: "keys-tone",
    label: "Tone",
    target: { track: "keys", parameter: "tone" },
  },
  {
    id: "keys-decay",
    label: "Decay",
    target: { track: "keys", parameter: "decay" },
  },
  {
    id: "keys-space",
    label: "Space",
    target: { track: "keys", parameter: "space" },
  },
  {
    id: "keys-volume",
    label: "Level",
    target: { track: "keys", parameter: "volume" },
  },
  {
    id: "keys-grit",
    label: "Grit",
    target: { track: "keys", parameter: "grit" },
  },
  {
    id: "keys-motion",
    label: "Motion",
    target: { track: "keys", parameter: "motion" },
  },
];
automationControls.push(
  {
    id: "bass-pulse",
    label: "Pulse",
    target: { track: "bass", parameter: "pulse" },
  },
  {
    id: "keys-width",
    label: "Width",
    target: { track: "keys", parameter: "width" },
  },
  {
    id: "keys-attack",
    label: "Attack",
    target: { track: "keys", parameter: "attack" },
  },
);
for (const id of drumIdSchema.options)
  for (const control of DRUM_CONTROLS)
    automationControls.push({
      id: `${id}-${control.parameter}`,
      label: control.label,
      target: { track: "drums", id, parameter: control.parameter },
    });
type MatrixSnapshot =
  | { track: "bass"; steps: BassStep[]; automation: BassAutomation }
  | { track: "keys"; steps: BassStep[]; automation: KeysAutomation };
const selectedAutomation: Record<NoteTrack, string | null> = {
  bass: null,
  keys: null,
};
const automationSweeps = new Map<string, { base: number; values: number[] }>();
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
const editHistory = new EditHistory(project);
let historyGroup = 0;
const historyPointers = new Set<number>();
document.addEventListener(
  "pointerdown",
  (event) => {
    if (!historyPointers.size) historyGroup++;
    historyPointers.add(event.pointerId);
  },
  true,
);
for (const event of ["pointerup", "pointercancel"])
  document.addEventListener(
    event,
    (event) => {
      if (event instanceof PointerEvent)
        historyPointers.delete(event.pointerId);
    },
    true,
  );
window.addEventListener("blur", () => historyPointers.clear());
document.addEventListener(
  "keydown",
  (event) => {
    if (!event.repeat) historyGroup++;
  },
  true,
);
let selectedDrum: DrumId = "kick";
let beforeRemix: ReturnType<typeof createProject> | null = null;
let starting = false;
let pendingDrum: DrumId | null = null;
let lastPaintPreview = 0;
let motion = true;
const matrixUndo: Record<NoteTrack, MatrixSnapshot | null> = {
  bass: null,
  keys: null,
};
let matrixCommitQueued = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const icon = (name: string) =>
  `<i data-lucide="${name}" aria-hidden="true"></i>`;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application container is missing.");
app.innerHTML = `
    <section id="visualizer-panel" class="visualizer-panel" aria-label="Drum pattern visualizer"><canvas id="fluid-canvas" aria-label="Drum-reactive fluid shapes"></canvas></section>
  <header class="app-header"><a class="brand" href="/" aria-label="Grain home"><span class="brand-icon">${icon("audio-lines")}</span><span>GRAIN</span><span class="brand-divider"></span><span class="brand-detail">BEAT MACHINE</span></a><div class="header-actions"><span id="save-state" class="save-state"><span class="status-dot"></span>${storageAvailable ? "Saved in this browser" : "Browser storage unavailable"}</span><button class="button secondary" id="global-undo" aria-label="Undo last edit" disabled>Undo</button><button class="button secondary" id="global-redo" aria-label="Redo last edit" disabled>Redo</button><button class="button secondary" id="share-track">Share</button><button class="button secondary" id="phone-motion" aria-label="Enable phone motion control" aria-pressed="false" title="Hold a knob and tilt or move your phone">Motion</button><button class="button secondary" id="export">${icon("download")}<span>Export WAV</span></button></div></header>
  <div class="motion-options" id="phone-motion-options" hidden><span>Hold a knob</span><div role="group" aria-label="Phone motion axis"><button data-phone-mode="tilt" aria-pressed="true">Tilt</button><button data-phone-mode="move" aria-pressed="false">Move</button><button data-phone-mode="twist" aria-pressed="false">Twist</button></div><span id="phone-motion-help">Tilt forwards / back or sideways</span></div>
  <div class="share-panel" id="share-panel" hidden><label for="share-url">Track link</label><input id="share-url" readonly><button id="copy-share">Copy</button><button id="close-share" aria-label="Close share link">×</button></div>
  <main class="workspace">
    <section class="transport panel" aria-label="Playback controls">
      <div class="playback"><button class="play-button" id="play" aria-label="Play pattern">${icon("play")}<span>Play</span></button><button class="icon-button restart" id="restart" aria-label="Restart pattern" title="Restart pattern">${icon("rotate-ccw")}</button></div>
      ${slider("bpm", "Tempo", 60, 180, project.bpm, `${project.bpm}`, "1")}
      ${slider("swing", "Swing", 0, 50, project.swing * 100, `${Math.round(project.swing * 100)}%`)}
      ${slider("drive", "Crunch", 0, 100, project.drive * 100, `${Math.round(project.drive * 100)}%`)}
      ${slider("volume", "Volume", 0, 100, project.volume * 100, `${Math.round(project.volume * 100)}%`)}
      <div class="position"><span id="position">01</span><span>/ 16</span><span class="beat-lights"><b></b><b></b><b></b><b></b></span></div>
    </section>
    <section class="scale-panel panel" aria-label="Musical scale"><div class="scale-row"><span>ROOT</span><div class="scale-roots" role="group" aria-label="Root note">${Array.from({ length: 12 }, (_, root) => `<button data-root="${root}" aria-label="Root ${noteName(root + 60).slice(0, -1)}" aria-pressed="${project.scale.root === root}">${noteName(root + 60).slice(0, -1)}</button>`).join("")}</div></div><div class="scale-row"><span>SCALE</span><div class="scale-modes" role="group" aria-label="Scale type">${SCALE_MODES.map((scale) => `<button data-scale="${scale.id}" aria-pressed="${project.scale.mode === scale.id}">${scale.name}</button>`).join("")}</div></div></section>
    <div class="studio-grid"><div class="sequencers">
      <section class="panel drums-panel" aria-labelledby="drums-title">
        <div class="section-header"><div class="section-title"><span class="section-number">01</span><h1 id="drums-title">Drum sequencer</h1><span class="small-tag">16 STEPS</span></div><button id="reset" class="text-button" title="Restore the selected preset">${icon("rotate-ccw")} Reset</button></div>
        <div class="preset-bar"><div class="preset-options" role="group" aria-label="Genre examples">${PRESETS.map((preset) => `<button data-preset="${preset.id}" aria-label="${preset.name} — ${preset.genre}"><strong>${preset.name}</strong><span>${preset.genre}</span></button>`).join("")}</div><div class="preset-actions"><button id="remix" class="remix-button">${icon("shuffle")} Remix</button><button id="undo-remix" class="text-button undo-remix" disabled>Undo</button></div></div>
        <div id="drum-editors"></div>
        <div class="beat-surface"><canvas id="beat-canvas" aria-label="Paint drum beats" aria-describedby="paint-help"></canvas><div id="drum-grid" class="beat-keyboard" role="grid" aria-label="Drum steps"></div></div>
        <div class="section-footer"><span><span class="legend-pad"></span><span id="paint-help">Drag to paint · Drag a filled step to erase</span></span><span>Drag controls up / down</span></div>
      </section>
      <section class="panel bass-panel" aria-labelledby="bass-title">
        <div class="section-header"><div class="section-title"><span class="section-number">02</span><h2 id="bass-title">Acid bass</h2><span class="small-tag">303</span></div><div class="bass-actions"><button id="bass-mute" class="mute-button" aria-label="Mute acid bass" aria-pressed="${project.bass.muted}">M</button><button id="generate" class="text-button">${icon("shuffle")} Generate</button></div></div>
        <div class="bass-meta"><div class="waveform-switch bass-sounds" role="group" aria-label="Bass sound">${BASS_SOUNDS.map((sound, index) => `<button data-bass-sound="${index}">${sound}</button>`).join("")}</div><span class="bass-key">A MINOR <span>·</span> 1 BAR</span></div>
        <div class="acid-controls">${slider("cutoff", "Cutoff", 0, 100, Math.round((Math.log(project.bass.cutoff / 80) / Math.log(100)) * 100), formatFrequency(project.bass.cutoff))}${slider("resonance", "Resonance", 0, 22, project.bass.resonance, `${Math.round((project.bass.resonance / 22) * 100)}%`, "0.1")}${slider("envelope", "Envelope", 0, 100, project.bass.envelope * 100, `${Math.round(project.bass.envelope * 100)}%`)}${slider("bass-decay", "Decay", 50, 1500, project.bass.decay * 1000, `${Math.round(project.bass.decay * 1000)} ms`, "10")}${slider("bass-volume", "Level", 0, 100, project.bass.volume * 100, `${Math.round(project.bass.volume * 100)}%`)}${slider("bass-shape", "Shape", 0, 100, project.bass.shape * 100, `${Math.round(project.bass.shape * 100)}%`)}${slider("bass-drive", "Drive", 0, 100, project.bass.drive * 100, `${Math.round(project.bass.drive * 100)}%`)}${slider("bass-pulse", "Pulse", 0, 100, project.bass.pulse * 100, `${Math.round(project.bass.pulse * 100)}%`)}</div>${matrixMarkup("bass", "Bass")}
      </section>
      <section class="panel bass-panel keys-panel" aria-labelledby="keys-title">
        <div class="section-header"><div class="section-title"><span class="section-number">03</span><h2 id="keys-title">Texture</h2></div><div class="bass-actions"><button id="keys-mute" class="mute-button" aria-label="Mute Texture" aria-pressed="${project.keys.muted}">M</button><button id="keys-generate" class="text-button">${icon("shuffle")} New pattern</button></div></div>
        <div class="bass-meta"><div class="waveform-switch keys-sounds" role="group" aria-label="Texture sound">${KEYS_SOUNDS.map((sound, index) => `<button data-key-sound="${index}">${sound}</button>`).join("")}</div><span class="bass-key keys-key">A MINOR</span></div>
        <div class="acid-controls">${slider("keys-tone", "Tone", 0, 100, project.keys.tone * 100, `${Math.round(project.keys.tone * 100)}%`)}${slider("keys-decay", "Decay", 80, 2000, project.keys.decay * 1000, `${Math.round(project.keys.decay * 1000)} ms`, "10")}${slider("keys-space", "Space", 0, 100, project.keys.space * 100, `${Math.round(project.keys.space * 100)}%`)}${slider("keys-volume", "Level", 0, 100, project.keys.volume * 100, `${Math.round(project.keys.volume * 100)}%`)}${slider("keys-grit", "Grit", 0, 100, project.keys.grit * 100, `${Math.round(project.keys.grit * 100)}%`)}${slider("keys-motion", "Motion", 0, 100, project.keys.motion * 100, `${Math.round(project.keys.motion * 100)}%`)}${slider("keys-width", "Width", 0, 100, project.keys.width * 100, `${Math.round(project.keys.width * 100)}%`)}${slider("keys-attack", "Attack", 0, 100, project.keys.attack * 100, `${Math.round(project.keys.attack * 100)}%`)}</div>
        ${matrixMarkup("keys", "Texture")}
      </section>
    </div>
</div>
<div class="visualizer-toolbar"><div class="visualizer-top"><span class="visualizer-label">${icon("waves")} VISUALIZER</span><span class="audio-status" id="audio-status">AUDIO IDLE</span></div><div class="visualizer-bottom"><span class="visualizer-mode"><span class="visualizer-dot"></span>FLUID</span><div class="visualizer-controls">${slider("intensity", "Intensity", 0, 100, 30, "30%")}<button id="motion" class="visualizer-button" aria-label="${motion ? "Pause" : "Enable"} visualizer motion" aria-pressed="${motion}">${icon(motion ? "pause" : "play")}</button><button id="fullscreen" class="visualizer-button" aria-label="Fullscreen visualizer">${icon("maximize-2")}</button></div></div></div>
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
  allowedValues?: number[],
): string {
  const automation = automationControls.find((control) => control.id === id);
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
        : `${id.startsWith("keys-") ? "Texture" : "Bass"} ${label.toLowerCase()}`);
  return `<div class="dial-control"><span class="dial-label">${label}</span><div class="gesture-control" id="${id}" role="slider" tabindex="0" title="${automation ? "Click or Enter to draw automation · Drag to adjust" : "Drag up/down · Shift for fine control · Double-tap to reset"}" ${automation ? `data-automation-control="${id}" aria-controls="${automation.target.track === "drums" ? automation.target.id : automation.target.track}-matrix-canvas"` : ""} aria-label="${name}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-valuetext="${display}" aria-orientation="vertical" data-step="${step}" ${allowedValues ? `data-values="${allowedValues.join(",")}"` : ""} data-reset="${value}" style="--knob-angle:${-135 + ((value - min) / (max - min)) * 270}deg"><span class="knob-face" aria-hidden="true"><span></span></span><output id="${id}-value">${display}</output></div></div>`;
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
  drumEditor.render();
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
function matrixMarkup(track: NoteTrack, label: string): string {
  return `<div class="matrix-toolbar"><div class="matrix-parameters" role="group" aria-label="${label} matrix parameter">${[
    ["pitch", "Pitch"],
    ["gate", "Gate"],
    ["accent", "Accent"],
    ["slide", "Glide"],
  ]
    .map(
      ([parameter, name]) =>
        `<button data-matrix-track="${track}" data-matrix-parameter="${parameter}" aria-pressed="${parameter === "pitch"}">${name}</button>`,
    )
    .join(
      "",
    )}</div><div class="matrix-tools" role="group" aria-label="${label} drawing tool"><button data-matrix-track="${track}" data-matrix-tool="draw" aria-pressed="true">Draw</button><button data-matrix-track="${track}" data-matrix-tool="line" aria-pressed="false">Line</button><button data-matrix-undo="${track}" aria-label="Undo ${label} drawing" disabled>Undo</button></div></div><div class="automation-strip" id="${track}-automation" hidden><span id="${track}-automation-label"></span><button data-automation-clear="${track}" aria-label="Clear ${label} automation">Clear curve</button><button data-automation-close="${track}" aria-label="Return to ${label} notes">Notes</button></div><div class="note-matrix" id="${track}-matrix"><canvas id="${track}-matrix-canvas" aria-label="Draw ${label} pitch" aria-describedby="${track}-matrix-help"></canvas><div class="matrix-access" id="${track}-matrix-access"></div></div><div class="matrix-legend" aria-hidden="true"><span class="motif-pitch">━ Pitch</span><span class="motif-gate">▌ Gate</span><span class="motif-accent">◆ Accent</span><span class="motif-glide">⌒ Glide</span></div><div class="section-footer note-help" id="${track}-matrix-help"><span>Draw pitch in scale · Tap a knob to automate</span><span>↑↓ Edit · ←→ Step · Enter Gate</span></div>`;
}
function automationValues(target: AutomationTarget): number[] | null {
  if (target.track === "drums")
    return (
      project.drums.find((track) => track.id === target.id)?.automation[
        target.parameter
      ] ?? null
    );
  return target.track === "bass"
    ? project.bass.automation[target.parameter]
    : project.keys.automation[target.parameter];
}
function setAutomationValues(
  target: AutomationTarget,
  values: number[] | null,
): void {
  if (target.track === "drums") {
    const drum = project.drums.find((track) => track.id === target.id);
    if (drum) drum.automation[target.parameter] = values;
  } else if (target.track === "bass")
    project.bass.automation[target.parameter] = values;
  else project.keys.automation[target.parameter] = values;
}
function automationBase(target: AutomationTarget): number {
  if (target.track === "drums") {
    const drum = project.drums.find((track) => track.id === target.id);
    return drum ? normalizedDrumValue(drum, target.parameter) : 0;
  }
  return target.track === "bass"
    ? normalizedBassValue(project.bass, target.parameter)
    : normalizedKeysValue(project.keys, target.parameter);
}
function automationDisplay(id: string, value: number): string {
  if (id === "cutoff") return formatFrequency(80 * 100 ** value);
  if (id === "bass-decay") return `${Math.round(50 + value * 1450)} ms`;
  if (id === "keys-decay") return `${Math.round(80 + value * 1920)} ms`;
  return `${Math.round(value * 100)}%`;
}
function refreshAutomation(track: NoteTrack): void {
  const selected = automationControls.find(
    (control) =>
      control.id === selectedAutomation[track] &&
      control.target.track === track,
  );
  const strip = document.getElementById(`${track}-automation`);
  if (strip) strip.hidden = !selected;
  for (const control of automationControls.filter(
    (control) => control.target.track === track,
  )) {
    const element = document.getElementById(control.id);
    const active = automationValues(control.target) !== null;
    element?.classList.toggle("automated", active);
    element?.classList.toggle(
      "automation-selected",
      control.id === selected?.id,
    );
    element?.setAttribute("data-automated", String(active));
    element?.setAttribute(
      "aria-description",
      `${active ? "Automation active. " : ""}Click or Enter to draw automation. Drag to ${active ? "shift the curve" : "adjust"}.`,
    );
  }
  if (!selected) {
    matrices[track].setAutomation(null);
    return;
  }
  const values = automationValues(selected.target);
  matrices[track].setAutomation({
    id: selected.id,
    label: selected.label,
    values,
    base: automationBase(selected.target),
    format: (value) => automationDisplay(selected.id, value),
  });
  const label = document.getElementById(`${track}-automation-label`);
  if (label) label.textContent = `${selected.label} automation`;
  const clear = document.querySelector(`[data-automation-clear="${track}"]`);
  if (clear instanceof HTMLButtonElement) clear.disabled = values === null;
}
function selectAutomation(id: string): void {
  const control = automationControls.find((control) => control.id === id);
  if (!control) return;
  if (control.target.track === "drums") {
    drumEditor.select(control.target.id, control.target.parameter);
    return;
  }
  const track = control.target.track;
  selectedAutomation[track] = id;
  document
    .querySelectorAll<HTMLButtonElement>(
      `[data-matrix-track="${track}"][data-matrix-parameter]`,
    )
    .forEach((button) => button.setAttribute("aria-pressed", "false"));
  refreshAutomation(track);
  const help = document.querySelector(`#${track}-matrix-help > span`);
  if (help)
    help.textContent = "Draw automation · Drag the knob to shift the curve";
  document
    .querySelector(`#${track}-matrix-canvas`)
    ?.setAttribute(
      "aria-label",
      `Draw ${track === "bass" ? "Bass" : "Texture"} ${control.label.toLowerCase()} automation`,
    );
}
function selectMatrixParameter(
  track: NoteTrack,
  parameter: MatrixParameter,
): void {
  selectedAutomation[track] = null;
  matrices[track].setParameter(parameter);
  refreshAutomation(track);
  document
    .querySelectorAll<HTMLButtonElement>(
      `[data-matrix-track="${track}"][data-matrix-parameter]`,
    )
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.matrixParameter === parameter),
      ),
    );
  const help = document.querySelector(`#${track}-matrix-help > span`);
  if (help)
    help.textContent =
      parameter === "pitch"
        ? "Draw pitch in scale · Tap a knob to automate"
        : "Draw above the centre for on · Below for off";
  document
    .querySelector(`#${track}-matrix-canvas`)
    ?.setAttribute(
      "aria-label",
      `Draw ${track === "bass" ? "Bass" : "Texture"} ${parameter === "slide" ? "glide" : parameter}`,
    );
}
function matrixPaint(track: NoteTrack, change: MatrixChange): void {
  if (change.parameter === "restore") {
    project[track].steps.forEach((step, index) => {
      const saved = change.steps[index];
      if (saved) Object.assign(step, saved);
    });
    if (change.automation) {
      const control = automationControls.find(
        (control) =>
          control.id === change.automation?.id &&
          control.target.track === track,
      );
      if (control)
        setAutomationValues(
          control.target,
          change.automation.values === null
            ? null
            : [...change.automation.values],
        );
    }
    queueMatrixSave();
    return;
  }
  if (change.parameter === "automation") {
    const control = automationControls.find(
      (control) => control.id === change.id && control.target.track === track,
    );
    if (
      !control ||
      !Number.isInteger(change.index) ||
      change.index < 0 ||
      change.index >= 16 ||
      !Number.isFinite(change.value)
    )
      return;
    const lane =
      automationValues(control.target) ??
      Array.from({ length: 16 }, () => automationBase(control.target));
    lane[change.index] = Math.max(0, Math.min(1, change.value));
    setAutomationValues(control.target, lane);
    automationSweeps.delete(change.id);
    queueMatrixSave();
    return;
  }
  const step = project[track].steps[change.index];
  if (!step) return;
  if (change.parameter === "pitch") {
    if (step.note === change.value) return;
    step.note = change.value;
    if (!engine.isPlaying && performance.now() - lastPaintPreview > 110) {
      lastPaintPreview = performance.now();
      void previewNote(track, step);
    }
  } else {
    const property = change.parameter === "gate" ? "on" : change.parameter;
    if (step[property] === change.value) return;
    step[property] = change.value;
    if (property === "slide" && change.value) {
      step.on = true;
      const next = project[track].steps[(change.index + 1) % 16];
      if (next) next.on = true;
    }
  }
  queueMatrixSave();
}
function queueMatrixSave(): void {
  if (!matrixCommitQueued) {
    matrixCommitQueued = true;
    queueMicrotask(() => {
      matrixCommitQueued = false;
      if (selectedAutomation.bass) refreshAutomation("bass");
      if (selectedAutomation.keys) refreshAutomation("keys");
      persist();
    });
  }
}
function saveMatrixUndo(track: NoteTrack): void {
  if (track === "bass")
    matrixUndo.bass = {
      track,
      steps: structuredClone(project.bass.steps),
      automation: structuredClone(project.bass.automation),
    };
  else
    matrixUndo.keys = {
      track,
      steps: structuredClone(project.keys.steps),
      automation: structuredClone(project.keys.automation),
    };
  const button = document.querySelector(`[data-matrix-undo="${track}"]`);
  if (button instanceof HTMLButtonElement) button.disabled = false;
}
function clearMatrixUndo(track?: NoteTrack): void {
  const tracks: NoteTrack[] = track ? [track] : ["bass", "keys"];
  for (const target of tracks) {
    matrixUndo[target] = null;
    const button = document.querySelector(`[data-matrix-undo="${target}"]`);
    if (button instanceof HTMLButtonElement) button.disabled = true;
  }
}
function refreshScaleControls(): void {
  const mode = SCALE_MODES.find((entry) => entry.id === project.scale.mode);
  const label = `${noteName(project.scale.root + 60).slice(0, -1)} ${mode?.name ?? "Minor"}`;
  document.querySelectorAll<HTMLElement>(".bass-key").forEach((element) => {
    element.textContent = label;
  });
  document
    .querySelectorAll<HTMLElement>("[data-root]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.root) === project.scale.root),
      ),
    );
  document
    .querySelectorAll<HTMLElement>("[data-scale]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scale === project.scale.mode),
      ),
    );
}
async function previewNote(track: NoteTrack, step: BassStep): Promise<void> {
  try {
    if (track === "bass")
      await engine.auditionBass(project.bass, step.note, step.accent);
    else await engine.auditionKeys(project.keys, step.note, step.accent);
  } catch {
    toast("Note preview could not start.");
  }
}
function renderBass(): void {
  document
    .querySelectorAll<HTMLButtonElement>("[data-bass-sound]")
    .forEach((button) => {
      const active = Number(button.dataset.bassSound) === project.bass.sound;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  document
    .querySelector("#bass-mute")
    ?.setAttribute("aria-pressed", String(project.bass.muted));
  matrices.bass.update(project.bass.steps, project.scale, project.bass.muted);
  refreshAutomation("bass");
}
function renderKeys(): void {
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
  matrices.keys.update(project.keys.steps, project.scale, project.keys.muted);
  refreshAutomation("keys");
}
async function previewKeys(note: number): Promise<void> {
  try {
    await engine.auditionKeys(project.keys, note);
  } catch {
    toast("Texture preview could not start.");
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
    .forEach((button) => {
      const active =
        PRESETS.find((preset) => preset.id === button.dataset.preset)?.name ===
        project.name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  const label = document.querySelector("#project-name");
  if (label) label.textContent = project.name;
}
function refreshProject(): void {
  automationSweeps.clear();
  renderDrums();
  renderBass();
  renderKeys();
  updatePresetLabels();
  refreshScaleControls();
  clearMatrixUndo();
  setInput("keys-tone", project.keys.tone * 100);
  setOutput("keys-tone", `${Math.round(project.keys.tone * 100)}%`);
  setInput("keys-decay", project.keys.decay * 1000);
  setOutput("keys-decay", `${Math.round(project.keys.decay * 1000)} ms`);
  setInput("keys-space", project.keys.space * 100);
  setOutput("keys-space", `${Math.round(project.keys.space * 100)}%`);
  setInput("keys-volume", project.keys.volume * 100);
  setOutput("keys-volume", `${Math.round(project.keys.volume * 100)}%`);
  for (const control of automationControls.filter((control) =>
    [
      "bass-shape",
      "bass-drive",
      "bass-pulse",
      "keys-grit",
      "keys-motion",
      "keys-width",
      "keys-attack",
    ].includes(control.id),
  )) {
    const value = Math.round(automationBase(control.target) * 100);
    setInput(control.id, value);
    setOutput(control.id, `${value}%`);
  }
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
  matrices.bass.setStep(step);
  matrices.keys.setStep(step);
  drumEditor.setStep(step);
  if (step >= 0) visualizer.triggerStep(project.drums, step);
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
const drumEditorContainer = document.getElementById("drum-editors");
if (!drumEditorContainer) throw new Error("Drum editor is missing.");
const drumEditor = new DrumEditor(drumEditorContainer, {
  getProject: () => project,
  getSelected: () => selectedDrum,
  renderControl: slider,
  onChange: () => {
    automationSweeps.clear();
    beatCanvas.update(project);
    persist();
  },
  onStroke: () => automationSweeps.clear(),
});
function createMatrix(
  track: NoteTrack,
  label: string,
  min: number,
  max: number,
): NoteMatrix {
  const canvas = document.querySelector(`#${track}-matrix-canvas`),
    access = document.querySelector(`#${track}-matrix-access`);
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(access instanceof HTMLElement)
  )
    throw new Error("Note matrix is missing.");
  return new NoteMatrix(
    canvas,
    access,
    label,
    min,
    max,
    (change) => matrixPaint(track, change),
    () => saveMatrixUndo(track),
  );
}
const matrices = {
  bass: createMatrix("bass", "Bass", 24, 60),
  keys: createMatrix("keys", "Texture", 48, 84),
};
const gestures = installGestures(
  app,
  (control, value) => updateControl(control.id, value),
  {
    activate: (control) => selectAutomation(control.id),
    begin: (element) => {
      const control = automationControls.find(
        (control) => control.id === element.id,
      );
      if (control?.target.track === "drums")
        drumEditor.cancel(control.target.id);
      else if (control) matrices[control.target.track].cancelStroke();
    },
    end: (control) => automationSweeps.delete(control.id),
  },
);
const phoneMotion = new MotionControls(
  (delta) => gestures.twist(delta),
  (status) => {
    const button = document.querySelector("#phone-motion");
    if (button instanceof HTMLButtonElement) {
      button.disabled = status.state === "requesting";
      button.setAttribute("aria-pressed", String(status.state === "on"));
      button.setAttribute(
        "aria-label",
        `${status.state === "on" ? "Disable" : "Enable"} phone motion control`,
      );
      button.title = status.message;
    }
    const options = document.getElementById("phone-motion-options");
    if (options) options.hidden = status.state !== "on";
    if (status.state !== "requesting") toast(status.message);
  },
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

function updateHistoryButtons(): void {
  const undo = document.getElementById("global-undo"),
    redo = document.getElementById("global-redo");
  if (undo instanceof HTMLButtonElement) undo.disabled = !editHistory.canUndo;
  if (redo instanceof HTMLButtonElement) redo.disabled = !editHistory.canRedo;
}
function travelHistory(redo: boolean): void {
  const next = redo ? editHistory.redo() : editHistory.undo();
  if (!next) return;
  project = next;
  clearRemixUndo();
  refreshProject();
  persist(false);
}
function persist(record = true): void {
  if (record) editHistory.record(project, historyGroup);
  updateHistoryButtons();
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
  } catch {
    toast("Audio preview could not start.");
  }
}
document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (!button) return;
  const { dataset, id } = button;
  if (id === "global-undo") travelHistory(false);
  if (id === "global-redo") travelHistory(true);
  if (id === "close-share") {
    const panel = document.getElementById("share-panel");
    if (panel) panel.hidden = true;
  }
  if (id === "share-track") {
    button.disabled = true;
    try {
      const encoded = await encodeTrack(structuredClone(project));
      const url = new URL(location.href);
      url.hash = `track=${encoded}`;
      const field = document.getElementById("share-url"),
        panel = document.getElementById("share-panel");
      if (field instanceof HTMLInputElement && panel) {
        field.value = url.href;
        panel.hidden = false;
        field.select();
      }
      try {
        await navigator.clipboard.writeText(url.href);
        toast("Track link copied.");
      } catch {
        toast("Copy the track link above.");
      }
    } catch {
      toast("Could not create the track link.");
    } finally {
      button.disabled = false;
    }
  }
  if (id === "copy-share") {
    const field = document.getElementById("share-url");
    if (field instanceof HTMLInputElement) {
      try {
        await navigator.clipboard.writeText(field.value);
        toast("Track link copied.");
      } catch {
        field.focus();
        field.select();
      }
    }
  }

  const phoneMode = dataset.phoneMode;
  if (phoneMode === "tilt" || phoneMode === "move" || phoneMode === "twist") {
    phoneMotion.setMode(phoneMode);
    document
      .querySelectorAll<HTMLElement>("[data-phone-mode]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.phoneMode === phoneMode),
        ),
      );
    const help = document.getElementById("phone-motion-help");
    if (help)
      help.textContent =
        phoneMode === "tilt"
          ? "Tilt forwards / back or sideways"
          : phoneMode === "move"
            ? "Move the phone forwards / back or sideways"
            : "Rotate the phone clockwise / anticlockwise";
  }
  if (id === "phone-motion") {
    if (phoneMotion.enabled) phoneMotion.disable();
    else await phoneMotion.enable();
  }
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
    if (
      track &&
      Number.isInteger(value) &&
      value >= 0 &&
      value < DRUM_META[track.id].sounds.length
    ) {
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
  if (
    dataset.preset &&
    PRESETS.some((preset) => preset.id === dataset.preset)
  ) {
    clearRemixUndo();
    project = withScale(createPreset(dataset.preset), project.scale);
    refreshProject();
    persist();
  }
  if (id === "reset") {
    clearRemixUndo();
    const preset = PRESETS.find((preset) => preset.name === project.name);
    project = withScale(
      preset ? createPreset(preset.id) : createProject(),
      project.scale,
    );
    refreshProject();
    persist();
    toast("Pattern reset.");
  }
  if (dataset.root !== undefined) {
    const root = Number(dataset.root);
    if (Number.isInteger(root) && root >= 0 && root < 12) {
      project = withScale(project, { ...project.scale, root });
      clearRemixUndo();
      refreshProject();
      persist();
    }
  }
  if (dataset.scale) {
    const mode = SCALE_MODES.find((entry) => entry.id === dataset.scale)?.id;
    if (mode) {
      project = withScale(project, { ...project.scale, mode });
      clearRemixUndo();
      refreshProject();
      persist();
    }
  }
  if (dataset.matrixTrack === "bass" || dataset.matrixTrack === "keys") {
    const track = dataset.matrixTrack;
    const parameter = dataset.matrixParameter;
    if (
      parameter === "pitch" ||
      parameter === "gate" ||
      parameter === "accent" ||
      parameter === "slide"
    ) {
      selectMatrixParameter(track, parameter);
    }
    if (dataset.matrixTool === "draw" || dataset.matrixTool === "line") {
      matrices[track].setTool(dataset.matrixTool);
      document
        .querySelectorAll<HTMLButtonElement>(
          `[data-matrix-track="${track}"][data-matrix-tool]`,
        )
        .forEach((control) =>
          control.setAttribute(
            "aria-pressed",
            String(control.dataset.matrixTool === dataset.matrixTool),
          ),
        );
    }
  }
  if (
    dataset.automationClear === "bass" ||
    dataset.automationClear === "keys"
  ) {
    const track = dataset.automationClear;
    const control = automationControls.find(
      (control) =>
        control.id === selectedAutomation[track] &&
        control.target.track === track,
    );
    if (control) {
      matrices[track].cancelStroke();
      automationSweeps.delete(control.id);
      saveMatrixUndo(track);
      setAutomationValues(control.target, null);
      refreshAutomation(track);
      persist();
    }
  }
  if (dataset.automationClose === "bass" || dataset.automationClose === "keys")
    selectMatrixParameter(dataset.automationClose, "pitch");
  if (dataset.matrixUndo === "bass" || dataset.matrixUndo === "keys") {
    const track = dataset.matrixUndo,
      before = matrixUndo[track];
    if (before) {
      automationSweeps.clear();
      project[track].steps = before.steps;
      if (before.track === "bass") project.bass.automation = before.automation;
      else project.keys.automation = before.automation;
      matrixUndo[track] = null;
      button.disabled = true;
      matrices[track].update(before.steps, project.scale, project[track].muted);
      refreshAutomation(track);
      persist();
    }
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
  if (dataset.bassSound !== undefined) {
    const sound = Number(dataset.bassSound);
    if (Number.isInteger(sound) && sound >= 0 && sound < BASS_SOUNDS.length) {
      project.bass.sound = sound;
      renderBass();
      persist();
      const step =
        project.bass.steps.find((step) => step.on) ?? project.bass.steps[0];
      if (step && !engine.isPlaying) void previewNote("bass", step);
    }
  }
  if (id === "generate") {
    clearMatrixUndo("bass");
    project.bass.steps = remixProject(project).bass.steps;
    renderBass();
    persist();
  }
  if (id === "keys-generate") {
    clearMatrixUndo("keys");
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
    if (Number.isInteger(sound) && sound >= 0 && sound < KEYS_SOUNDS.length) {
      project.keys.sound = sound;
      renderKeys();
      persist();
      if (!engine.isPlaying)
        void previewKeys(project.keys.steps[0]?.note ?? 57);
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
      link.download = `grain-${project.bpm}bpm.wav`;
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
  const automation = automationControls.find((control) => control.id === id);
  const baseBefore = automation ? automationBase(automation.target) : 0;
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
  if (id === "bass-shape") {
    project.bass.shape = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "bass-drive") {
    project.bass.drive = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "keys-grit") {
    project.keys.grit = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "keys-motion") {
    project.keys.motion = value / 100;
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
  if (id === "bass-pulse") {
    project.bass.pulse = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "keys-width") {
    project.keys.width = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "keys-attack") {
    project.keys.attack = value / 100;
    setOutput(id, `${value}%`);
  }
  for (const track of project.drums) {
    if (id === `${track.id}-pan`) {
      track.pan = value / 100;
      setOutput(id, `${value}%`);
    }
    if (id === `${track.id}-attack`) {
      track.attack = value / 100;
      setOutput(id, `${value}%`);
    }
    if (id === `${track.id}-space`) {
      track.space = value / 100;
      setOutput(id, `${value}%`);
    }
    if (id === `${track.id}-pitch`) {
      track.pitch = snapNote(
        value,
        { root: 0, mode: project.scale.mode },
        -24,
        24,
      );
      setInput(id, track.pitch);
      setOutput(id, `${track.pitch > 0 ? "+" : ""}${track.pitch} st`);
    }
    if (id === `${track.id}-decay`) {
      track.decay = value / 1000;
      setOutput(id, `${value} ms`);
    }
    if (id === `${track.id}-volume`) {
      track.volume = value / 100;
      setOutput(id, `${value}%`);
    }
    if (id === `${track.id}-tone`) {
      track.tone = value / 100;
      setOutput(id, `${value}%`);
    }
    if (id === `${track.id}-drive`) {
      track.drive = value / 100;
      setOutput(id, `${value}%`);
    }
  }
  if (automation) {
    const lane = automationValues(automation.target);
    if (lane) {
      const held = document.getElementById(id)?.classList.contains("dragging");
      if (held && !automationSweeps.has(id))
        automationSweeps.set(id, { base: baseBefore, values: [...lane] });
      const sweep = held ? automationSweeps.get(id) : undefined;
      const delta =
        automationBase(automation.target) - (sweep?.base ?? baseBefore);
      const source = sweep?.values ?? lane;
      if (delta !== 0 || sweep) {
        setAutomationValues(
          automation.target,
          source.map((value) => Math.max(0, Math.min(1, value + delta))),
        );
        if (automation.target.track !== "drums")
          clearMatrixUndo(automation.target.track);
      }
    }
    if (automation.target.track === "drums")
      drumEditor.refresh(automation.target.id);
    else refreshAutomation(automation.target.track);
  }
  if (id === "intensity") {
    setOutput(id, `${value}%`);
    const stage = document.querySelector("#visualizer-panel");
    if (stage instanceof HTMLElement) {
      stage.style.opacity = String(value / 100);
      stage.style.visibility = value === 0 ? "hidden" : "visible";
    }
    return;
  }
  persist();
}
document.addEventListener("keydown", (event) => {
  if (
    (event.metaKey || event.ctrlKey) &&
    ["z", "y"].includes(event.key.toLowerCase()) &&
    !(event.target instanceof HTMLInputElement)
  ) {
    event.preventDefault();
    travelHistory(event.key.toLowerCase() === "y" || event.shiftKey);
    return;
  }
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
  phoneMotion.disable();
  engine.stop();
  visualizer.setPlaying(false);
  try {
    localStorage.setItem(storageKey, JSON.stringify(project));
  } catch {
    /* Storage may be disabled by the browser. */
  }
});
refreshProject();

async function loadSharedTrack(): Promise<void> {
  const encoded = new URLSearchParams(location.hash.slice(1)).get("track");
  if (!encoded) return;
  const shared = await decodeTrack(encoded);
  if (!shared) {
    toast("This track link is invalid or incomplete.");
    return;
  }
  historyGroup++;
  project = shared;
  refreshProject();
  persist();
  toast("Shared track loaded.");
}
void loadSharedTrack();
window.addEventListener("hashchange", () => void loadSharedTrack());
