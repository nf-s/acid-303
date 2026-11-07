import {
  createIcons,
  AudioLines,
  Play,
  Square,
  RotateCcw,
  Download,
  Volume2,
  Waves,
  Maximize2,
  Minimize2,
  Pause,
  Shuffle,
  CircleDot,
  Drum,
  Disc3,
  Bell,
  SlidersHorizontal,
  ChevronRight,
} from "lucide";
import {
  createProject,
  DRUM_META,
  drumIdSchema,
  noteName,
  projectSchema,
} from "./model";
import type { DrumId } from "./model";
import { AudioEngine } from "./audio";
import { FluidVisualizer } from "./visualizer";
import "./style.css";

const storageKey = "acid-303-project-v1";
let project = createProject();
let storageAvailable = true;
try {
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    const parsed = projectSchema.safeParse(JSON.parse(stored));
    if (parsed.success) project = parsed.data;
  }
} catch {
  storageAvailable = false;
}
let selectedDrum: DrumId = "kick";
let starting = false;
let motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const icon = (name: string) =>
  `<i data-lucide="${name}" aria-hidden="true"></i>`;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application container is missing.");
app.innerHTML = `
  <header class="app-header"><a class="brand" href="/" aria-label="ACID 303 home"><span class="brand-icon">${icon("audio-lines")}</span><span>ACID<span class="brand-number">303</span></span><span class="brand-divider"></span><span class="brand-detail">BEAT MACHINE</span></a><div class="header-actions"><span id="save-state" class="save-state"><span class="status-dot"></span>${storageAvailable ? "Saved in this browser" : "Browser storage unavailable"}</span><button class="button secondary" id="export">${icon("download")}<span>Export WAV</span></button></div></header>
  <main class="workspace">
    <section class="transport panel" aria-label="Playback controls">
      <div class="playback"><button class="play-button" id="play" aria-label="Play pattern">${icon("play")}<span>Play</span></button><button class="icon-button restart" id="restart" aria-label="Restart pattern" title="Restart pattern">${icon("rotate-ccw")}</button></div>
      <span class="transport-divider"></span>
      <label class="tempo-control"><span class="eyebrow">TEMPO</span><span><input id="bpm" type="number" min="60" max="180" step="1" value="${project.bpm}" aria-label="Tempo in BPM"/><span class="unit">BPM</span></span></label>
      <label class="transport-range"><span class="control-label">Swing <output id="swing-value">${Math.round(project.swing * 100)}%</output></span><input id="swing" type="range" min="0" max="50" value="${project.swing * 100}" aria-label="Swing"/></label>
      <label class="transport-range"><span class="control-label">Crunch <output id="drive-value">${Math.round(project.drive * 100)}%</output></span><input id="drive" type="range" min="0" max="100" value="${project.drive * 100}" aria-label="Crunch distortion"/></label>
      <div class="transport-spacer"></div><div class="position"><span id="position">01</span><span>/ 16</span><span class="beat-lights"><b></b><b></b><b></b><b></b></span></div>
      <label class="master-control">${icon("volume-2")}<input id="volume" type="range" min="0" max="100" value="${project.volume * 100}" aria-label="Master volume"/></label>
    </section>
    <div class="studio-grid"><div class="sequencers">
      <section class="panel drums-panel" aria-labelledby="drums-title">
        <div class="section-header"><div class="section-title"><span class="section-number">01</span><h1 id="drums-title">Drum sequencer</h1><span class="small-tag">16 STEPS</span></div><button id="reset" class="text-button" title="Restore the selected preset">${icon("rotate-ccw")} Reset</button></div>
        <div class="preset-bar"><span class="eyebrow">PATTERN</span><div class="preset-options"><button data-preset="0">Acid funk</button><button data-preset="1">After hours</button><button data-preset="2">Broken circuit</button></div></div>
        <div class="sequence-scroll"><div class="drum-grid" id="drum-grid"></div></div>
        <div class="section-footer"><span><span class="legend-pad"></span><span class="desktop-hint">Click steps to edit</span><span class="mobile-hint">Tap steps · Swipe to see all 16</span></span><span>Select a drum to shape its sound ${icon("chevron-right")}</span></div>
      </section>
      <section class="panel bass-panel" aria-labelledby="bass-title">
        <div class="section-header"><div class="section-title"><span class="section-number">02</span><h2 id="bass-title">Acid bass</h2><span class="small-tag">303</span></div><div class="bass-actions"><button id="bass-mute" class="mute-button" aria-label="Mute acid bass" aria-pressed="${project.bass.muted}">M</button><button id="generate" class="text-button">${icon("shuffle")} Generate</button></div></div>
        <div class="bass-meta"><div class="waveform-switch" role="group" aria-label="Bass waveform"><button data-waveform="sawtooth">${icon("audio-lines")} Saw</button><button data-waveform="square">${icon("waves")} Square</button></div><span class="bass-key">A MINOR <span>·</span> 1 BAR</span></div>
        <div class="sequence-scroll"><div class="bass-grid" id="bass-grid"></div></div>
        <div class="section-footer"><span>Gate plays a note · Accent adds emphasis · Slide ties to the next note</span></div>
      </section>
    </div>
    <aside class="panel sound-panel" aria-label="Sound controls"><div class="inspector-header">${icon("sliders-horizontal")}<h2>Sound controls</h2></div><div id="drum-controls"></div><div class="acid-controls"><div class="control-section-heading"><span class="mini-chip">303</span><h3>Acid filter</h3></div><div class="filter-display"><svg viewBox="0 0 240 50" preserveAspectRatio="none" aria-hidden="true"><path id="filter-path" d="M0 35 L100 35 Q130 35 145 10 Q160 0 170 35 L190 46 L240 46"/></svg><span>24 dB/oct</span><span>LOW PASS</span></div>${slider("cutoff", "Cutoff", 0, 100, Math.round((Math.log(project.bass.cutoff / 80) / Math.log(100)) * 100), formatFrequency(project.bass.cutoff))}${slider("resonance", "Resonance", 0, 22, project.bass.resonance, `${Math.round((project.bass.resonance / 22) * 100)}%`, "0.1")}${slider("envelope", "Envelope", 0, 100, project.bass.envelope * 100, `${Math.round(project.bass.envelope * 100)}%`)}${slider("bass-decay", "Decay", 50, 1500, project.bass.decay * 1000, `${Math.round(project.bass.decay * 1000)} ms`)}${slider("bass-volume", "Level", 0, 100, project.bass.volume * 100, `${Math.round(project.bass.volume * 100)}%`)}</div></aside></div>
    <section id="visualizer-panel" class="visualizer-panel" aria-label="Fluid audio visualizer"><canvas id="fluid-canvas" aria-label="Audio-reactive fluid ribbons"></canvas><div class="visualizer-top"><span class="visualizer-label">${icon("waves")} VISUALIZER</span><span class="audio-status" id="audio-status">AUDIO IDLE</span></div><div class="visualizer-bottom"><span class="visualizer-mode"><span class="visualizer-dot"></span>FLUID</span><div class="visualizer-controls"><label>Intensity<input id="intensity" type="range" min="0" max="100" value="65" aria-label="Visualizer intensity"/></label><button id="motion" class="visualizer-button" aria-label="${motion ? "Pause" : "Enable"} visualizer motion" aria-pressed="${motion}">${icon(motion ? "pause" : "play")}</button><button id="fullscreen" class="visualizer-button" aria-label="Fullscreen visualizer">${icon("maximize-2")}</button></div></div></section>
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
): string {
  return `<label class="slider-control"><span class="control-label">${label}<output id="${id}-value">${display}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${id.startsWith("drum") ? "Drum " : "Bass "}${label.toLowerCase()}"/></label>`;
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
      Volume2,
      Waves,
      Maximize2,
      Minimize2,
      Pause,
      Shuffle,
      CircleDot,
      Drum,
      Disc3,
      Bell,
      SlidersHorizontal,
      ChevronRight,
    },
    attrs: { "stroke-width": 1.7 },
  });
}
function selectedTrack() {
  return (
    project.drums.find((track) => track.id === selectedDrum) ?? project.drums[0]
  );
}
function renderDrums(): void {
  const grid = document.querySelector("#drum-grid");
  if (!grid) return;
  grid.innerHTML = `<div class="drum-row step-header"><span class="track-heading">INSTRUMENT</span><div class="steps">${Array.from({ length: 16 }, (_, i) => `<span class="step-number ${i % 4 === 0 ? "group-start" : ""}">${String(i + 1).padStart(2, "0")}</span>`).join("")}</div><span></span></div>${project.drums.map((track) => `<div class="drum-row ${track.id === selectedDrum ? "selected" : ""} ${track.muted ? "muted" : ""}" data-track="${track.id}"><button class="track-select" data-drum="${track.id}" aria-label="Select and preview ${DRUM_META[track.id].name}" aria-pressed="${track.id === selectedDrum}"><span class="track-icon">${icon(DRUM_META[track.id].icon)}</span><span><strong>${DRUM_META[track.id].name}</strong><small>${DRUM_META[track.id].sounds[track.sound]}</small></span></button><div class="steps">${track.steps.map((on, index) => `<button class="step-pad ${on ? "on" : ""} ${index % 4 === 0 ? "group-start" : ""}" data-drum-step="${track.id}" data-step="${index}" aria-label="${DRUM_META[track.id].name} step ${index + 1}" aria-pressed="${on}"><span></span></button>`).join("")}</div><button class="mute-button" data-mute="${track.id}" aria-label="Mute ${DRUM_META[track.id].name}" aria-pressed="${track.muted}">M</button></div>`).join("")}`;
  refreshIcons();
}
function renderBass(): void {
  const grid = document.querySelector("#bass-grid");
  if (!grid) return;
  const notes = Array.from({ length: 37 }, (_, i) => i + 24);
  grid.innerHTML = `<div class="bass-labels"><span>NOTE</span><span>GATE</span><span>ACCENT</span><span>SLIDE</span></div><div class="bass-steps">${project.bass.steps
    .map(
      (step, index) =>
        `<div class="bass-step ${index % 4 === 0 ? "group-start" : ""}" data-bass-index="${index}"><label class="note-cell ${step.on ? "on" : ""}"><span>${String(index + 1).padStart(2, "0")}</span><select data-note="${index}" aria-label="Bass note step ${index + 1}">${notes.map((note) => `<option value="${note}" ${note === step.note ? "selected" : ""}>${noteName(note)}</option>`).join("")}</select></label>${[
          "on",
          "accent",
          "slide",
        ]
          .map((type) => {
            const enabled =
              type === "on"
                ? step.on
                : type === "accent"
                  ? step.accent
                  : step.slide;
            return `<button class="bass-toggle ${type === "on" ? "gate" : type} ${enabled ? "on" : ""}" data-bass-toggle="${type}" data-step="${index}" aria-label="Bass ${type === "on" ? "gate" : type} step ${index + 1}" aria-pressed="${enabled}"><span></span></button>`;
          })
          .join("")}</div>`,
    )
    .join("")}</div>`;
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
}
function renderInspector(): void {
  const track = selectedTrack();
  const controls = document.querySelector("#drum-controls");
  if (!track || !controls) return;
  controls.innerHTML = `<div class="control-section-heading"><span class="mini-chip">${DRUM_META[track.id].short}</span><h3>${DRUM_META[track.id].name}</h3><button id="audition" class="icon-button" aria-label="Preview ${DRUM_META[track.id].name}">${icon("play")}</button></div><label class="sound-select"><span class="eyebrow">SOUND</span><select id="drum-sound" aria-label="${DRUM_META[track.id].name} sound">${DRUM_META[track.id].sounds.map((sound, i) => `<option value="${i}" ${track.sound === i ? "selected" : ""}>${sound}</option>`).join("")}</select></label>${slider("drum-pitch", "Pitch", -24, 24, track.pitch, `${track.pitch > 0 ? "+" : ""}${track.pitch} st`)}${slider("drum-decay", "Decay", 30, 1500, track.decay * 1000, `${Math.round(track.decay * 1000)} ms`)}${slider("drum-volume", "Level", 0, 100, track.volume * 100, `${Math.round(track.volume * 100)}%`)}`;
  refreshIcons();
}
function setOutput(id: string, value: string): void {
  const output = document.getElementById(`${id}-value`);
  if (output) output.textContent = value;
}
function setInput(id: string, value: number): void {
  const input = document.getElementById(id);
  if (input instanceof HTMLInputElement) input.value = String(value);
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
  renderInspector();
  updatePresetLabels();
  const bassKey = document.querySelector(".bass-key");
  if (bassKey)
    bassKey.innerHTML = `${project.name === "Broken circuit" ? "C" : "A"} MINOR <span>·</span> 1 BAR`;
  setInput("bpm", project.bpm);
  setInput("swing", project.swing * 100);
  setInput("drive", project.drive * 100);
  setInput("volume", project.volume * 100);
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
  document
    .querySelectorAll(".current")
    .forEach((element) => element.classList.remove("current"));
  document
    .querySelectorAll(`[data-step="${step}"], [data-bass-index="${step}"]`)
    .forEach((element) => element.classList.add("current"));
  document
    .querySelectorAll(".step-number")
    .item(step)
    ?.classList.add("current");
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
async function audition(): Promise<void> {
  const track = selectedTrack();
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
      renderDrums();
      renderInspector();
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
  if (dataset.preset || dataset.preset === "0") {
    project = createProject(Number(dataset.preset));
    refreshProject();
    persist();
  }
  if (id === "reset") {
    const preset = ["Acid funk", "After hours", "Broken circuit"].indexOf(
      project.name,
    );
    project = createProject(Math.max(0, preset));
    refreshProject();
    persist();
    toast("Pattern reset.");
  }
  if (id === "audition") await audition();
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
      if (dataset.bassToggle === "accent") step.accent = !step.accent;
      if (dataset.bassToggle === "slide") step.slide = !step.slide;
      renderBass();
      persist();
    }
  }
  if (id === "generate") {
    const scale = [33, 33, 36, 38, 40, 41, 44, 45];
    project.bass.steps = project.bass.steps.map((_, index) => ({
      note: scale[Math.floor(Math.random() * scale.length)] ?? 33,
      on: index === 0 || Math.random() > 0.2,
      accent: index % 4 === 0 || Math.random() > 0.8,
      slide: Math.random() > 0.75,
    }));
    renderBass();
    persist();
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
          if (typeof panel.requestFullscreen === "function")
            await panel.requestFullscreen();
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
document.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const id = input.id;
  if (id === "bpm") {
    if (value < 60 || value > 180) return;
    project.bpm = value;
  }
  if (id === "swing") {
    project.swing = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "drive") {
    project.drive = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "volume") project.volume = value / 100;
  if (id === "cutoff") {
    project.bass.cutoff = 80 * 100 ** (value / 100);
    setOutput(id, formatFrequency(project.bass.cutoff));
    const path = document.querySelector("#filter-path");
    const x = 30 + value * 1.6;
    path?.setAttribute(
      "d",
      `M0 35 L${x - 25} 35 Q${x - 10} 35 ${x} 10 Q${x + 15} 0 ${x + 25} 35 L${x + 45} 46 L240 46`,
    );
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
  const track = selectedTrack();
  if (track && id === "drum-pitch") {
    track.pitch = value;
    setOutput(id, `${value > 0 ? "+" : ""}${value} st`);
  }
  if (track && id === "drum-decay") {
    track.decay = value / 1000;
    setOutput(id, `${value} ms`);
  }
  if (track && id === "drum-volume") {
    track.volume = value / 100;
    setOutput(id, `${value}%`);
  }
  if (id === "intensity") {
    visualizer.setIntensity(value / 100);
    return;
  }
  persist();
});
document.addEventListener("change", (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.id === "bpm") {
    const value = Number(input.value);
    project.bpm = Number.isFinite(value)
      ? Math.max(60, Math.min(180, value))
      : 126;
    input.value = String(project.bpm);
    persist();
  }
  if (!(input instanceof HTMLSelectElement)) return;
  const value = Number(input.value);
  if (input.id === "drum-sound") {
    const track = selectedTrack();
    if (track && [0, 1, 2].includes(value)) {
      track.sound = value;
      renderDrums();
      persist();
      void audition();
    }
  }
  if (input.dataset.note) {
    const step = project.bass.steps[Number(input.dataset.note)];
    if (step && Number.isInteger(value) && value >= 24 && value <= 60) {
      step.note = value;
      persist();
    }
  }
});
document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('input,select,button,textarea,a,[contenteditable="true"]')
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
