import {
  createIcons,
  Play,
  Square,
  RotateCcw,
  Download,
  Waves,
  Maximize2,
  Minimize2,
  Pause,
  Shuffle,
  SlidersHorizontal,
} from "lucide";
import {
  createProject,
  exportPlan,
  playbackFrame,
  resolvedAutomationValue,
  resizeBassTrack,
  resizeBassAutomation,
  resizeKeysTrack,
  resizeKeysAutomation,
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
  PlaybackFrame,
  Project,
  BassStep,
  DrumId,
  BassAutomationParameter,
  KeysAutomationParameter,
  DrumAutomationParameter,
  InstrumentId,
} from "./model";
import { DrumEditor, DRUM_CONTROLS } from "./drum-editor";
import { audibleProject, toggleSolo } from "./solo";
import { EditHistory } from "./history";
import { encodeTrack, decodeTrack } from "./share";
import { createArpPanel } from "./arp-panel";
import { createPadPanel } from "./pad-panel";
import { createProgressionPanel } from "./progression-panel";
import { createVocalPanel } from "./vocal-panel";
import { configureSampleApi, ensureSharedSample } from "./custom-samples";
import type { CustomSample } from "./custom-sample-schema";
import { vocalSourceKey } from "./vocal-samples";
import { createCloudPanel } from "./cloud-panel";
import { createTensionPanel } from "./tension-panel";
import { cloudGrainSeconds, cloudGrainsPerSecond } from "./cloud-model";
import type { CloudParameter } from "./cloud-model";
import { tensionDecaySeconds } from "./tension-model";
import type { TensionParameter } from "./tension-model";
import type { CloudGesture } from "./cloud-surface";
import type { TensionGesture } from "./tension-surface";
import { normalizedVocalValue } from "./vocal-model";
import type { VocalParameter } from "./vocal-model";
import { SessionClient } from "./session-client";
import type { SessionStatus } from "./session-client";
import { createSessionPanel } from "./session-panel";
import { diffProject } from "./session-protocol";
import "./session.css";
import "./instrument-automation.css";
import { AudioEngine } from "./audio";
import { FluidVisualizer } from "./visualizer";
import { setThemePalette } from "./canvas-theme";
import grainWordmark from "./grain-wordmark.svg?raw";
import fluffWordmark from "./fluff-wordmark.svg?raw";
import "./fluff-theme.css";
import {
  FLUFF_SOUNDS,
  MODE_LABELS,
  PROJECT_MODES,
  projectModeSchema,
} from "./mode";
import type { ProjectMode } from "./mode";
import {
  VISUALIZER_PALETTES,
  defaultPaletteId,
  isVisualizerPaletteId,
  palettesForMode,
} from "./visualizer-palettes";
import type { VisualizerPaletteId } from "./visualizer-palettes";
import { BeatCanvas } from "./beat-canvas";
import { installGestures } from "./gestures";
import { installStudioNavigation } from "./studio-navigation";
import { installInstrumentCollapse } from "./instrument-collapse";
import { playOpeningAnimation } from "./opening-animation";
import { createPlaybackRecovery } from "./playback-recovery";
import { TrackMixer, mixerTrack } from "./track-mixer";
import { AutomationRecorder } from "./automation-recorder";
import type { RecordingLane } from "./automation-recorder";
import { ARP_SOUNDS, normalizedArpValue } from "./arp-model";
import { PAD_SOUNDS, normalizedPadValue } from "./pad-model";
import { MotionControls } from "./motion-controls";
import { PatternControls } from "./pattern-controls";
import type { PatternViewport } from "./pattern-controls";
import {
  sequenceTimingSchema,
  automationTiming,
  automationPosition,
  trackStepCount,
  PPQ,
  ticksPerStep,
  unswungTick,
} from "./timing";
import type { ArpParameter } from "./arp-model";
import type { PadParameter } from "./pad-model";
import { NoteMatrix } from "./note-matrix";
import type { MatrixChange, MatrixParameter } from "./note-matrix";
import {
  PRESETS,
  createPreset,
  defaultPresetId,
  findPresetByName,
  presetsForMode,
} from "./presets";
import "./style.css";

type PerformanceParameter = "sweep" | "space" | "echo";
const PERFORMANCE_CONTROLS: ReadonlyArray<{
  id: string;
  parameter: PerformanceParameter;
  label: string;
  name: string;
}> = [
  { id: "fx-sweep", parameter: "sweep", label: "Sweep", name: "Sweep filter" },
  { id: "fx-space", parameter: "space", label: "Space", name: "Space effect" },
  { id: "fx-echo", parameter: "echo", label: "Dub echo", name: "Dub echo" },
];
function formatPerformance(
  parameter: PerformanceParameter,
  value: number,
): string {
  if (Math.abs(value) < 0.005) return "Off";
  const labels = MODE_LABELS[project.mode];
  const mode =
    parameter === "sweep"
      ? value < 0
        ? "LP"
        : "HP"
      : parameter === "space"
        ? value < 0
          ? labels.spaceLeft
          : labels.spaceRight
        : value < 0
          ? labels.echoLeft
          : labels.echoRight;
  return `${mode} ${Math.round(Math.abs(value) * 100)}%`;
}

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
type MatrixSnapshot = { steps: BassStep[] };
const automationUndo: Record<
  NoteTrack,
  { id: string; values: number[] | null } | null
> = { bass: null, keys: null };
const selectedAutomation: Record<NoteTrack, string | null> = {
  bass: "cutoff",
  keys: "keys-tone",
};
const notePagers: Partial<Record<NoteTrack, PatternControls>> = {};
const automationPagers: Partial<Record<NoteTrack, PatternControls>> = {};
const automationMatrices: Partial<Record<NoteTrack, NoteMatrix>> = {};
const automationContexts: Record<NoteTrack, BassStep[]> = {
  bass: [],
  keys: [],
};
let drumViewport: PatternViewport = { start: 0, count: 16 };
const automationSweeps = new Map<string, { base: number; values: number[] }>();
const storageKeys: Record<ProjectMode, string> = {
  grain: "acid-303-project-v1",
  fluff: "fluff-project-v1",
};
const modeStorageKey = "grain-mode-v1";
const paletteStorageKeys: Record<ProjectMode, string> = {
  grain: "grain-visualizer-palette-v1",
  fluff: "fluff-visualizer-palette-v1",
};
let importedHash: string | null = null;
let sessionClient: SessionClient | null = null;
let playbackRecovery: ReturnType<typeof createPlaybackRecovery> | null = null;
let sessionStatus: SessionStatus = {
  phase: "idle",
  role: null,
  participants: 0,
  hostConnected: false,
  supportsVocal: false,
  supportsVocalMusic: false,
  supportsCloud: false,
  supportsTension: false,
  supportsComposition: false,
  supportsVocalGain: false,
  inviteLink: null,
  message: "",
};
let remotePlaying = false;
let deferredSessionRefresh = false;
let storageAvailable = true;
/** Each mode keeps its own saved project, so switching never overwrites the other. */
function storedProject(mode: ProjectMode): Project {
  try {
    const stored = localStorage.getItem(storageKeys[mode]);
    if (stored) {
      const parsed = readProject(JSON.parse(stored));
      if (parsed) return { ...parsed, mode };
    }
  } catch {
    storageAvailable = false;
  }
  return createPreset(defaultPresetId(mode));
}
function storedMode(): ProjectMode {
  try {
    const parsed = projectModeSchema.safeParse(
      localStorage.getItem(modeStorageKey),
    );
    if (parsed.success) return parsed.data;
  } catch {
    storageAvailable = false;
  }
  return "grain";
}
function saveProject(): void {
  localStorage.setItem(storageKeys[project.mode], JSON.stringify(project));
  localStorage.setItem(modeStorageKey, project.mode);
}
let project: Project = storedProject(storedMode());
/** Local monitoring state; never saved, shared or part of Undo. */
let soloed = new Set<InstrumentId>();
function audible(): Project {
  return audibleProject(project, soloed);
}
function syncSolo(): void {
  document
    .querySelectorAll<HTMLElement>("[data-solo]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String([...soloed].some((id) => id === button.dataset.solo)),
      ),
    );
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
      if (!historyPointers.size && deferredSessionRefresh)
        queueMicrotask(refreshSessionProject);
    },
    true,
  );
window.addEventListener("blur", () => {
  historyPointers.clear();
  cancelMaterialPerformance();
  if (deferredSessionRefresh) queueMicrotask(refreshSessionProject);
});
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
let playbackRequest = 0;
let pendingDrum: DrumId | null = null;
let lastPaintPreview = 0;
let motion = true;
function storedPalette(mode: ProjectMode): VisualizerPaletteId {
  try {
    const saved = localStorage.getItem(paletteStorageKeys[mode]);
    if (
      isVisualizerPaletteId(saved) &&
      palettesForMode(mode).some((palette) => palette.id === saved)
    )
      return saved;
  } catch {
    // Visual preferences remain usable when browser storage is unavailable.
  }
  return defaultPaletteId(mode);
}
let visualizerPalette: VisualizerPaletteId = storedPalette(project.mode);
let appliedMode: ProjectMode | null = null;
let visualizerSwirl = 0;
try {
  const savedSwirl = Number(localStorage.getItem("grain-visualizer-swirl-v1"));
  if (Number.isFinite(savedSwirl))
    visualizerSwirl = Math.max(0, Math.min(100, savedSwirl));
} catch {
  // Visual preferences remain usable when browser storage is unavailable.
}
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
  <header class="app-header"><div class="mode-switch" role="group" aria-label="Studio mode">${PROJECT_MODES.map((mode) => `<button data-project-mode="${mode.id}" aria-pressed="${mode.id === project.mode}">${mode.label}</button>`).join("")}</div><div class="brand" aria-label="Grain"><span class="brand-wordmark"></span></div></header>
  <div class="motion-options" id="phone-motion-options" hidden><span>Hold a knob</span><div role="group" aria-label="Phone motion axis"><button data-phone-mode="tilt" aria-pressed="true">Tilt</button><button data-phone-mode="move" aria-pressed="false">Move</button><button data-phone-mode="twist" aria-pressed="false">Twist</button></div><span id="phone-motion-help">Tilt forwards / back or sideways</span></div>
  <main class="workspace">
    <section class="transport panel" aria-label="Playback controls">
      <div class="performance-row"><div class="playback"><button class="play-button" id="play" aria-label="Play pattern">${icon("play")}<span>Play</span></button><button class="icon-button record-button" id="record-automation" aria-label="Record automation on this device" aria-pressed="false" title="Record instrument knob movements on this device"><span class="record-dot" aria-hidden="true"></span><span>REC</span></button><button class="icon-button restart" id="restart" aria-label="Restart pattern" title="Restart pattern">${icon("rotate-ccw")}</button></div>
      <div class="jam-controls">${PERFORMANCE_CONTROLS.map((control) => slider(control.id, control.label, -100, 100, project.fx[control.parameter] * 100, formatPerformance(control.parameter, project.fx[control.parameter]), "1", control.name, undefined, 0)).join("")}</div>
      <div class="performance-tools"><button id="studio-tools" class="icon-button" aria-label="Track controls" aria-expanded="false" aria-controls="studio-tools-panel">${icon("sliders-horizontal")}</button><span id="bar-position">Beat 1</span></div></div>
      <div id="studio-tools-panel" class="studio-tools" hidden><div class="mix-controls">${slider("bpm", "Tempo", 60, 180, project.bpm, `${project.bpm}`, "1")}${slider("swing", "Swing", 0, 50, project.swing * 100, `${Math.round(project.swing * 100)}%`)}${slider("drive", "Crunch", 0, 100, project.drive * 100, `${Math.round(project.drive * 100)}%`)}${slider("volume", "Volume", 0, 100, project.volume * 100, `${Math.round(project.volume * 100)}%`)}</div>
    <section class="scale-panel panel" aria-label="Musical scale"><div class="scale-row"><span>ROOT</span><div class="scale-roots" role="group" aria-label="Root note">${Array.from({ length: 12 }, (_, root) => `<button data-root="${root}" aria-label="Root ${noteName(root + 60).slice(0, -1)}" aria-pressed="${project.scale.root === root}">${noteName(root + 60).slice(0, -1)}</button>`).join("")}</div></div><div class="scale-row"><span>SCALE</span><div class="scale-modes" role="group" aria-label="Scale type">${SCALE_MODES.map((scale) => `<button data-scale="${scale.id}" aria-pressed="${project.scale.mode === scale.id}">${scale.name}</button>`).join("")}</div></div></section>
<div class="header-actions"><span id="save-state" class="save-state"><span class="status-dot"></span>${storageAvailable ? "Saved in this browser" : "Browser storage unavailable"}</span><button class="button secondary" id="global-undo" aria-label="Undo last edit" disabled>Undo</button><button class="button secondary" id="global-redo" aria-label="Redo last edit" disabled>Redo</button><button class="button secondary" id="share-track">Share</button><button class="button secondary" id="session-toggle" aria-expanded="false" aria-controls="session-panel">Session</button><button class="button secondary" id="phone-motion" aria-label="Enable phone motion control" aria-pressed="false" title="Hold a knob and tilt or move your phone">Motion</button><button class="button secondary" id="export">${icon("download")}<span>Export WAV</span></button></div><section id="session-panel" hidden></section></div>
      <p id="playback-recovery-status" class="playback-recovery-status" role="status" hidden>Tap to resume audio</p>
      <div id="track-mixer"></div>
  <div class="share-panel" id="share-panel" hidden><label for="share-url">Track link</label><input id="share-url" readonly><button id="copy-share">Copy</button><button id="close-share" aria-label="Close share link">×</button></div>
    </section>
    <section id="progression-controls" class="project-progression" aria-label="Shared chords"></section>
    <section class="preset-section panel" aria-label="Examples">
        <div class="preset-bar"><div class="preset-navigation"><button class="preset-scroll" data-example-scroll="-1" aria-label="Scroll examples left">‹</button><div class="preset-options" role="group" aria-label="Genre examples"></div><button class="preset-scroll" data-example-scroll="1" aria-label="Scroll examples right">›</button></div><div class="preset-actions"><button id="remix" class="remix-button">${icon("shuffle")} Remix</button><button id="undo-remix" class="text-button undo-remix" disabled>Undo</button></div></div>
    </section>
    <div class="studio-grid"><div class="sequencers">
      <section id="drums-panel" class="panel drums-panel" aria-labelledby="drums-title">
        <div class="section-header"><div class="section-title"><span class="section-number">01</span><h1 id="drums-title">Drum sequencer</h1></div><button id="reset" class="text-button" title="Restore the selected preset">${icon("rotate-ccw")} Reset</button></div>
        <div id="drum-editors"></div>
        <details class="instrument-section instrument-sequence" id="drum-simple-sequence" open><summary>Sequence</summary><div id="drum-simple-pattern"></div><div class="beat-surface"><canvas id="beat-canvas" aria-label="Paint drum beats" aria-describedby="paint-help"></canvas><div id="drum-grid" class="beat-keyboard" role="grid" aria-label="Drum steps"></div></div>
        <div class="section-footer"><span><span class="legend-pad"></span><span id="paint-help">Drag to paint · Drag a filled step to erase</span></span><span>Drag controls up / down</span></div></details>
      </section>
      <section id="bass-panel" class="panel bass-panel" aria-labelledby="bass-title">
        <div class="section-header"><div class="section-title"><span class="section-number">02</span><h2 id="bass-title">Acid bass</h2><span class="small-tag">303</span></div><div class="bass-actions"><button id="bass-mute" class="mute-button" aria-label="Mute acid bass" aria-pressed="${project.bass.muted}">M</button><button class="mute-button solo-button" data-solo="bass" aria-label="Solo acid bass" aria-pressed="false">S</button><button id="generate" class="text-button">${icon("shuffle")} Generate</button></div></div>
        <div class="bass-meta"><div class="waveform-switch bass-sounds" role="group" aria-label="Bass sound">${BASS_SOUNDS.map((sound, index) => `<button data-bass-sound="${index}">${sound}</button>`).join("")}</div></div>
        <div class="acid-controls">${slider("cutoff", "Cutoff", 0, 100, Math.round((Math.log(project.bass.cutoff / 80) / Math.log(100)) * 100), formatFrequency(project.bass.cutoff))}${slider("resonance", "Resonance", 0, 22, project.bass.resonance, `${Math.round((project.bass.resonance / 22) * 100)}%`, "0.1")}${slider("envelope", "Envelope", 0, 100, project.bass.envelope * 100, `${Math.round(project.bass.envelope * 100)}%`)}${slider("bass-decay", "Decay", 50, 1500, project.bass.decay * 1000, `${Math.round(project.bass.decay * 1000)} ms`, "10")}${slider("bass-volume", "Level", 0, 100, project.bass.volume * 100, `${Math.round(project.bass.volume * 100)}%`)}${slider("bass-shape", "Shape", 0, 100, project.bass.shape * 100, `${Math.round(project.bass.shape * 100)}%`)}${slider("bass-drive", "Drive", 0, 100, project.bass.drive * 100, `${Math.round(project.bass.drive * 100)}%`)}${slider("bass-pulse", "Pulse", 0, 100, project.bass.pulse * 100, `${Math.round(project.bass.pulse * 100)}%`)}</div>${matrixMarkup("bass", "Bass")}
      </section>
      <section id="keys-panel" class="panel bass-panel keys-panel" aria-labelledby="keys-title">
        <div class="section-header"><div class="section-title"><span class="section-number">03</span><h2 id="keys-title">Texture</h2></div><div class="bass-actions"><button id="keys-mute" class="mute-button" aria-label="Mute Texture" aria-pressed="${project.keys.muted}">M</button><button class="mute-button solo-button" data-solo="keys" aria-label="Solo Texture" aria-pressed="false">S</button><button id="keys-generate" class="text-button">${icon("shuffle")} New pattern</button></div></div>
        <div class="bass-meta"><div class="waveform-switch keys-sounds" role="group" aria-label="Texture sound">${KEYS_SOUNDS.map((sound, index) => `<button data-key-sound="${index}">${sound}</button>`).join("")}</div></div>
        <div class="acid-controls">${slider("keys-tone", "Tone", 0, 100, project.keys.tone * 100, `${Math.round(project.keys.tone * 100)}%`)}${slider("keys-decay", "Decay", 80, 2000, project.keys.decay * 1000, `${Math.round(project.keys.decay * 1000)} ms`, "10")}${slider("keys-space", "Space", 0, 100, project.keys.space * 100, `${Math.round(project.keys.space * 100)}%`)}${slider("keys-volume", "Level", 0, 100, project.keys.volume * 100, `${Math.round(project.keys.volume * 100)}%`)}${slider("keys-grit", "Grit", 0, 100, project.keys.grit * 100, `${Math.round(project.keys.grit * 100)}%`)}${slider("keys-motion", "Motion", 0, 100, project.keys.motion * 100, `${Math.round(project.keys.motion * 100)}%`)}${slider("keys-width", "Width", 0, 100, project.keys.width * 100, `${Math.round(project.keys.width * 100)}%`)}${slider("keys-attack", "Attack", 0, 100, project.keys.attack * 100, `${Math.round(project.keys.attack * 100)}%`)}</div>
        ${matrixMarkup("keys", "Texture")}
      </section>
      <section id="arp-panel" class="panel bass-panel arp-panel" aria-labelledby="arp-title"></section>
      <section id="pad-panel" class="panel bass-panel pad-panel" aria-labelledby="pad-title"></section>
      <section id="vocal-panel" class="panel bass-panel vocal-panel" aria-labelledby="vocal-title"></section>
      <section id="cloud-panel" class="panel bass-panel" aria-labelledby="cloud-title"></section>
      <section id="tension-panel" class="panel bass-panel" aria-labelledby="tension-title"></section>
    </div>
</div>
    <footer class="app-footer"><span><kbd>SPACE</kbd> Play / stop</span><span>Per-instrument timing</span><span id="project-name"></span></footer>
  </main><nav class="instrument-nav" aria-label="Instruments"><button data-instrument-jump="drums-panel">Drums</button><button data-instrument-jump="bass-panel">Bass</button><button data-instrument-jump="keys-panel">Texture</button><button data-instrument-jump="arp-panel">Arp</button><button data-instrument-jump="pad-panel">Pads</button><button data-instrument-jump="vocal-panel">Vocals</button><button data-instrument-jump="cloud-panel">Cloud</button><button data-instrument-jump="tension-panel">Tension</button><button id="studio-view" aria-expanded="false" aria-controls="visualizer-toolbar">View</button></nav><div id="visualizer-toolbar" class="visualizer-toolbar" role="region" aria-label="Visualizer controls"><div class="visualizer-top"><span class="visualizer-label">${icon("waves")} VISUALIZER</span><span class="audio-status" id="audio-status">AUDIO IDLE</span></div><div class="visualizer-bottom"><div class="visualizer-controls"><button id="visualizer-colour" class="visualizer-button palette-toggle" aria-expanded="false" aria-controls="visualizer-palettes"><span class="palette-current" aria-hidden="true"></span>Colour</button>${slider("intensity", "Intensity", 0, 100, 30, "30%")}${slider("swirl", "Swirl", 0, 100, visualizerSwirl, `${visualizerSwirl}%`, "1", "Visualizer swirl", undefined, 0)}<button id="motion" class="visualizer-button" aria-label="${motion ? "Pause" : "Enable"} visualizer motion" aria-pressed="${motion}">${icon(motion ? "pause" : "play")}</button><button id="fullscreen" class="visualizer-button" aria-label="Fullscreen visualizer">${icon("maximize-2")}</button></div></div><div id="visualizer-palettes" class="visualizer-palettes" role="group" aria-label="Visualizer colour" hidden></div></div>
<div id="toast" role="status" class="toast" hidden></div>`;

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
  resetValue = value,
): string {
  const automation = automationControls.find((control) => control.id === id);
  const name =
    ariaLabel ||
    (id === "bpm"
      ? "Tempo in BPM"
      : ["swing", "drive", "volume", "intensity"].includes(id)
        ? id === "drive"
          ? MODE_LABELS[project.mode].driveName
          : id === "volume"
            ? "Master volume"
            : id === "intensity"
              ? "Visualizer intensity"
              : "Swing"
        : `${id.startsWith("keys-") ? "Texture" : "Bass"} ${label.toLowerCase()}`);
  return `<div class="dial-control"><span class="dial-label">${label}</span><div class="gesture-control" id="${id}" role="slider" tabindex="0" title="${automation ? "Click or Enter to draw automation · Drag to adjust" : "Drag up/down · Shift for fine control · Double-tap to reset"}" ${automation ? `data-automation-control="${id}" aria-controls="${automation.target.track === "drums" ? `${automation.target.id}-matrix-canvas` : `${automation.target.track}-automation-canvas`}"` : ""} aria-label="${name}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-valuetext="${display}" aria-orientation="vertical" data-step="${step}" ${id.startsWith("fx-") ? 'data-drag-axis="both"' : ""} ${allowedValues ? `data-values="${allowedValues.join(",")}"` : ""} data-reset="${resetValue}" style="--knob-angle:${-135 + ((value - min) / (max - min)) * 270}deg"><span class="knob-face" aria-hidden="true"><span></span><span class="automation-live"></span></span><output id="${id}-value">${display}</output></div></div>`;
}
function formatFrequency(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toFixed(1)} kHz`
    : `${Math.round(value)} Hz`;
}
function refreshIcons(): void {
  createIcons({
    icons: {
      Play,
      Square,
      RotateCcw,
      Download,
      Waves,
      Maximize2,
      Minimize2,
      Pause,
      Shuffle,
      SlidersHorizontal,
    },
    attrs: { "stroke-width": 1.7 },
  });
}
function renderInstrumentControls(): void {
  drumEditor.render();
  applySoundLabels();
}
function renderDrumGrid(): void {
  const grid = document.querySelector("#drum-grid");
  if (!(grid instanceof HTMLElement)) return;
  grid.style.gridTemplateColumns = `repeat(${drumViewport.count}, minmax(0, 1fr))`;
  grid.innerHTML = project.drums
    .map((track, trackIndex) =>
      Array.from({ length: drumViewport.count }, (_, column) => {
        const step = (drumViewport.start + column) % track.steps.length;
        const on = track.steps[step];
        return `<button class="step-pad ${on ? "on" : ""}" role="gridcell" tabindex="${trackIndex === 0 && column === 0 ? 0 : -1}" data-drum-step="${track.id}" data-step="${step}" data-grid-index="${trackIndex * drumViewport.count + column}" aria-label="${DRUM_META[track.id].name} step ${step + 1}" aria-pressed="${on}">${on ? "On" : "Off"}</button>`;
      }).join(""),
    )
    .join("");
  beatCanvas.update(project);
  beatCanvas.setSelectedDrum(selectedDrum);
}
function renderDrums(): void {
  renderInstrumentControls();
  renderDrumGrid();
}
type NoteTrack = "bass" | "keys";
function matrixMarkup(track: NoteTrack, label: string): string {
  return `<details class="instrument-section instrument-sequence" open><summary>Sequence</summary><div id="${track}-pattern"></div><div class="matrix-toolbar"><div class="matrix-parameters" role="group" aria-label="${label} matrix parameter">${[
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
    )}</div><div class="matrix-tools" role="group" aria-label="${label} drawing tool"><button data-matrix-track="${track}" data-matrix-tool="draw" aria-pressed="true">Draw</button><button data-matrix-track="${track}" data-matrix-tool="line" aria-pressed="false">Line</button><button data-matrix-undo="${track}" aria-label="Undo ${label} drawing" disabled>Undo</button></div></div><div class="note-matrix" id="${track}-matrix"><canvas id="${track}-matrix-canvas" aria-label="Draw ${label} pitch" aria-describedby="${track}-matrix-help"></canvas><div class="matrix-access" id="${track}-matrix-access"></div></div><div class="matrix-legend" aria-hidden="true"><span class="motif-pitch">━ Pitch</span><span class="motif-gate">▌ Gate</span><span class="motif-accent">◆ Accent</span><span class="motif-glide">⌒ Glide</span></div><div class="section-footer note-help" id="${track}-matrix-help"><span>Draw pitch in scale · Tap a note to remove · Drag from a note to tie or glide</span><span>↑↓ Edit · ←→ Step · Enter Gate · Shift+→ Join</span></div></details>
  <details class="instrument-section instrument-automation-section" id="${track}-automation-section"><summary>Automation</summary><div id="${track}-automation-pattern"></div><div class="automation-strip" id="${track}-automation"><span id="${track}-automation-label"></span><div class="automation-view" role="group" aria-label="${label} automation view"><button data-matrix-track="${track}" data-matrix-automation-view="page" aria-pressed="true">Page</button><button data-matrix-track="${track}" data-matrix-automation-view="loop" aria-pressed="false">Whole loop</button></div><div class="matrix-tools" role="group" aria-label="${label} automation drawing tool"><button data-matrix-track="${track}" data-note-automation-tool="draw" aria-pressed="true">Draw</button><button data-matrix-track="${track}" data-note-automation-tool="line" aria-pressed="false">Line</button><button data-note-automation-undo="${track}" aria-label="Undo ${label} automation" disabled>Undo</button><button data-automation-clear="${track}" aria-label="Clear ${label} automation">Clear curve</button></div></div><div class="note-matrix"><canvas id="${track}-automation-canvas" aria-label="Draw ${label} automation"></canvas><div class="matrix-access" id="${track}-automation-access"></div></div></details>`;
}
function automationValues(
  target: AutomationTarget,
  source = project,
): number[] | null {
  if (target.track === "drums")
    return (
      source.drums.find((track) => track.id === target.id)?.automation[
        target.parameter
      ] ?? null
    );
  return target.track === "bass"
    ? source.bass.automation[target.parameter]
    : source.keys.automation[target.parameter];
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
  const matrix = automationMatrices[track];
  if (!selected || !matrix) return;
  const timing = automationTiming(project[track]);
  const steps = automationContexts[track];
  steps.length = trackStepCount(timing);
  for (let index = 0; index < steps.length; index++) {
    const source = project[track].steps[index % project[track].steps.length];
    if (!source) continue;
    const target = steps[index];
    if (target) Object.assign(target, source);
    else steps[index] = { ...source };
  }
  matrix.update(steps, project.scale, project[track].muted);
  matrix.setAutomationView(matrix.automationView, timing.bars);
  const values = automationValues(selected.target);
  matrix.setAutomation({
    id: selected.id,
    label: selected.label,
    values,
    base: automationBase(selected.target),
    format: (value) => automationDisplay(selected.id, value),
  });
  automationPagers[track]?.update(
    timing,
    project[track].automationBars === null,
  );
  for (const button of document.querySelectorAll<HTMLElement>(
    `[data-matrix-track="${track}"][data-matrix-automation-view]`,
  ))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.matrixAutomationView === matrix.automationView),
    );
  const label = document.getElementById(`${track}-automation-label`);
  if (label) label.textContent = `${selected.label} automation`;
  const clear = document.querySelector(`[data-automation-clear="${track}"]`);
  if (clear instanceof HTMLButtonElement) clear.disabled = values === null;
  const undo = document.querySelector(`[data-note-automation-undo="${track}"]`);
  if (undo instanceof HTMLButtonElement)
    undo.disabled = automationUndo[track] === null;
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
  const section = document.getElementById(`${track}-automation-section`);
  if (section instanceof HTMLDetailsElement) section.open = true;
  refreshAutomation(track);
}
function selectMatrixParameter(
  track: NoteTrack,
  parameter: MatrixParameter,
): void {
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
        ? "Draw pitch in scale · Tap a note to remove · Drag from a note to tie or glide · Tap a knob to automate"
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
    if (!change.automation)
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
      change.index >= trackStepCount(automationTiming(project[track])) ||
      !Number.isFinite(change.value)
    )
      return;
    const lane =
      automationValues(control.target) ??
      Array.from(
        { length: trackStepCount(automationTiming(project[track])) },
        () => automationBase(control.target),
      );
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
      const next =
        project[track].steps[(change.index + 1) % project[track].steps.length];
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
  matrixUndo[track] = { steps: structuredClone(project[track].steps) };
  const button = document.querySelector(`[data-matrix-undo="${track}"]`);
  if (button instanceof HTMLButtonElement) button.disabled = false;
}
function saveAutomationUndo(track: NoteTrack): void {
  const control = automationControls.find(
    (entry) => entry.id === selectedAutomation[track],
  );
  if (!control) return;
  const values = automationValues(control.target);
  automationUndo[track] = {
    id: control.id,
    values: values ? [...values] : null,
  };
}
function clearMatrixUndo(track?: NoteTrack): void {
  const tracks: NoteTrack[] = track ? [track] : ["bass", "keys"];
  for (const target of tracks) {
    matrixUndo[target] = null;
    automationUndo[target] = null;
    const automationButton = document.querySelector(
      `[data-note-automation-undo="${target}"]`,
    );
    if (automationButton instanceof HTMLButtonElement)
      automationButton.disabled = true;
    const button = document.querySelector(`[data-matrix-undo="${target}"]`);
    if (button instanceof HTMLButtonElement) button.disabled = true;
  }
}
function refreshScaleControls(): void {
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
  if (sessionStatus.role === "guest") return;
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
  notePagers.bass?.update(project.bass.timing);
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
  notePagers.keys?.update(project.keys.timing);
  refreshAutomation("keys");
}
async function previewKeys(note: number): Promise<void> {
  if (sessionStatus.role === "guest") return;
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
/** Grain examples keep the chosen key; Fluff examples are written for their own. */
function loadPreset(id: string): Project {
  const preset = createPreset(id);
  return preset.mode === "fluff" ? preset : withScale(preset, project.scale);
}
function updatePresetLabels(): void {
  const selected = findPresetByName(project.name, project.mode);
  document
    .querySelectorAll<HTMLButtonElement>("[data-preset]")
    .forEach((button) => {
      const active = button.dataset.preset === selected?.id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  const label = document.querySelector("#project-name");
  if (label) label.textContent = selected?.name ?? project.name;
}
function setText(selector: string, text: string): void {
  document.querySelectorAll(selector).forEach((element) => {
    if (element.textContent !== text) element.textContent = text;
  });
}
function setDialLabel(id: string, label: string, name: string): void {
  const control = document.getElementById(id);
  control?.setAttribute("aria-label", name);
  const text = control?.closest(".dial-control")?.querySelector(".dial-label");
  if (text) text.textContent = label;
}
/** Sound slots are shared by both modes; only their names and voices differ. */
function applySoundLabels(): void {
  const fluff = project.mode === "fluff";
  const names = (
    selector: string,
    attribute: string,
    sounds: readonly string[],
  ): void => {
    document.querySelectorAll<HTMLElement>(selector).forEach((button) => {
      const name = sounds[Number(button.dataset[attribute])];
      if (name !== undefined && button.textContent !== name)
        button.textContent = name;
    });
  };
  names(
    "[data-bass-sound]",
    "bassSound",
    fluff ? FLUFF_SOUNDS.bass : BASS_SOUNDS,
  );
  names(
    "[data-key-sound]",
    "keySound",
    fluff ? FLUFF_SOUNDS.keys : KEYS_SOUNDS,
  );
  names("[data-arp-sound]", "arpSound", fluff ? FLUFF_SOUNDS.arp : ARP_SOUNDS);
  names("[data-pad-sound]", "padSound", fluff ? FLUFF_SOUNDS.pad : PAD_SOUNDS);
  for (const id of drumIdSchema.options)
    names(
      `[data-sound][data-sound-track="${id}"]`,
      "sound",
      fluff ? FLUFF_SOUNDS[id] : DRUM_META[id].sounds,
    );
  const labels = MODE_LABELS[project.mode];
  setText('[data-drum="rim"]', labels.rim);
  setText('.drum-detail[aria-label="Rimshot editor"] h3', labels.rim);
}
function applyMode(): void {
  applySoundLabels();
  if (appliedMode === project.mode) return;
  const mode = project.mode;
  const first = appliedMode === null;
  appliedMode = mode;
  const labels = MODE_LABELS[mode];
  document.documentElement.dataset.mode = mode;
  document.title = labels.title;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", labels.themeColor);
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", labels.description);
  const brand = document.querySelector(".brand");
  brand?.setAttribute("aria-label", mode === "fluff" ? "Fluff" : "Grain");
  const wordmark = document.querySelector(".brand-wordmark");
  if (wordmark)
    wordmark.innerHTML = mode === "fluff" ? fluffWordmark : grainWordmark;
  document
    .querySelectorAll<HTMLButtonElement>("[data-project-mode]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.projectMode === mode),
      ),
    );
  const presets = document.querySelector(".preset-options");
  if (presets)
    presets.innerHTML = presetsForMode(mode)
      .map(
        (preset) =>
          `<button data-preset="${preset.id}" aria-label="${preset.name} — ${preset.genre}"><strong>${preset.name}</strong><span>${preset.genre}</span></button>`,
      )
      .join("");
  const palettes = document.getElementById("visualizer-palettes");
  if (palettes)
    palettes.innerHTML = palettesForMode(mode)
      .map(
        (palette) =>
          `<button data-visualizer-palette="${palette.id}"><span class="palette-swatch" style="background:${palette.swatch}" aria-hidden="true"></span><span>${palette.label}</span></button>`,
      )
      .join("");
  setText("#bass-title", labels.bass);
  setText("#keys-title", labels.keys);
  setText('[data-instrument-jump="keys-panel"]', labels.keys);
  setText(".mixer-channel:has(#mixer-keys) > span", labels.keys);
  setText(".mixer-channel:has(#mixer-rim) > span", labels.rim);
  setDialLabel("drive", labels.drive, labels.driveName);
  setDialLabel("fx-echo", labels.echo, labels.echoName);
  if (!first) visualizerPalette = storedPalette(mode);
  visualizer.setMode(mode);
  visualizer.setPalette(visualizerPalette);
  updateVisualizerPalette();
}
/** Park the current project in its own slot, then open the other mode's project. */
function switchMode(mode: ProjectMode): void {
  if (mode === project.mode || sessionEditingBlocked()) return;
  playbackRecovery?.cancel();
  playbackRequest++;
  starting = false;
  engine.stop();
  try {
    saveProject();
  } catch {
    storageAvailable = false;
  }
  clearRemixUndo();
  project = storedProject(mode);
  refreshProject();
  persist();
  updatePlayback();
}
function refreshProject(cancelPerformance = true): void {
  if (cancelPerformance) cancelMaterialPerformance();
  mixer.update(project);
  automationSweeps.clear();
  arpPanel.render();
  padPanel.render();
  progressionPanel.render();
  vocalPanel.render();
  cloudPanel.render();
  tensionPanel.render();
  updateBarPosition();
  renderDrums();
  renderBass();
  renderKeys();
  syncSolo();
  applyMode();
  updatePresetLabels();
  refreshScaleControls();
  clearMatrixUndo();
  for (const control of PERFORMANCE_CONTROLS) {
    setInput(control.id, project.fx[control.parameter] * 100);
    setOutput(
      control.id,
      formatPerformance(control.parameter, project.fx[control.parameter]),
    );
  }
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
let currentAbsoluteTick = -1;
const arpParameters: ArpParameter[] = [
  "gate",
  "decay",
  "tone",
  "resonance",
  "shape",
  "space",
  "width",
  "volume",
];
const padParameters: PadParameter[] = [
  "attack",
  "release",
  "tone",
  "motion",
  "spread",
  "space",
  "shape",
  "volume",
];
const vocalParameters: VocalParameter[] = [
  "gain",
  "start",
  "end",
  "attack",
  "release",
  "tone",
  "drive",
  "space",
  "volume",
];
const cloudParameters: CloudParameter[] = [
  "scan",
  "size",
  "density",
  "scatter",
  "roughness",
  "tone",
  "width",
  "volume",
];
const tensionParameters: TensionParameter[] = [
  "tension",
  "pick",
  "decay",
  "damping",
  "coupling",
  "drive",
  "width",
  "volume",
];
function recordingLane(id: string): RecordingLane | null {
  const control = automationControls.find((control) => control.id === id);
  if (control) {
    const target = control.target;
    const track =
      target.track === "drums"
        ? project.drums.find((drum) => drum.id === target.id)
        : project[target.track];
    if (!track) return null;
    return {
      timing: automationTiming(track),
      base: automationBase(target),
      values: automationValues(target),
      write: (values) => setAutomationValues(target, values),
    };
  }
  const arp = arpParameters.find((parameter) => `arp-${parameter}` === id);
  if (arp)
    return {
      timing: automationTiming(project.arp),
      base: normalizedArpValue(project.arp, arp),
      values: project.arp.automation[arp],
      write: (values) => {
        project.arp.automation[arp] = values;
      },
    };
  const pad = padParameters.find((parameter) => `pad-${parameter}` === id);
  if (pad)
    return {
      timing: automationTiming(project.pad),
      base: normalizedPadValue(project.pad, pad),
      values: project.pad.automation[pad],
      write: (values) => {
        project.pad.automation[pad] = values;
      },
    };
  const vocal = vocalParameters.find(
    (parameter) => `vocal-${parameter}` === id,
  );
  if (vocal)
    return {
      timing: automationTiming(project.vocal),
      base: normalizedVocalValue(project.vocal, vocal),
      values: project.vocal.automation[vocal],
      write: (values) => {
        project.vocal.automation[vocal] = values;
      },
    };
  const cloud = cloudParameters.find(
    (parameter) => `cloud-${parameter}` === id,
  );
  if (cloud)
    return {
      timing: automationTiming(project.cloud),
      base: project.cloud[cloud],
      values: project.cloud.automation[cloud],
      write: (values) => {
        project.cloud.automation[cloud] = values;
      },
    };
  const tension = tensionParameters.find(
    (parameter) => `tension-${parameter}` === id,
  );
  if (tension)
    return {
      timing: automationTiming(project.tension),
      base: project.tension[tension],
      values: project.tension.automation[tension],
      write: (values) => {
        project.tension.automation[tension] = values;
      },
    };
  return null;
}
const automationRecorder = new AutomationRecorder(recordingLane);
const recordedControls = new Set<string>();
function armRecording(armed: boolean): void {
  cancelMaterialPerformance();
  automationRecorder.arm(armed);
  const button = document.getElementById("record-automation");
  button?.setAttribute("aria-pressed", String(armed));
  if (button)
    button.title = armed
      ? "Armed on this device · Play and move instrument knobs"
      : "Record instrument knob movements on this device";
  for (const id of recordedControls) restoreRecordedControl(id);
}

function recordingDisplay(id: string, value: number): string {
  if (id === "vocal-gain")
    return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
  if (id === "cloud-size")
    return `${Math.round(cloudGrainSeconds(value / 100) * 1000)} ms`;
  if (id === "cloud-density")
    return `${cloudGrainsPerSecond(value / 100).toFixed(1)}/s`;
  if (id === "tension-decay")
    return `${tensionDecaySeconds(value / 100).toFixed(2)} s`;
  if (id === "cutoff") return formatFrequency(80 * 100 ** (value / 100));
  if (id === "resonance") return `${Math.round((value / 22) * 100)}%`;
  if (id.endsWith("-pitch"))
    return `${value > 0 ? "+" : ""}${Math.round(value)} st`;
  if (id.endsWith("-decay")) return `${Math.round(value)} ms`;
  return `${Math.round(value)}%`;
}
function restoreRecordedControl(id: string): void {
  if (!recordedControls.delete(id)) return;
  const lane = recordingLane(id);
  const control = document.getElementById(id);
  if (!lane || !control) {
    mixer.update(project);
    return;
  }
  const min = Number(control.getAttribute("aria-valuemin"));
  const max = Number(control.getAttribute("aria-valuemax"));
  const value = min + lane.base * (max - min);
  setInput(id, value);
  setOutput(id, recordingDisplay(id, value));
  mixer.update(project);
}
function commitRecording(ids: string[]): void {
  if (ids.some((id) => id.startsWith("arp-"))) arpPanel.refreshAutomation();
  if (ids.some((id) => id.startsWith("pad-"))) padPanel.refreshAutomation();
  if (ids.some((id) => id.startsWith("vocal-"))) vocalPanel.refreshAutomation();
  if (ids.some((id) => id.startsWith("cloud-"))) cloudPanel.refreshAutomation();
  if (ids.some((id) => id.startsWith("tension-")))
    tensionPanel.refreshAutomation();
  for (const control of automationControls) {
    if (!ids.includes(control.id)) continue;
    if (control.target.track === "drums") drumEditor.refresh(control.target.id);
    else refreshAutomation(control.target.track);
  }
  persist();
}
function captureAutomation(
  control: HTMLElement,
  id: string,
  value: number,
): boolean {
  const min = Number(control.getAttribute("aria-valuemin"));
  const max = Number(control.getAttribute("aria-valuemax"));
  if (
    sessionEditingBlocked() ||
    max <= min ||
    !automationRecorder.capture(id, (value - min) / (max - min))
  )
    return false;
  recordedControls.add(id);
  setOutput(id, recordingDisplay(id, value));
  commitRecording([id]);
  if (!control.classList.contains("dragging")) restoreRecordedControl(id);
  return true;
}
const lastDrumSteps = new Map<DrumId, number>();
function updateBarPosition(absoluteTick = currentAbsoluteTick): void {
  currentAbsoluteTick = absoluteTick;
  const plan = exportPlan(audible());
  const position = document.getElementById("bar-position");
  if (position)
    position.textContent = `Beat ${absoluteTick < 0 ? 1 : Math.floor(absoluteTick / PPQ) + 1}`;
  document
    .getElementById("export")
    ?.setAttribute(
      "title",
      `Export ${Math.round(plan.ticks / PPQ)} beats${plan.completeCycle ? "" : " (excerpt)"} and release tails`,
    );
}
function showAutomation(
  controlId: string,
  value: { value: number; automated: boolean },
  playing: boolean,
): void {
  const control = document.getElementById(controlId);
  if (!control) return;
  control.classList.toggle("automation-playing", playing && value.automated);
  control.style.setProperty(
    "--automation-angle",
    `${-135 + value.value * 270}deg`,
  );
  if (playing && value.automated)
    control.dataset.liveValue = String(value.value);
  else delete control.dataset.liveValue;
}
function updateAutomationIndicators(frame: PlaybackFrame): void {
  for (const control of automationControls) {
    const target = control.target;
    const resolved =
      target.track === "drums"
        ? resolvedAutomationValue(
            project,
            {
              instrument: "drum",
              drum: target.id,
              parameter: target.parameter,
            },
            frame.absoluteTick,
          )
        : target.track === "bass"
          ? resolvedAutomationValue(
              project,
              { instrument: "bass", parameter: target.parameter },
              frame.absoluteTick,
            )
          : resolvedAutomationValue(
              project,
              { instrument: "keys", parameter: target.parameter },
              frame.absoluteTick,
            );
    showAutomation(control.id, resolved, frame.playing);
  }
  for (const parameter of arpParameters)
    showAutomation(
      `arp-${parameter}`,
      resolvedAutomationValue(
        project,
        { instrument: "arp", parameter },
        frame.absoluteTick,
      ),
      frame.playing,
    );
  for (const parameter of padParameters)
    showAutomation(
      `pad-${parameter}`,
      resolvedAutomationValue(
        project,
        { instrument: "pad", parameter },
        frame.absoluteTick,
      ),
      frame.playing,
    );
  for (const parameter of vocalParameters)
    showAutomation(
      `vocal-${parameter}`,
      resolvedAutomationValue(
        project,
        { instrument: "vocal", parameter },
        frame.absoluteTick,
      ),
      frame.playing,
    );
  for (const parameter of cloudParameters)
    showAutomation(
      `cloud-${parameter}`,
      resolvedAutomationValue(
        project,
        { instrument: "cloud", parameter },
        frame.absoluteTick,
      ),
      frame.playing,
    );
  for (const parameter of tensionParameters)
    showAutomation(
      `tension-${parameter}`,
      resolvedAutomationValue(
        project,
        { instrument: "tension", parameter },
        frame.absoluteTick,
      ),
      frame.playing,
    );
}
function showFrame(frame: PlaybackFrame): void {
  if (materialPlaying && !frame.playing) cancelMaterialPerformance();
  materialPlaying = frame.playing;
  playbackRecovery?.frame();
  const recorded = automationRecorder.frame(
    frame.playing && !sessionEditingBlocked(),
    frame.absoluteTick,
    project.swing,
  );
  if (recorded.length) commitRecording(recorded);
  if (frame.playing && recordCloudGesture(frame.absoluteTick)) {
    cloudPanel.refreshAutomation();
    persist();
  }
  const positions = frame.positions;
  beatCanvas.setTrackSteps({
    kick: positions.kick?.index ?? -1,
    snare: positions.snare?.index ?? -1,
    hat: positions.hat?.index ?? -1,
    clap: positions.clap?.index ?? -1,
    rim: positions.rim?.index ?? -1,
  });
  matrices.bass.setStep(positions.bass?.index ?? -1);
  matrices.keys.setStep(positions.keys?.index ?? -1);
  const playingTick = frame.playing ? frame.absoluteTick : -1;
  for (const track of noteTracks) {
    automationMatrices[track]?.setStep(
      playingTick < 0
        ? -1
        : automationPosition(project[track], playingTick, project.swing).index,
    );
    automationPagers[track]?.setTick(playingTick, project.swing);
  }
  drumEditor.setTick(playingTick, project.swing);
  notePagers.bass?.setTick(playingTick, project.swing);
  notePagers.keys?.setTick(playingTick, project.swing);
  updateBarPosition(frame.absoluteTick);
  for (const drum of audible().drums) {
    const index = positions[drum.id]?.index;
    if (
      frame.playing &&
      index !== undefined &&
      lastDrumSteps.get(drum.id) !== index
    ) {
      visualizer.triggerStep([drum], index);
      lastDrumSteps.set(drum.id, index);
    }
  }
  if (!frame.playing) lastDrumSteps.clear();
  document
    .querySelectorAll<HTMLButtonElement>("[data-drum-step]")
    .forEach((button) => {
      const id = drumIdSchema.safeParse(button.dataset.drumStep);
      button.classList.toggle(
        "current",
        id.success && positions[id.data]?.index === Number(button.dataset.step),
      );
    });
  arpPanel.setPosition(playingTick, project.swing);
  padPanel.setPosition(playingTick, project.swing);
  progressionPanel.setPosition(playingTick, project.swing);
  vocalPanel.setPosition(playingTick, project.swing);
  cloudPanel.setPosition(playingTick, project.swing);
  tensionPanel.setPosition(playingTick, project.swing);
  updateAutomationIndicators(frame);
}
function showStep(step: number, absoluteStep: number): void {
  showFrame(playbackFrame(project, absoluteStep * 6, step >= 0));
}
const engine = new AudioEngine((_step, _absoluteStep, frame) => {
  showFrame(frame);
  sessionClient?.clock(frame.playing, frame.absoluteTick);
});
const canvas = document.querySelector("#fluid-canvas");
if (!(canvas instanceof HTMLCanvasElement))
  throw new Error("Visualizer canvas is missing.");
const visualizer = new FluidVisualizer(canvas);
visualizer.setMode(project.mode);
visualizer.setPalette(visualizerPalette);
visualizer.setSwirl(visualizerSwirl / 100);
updateVisualizerPalette();
engine.update(audible());
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
    document
      .querySelectorAll(`[data-drum-step="${id}"][data-step="${step}"]`)
      .forEach((cell) => {
        cell.setAttribute("aria-pressed", String(on));
        cell.classList.toggle("on", on);
        cell.textContent = on ? "On" : "Off";
      });
    persist();
  },
  (id) => {
    if (
      beatCanvas.busy ||
      document.querySelector(".gesture-control.dragging")
    ) {
      pendingDrum = id;
      return;
    }
    if (selectedDrum !== id) {
      selectedDrum = id;
      renderInstrumentControls();
    }
  },
  () => drumEditor.freezeFollow(),
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
  isBusy: () => beatCanvas.busy,
  isSoloed: (id) => soloed.has(id),
  beforeTimingChange: () => beatCanvas.cancelStroke(),
  onViewportChange: (viewport) => {
    drumViewport = viewport;
    beatCanvas.setViewport(viewport);
    renderDrumGrid();
  },
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
    () => {
      notePagers[track]?.freezeFollow();
      saveMatrixUndo(track);
    },
    false,
    true,
  );
}
const matrices = {
  bass: createMatrix("bass", "Bass", 24, 60),
  keys: createMatrix("keys", "Texture", 48, 84),
};
const noteTracks: NoteTrack[] = ["bass", "keys"];
for (const track of noteTracks) {
  const container = document.getElementById(`${track}-pattern`);
  if (!container) throw new Error("Pattern controls are missing.");
  notePagers[track] = new PatternControls(container, {
    label: track === "bass" ? "Bass" : "Texture",
    pageViews: true,
    pageBars: true,
    isBusy: () => matrices[track].busy,
    onViewportChange: (viewport) => matrices[track].setViewport(viewport),
    onTimingChange: (timing) => {
      const parsed = sequenceTimingSchema.safeParse(timing);
      if (!parsed.success) return;
      matrices[track].cancelStroke();
      if (track === "bass") {
        project.bass = resizeBassTrack(project.bass, parsed.data);
        renderBass();
      } else {
        project.keys = resizeKeysTrack(project.keys, parsed.data);
        renderKeys();
      }
      clearMatrixUndo(track);
      persist();
    },
  });
  notePagers[track]?.update(project[track].timing);
}
for (const track of noteTracks) {
  const canvas = document.getElementById(`${track}-automation-canvas`);
  const access = document.getElementById(`${track}-automation-access`);
  const container = document.getElementById(`${track}-automation-pattern`);
  if (!(canvas instanceof HTMLCanvasElement) || !access || !container)
    throw new Error("Note automation controls are missing.");
  const matrix = new NoteMatrix(
    canvas,
    access,
    track === "bass" ? "Bass" : "Texture",
    track === "bass" ? 24 : 48,
    track === "bass" ? 60 : 84,
    (change) => matrixPaint(track, change),
    () => {
      automationPagers[track]?.freezeFollow();
      saveAutomationUndo(track);
    },
  );
  automationMatrices[track] = matrix;
  const changeBars = (bars: import("./timing").AutomationBars): void => {
    matrix.cancelStroke();
    automationUndo[track] = null;
    if (track === "bass")
      project.bass = resizeBassAutomation(project.bass, bars);
    else project.keys = resizeKeysAutomation(project.keys, bars);
    refreshAutomation(track);
    persist();
  };
  automationPagers[track] = new PatternControls(container, {
    label: `${track === "bass" ? "Bass" : "Texture"} automation`,
    barsOnly: true,
    pageBars: true,
    allowedBars: [1, 2, 4, 8, 16],
    onFollowSequence: () => changeBars(null),
    onTimingChange: (timing) => changeBars(timing.bars),
    isBusy: () => matrix.busy,
    onViewportChange: (viewport) => matrix.setViewport(viewport),
  });
  refreshAutomation(track);
}
const progressionContainer = document.getElementById("progression-controls");
if (!progressionContainer) throw new Error("Chord controls are missing.");
function openChords(): void {
  const tools = document.getElementById("studio-tools-panel");
  const button = document.getElementById("studio-tools");
  if (tools) tools.hidden = true;
  button?.setAttribute("aria-expanded", "false");
  progressionPanel.open();
  requestAnimationFrame(() =>
    progressionContainer?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    }),
  );
}
const progressionPanel = createProgressionPanel(progressionContainer, {
  getProgression: () => project.progression,
  getScale: () => project.scale,
  onChange: () => {
    refreshProject();
    persist();
  },
});
const arpContainer = document.getElementById("arp-panel");
const padContainer = document.getElementById("pad-panel");
if (!arpContainer || !padContainer)
  throw new Error("Melodic instruments are missing.");
const arpPanel = createArpPanel(arpContainer, {
  getTrack: () => project.arp,
  getProgression: () => project.progression,
  onProgressionEdit: () => openChords(),
  getScale: () => project.scale,
  onChange: () => persist(),
  renderControl: slider,
});
const padPanel = createPadPanel(padContainer, {
  getTrack: () => project.pad,
  getProgression: () => project.progression,
  onProgressionEdit: () => openChords(),
  getScale: () => project.scale,
  onChange: () => {
    updateBarPosition();
    persist();
  },
  renderControl: slider,
});
async function prepareSharedProject(): Promise<
  ReturnType<typeof createProject>
> {
  const snapshot = structuredClone(project);
  if (snapshot.vocal.recording)
    snapshot.vocal.recording = await ensureSharedSample(
      snapshot.vocal.recording,
    );
  return snapshot;
}
async function useVocalRecording(sample: CustomSample): Promise<void> {
  if (sessionEditingBlocked())
    throw new Error(
      "Wait for the session to reconnect before changing recordings.",
    );
  if (
    sessionStatus.role === "guest" &&
    sessionStatus.hostConnected &&
    !sessionStatus.supportsComposition
  )
    throw new Error(
      "The host needs the current version of Grain to play custom recordings.",
    );
  const source = project;
  const previousSource = vocalSourceKey(
    project.vocal.sound,
    project.vocal.recording,
  );
  const role = sessionStatus.role;
  const invite = sessionClient?.inviteLink;
  const recording = role ? await ensureSharedSample(sample) : sample;
  if (
    project !== source ||
    vocalSourceKey(project.vocal.sound, project.vocal.recording) !==
      previousSource ||
    sessionStatus.role !== role ||
    sessionClient?.inviteLink !== invite ||
    sessionEditingBlocked()
  )
    throw new Error(
      "Track changed while uploading. Select the recording again.",
    );
  project.vocal.recording = recording;
  project.vocal.muted = false;
  vocalPanel.render();
  persist();
}
const vocalContainer = document.getElementById("vocal-panel");
if (!vocalContainer) throw new Error("Vocal instrument is missing.");
const vocalPanel = createVocalPanel(vocalContainer, {
  getTrack: () => project.vocal,
  getScale: () => project.scale,
  getProgression: () => project.progression,
  onProgressionEdit: openChords,
  getSessionActive: () => sessionStatus.role !== null,
  onUseRecording: useVocalRecording,
  onChange: () => persist(),
  renderControl: slider,
  onPreview: (note) => {
    if (sessionStatus.role === "guest" || sessionEditingBlocked()) return;
    void engine
      .auditionVocal(project.vocal, note)
      .catch(() => toast("Vocal preview could not load. Try again."));
  },
  onTrimGesture: (phase, parameter, value) => {
    const id = `vocal-${parameter}`;
    const control = document.getElementById(id);
    if (!control || sessionEditingBlocked()) return;
    if (phase === "begin") {
      control.classList.add("dragging");
      automationRecorder.begin(id);
    } else if (phase === "change") {
      setInput(id, value * 100);
      if (!captureAutomation(control, id, value * 100))
        updateControl(id, value * 100);
    } else {
      control.classList.remove("dragging");
      automationRecorder.end(id);
      restoreRecordedControl(id);
    }
  },
});
const performanceTouches = new Map<string, Set<number>>();
let heldCloud: CloudGesture | null = null;
let materialPlaying = false;
let lastCloudCell: number | null = null;
function canRecordPerformance(): boolean {
  return (
    automationRecorder.armed &&
    !sessionEditingBlocked() &&
    (sessionStatus.role === "guest" ? remotePlaying : engine.isPlaying)
  );
}
function performanceCell(
  track: "cloud" | "tension",
  tick = currentAbsoluteTick,
): number {
  const timing = project[track].timing;
  return Math.floor(
    unswungTick(Math.max(0, tick), project.swing, timing.grid) /
      ticksPerStep(timing) +
      1e-9,
  );
}
function recordCloudGesture(tick = currentAbsoluteTick): boolean {
  if (!heldCloud || !canRecordPerformance()) return false;
  const track = project.cloud,
    cell = performanceCell("cloud", tick),
    count = trackStepCount(track.timing);
  const first =
    lastCloudCell !== null &&
    cell >= lastCloudCell &&
    cell - lastCloudCell < count
      ? lastCloudCell
      : cell;
  let changed = track.muted;
  track.muted = false;
  for (let point = first; point <= cell; point++) {
    const step = track.steps[point % count];
    if (!step) continue;
    if (
      !step.on ||
      step.note !== heldCloud.note ||
      step.velocity !== heldCloud.velocity
    )
      changed = true;
    step.on = true;
    step.note = heldCloud.note;
    step.velocity = heldCloud.velocity;
  }
  lastCloudCell = cell;
  return changed;
}
function applyPerformanceValues<Parameter extends string>(
  prefix: "cloud" | "tension",
  parameters: ReadonlyArray<Parameter>,
  track: Record<Parameter, number>,
  values: Partial<Record<Parameter, number>>,
  pointerId: number,
): void {
  const changed: string[] = [];
  for (const parameter of parameters) {
    const value = values[parameter];
    if (value === undefined || !Number.isFinite(value)) continue;
    const normalized = Math.max(0, Math.min(1, value)),
      id = `${prefix}-${parameter}`;
    let contacts = performanceTouches.get(id);
    if (!contacts) {
      contacts = new Set();
      performanceTouches.set(id, contacts);
    }
    contacts.add(pointerId);
    automationRecorder.begin(id);
    const control = document.getElementById(id);
    control?.classList.add("dragging");
    if (automationRecorder.capture(id, normalized)) recordedControls.add(id);
    else track[parameter] = normalized;
    setInput(id, normalized * 100);
    setOutput(id, recordingDisplay(id, normalized * 100));
    changed.push(id);
  }
  if (changed.length) commitRecording(changed);
}
function endPerformanceValues(
  prefix: "cloud" | "tension",
  pointerId: number,
): void {
  for (const [id, contacts] of performanceTouches) {
    if (
      !id.startsWith(`${prefix}-`) ||
      !contacts.delete(pointerId) ||
      contacts.size
    )
      continue;
    performanceTouches.delete(id);
    document.getElementById(id)?.classList.remove("dragging");
    automationRecorder.end(id);
    restoreRecordedControl(id);
  }
}
function previewCloud(
  note: number,
  velocity: number,
  sustain = false,
  values: CloudGesture["values"] = {},
): void {
  if (sessionStatus.role === "guest" || sessionEditingBlocked()) return;
  void engine
    .auditionCloud(
      { ...project.cloud, ...values, muted: false },
      note,
      velocity,
      sustain,
    )
    .catch(() => toast("Cloud preview could not start. Try again."));
}
function previewTension(
  note: number,
  velocity: number,
  values: TensionGesture["values"] = {},
): void {
  if (sessionStatus.role === "guest" || sessionEditingBlocked()) return;
  void engine
    .auditionTension(
      { ...project.tension, ...values, muted: false },
      note,
      velocity,
    )
    .catch(() => toast("Tension preview could not start. Try again."));
}
const cloudContainer = document.getElementById("cloud-panel");
const tensionContainer = document.getElementById("tension-panel");
if (!cloudContainer || !tensionContainer)
  throw new Error("Material instruments are missing.");
const cloudPanel = createCloudPanel(cloudContainer, {
  getTrack: () => project.cloud,
  getScale: () => project.scale,
  renderControl: slider,
  onChange: () => {
    updateBarPosition();
    persist();
  },
  onPreview: (note, velocity) => previewCloud(note, velocity),
  onGesture: (phase, gesture) => {
    if (phase === "end") {
      heldCloud = null;
      lastCloudCell = null;
      endPerformanceValues("cloud", gesture.pointerId);
      engine.releaseCloudAudition();
      return;
    }
    if (sessionEditingBlocked()) return;
    heldCloud = gesture;
    if (phase === "begin") lastCloudCell = null;
    applyPerformanceValues(
      "cloud",
      cloudParameters,
      project.cloud,
      gesture.values,
      gesture.pointerId,
    );
    if (recordCloudGesture()) {
      cloudPanel.refreshAutomation();
      persist();
    }
    previewCloud(gesture.note, gesture.velocity, true, gesture.values);
  },
});
const tensionPanel = createTensionPanel(tensionContainer, {
  getTrack: () => project.tension,
  getScale: () => project.scale,
  renderControl: slider,
  onChange: () => {
    updateBarPosition();
    persist();
  },
  onPreview: (note, velocity) => previewTension(note, velocity),
  onGesture: (phase, gesture) => {
    if (!gesture.cancelled && !sessionEditingBlocked()) {
      applyPerformanceValues(
        "tension",
        tensionParameters,
        project.tension,
        gesture.values,
        gesture.pointerId,
      );
      if (phase === "end") {
        if (canRecordPerformance()) {
          const track = project.tension,
            step = track.steps[performanceCell("tension") % track.steps.length];
          if (step) {
            step.on = true;
            step.note = gesture.note;
            step.velocity = gesture.velocity;
          }
          track.muted = false;
          tensionPanel.refreshAutomation();
          persist();
        }
        previewTension(gesture.note, gesture.velocity, gesture.values);
      }
    }
    if (phase === "end") endPerformanceValues("tension", gesture.pointerId);
  },
});
function cancelMaterialPerformance(): void {
  heldCloud = null;
  lastCloudCell = null;
  cloudPanel.cancelPerformance();
  tensionPanel.cancelPerformance();
  engine.releaseCloudAudition();
}
engine.setVocalLoadListener((status) => vocalPanel.setSampleStatus(status));
const mixerContainer = document.getElementById("track-mixer");
if (!mixerContainer) throw new Error("Mixer is missing.");
const mixer = new TrackMixer(mixerContainer);
const gestures = installGestures(
  app,
  (control, value) => {
    const id = control.dataset.sourceControl ?? control.id;
    if (captureAutomation(control, id, value)) return;
    if (control.dataset.sourceControl) setInput(id, value);
    updateControl(id, value);
  },
  {
    activate: (control, source) => {
      if (control.dataset.sourceControl) return;
      // Keep tapped controls stationary for double-tap reset and the native click.
      const reveal = source === "keyboard";
      if (
        arpPanel.activateControl(control.id, reveal) ||
        padPanel.activateControl(control.id, reveal) ||
        vocalPanel.activateControl(control.id, reveal) ||
        cloudPanel.activateControl(control.id, reveal) ||
        tensionPanel.activateControl(control.id, reveal)
      )
        return;
      selectAutomation(control.id);
    },
    begin: (element) => {
      automationRecorder.begin(element.dataset.sourceControl ?? element.id);
      const control = automationControls.find(
        (control) =>
          control.id === (element.dataset.sourceControl ?? element.id),
      );
      if (control?.target.track === "drums")
        drumEditor.cancel(control.target.id);
      else if (control)
        automationMatrices[control.target.track]?.cancelStroke();
    },
    end: (control) => {
      const id = control.dataset.sourceControl ?? control.id;
      automationRecorder.end(id);
      restoreRecordedControl(id);
      automationSweeps.delete(id);
    },
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
  if (
    pendingDrum &&
    !beatCanvas.busy &&
    !document.querySelector(".gesture-control.dragging")
  ) {
    selectedDrum = pendingDrum;
    pendingDrum = null;
    renderInstrumentControls();
    beatCanvas.setSelectedDrum(selectedDrum);
  }
};
app.addEventListener("pointerup", () => queueMicrotask(applyPendingInstrument));
app.addEventListener("pointercancel", () =>
  queueMicrotask(applyPendingInstrument),
);

function updateHistoryButtons(): void {
  const undo = document.getElementById("global-undo"),
    redo = document.getElementById("global-redo");
  if (undo instanceof HTMLButtonElement)
    undo.disabled = sessionEditingBlocked() || !editHistory.canUndo;
  if (redo instanceof HTMLButtonElement)
    redo.disabled = sessionEditingBlocked() || !editHistory.canRedo;
}
function travelHistory(redo: boolean): void {
  cancelMaterialPerformance();
  automationRecorder.clearTouches();
  if (sessionEditingBlocked()) return;
  const next = redo ? editHistory.redo() : editHistory.undo();
  if (!next) return;
  project = next;
  clearRemixUndo();
  refreshProject();
  persist(false);
}
function persist(record = true, broadcast = true): void {
  if (record) editHistory.record(project, historyGroup);
  updateHistoryButtons();
  engine.update(audible());
  mixer.update(project);
  if (broadcast) sessionClient?.edit(project);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const status = document.querySelector("#save-state");
    try {
      saveProject();
      if (importedHash !== null && location.hash === importedHash) {
        const url = new URL(location.href);
        const parameters = new URLSearchParams(url.hash.slice(1));
        parameters.delete("track");
        url.hash = parameters.toString();
        window.history.replaceState(null, "", url);
        importedHash = null;
      }
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
  playbackRecovery?.frame();
  const playing =
    sessionStatus.role === "guest" ? remotePlaying : engine.isPlaying;
  const recorded = automationRecorder.frame(
    playing && !sessionEditingBlocked(),
    Math.max(0, currentAbsoluteTick),
    project.swing,
  );
  if (recorded.length) commitRecording(recorded);
  const play = document.querySelector("#play");
  const canStop = playing || starting;
  if (play) {
    play.innerHTML = `${icon(canStop ? "square" : "play")}<span>${canStop ? "Stop" : "Play"}</span>`;
    play.setAttribute("aria-label", canStop ? "Stop pattern" : "Play pattern");
    play.classList.toggle("playing", canStop);
  }
  visualizer.setPlaying(playing);
  const status = document.querySelector("#audio-status");
  if (status)
    status.textContent =
      sessionStatus.role === "guest"
        ? "AUDIO ON HOST"
        : starting && !playing
          ? "AUDIO LOADING"
          : playing
            ? "AUDIO LIVE"
            : "AUDIO IDLE";
  if (!playing) {
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
async function togglePlayback(recovering = false): Promise<void> {
  if (!recovering) playbackRecovery?.userAction();
  if (sessionEditingBlocked()) return;
  if (sessionStatus.role === "guest") {
    sessionClient?.transport(remotePlaying ? "stop" : "play");
    return;
  }
  if (starting || engine.isPlaying) {
    playbackRequest++;
    starting = false;
    cancelMaterialPerformance();
    engine.stop();
    updatePlayback();
    return;
  }
  const request = ++playbackRequest;
  starting = true;
  updatePlayback();
  try {
    await engine.play(audible());
  } catch {
    if (!recovering && request === playbackRequest)
      toast("Audio could not start. Try Play again.");
  } finally {
    if (request === playbackRequest) {
      starting = false;
      updatePlayback();
    }
  }
}

async function audition(id: DrumId = selectedDrum): Promise<void> {
  if (sessionStatus.role === "guest") return;
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
  if (dataset.solo !== undefined) {
    soloed = toggleSolo(soloed, dataset.solo);
    syncSolo();
    engine.update(audible());
    updateBarPosition();
    return;
  }
  if (id === "session-toggle") setSessionOpen(!sessionPanel.isOpen());
  if (id === "global-undo") travelHistory(false);
  if (id === "global-redo") travelHistory(true);
  if (id === "close-share") {
    const panel = document.getElementById("share-panel");
    if (panel) panel.hidden = true;
  }
  if (id === "share-track") {
    button.disabled = true;
    button.textContent = "Sharing…";
    try {
      const encoded = await encodeTrack(await prepareSharedProject());
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
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "Could not create the track link.",
      );
    } finally {
      button.disabled = false;
      button.textContent = "Share";
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
  if (id === "record-automation") {
    armRecording(!automationRecorder.armed);
  }
  if (id === "restart") {
    playbackRecovery?.userAction();
    playbackRequest++;
    starting = false;
    if (sessionStatus.role === "guest") {
      sessionClient?.transport("restart");
      return;
    }
    const playing = engine.isPlaying;
    cancelMaterialPerformance();
    engine.stop();
    if (playing) {
      try {
        await engine.play(audible());
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
    if (
      track &&
      Number.isInteger(step) &&
      step >= 0 &&
      step < track.steps.length
    ) {
      drumEditor.freezeFollow();
      track.steps[step] = !track.steps[step];
      document
        .querySelectorAll(`[data-drum-step="${track.id}"][data-step="${step}"]`)
        .forEach((cell) => {
          cell.setAttribute("aria-pressed", String(track.steps[step]));
          cell.classList.toggle("on", track.steps[step]);
          cell.textContent = track.steps[step] ? "On" : "Off";
        });
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
  if (dataset.mixerMute) {
    const track = mixerTrack(project, dataset.mixerMute);
    if (track) {
      track.muted = !track.muted;
      refreshProject();
      persist();
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
  if (projectModeSchema.safeParse(dataset.projectMode).success)
    switchMode(projectModeSchema.parse(dataset.projectMode));
  if (
    dataset.preset &&
    PRESETS.some((preset) => preset.id === dataset.preset)
  ) {
    clearRemixUndo();
    project = loadPreset(dataset.preset);
    refreshProject();
    persist();
  }
  if (id === "reset") {
    clearRemixUndo();
    const preset = findPresetByName(project.name, project.mode);
    project = loadPreset(preset?.id ?? defaultPresetId(project.mode));
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
    if (
      dataset.matrixAutomationView === "page" ||
      dataset.matrixAutomationView === "loop"
    ) {
      automationPagers[track]?.freezeFollow();
      automationMatrices[track]?.setAutomationView(
        dataset.matrixAutomationView,
        automationTiming(project[track]).bars,
      );
      refreshAutomation(track);
    }
    if (
      dataset.noteAutomationTool === "draw" ||
      dataset.noteAutomationTool === "line"
    ) {
      automationMatrices[track]?.setTool(dataset.noteAutomationTool);
      document
        .querySelectorAll<HTMLElement>(
          `[data-matrix-track="${track}"][data-note-automation-tool]`,
        )
        .forEach((item) =>
          item.setAttribute(
            "aria-pressed",
            String(
              item.dataset.noteAutomationTool === dataset.noteAutomationTool,
            ),
          ),
        );
    }
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
      automationMatrices[track]?.cancelStroke();
      automationSweeps.delete(control.id);
      saveAutomationUndo(track);
      setAutomationValues(control.target, null);
      refreshAutomation(track);
      persist();
    }
  }
  if (
    dataset.noteAutomationUndo === "bass" ||
    dataset.noteAutomationUndo === "keys"
  ) {
    const track = dataset.noteAutomationUndo,
      before = automationUndo[track];
    const control = automationControls.find((entry) => entry.id === before?.id);
    if (before && control) {
      automationMatrices[track]?.cancelStroke();
      automationSweeps.delete(control.id);
      setAutomationValues(control.target, before.values);
      automationUndo[track] = null;
      selectedAutomation[track] = control.id;
      refreshAutomation(track);
      persist();
    }
  }
  if (dataset.matrixUndo === "bass" || dataset.matrixUndo === "keys") {
    const track = dataset.matrixUndo,
      before = matrixUndo[track];
    if (before) {
      automationSweeps.clear();
      project[track].steps = before.steps;
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
    if (!(sessionStatus.role === "guest" ? remotePlaying : engine.isPlaying))
      await togglePlayback();
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
  if (dataset.exampleScroll) {
    const strip = document.querySelector(".preset-options");
    if (strip instanceof HTMLElement)
      strip.scrollBy({
        left:
          Math.sign(Number(dataset.exampleScroll)) * strip.clientWidth * 0.8,
        behavior: "smooth",
      });
  }
  if (id === "visualizer-colour") {
    const palettes = document.getElementById("visualizer-palettes");
    if (palettes) setVisualizerPaletteOpen(palettes.hidden);
  }
  if (isVisualizerPaletteId(dataset.visualizerPalette)) {
    visualizerPalette = dataset.visualizerPalette;
    visualizer.setPalette(visualizerPalette);
    updateVisualizerPalette();
    try {
      localStorage.setItem(paletteStorageKeys[project.mode], visualizerPalette);
    } catch {
      // The selected palette still applies for this visit.
    }
  }
  if (id === "fullscreen") {
    const panel = document.querySelector("#visualizer-panel");
    if (panel instanceof HTMLElement) {
      setVisualizerPaletteOpen(false);
      if (panel.classList.contains("expanded") || document.fullscreenElement)
        await exitVisualizerFullscreen();
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
      const blob = await engine.exportWav(audible());
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
  const performanceControl = PERFORMANCE_CONTROLS.find(
    (control) => control.id === id,
  );
  if (performanceControl) {
    project.fx[performanceControl.parameter] = value / 100;
    setOutput(id, formatPerformance(performanceControl.parameter, value / 100));
    persist();
    return;
  }
  if (
    arpPanel.updateControl(id, value) ||
    padPanel.updateControl(id, value) ||
    vocalPanel.updateControl(id, value) ||
    cloudPanel.updateControl(id, value) ||
    tensionPanel.updateControl(id, value)
  )
    return;
  const automation = automationControls.find((control) => control.id === id);
  const baseBefore = automation ? automationBase(automation.target) : 0;
  if (id === "bpm") {
    project.bpm = value;
    setOutput(id, String(value));
  }
  if (id === "swing") {
    project.swing = value / 100;
    setOutput(id, `${value}%`);
    arpPanel.setPosition(currentAbsoluteTick, project.swing);
    padPanel.setPosition(currentAbsoluteTick, project.swing);
    vocalPanel.setPosition(currentAbsoluteTick, project.swing);
    progressionPanel.setPosition(currentAbsoluteTick, project.swing);
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
      const held =
        document.getElementById(id)?.classList.contains("dragging") ||
        document.querySelector(`[data-source-control="${id}"].dragging`) !==
          null;
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
      stage.style.setProperty("--visualizer-intensity", String(value / 100));
      stage.style.visibility = value === 0 ? "hidden" : "visible";
    }
    return;
  }
  if (id === "swirl") {
    visualizerSwirl = value;
    visualizer.setSwirl(value / 100);
    setOutput(id, `${value}%`);
    try {
      localStorage.setItem("grain-visualizer-swirl-v1", String(value));
    } catch {
      // The current swirl setting remains usable without storage.
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
        project.drums.length * drumViewport.count - 1,
        index +
          (event.key === "ArrowLeft"
            ? -1
            : event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowUp"
                ? -drumViewport.count
                : drumViewport.count),
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
function setVisualizerPaletteOpen(open: boolean): void {
  const palettes = document.getElementById("visualizer-palettes");
  if (palettes) palettes.hidden = !open;
  document
    .getElementById("visualizer-colour")
    ?.setAttribute("aria-expanded", String(open));
}
function updateVisualizerPalette(): void {
  setThemePalette(visualizerPalette);
  const palette = VISUALIZER_PALETTES.find(
    (option) => option.id === visualizerPalette,
  );
  const current = document.querySelector(".palette-current");
  if (palette && current instanceof HTMLElement)
    current.style.background = palette.swatch;
  document
    .querySelectorAll<HTMLButtonElement>("[data-visualizer-palette]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.visualizerPalette === visualizerPalette),
      );
    });
}
async function exitVisualizerFullscreen(): Promise<void> {
  document.querySelector("#visualizer-panel")?.classList.remove("expanded");
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // Keep the fullscreen button in sync if the browser refuses to exit.
    }
  }
  updateFullscreenButton();
}
document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".visualizer-toolbar"))
      return;
    setVisualizerPaletteOpen(false);
    if (!document.body.classList.contains("visualizer-expanded")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void exitVisualizerFullscreen();
  },
  true,
);
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
  const toolbar = document.getElementById("visualizer-toolbar");
  const parent = expanded ? app : document.getElementById("header-visuals");
  if (toolbar && parent && toolbar.parentElement !== parent)
    parent.append(toolbar);
}
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setVisualizerPaletteOpen(false);
    void exitVisualizerFullscreen();
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    playbackRecovery?.cancel();
    sessionClient?.reconnect();
    updatePlayback();
  }
});
window.addEventListener("pagehide", () => {
  playbackRecovery?.suspend();
  playbackRequest++;
  starting = false;
  phoneMotion.disable();
  cancelMaterialPerformance();
  engine.stop();
  sessionClient?.suspend();
  visualizer.setPlaying(false);
  try {
    saveProject();
  } catch {
    /* Storage may be disabled by the browser. */
  }
});
refreshProject();
refreshIcons();
installInstrumentCollapse(app, () => historyPointers.size > 0);
installStudioNavigation(app);
playOpeningAnimation(app);
void document.fonts.ready.then(() => {
  beatCanvas.update(project);
  matrices.bass.update(project.bass.steps, project.scale, project.bass.muted);
  matrices.keys.update(project.keys.steps, project.scale, project.keys.muted);
  drumEditor.refresh();
});

async function loadSharedTrack(): Promise<void> {
  const hash = location.hash;
  const encoded = new URLSearchParams(hash.slice(1)).get("track");
  if (!encoded) return;
  playbackRecovery?.cancel();
  const shared = await decodeTrack(encoded);
  if (location.hash !== hash) return;
  if (!shared) {
    toast("This track link is invalid or incomplete.");
    return;
  }
  historyGroup++;
  project = shared;
  importedHash = hash;
  refreshProject();
  persist();
  toast("Shared track loaded.");
}
function sessionEditingBlocked(): boolean {
  if (sessionStatus.role === null && sessionStatus.phase === "error")
    return false;
  return (
    sessionStatus.phase !== "idle" &&
    (sessionStatus.phase !== "connected" ||
      (sessionStatus.role === "guest" && !sessionStatus.hostConnected))
  );
}
function refreshSessionProject(): void {
  if (historyPointers.size) {
    deferredSessionRefresh = true;
    return;
  }
  deferredSessionRefresh = false;
  const focused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.id
      : "";
  refreshProject(false);
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}
function setSessionOpen(open: boolean): void {
  sessionPanel.setOpen(open);
  document
    .getElementById("session-toggle")
    ?.setAttribute("aria-expanded", String(open));
}
function leaveSession(): void {
  playbackRecovery?.cancel();
  playbackRequest++;
  starting = false;
  armRecording(false);
  cancelMaterialPerformance();
  engine.stop();
  sessionClient?.leave();
  remotePlaying = false;
  updatePlayback();
  showStep(-1, -1);
  editHistory.reset(project);
  clearRemixUndo();
  clearMatrixUndo();
  updateHistoryButtons();
  const url = new URL(location.href);
  if (new URLSearchParams(url.hash.slice(1)).has("session")) {
    url.hash = "";
    window.history.replaceState(null, "", url);
  }
}
async function hostTransport(
  action: "play" | "stop" | "restart",
): Promise<void> {
  if (sessionStatus.role !== "host") return;
  playbackRecovery?.userAction();
  if (action !== "stop" && !engine.isReady) {
    toast("Press Play on the host to enable audio.");
    sessionClient?.clock(false, 0);
    return;
  }
  try {
    if (action === "stop" || action === "restart") {
      playbackRequest++;
      starting = false;
      cancelMaterialPerformance();
      engine.stop();
    }
    if (action !== "stop") await engine.play(audible());
    updatePlayback();
    sessionClient?.clock(engine.isPlaying, currentAbsoluteTick);
  } catch {
    toast("Audio could not start. Press Play on the host.");
  }
}
const sessionContainer = document.getElementById("session-panel");
if (!sessionContainer) throw new Error("Session panel is missing.");
let creatingSession = false;
const sessionPanel = createSessionPanel(sessionContainer, {
  onCreate: () => {
    if (creatingSession) return;
    if (sessionStatus.phase === "ended") leaveSession();
    if (sessionClient?.role) {
      sessionClient.reconnect();
      return;
    }
    creatingSession = true;
    const createButton =
      document.querySelector<HTMLButtonElement>("#session-create");
    if (createButton) {
      createButton.disabled = true;
      createButton.textContent = "Preparing session…";
    }
    const source = project;
    const recording = project.vocal.recording;
    void (async () => {
      try {
        try {
          await engine.unlock(audible());
        } catch {
          toast("Press Play on the host to enable audio.");
        }
        const shared = await prepareSharedProject();
        if (
          sessionClient?.role ||
          project !== source ||
          project.vocal.recording !== recording
        )
          throw new Error(
            "Track changed while preparing the session. Create the session again.",
          );
        shared.vocal = { ...project.vocal, recording: shared.vocal.recording };
        await sessionClient?.create({
          ...structuredClone(project),
          vocal: shared.vocal,
        });
      } catch (error) {
        toast(
          error instanceof Error
            ? error.message
            : "Could not prepare the session.",
        );
      } finally {
        creatingSession = false;
        if (createButton) {
          createButton.disabled = sessionStatus.phase === "connecting";
          createButton.textContent = "Create session";
        }
      }
    })();
  },
  onJoin: (link) => {
    sessionClient?.join(link);
  },
  onLeave: leaveSession,
  onEnd: () => {
    if (sessionClient?.connected) sessionClient.end();
    else leaveSession();
  },
  onCopy: () => {
    const link = sessionClient?.inviteLink;
    if (!link) return;
    void navigator.clipboard.writeText(link).then(
      () => toast("Session invite copied."),
      () => {
        const field = document.getElementById("session-invite-link");
        if (field instanceof HTMLInputElement) {
          field.focus();
          field.select();
        }
        toast("Copy the session invite above.");
      },
    );
  },
});
const sessionApi =
  import.meta.env.VITE_SESSION_API ||
  (["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://127.0.0.1:8787"
    : "https://grain-sessions.nf-s.workers.dev");
configureSampleApi(sessionApi);
sessionClient = new SessionClient(sessionApi, {
  onState: (state) => {
    sessionStatus = state;
    engine.setSilent(state.role === "guest");
    vocalPanel.setHostCapability(
      state.role !== "guest" ||
        state.phase !== "connected" ||
        !state.hostConnected ||
        state.supportsVocal,
      state.role !== "guest" ||
        state.phase !== "connected" ||
        !state.hostConnected ||
        state.supportsVocalMusic,
      state.role !== "guest" ||
        state.phase !== "connected" ||
        !state.hostConnected ||
        state.supportsComposition,
      state.role !== "guest" ||
        state.phase !== "connected" ||
        !state.hostConnected ||
        state.supportsVocalGain,
    );
    cloudPanel.setHostCapability(
      state.role !== "guest" ||
        state.phase !== "connected" ||
        !state.hostConnected ||
        state.supportsCloud,
    );
    tensionPanel.setHostCapability(
      state.role !== "guest" ||
        state.phase !== "connected" ||
        !state.hostConnected ||
        state.supportsTension,
    );
    sessionPanel.render(state);
    if (state.phase !== "idle") setSessionOpen(true);
    const blocked = sessionEditingBlocked();
    if (blocked) {
      playbackRequest++;
      starting = false;
      armRecording(false);
    }
    document
      .querySelectorAll<HTMLElement>(
        ".preset-section, .studio-grid, .playback, .jam-controls, .mix-controls, .scale-panel, .project-progression, #track-mixer, #global-undo, #global-redo, #share-track, #phone-motion, #export",
      )
      .forEach((element) => {
        element.inert = blocked;
      });
    document
      .getElementById("session-toggle")
      ?.setAttribute("aria-pressed", String(state.role !== null));
    updateHistoryButtons();
    updatePlayback();
  },
  onProject: (next, initial) => {
    const changed = diffProject(project, next).length > 0;
    if (!changed && !initial) return;
    if (
      initial ||
      project.scale.root !== next.scale.root ||
      project.scale.mode !== next.scale.mode ||
      ["cloud", "tension"].some((instrument) => {
        const before = instrument === "cloud" ? project.cloud : project.tension;
        const after = instrument === "cloud" ? next.cloud : next.tension;
        return (
          before.timing.bars !== after.timing.bars ||
          before.timing.meter !== after.timing.meter ||
          before.timing.grid !== after.timing.grid ||
          before.sound !== after.sound ||
          before.muted !== after.muted
        );
      })
    )
      cancelMaterialPerformance();
    if (
      project.drums.some((drum) => {
        const incoming = next.drums.find((track) => track.id === drum.id);
        return (
          incoming &&
          (drum.timing.bars !== incoming.timing.bars ||
            drum.timing.meter !== incoming.timing.meter ||
            drum.timing.grid !== incoming.timing.grid)
        );
      })
    )
      beatCanvas.cancelStroke();
    const noteTracks: NoteTrack[] = ["bass", "keys"];
    for (const track of noteTracks) {
      const before = project[track].timing,
        after = next[track].timing;
      if (
        before.bars !== after.bars ||
        before.meter !== after.meter ||
        before.grid !== after.grid
      )
        matrices[track].cancelStroke();
      const control = automationControls.find(
        (control) => control.id === selectedAutomation[track],
      );
      matrices[track].rebaseIncoming(next[track].steps);
      const incomingTiming = automationTiming(next[track]);
      const currentTiming = automationTiming(project[track]);
      if (
        incomingTiming.bars !== currentTiming.bars ||
        incomingTiming.meter !== currentTiming.meter ||
        incomingTiming.grid !== currentTiming.grid
      )
        automationMatrices[track]?.cancelStroke();
      else
        automationMatrices[track]?.rebaseIncoming(
          Array.from(
            { length: trackStepCount(incomingTiming) },
            (_, index) =>
              next[track].steps[index % next[track].steps.length] ?? {
                note: 48,
                on: false,
                accent: false,
                slide: false,
              },
          ),
          control ? automationValues(control.target, next) : undefined,
        );
    }
    drumEditor.rebaseIncoming(next);
    arpPanel.rebaseIncoming(next.arp);
    padPanel.rebaseIncoming(next.pad);
    vocalPanel.rebaseIncoming(next.vocal);
    cloudPanel.rebaseIncoming(next.cloud);
    tensionPanel.rebaseIncoming(next.tension);
    const bassSteps =
        project.bass.steps.length === next.bass.steps.length
          ? project.bass.steps
          : next.bass.steps,
      keysSteps =
        project.keys.steps.length === next.keys.steps.length
          ? project.keys.steps
          : next.keys.steps;
    next.bass.steps.forEach((step, index) => {
      const current = bassSteps[index];
      if (current) Object.assign(current, step);
    });
    next.keys.steps.forEach((step, index) => {
      const current = keysSteps[index];
      if (current) Object.assign(current, step);
    });
    Object.assign(project, next);
    project.bass.steps = bassSteps;
    project.keys.steps = keysSteps;
    if (initial) {
      editHistory.reset(project);
      clearRemixUndo();
      clearMatrixUndo();
    } else editHistory.record(project, -1);
    refreshSessionProject();
    persist(false, false);
  },
  onClock: (playing, absoluteTick) => {
    if (sessionStatus.role !== "guest") return;
    const changed = remotePlaying !== playing;
    remotePlaying = playing;
    if (changed) updatePlayback();
    showFrame(playbackFrame(project, absoluteTick, playing));
  },
  onTransport: (action) => void hostTransport(action),
  onReady: () => {
    if (sessionStatus.role === "host")
      sessionClient?.clock(engine.isPlaying, currentAbsoluteTick);
    const url = new URL(location.href);
    const parameters = new URLSearchParams(url.hash.slice(1));
    if (parameters.has("session")) {
      parameters.delete("session");
      url.hash = parameters.toString();
      window.history.replaceState(null, "", url);
    }
    playbackRecovery?.check();
  },
  onEnded: () => {
    playbackRecovery?.cancel();
    playbackRequest++;
    starting = false;
    cancelMaterialPerformance();
    engine.stop();
    remotePlaying = false;
    showStep(-1, -1);
    updatePlayback();
  },
});
playbackRecovery = createPlaybackRecovery({
  getState: () => ({
    playing: engine.isPlaying,
    role: sessionStatus.role ?? "solo",
    room: sessionStatus.inviteLink
      ? (new URLSearchParams(new URL(sessionStatus.inviteLink).hash.slice(1))
          .get("session")
          ?.split(".")[0] ?? null)
      : null,
    ready:
      sessionStatus.phase === "idle" ||
      (sessionStatus.phase === "connected" && sessionStatus.role === "host"),
  }),
  isAudioReady: () => engine.isReady,
  onPlay: async () => {
    if (!engine.isPlaying && !starting) await togglePlayback(true);
  },
  onCancelStart: () => {
    if (!starting) return;
    playbackRequest++;
    starting = false;
    cancelMaterialPerformance();
    engine.stop();
    updatePlayback();
  },
  onBlocked: () => {
    const status = document.getElementById("playback-recovery-status");
    if (status) status.hidden = false;
  },
  clearBlocked: () => {
    const status = document.getElementById("playback-recovery-status");
    if (status) status.hidden = true;
  },
});
function loadLink(): void {
  const parameters = new URLSearchParams(location.hash.slice(1));
  if (parameters.has("session")) {
    sessionClient?.join(location.href);
    setSessionOpen(true);
  } else if (parameters.has("track")) {
    if (sessionClient?.role) leaveSession();
    void loadSharedTrack();
  }
}
if (
  new URLSearchParams(location.hash.slice(1)).has("session") ||
  new URLSearchParams(location.hash.slice(1)).has("track")
)
  loadLink();
else sessionClient.resume();
playbackRecovery.check();
window.addEventListener("hashchange", loadLink);
