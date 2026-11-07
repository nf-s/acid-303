import { snapNote } from "./model";
import type { BassStep, MusicalScale } from "./model";
import { createInstrumentAutomation } from "./instrument-automation";
import type { InstrumentControl } from "./instrument-automation";
import { NoteMatrix } from "./note-matrix";
import type { MatrixChange } from "./note-matrix";
import { PPQ, timingSchema, trackPosition } from "./timing";
import {
  TENSION_SOUNDS,
  normalizedTensionValue,
  tensionValueFromNormalized,
  resizeTensionTrack,
  tensionStepNotes,
  tensionDecaySeconds,
} from "./tension-model";
import type { TensionParameter, TensionTrack } from "./tension-model";
import { TensionSurface } from "./tension-surface";
import type { TensionGesture } from "./tension-surface";
import "./material-instruments.css";

export interface TensionPanelOptions {
  getTrack: () => TensionTrack;
  getScale: () => MusicalScale;
  onChange: () => void;
  onPreview: (note: number, velocity: number) => void;
  onGesture: (
    phase: "begin" | "change" | "end",
    gesture: TensionGesture,
  ) => void;
  renderControl: (
    id: string,
    label: string,
    min: number,
    max: number,
    value: number,
    display: string,
    step?: string,
    ariaLabel?: string,
    allowedValues?: number[],
  ) => string;
}
const LABELS: ReadonlyArray<{ parameter: TensionParameter; label: string }> = [
  { parameter: "tension", label: "Tension" },
  { parameter: "pick", label: "Pick" },
  { parameter: "decay", label: "Decay" },
  { parameter: "damping", label: "Damping" },
  { parameter: "coupling", label: "Coupling" },
  { parameter: "drive", label: "Drive" },
  { parameter: "width", label: "Width" },
  { parameter: "volume", label: "Level" },
];
const CONTROLS: ReadonlyArray<InstrumentControl<TensionParameter>> = LABELS.map(
  (control) => ({
    ...control,
    min: 0,
    max: 100,
    multiplier: 100,
    step: "0.1",
    format: (value: number) => displayValue(control.parameter, value),
  }),
);
function displayValue(parameter: TensionParameter, value: number): string {
  if (parameter === "decay")
    return `${tensionDecaySeconds(value).toFixed(2)} s`;
  return `${Math.round(value * 100)}%`;
}

/** Performance reports gestures; the shared matrix owns sequence and automation editing. */
export function createTensionPanel(
  container: HTMLElement,
  options: TensionPanelOptions,
) {
  container.classList.add("material-instrument", "tension-instrument");
  let destroyed = false;
  let queued = false;
  let parameter: "pitch" | "gate" | "velocity" = "pitch";
  let lastStep = -1;
  let previewNote = snapNote(48, options.getScale(), 36, 84);
  const steps: BassStep[] = [];
  const velocities: number[] = [];
  container.innerHTML = `
    <div class="section-header"><div class="section-title"><span class="section-number">08</span><h2 id="tension-title">Tension</h2></div><div class="bass-actions"><button id="tension-preview">Preview</button><button id="tension-mute" class="mute-button" aria-label="Mute Tension">M</button></div></div>
    <p id="tension-host-capability" class="material-status" hidden>Host must reload Grain to play tension.</p>
    <div class="material-surface-tools"><span>Pull sideways and release · Touch height changes Pick</span><div class="material-octaves" role="group" aria-label="Tension pitch view"><button data-tension-octave="-1" aria-label="Lower Tension pitch view">−</button><output id="tension-octave-label"></output><button data-tension-octave="1" aria-label="Raise Tension pitch view">+</button></div></div>
    <div class="material-surface"><canvas id="tension-surface"></canvas></div>
    <details class="material-sound-controls"><summary>Sound <span id="tension-sound-name"></span></summary><div class="waveform-switch material-sounds" role="group" aria-label="Tension sound">${TENSION_SOUNDS.map((sound, index) => `<button data-tension-sound="${index}">${sound}</button>`).join("")}</div><div class="acid-controls material-controls">${CONTROLS.map(
      (control) => {
        const value = normalizedTensionValue(
          options.getTrack(),
          control.parameter,
        );
        return options.renderControl(
          `tension-${control.parameter}`,
          control.label,
          0,
          100,
          value * 100,
          displayValue(control.parameter, value),
          control.step,
          `Tension ${control.label.toLowerCase()}`,
        );
      },
    ).join("")}</div></details>
    <details class="material-sequence" open><summary>Sequence</summary><div id="tension-pattern-controls" class="instrument-pattern-controls"></div><div class="matrix-toolbar material-note-tools"><div role="group" aria-label="Tension note attribute">${["pitch", "gate", "velocity"].map((item) => `<button data-tension-attribute="${item}" aria-pressed="${item === "pitch"}">${item[0]?.toUpperCase()}${item.slice(1)}</button>`).join("")}</div><div class="matrix-tools" role="group" aria-label="Tension note drawing tool"><button data-tension-tool="draw" aria-pressed="true">Draw</button><button data-tension-tool="line" aria-pressed="false">Line</button><button id="tension-clear-notes">Clear notes</button></div></div><div class="note-matrix material-note-matrix"><canvas id="tension-notes-canvas" aria-label="Draw Tension notes"></canvas><div class="matrix-access" id="tension-notes-access"></div></div></details>
    <details class="material-automation-details"><summary>Automation</summary><div id="tension-automation"></div></details>`;
  const surfaceCanvas = container.querySelector("#tension-surface"),
    noteCanvas = container.querySelector("#tension-notes-canvas"),
    access = container.querySelector<HTMLElement>("#tension-notes-access"),
    pager = container.querySelector<HTMLElement>("#tension-pattern-controls"),
    automationContainer = container.querySelector<HTMLElement>(
      "#tension-automation",
    ),
    automationDetails = container.querySelector<HTMLDetailsElement>(
      ".material-automation-details",
    );
  if (
    !(surfaceCanvas instanceof HTMLCanvasElement) ||
    !(noteCanvas instanceof HTMLCanvasElement) ||
    !access ||
    !pager ||
    !automationContainer ||
    !automationDetails
  )
    throw new Error("Tension controls are missing.");
  const surface = new TensionSurface(surfaceCanvas, {
    getTrack: options.getTrack,
    getScale: options.getScale,
    onGesture: options.onGesture,
    onViewChange: renderView,
  });
  const matrix = new NoteMatrix(
    noteCanvas,
    access,
    "Tension",
    36,
    84,
    paint,
    () => automation.freezeFollow(),
  );
  const automation = createInstrumentAutomation(automationContainer, {
    prefix: "tension",
    label: "Tension",
    root: container,
    controls: CONTROLS,
    minNote: 36,
    maxNote: 84,
    getLane: (key) => options.getTrack().automation[key],
    setLane: (key, values) => {
      options.getTrack().automation[key] = values;
    },
    getBase: (key) => normalizedTensionValue(options.getTrack(), key),
    getScale: options.getScale,
    getMuted: () => options.getTrack().muted,
    getTiming: () => options.getTrack().timing,
    getSteps: () => tensionStepNotes(options.getTrack()),
    onTimingChange: (timing) => {
      const parsed = timingSchema.safeParse(timing);
      if (!parsed.success) return;
      surface.cancel();
      matrix.cancelStroke();
      Object.assign(
        options.getTrack(),
        resizeTensionTrack(options.getTrack(), parsed.data),
      );
      render();
      options.onChange();
    },
    allowedBars: [1, 2, 4, 8, 16],
    pagerContainer: pager,
    onViewportChange: (viewport) => matrix.setViewport(viewport),
    onChange: options.onChange,
  });
  function refreshNotes(): void {
    const incoming = tensionStepNotes(options.getTrack());
    steps.length = incoming.length;
    velocities.length = incoming.length;
    incoming.forEach((step, index) => {
      const target = steps[index];
      if (target) Object.assign(target, step);
      else steps[index] = { ...step };
      velocities[index] = options.getTrack().steps[index]?.velocity ?? 0.75;
    });
    matrix.update(steps, options.getScale(), options.getTrack().muted);
    if (parameter === "velocity")
      matrix.setAutomation({
        id: "tension-velocity",
        label: "Velocity",
        values: velocities,
        base: 0.75,
        format: (value) => `${Math.round(value * 100)}%`,
      });
  }
  function paint(change: MatrixChange): void {
    const track = options.getTrack();
    if (change.parameter === "restore") {
      change.steps.forEach((step, index) => {
        const target = track.steps[index];
        if (!target) return;
        target.note = step.note;
        target.on = step.on;
        const velocity =
          change.automation?.id === "tension-velocity"
            ? change.automation.values?.[index]
            : undefined;
        if (velocity !== undefined) target.velocity = velocity;
      });
    } else {
      const step = track.steps[change.index];
      if (!step) return;
      if (change.parameter === "pitch") {
        step.note = snapNote(change.value, options.getScale(), 36, 84);
        previewNote = step.note;
      } else if (change.parameter === "gate") step.on = change.value;
      else if (
        change.parameter === "automation" &&
        change.id === "tension-velocity"
      )
        step.velocity = Math.max(0, Math.min(1, change.value));
      else return;
    }
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (destroyed) return;
      refreshNotes();
      automation.refresh();
      options.onChange();
    });
  }
  function renderView(): void {
    const output = container.querySelector("#tension-octave-label");
    if (output) output.textContent = surface.octaveLabel;
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-tension-octave]",
    ))
      button.disabled =
        button.dataset.tensionOctave === "-1"
          ? !surface.canLower
          : !surface.canRaise;
  }
  function displayControl(control: InstrumentControl<TensionParameter>): void {
    const element = container.querySelector<HTMLElement>(
        `#tension-${control.parameter}`,
      ),
      value = normalizedTensionValue(options.getTrack(), control.parameter),
      display = displayValue(control.parameter, value);
    element?.setAttribute("aria-valuenow", String(value * 100));
    element?.setAttribute("aria-valuetext", display);
    element?.style.setProperty("--knob-angle", `${-135 + value * 270}deg`);
    const output = container.querySelector(
      `#tension-${control.parameter}-value`,
    );
    if (output) output.textContent = display;
  }
  function render(): void {
    if (destroyed) return;
    const track = options.getTrack();
    CONTROLS.forEach(displayControl);
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-tension-sound]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.tensionSound) === track.sound),
      );
    container
      .querySelector("#tension-mute")
      ?.setAttribute("aria-pressed", String(track.muted));
    const soundName = container.querySelector("#tension-sound-name");
    if (soundName) soundName.textContent = TENSION_SOUNDS[track.sound] ?? "";
    surface.refresh();
    renderView();
    refreshNotes();
    automation.refresh(true);
  }
  function updateControl(id: string, value: number): boolean {
    const control = CONTROLS.find((item) => `tension-${item.parameter}` === id);
    if (!control) return false;
    if (!Number.isFinite(value)) return true;
    const track = options.getTrack(),
      before = normalizedTensionValue(track, control.parameter);
    track[control.parameter] = tensionValueFromNormalized(
      control.parameter,
      value / 100,
    );
    displayControl(control);
    automation.shiftControl(
      id,
      before,
      normalizedTensionValue(track, control.parameter),
    );
    surface.refresh();
    options.onChange();
    return true;
  }
  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !container.contains(button))
      return;
    const sound = Number(button.dataset.tensionSound);
    if (
      button.dataset.tensionSound !== undefined &&
      Number.isInteger(sound) &&
      TENSION_SOUNDS[sound] !== undefined
    ) {
      options.getTrack().sound = sound;
      options.getTrack().muted = false;
      render();
      options.onChange();
      options.onPreview(previewNote, 0.75);
    } else if (button.id === "tension-preview")
      options.onPreview(previewNote, 0.75);
    else if (button.id === "tension-mute") {
      options.getTrack().muted = !options.getTrack().muted;
      render();
      options.onChange();
    } else if (button.dataset.tensionOctave)
      surface.shiftOctave(Number(button.dataset.tensionOctave));
    else if (
      ["pitch", "gate", "velocity"].includes(
        button.dataset.tensionAttribute ?? "",
      )
    ) {
      const selected = button.dataset.tensionAttribute;
      if (
        selected !== "pitch" &&
        selected !== "gate" &&
        selected !== "velocity"
      )
        return;
      parameter = selected;
      matrix.setParameter(selected === "velocity" ? "gate" : selected);
      for (const item of container.querySelectorAll<HTMLElement>(
        "[data-tension-attribute]",
      ))
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.tensionAttribute === parameter),
        );
      refreshNotes();
    } else if (
      button.dataset.tensionTool === "draw" ||
      button.dataset.tensionTool === "line"
    ) {
      matrix.setTool(button.dataset.tensionTool);
      for (const item of container.querySelectorAll<HTMLElement>(
        "[data-tension-tool]",
      ))
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.tensionTool === button.dataset.tensionTool),
        );
    } else if (button.id === "tension-clear-notes") {
      matrix.cancelStroke();
      for (const step of options.getTrack().steps) step.on = false;
      refreshNotes();
      automation.refresh();
      options.onChange();
    }
  }
  const focusNotes = (): void => automation.freezeFollow();
  container.addEventListener("click", click);
  access.addEventListener("focusin", focusNotes);
  void document.fonts.ready.then(() => {
    if (!destroyed) refreshNotes();
  });
  render();
  function setPosition(tick: number, swing: number): void {
    const track = options.getTrack(),
      index = tick < 0 ? -1 : trackPosition(track.timing, tick, swing).index;
    matrix.setStep(index);
    automation.setPosition(tick, swing);
    if (index !== lastStep) {
      const step = track.steps[index];
      if (!track.muted && step?.on) surface.pulse(step.note, step.velocity);
      lastStep = index;
    }
  }
  return {
    render,
    refreshAutomation: () => {
      refreshNotes();
      automation.refresh();
      surface.refresh();
    },
    setPosition,
    setStep: (step: number) => setPosition(step < 0 ? -1 : (step * PPQ) / 4, 0),
    updateControl,
    activateControl: (id: string): boolean => {
      if (!CONTROLS.some((control) => `tension-${control.parameter}` === id))
        return false;
      automationDetails.open = true;
      return automation.activateControl(id);
    },
    rebaseIncoming: (next: TensionTrack) => {
      const current = options.getTrack().timing;
      if (
        current.bars !== next.timing.bars ||
        current.meter !== next.timing.meter ||
        current.grid !== next.timing.grid
      )
        matrix.cancelStroke();
      else
        matrix.rebaseIncoming(
          tensionStepNotes(next),
          next.steps.map((step) => step.velocity),
        );
      automation.rebaseIncoming((key) => next.automation[key], next.timing);
    },
    setHostCapability: (supported: boolean) => {
      const message = container.querySelector<HTMLElement>(
        "#tension-host-capability",
      );
      if (message) message.hidden = supported;
    },
    cancelPerformance: () => surface.cancel(),
    destroy: () => {
      destroyed = true;
      surface.destroy();
      matrix.destroy();
      automation.destroy();
      container.removeEventListener("click", click);
      access.removeEventListener("focusin", focusNotes);
    },
  };
}
