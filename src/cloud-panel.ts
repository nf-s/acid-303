import { snapNote } from "./model";
import type { BassStep, MusicalScale } from "./model";
import { createInstrumentAutomation } from "./instrument-automation";
import type { InstrumentControl } from "./instrument-automation";
import { NoteMatrix } from "./note-matrix";
import type { MatrixChange } from "./note-matrix";
import { PPQ, timingSchema, trackPosition } from "./timing";
import {
  CLOUD_PATCHES,
  applyCloudPatch,
  normalizedCloudValue,
  cloudValueFromNormalized,
  resizeCloudTrack,
  resizeCloudAutomation,
  cloudStepNotes,
  cloudGrainSeconds,
  cloudGrainsPerSecond,
} from "./cloud-model";
import type { CloudParameter, CloudTrack } from "./cloud-model";
import { CloudSurface } from "./cloud-surface";
import type { CloudGesture } from "./cloud-surface";
import "./material-instruments.css";

export interface CloudPanelOptions {
  getTrack: () => CloudTrack;
  getScale: () => MusicalScale;
  onChange: () => void;
  onPreview: (note: number, velocity: number) => void;
  onGesture: (phase: "begin" | "change" | "end", gesture: CloudGesture) => void;
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
const LABELS: ReadonlyArray<{ parameter: CloudParameter; label: string }> = [
  { parameter: "scan", label: "Scan" },
  { parameter: "size", label: "Grain size" },
  { parameter: "density", label: "Density" },
  { parameter: "scatter", label: "Scatter" },
  { parameter: "roughness", label: "Roughness" },
  { parameter: "tone", label: "Tone" },
  { parameter: "width", label: "Width" },
  { parameter: "volume", label: "Level" },
];
const CONTROLS: ReadonlyArray<InstrumentControl<CloudParameter>> = LABELS.map(
  (control) => ({
    ...control,
    min: 0,
    max: 100,
    multiplier: 100,
    step: "0.1",
    format: (value: number) => displayValue(control.parameter, value),
  }),
);
function displayValue(parameter: CloudParameter, value: number): string {
  if (parameter === "size")
    return `${Math.round(cloudGrainSeconds(value) * 1000)} ms`;
  if (parameter === "density")
    return `${cloudGrainsPerSecond(value).toFixed(1)}/s`;
  return `${Math.round(value * 100)}%`;
}

/** Performance reports gestures; the shared matrix owns sequence and automation editing. */
export function createCloudPanel(
  container: HTMLElement,
  options: CloudPanelOptions,
) {
  container.classList.add("material-instrument", "cloud-instrument");
  let destroyed = false;
  let queued = false;
  let parameter: "pitch" | "gate" | "velocity" = "pitch";
  let lastStep = -1;
  let previewNote = snapNote(
    options.getTrack().steps.find((step) => step.on)?.note ?? 48,
    options.getScale(),
    36,
    84,
  );
  const steps: BassStep[] = [];
  const velocities: number[] = [];
  container.innerHTML = `
    <div class="section-header"><div class="section-title"><span class="section-number">07</span><h2 id="cloud-title">Cloud</h2></div><div class="bass-actions"><button id="cloud-preview">Preview</button><button id="cloud-mute" class="mute-button" aria-label="Mute Cloud">M</button><button class="mute-button solo-button" data-solo="cloud" aria-label="Solo Cloud" aria-pressed="false">S</button></div></div>
    <p id="cloud-host-capability" class="material-status" hidden>Host must reload Grain to play cloud.</p>
    <div class="material-surface-tools"><span>Drag to scan and pitch · Two fingers change width</span><div class="material-octaves" role="group" aria-label="Cloud pitch view"><button data-cloud-octave="-1" aria-label="Lower Cloud pitch view">−</button><output id="cloud-octave-label"></output><button data-cloud-octave="1" aria-label="Raise Cloud pitch view">+</button></div></div>
    <div class="material-surface"><canvas id="cloud-surface"></canvas></div>
    <details class="material-sound-controls"><summary>Sound <span id="cloud-sound-name"></span></summary><div class="waveform-switch material-sounds" role="group" aria-label="Cloud sound">${CLOUD_PATCHES.map((patch) => `<button data-cloud-sound="${patch.sound}">${patch.name}</button>`).join("")}</div><div class="acid-controls material-controls">${CONTROLS.map(
      (control) => {
        const value = normalizedCloudValue(
          options.getTrack(),
          control.parameter,
        );
        return options.renderControl(
          `cloud-${control.parameter}`,
          control.label,
          0,
          100,
          value * 100,
          displayValue(control.parameter, value),
          control.step,
          `Cloud ${control.label.toLowerCase()}`,
        );
      },
    ).join("")}</div></details>
    <details class="material-sequence instrument-section instrument-sequence" open><summary>Sequence</summary><div id="cloud-pattern-controls" class="instrument-pattern-controls"></div><div class="matrix-toolbar material-note-tools"><div role="group" aria-label="Cloud note attribute">${["pitch", "gate", "velocity"].map((item) => `<button data-cloud-attribute="${item}" aria-pressed="${item === "pitch"}">${item[0]?.toUpperCase()}${item.slice(1)}</button>`).join("")}</div><div class="matrix-tools" role="group" aria-label="Cloud note drawing tool"><button data-cloud-tool="draw" aria-pressed="true">Draw</button><button data-cloud-tool="line" aria-pressed="false">Line</button><button id="cloud-clear-notes">Clear notes</button></div></div><div class="note-matrix material-note-matrix"><canvas id="cloud-notes-canvas" aria-label="Draw Cloud notes"></canvas><div class="matrix-access" id="cloud-notes-access"></div></div></details>
    <details class="material-automation-details instrument-section instrument-automation-section"><summary>Automation</summary><div id="cloud-automation"></div></details>`;
  const surfaceCanvas = container.querySelector("#cloud-surface"),
    noteCanvas = container.querySelector("#cloud-notes-canvas"),
    access = container.querySelector<HTMLElement>("#cloud-notes-access"),
    pager = container.querySelector<HTMLElement>("#cloud-pattern-controls"),
    automationContainer =
      container.querySelector<HTMLElement>("#cloud-automation"),
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
    throw new Error("Cloud controls are missing.");
  const surface = new CloudSurface(surfaceCanvas, {
    getTrack: options.getTrack,
    getScale: options.getScale,
    onGesture: options.onGesture,
    onViewChange: renderView,
  });
  const matrix = new NoteMatrix(
    noteCanvas,
    access,
    "Cloud",
    36,
    84,
    paint,
    () => automation.freezeFollow(),
  );
  const automation = createInstrumentAutomation(automationContainer, {
    prefix: "cloud",
    label: "Cloud",
    root: container,
    controls: CONTROLS,
    minNote: 36,
    maxNote: 84,
    getLane: (key) => options.getTrack().automation[key],
    setLane: (key, values) => {
      options.getTrack().automation[key] = values;
    },
    getBase: (key) => normalizedCloudValue(options.getTrack(), key),
    getScale: options.getScale,
    getMuted: () => options.getTrack().muted,
    getTiming: () => options.getTrack().timing,
    getAutomationBars: () => options.getTrack().automationBars,
    onAutomationBarsChange: (bars) => {
      Object.assign(
        options.getTrack(),
        resizeCloudAutomation(options.getTrack(), bars),
      );
      render();
      options.onChange();
    },
    getSteps: () => cloudStepNotes(options.getTrack()),
    onTimingChange: (timing) => {
      const parsed = timingSchema.safeParse(timing);
      if (!parsed.success) return;
      surface.cancel();
      matrix.cancelStroke();
      Object.assign(
        options.getTrack(),
        resizeCloudTrack(options.getTrack(), parsed.data),
      );
      render();
      options.onChange();
    },
    allowedBars: [1, 2, 4, 8, 16],
    pagerContainer: pager,
    sequenceViews: true,
    onViewportChange: (viewport) => matrix.setViewport(viewport),
    onChange: options.onChange,
  });
  function refreshNotes(): void {
    const incoming = cloudStepNotes(options.getTrack());
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
        id: "cloud-velocity",
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
          change.automation?.id === "cloud-velocity"
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
        change.id === "cloud-velocity"
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
    const output = container.querySelector("#cloud-octave-label");
    if (output) output.textContent = surface.octaveLabel;
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-cloud-octave]",
    ))
      button.disabled =
        button.dataset.cloudOctave === "-1"
          ? !surface.canLower
          : !surface.canRaise;
  }
  function displayControl(control: InstrumentControl<CloudParameter>): void {
    const element = container.querySelector<HTMLElement>(
        `#cloud-${control.parameter}`,
      ),
      value = normalizedCloudValue(options.getTrack(), control.parameter),
      display = displayValue(control.parameter, value);
    element?.setAttribute("aria-valuenow", String(value * 100));
    element?.setAttribute("aria-valuetext", display);
    element?.style.setProperty("--knob-angle", `${-135 + value * 270}deg`);
    const output = container.querySelector(`#cloud-${control.parameter}-value`);
    if (output) output.textContent = display;
  }
  function render(): void {
    if (destroyed) return;
    const track = options.getTrack();
    CONTROLS.forEach(displayControl);
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-cloud-sound]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.cloudSound) === track.sound),
      );
    container
      .querySelector("#cloud-mute")
      ?.setAttribute("aria-pressed", String(track.muted));
    const soundName = container.querySelector("#cloud-sound-name");
    if (soundName)
      soundName.textContent =
        CLOUD_PATCHES.find((patch) => patch.sound === track.sound)?.name ?? "";
    surface.refresh();
    renderView();
    refreshNotes();
    automation.refresh(true);
  }
  function updateControl(id: string, value: number): boolean {
    const control = CONTROLS.find((item) => `cloud-${item.parameter}` === id);
    if (!control) return false;
    if (!Number.isFinite(value)) return true;
    const track = options.getTrack(),
      before = normalizedCloudValue(track, control.parameter);
    track[control.parameter] = cloudValueFromNormalized(
      control.parameter,
      value / 100,
    );
    displayControl(control);
    automation.shiftControl(
      id,
      before,
      normalizedCloudValue(track, control.parameter),
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
    const sound = Number(button.dataset.cloudSound);
    if (
      button.dataset.cloudSound !== undefined &&
      Number.isInteger(sound) &&
      CLOUD_PATCHES.some((patch) => patch.sound === sound)
    ) {
      surface.cancel();
      const track = options.getTrack();
      const before = { ...track };
      Object.assign(track, applyCloudPatch(track, sound));
      for (const control of CONTROLS) {
        if (control.parameter === "volume") continue;
        automation.shiftControl(
          `cloud-${control.parameter}`,
          normalizedCloudValue(before, control.parameter),
          normalizedCloudValue(track, control.parameter),
        );
      }
      track.muted = false;
      previewNote = snapNote(
        track.steps.find((step) => step.on)?.note ?? previewNote,
        options.getScale(),
        36,
        84,
      );
      render();
      options.onChange();
      options.onPreview(previewNote, 0.75);
    } else if (button.id === "cloud-preview")
      options.onPreview(previewNote, 0.75);
    else if (button.id === "cloud-mute") {
      options.getTrack().muted = !options.getTrack().muted;
      render();
      options.onChange();
    } else if (button.dataset.cloudOctave)
      surface.shiftOctave(Number(button.dataset.cloudOctave));
    else if (
      ["pitch", "gate", "velocity"].includes(
        button.dataset.cloudAttribute ?? "",
      )
    ) {
      const selected = button.dataset.cloudAttribute;
      if (
        selected !== "pitch" &&
        selected !== "gate" &&
        selected !== "velocity"
      )
        return;
      parameter = selected;
      matrix.setParameter(selected === "velocity" ? "gate" : selected);
      for (const item of container.querySelectorAll<HTMLElement>(
        "[data-cloud-attribute]",
      ))
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.cloudAttribute === parameter),
        );
      refreshNotes();
    } else if (
      button.dataset.cloudTool === "draw" ||
      button.dataset.cloudTool === "line"
    ) {
      matrix.setTool(button.dataset.cloudTool);
      for (const item of container.querySelectorAll<HTMLElement>(
        "[data-cloud-tool]",
      ))
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.cloudTool === button.dataset.cloudTool),
        );
    } else if (button.id === "cloud-clear-notes") {
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
    activateControl: (id: string, reveal = true): boolean => {
      if (!CONTROLS.some((control) => `cloud-${control.parameter}` === id))
        return false;
      automationDetails.open = true;
      return automation.activateControl(id, reveal);
    },
    rebaseIncoming: (next: CloudTrack) => {
      const current = options.getTrack().timing;
      if (
        current.bars !== next.timing.bars ||
        current.meter !== next.timing.meter ||
        current.grid !== next.timing.grid
      )
        matrix.cancelStroke();
      else
        matrix.rebaseIncoming(
          cloudStepNotes(next),
          next.steps.map((step) => step.velocity),
        );
      automation.rebaseIncoming(
        (key) => next.automation[key],
        next.timing,
        next.automationBars,
      );
    },
    setHostCapability: (supported: boolean) => {
      const message = container.querySelector<HTMLElement>(
        "#cloud-host-capability",
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
