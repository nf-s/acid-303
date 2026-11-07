import {
  DRUM_META,
  automatedDrum,
  drumValueFromNormalized,
  normalizedDrumValue,
  resizeDrumTrack,
  scaleNotes,
} from "./model";
import type {
  BassStep,
  DrumAutomationParameter,
  DrumId,
  DrumTrack,
  Project,
} from "./model";
import { NoteMatrix } from "./note-matrix";
import type { MatrixChange } from "./note-matrix";
import { PatternControls } from "./pattern-controls";
import type { PatternViewport } from "./pattern-controls";
import { sequenceTimingSchema, trackPosition } from "./timing";

export const DRUM_CONTROLS: ReadonlyArray<{
  parameter: DrumAutomationParameter;
  label: string;
}> = [
  { parameter: "pitch", label: "Pitch" },
  { parameter: "decay", label: "Decay" },
  { parameter: "volume", label: "Level" },
  { parameter: "tone", label: "Tone" },
  { parameter: "drive", label: "Drive" },
  { parameter: "pan", label: "Pan" },
  { parameter: "attack", label: "Attack" },
  { parameter: "space", label: "Space" },
];
interface EditorOptions {
  getProject: () => Project;
  getSelected: () => DrumId;
  onChange: () => void;
  onStroke: () => void;
  onViewportChange?: (viewport: PatternViewport) => void;
  isBusy?: () => boolean;
  beforeTimingChange?: () => void;
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
interface DrumView {
  matrix: NoteMatrix;
  steps: BassStep[];
}

export class DrumEditor {
  private advanced = false;
  private readonly views = new Map<DrumId, DrumView>();
  private readonly selected = new Map<DrumId, DrumAutomationParameter | null>();
  private readonly pagers = new Map<
    DrumId,
    { element: HTMLDivElement; controls: PatternControls }
  >();
  private queued = false;
  constructor(
    private readonly container: HTMLElement,
    private readonly options: EditorOptions,
  ) {
    container.addEventListener("click", this.click);
  }
  get isAdvanced(): boolean {
    return this.advanced;
  }
  setMode(advanced: boolean): void {
    this.advanced = advanced;
    this.render();
  }
  freezeFollow(id = this.options.getSelected()): void {
    this.pagers.get(id)?.controls.freezeFollow();
  }
  private pager(track: DrumTrack): PatternControls {
    const existing = this.pagers.get(track.id);
    if (existing) return existing.controls;
    const element = document.createElement("div");
    const id = track.id;
    const controls = new PatternControls(element, {
      label: DRUM_META[id].name,
      isBusy: () =>
        this.views.get(id)?.matrix.busy ??
        (!this.advanced &&
          this.options.getSelected() === id &&
          (this.options.isBusy?.() ?? false)),
      onViewportChange: (viewport) => {
        this.views.get(id)?.matrix.setViewport(viewport);
        if (!this.advanced && this.options.getSelected() === id)
          this.options.onViewportChange?.(viewport);
      },
      onTimingChange: (timing) => {
        const parsed = sequenceTimingSchema.safeParse(timing);
        const current = this.options
          .getProject()
          .drums.find((drum) => drum.id === id);
        if (!parsed.success || !current) return;
        this.views.get(id)?.matrix.cancelStroke();
        this.options.beforeTimingChange?.();
        this.options.onStroke();
        Object.assign(current, resizeDrumTrack(current, parsed.data));
        this.refresh(id);
        this.options.onChange();
      },
    });
    this.pagers.set(id, { element, controls });
    return controls;
  }
  private controls(track: DrumTrack): string {
    const { renderControl, getProject } = this.options;
    return `<div class="instrument-dials">${DRUM_CONTROLS.map(
      ({ parameter, label }) => {
        const value = track[parameter];
        const id = `${track.id}-${parameter}`;
        if (parameter === "pitch")
          return renderControl(
            id,
            label,
            -24,
            24,
            value,
            `${value > 0 ? "+" : ""}${value} st`,
            "1",
            `${DRUM_META[track.id].name} pitch`,
            scaleNotes({ root: 0, mode: getProject().scale.mode }, -24, 24),
          );
        if (parameter === "decay")
          return renderControl(
            id,
            label,
            30,
            1500,
            value * 1000,
            `${Math.round(value * 1000)} ms`,
            "10",
            `${DRUM_META[track.id].name} decay`,
          );
        return renderControl(
          id,
          label,
          parameter === "pan" ? -100 : 0,
          100,
          value * 100,
          `${Math.round(value * 100)}%`,
          "1",
          `${DRUM_META[track.id].name} ${label.toLowerCase()}`,
        );
      },
    ).join("")}</div>`;
  }
  private sounds(track: DrumTrack): string {
    return `<div class="sound-buttons" role="group" aria-label="${DRUM_META[track.id].name} sounds">${DRUM_META[track.id].sounds.map((sound, index) => `<button data-sound="${index}" data-sound-track="${track.id}" aria-pressed="${track.sound === index}">${sound}</button>`).join("")}</div><button class="mute-button" data-mute="${track.id}" aria-label="Mute ${DRUM_META[track.id].name}" aria-pressed="${track.muted}">M</button>`;
  }
  render(): void {
    for (const view of this.views.values()) view.matrix.destroy();
    this.views.clear();
    const project = this.options.getProject();
    const selected = this.options.getSelected();
    this.container.innerHTML = `<div class="drum-mode-bar" role="group" aria-label="Drum editor mode"><button data-drum-mode="simple" aria-pressed="${!this.advanced}">Simple</button><button data-drum-mode="advanced" aria-pressed="${this.advanced}">Advanced</button></div>${
      this.advanced
        ? project.drums
            .map(
              (track) =>
                `<section class="drum-detail" aria-label="${DRUM_META[track.id].name} automation"><div class="drum-detail-header"><h3>${DRUM_META[track.id].name}</h3>${this.sounds(track)}</div>${this.controls(track)}<div class="matrix-toolbar"><div class="matrix-parameters"><button data-drum-gates="${track.id}" aria-pressed="false">Gates</button><span id="${track.id}-lane-label">Pitch automation</span></div><div class="matrix-tools"><button data-drum-tool="draw" data-drum-target="${track.id}" aria-pressed="true">Draw</button><button data-drum-tool="line" data-drum-target="${track.id}" aria-pressed="false">Line</button><button data-drum-clear="${track.id}">Clear curve</button></div></div><div class="note-matrix drum-matrix"><canvas id="${track.id}-matrix-canvas" aria-label="Draw ${DRUM_META[track.id].name} automation"></canvas><div class="matrix-access" id="${track.id}-matrix-access"></div></div></section>`,
            )
            .join("")
        : `<div class="instrument-tabs" role="group" aria-label="Drum instrument">${project.drums.map((track) => `<button data-drum="${track.id}" aria-label="Select and preview ${DRUM_META[track.id].name}" aria-pressed="${track.id === selected}">${DRUM_META[track.id].name}</button>`).join("")}</div><div id="instrument-controls" class="instrument-controls">${project.drums
            .filter((track) => track.id === selected)
            .map(
              (track) =>
                `<div class="drum-detail-header">${this.sounds(track)}</div>${this.controls(track)}`,
            )
            .join("")}</div>`
    }`;
    if (this.advanced)
      for (const track of project.drums) {
        const canvas = document.getElementById(`${track.id}-matrix-canvas`);
        const access = document.getElementById(`${track.id}-matrix-access`);
        if (
          !(canvas instanceof HTMLCanvasElement) ||
          !(access instanceof HTMLElement)
        )
          continue;
        const steps = track.steps.map((on, index) => ({
          on,
          note: automatedDrum(track, index, project.scale).pitch + 48,
          accent: false,
          slide: false,
        }));
        const matrix = new NoteMatrix(
          canvas,
          access,
          DRUM_META[track.id].name,
          24,
          72,
          (change) => this.paint(track.id, change),
          () => {
            this.freezeFollow(track.id);
            this.options.onStroke();
          },
          true,
        );
        this.views.set(track.id, { matrix, steps });
        if (!this.selected.has(track.id)) this.selected.set(track.id, "pitch");
        if (this.selected.get(track.id) === null) matrix.setParameter("gate");
      }
    for (const track of project.drums) {
      if (!this.advanced && track.id !== selected) continue;
      const controls = this.pager(track);
      const pager = this.pagers.get(track.id);
      const surface = document
        .getElementById(`${track.id}-matrix-canvas`)
        ?.closest(".note-matrix");
      if (pager) {
        if (this.advanced && surface) surface.before(pager.element);
        else this.container.append(pager.element);
      }
      controls.update(track.timing);
      this.views.get(track.id)?.matrix.setViewport(controls.viewport);
      if (!this.advanced) this.options.onViewportChange?.(controls.viewport);
    }
    this.refresh();
    const beat = document.querySelector(".beat-surface");
    if (beat instanceof HTMLElement) beat.hidden = this.advanced;
    const footer = document
      .getElementById("paint-help")
      ?.closest(".section-footer");
    if (footer instanceof HTMLElement) footer.hidden = this.advanced;
  }
  select(id: DrumId, parameter: DrumAutomationParameter): void {
    this.selected.set(id, parameter);
    if (!this.advanced) this.setMode(true);
    else this.refresh(id);
    document
      .getElementById(`${id}-matrix-canvas`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  cancel(id: DrumId): void {
    this.views.get(id)?.matrix.cancelStroke();
  }
  rebaseIncoming(project: Project): void {
    for (const track of project.drums) {
      const view = this.views.get(track.id);
      if (!view) continue;
      const steps = track.steps.map((on, index) => ({
        on,
        note: automatedDrum(track, index, project.scale).pitch + 48,
        accent: false,
        slide: false,
      }));
      const parameter = this.selected.get(track.id);
      view.matrix.rebaseIncoming(
        steps,
        parameter ? track.automation[parameter] : undefined,
      );
    }
  }
  refresh(id?: DrumId): void {
    const project = this.options.getProject();
    for (const track of project.drums) {
      if (id && track.id !== id) continue;
      this.pagers.get(track.id)?.controls.update(track.timing);
      const parameter = this.selected.get(track.id);
      for (const control of DRUM_CONTROLS) {
        const element = document.getElementById(
          `${track.id}-${control.parameter}`,
        );
        element?.setAttribute(
          "data-automated",
          String(track.automation[control.parameter] !== null),
        );
        element?.classList.toggle(
          "automated",
          track.automation[control.parameter] !== null,
        );
        element?.classList.toggle(
          "automation-selected",
          this.advanced && parameter === control.parameter,
        );
      }
      const view = this.views.get(track.id);
      if (!view) continue;
      if (view.steps.length !== track.steps.length) {
        view.matrix.cancelStroke();
        view.steps = track.steps.map((on, index) => ({
          on,
          note: automatedDrum(track, index, project.scale).pitch + 48,
          accent: false,
          slide: false,
        }));
      }
      view.steps.forEach((step, index) => {
        step.on = track.steps[index] ?? false;
        step.note = automatedDrum(track, index, project.scale).pitch + 48;
      });
      view.matrix.update(
        view.steps,
        { root: 0, mode: project.scale.mode },
        track.muted,
      );
      const label = document.getElementById(`${track.id}-lane-label`);
      const gates = this.container.querySelector(
        `[data-drum-gates="${track.id}"]`,
      );
      gates?.setAttribute("aria-pressed", String(parameter === null));
      const clear = this.container.querySelector(
        `[data-drum-clear="${track.id}"]`,
      );
      if (clear instanceof HTMLButtonElement)
        clear.disabled = !parameter || track.automation[parameter] === null;
      if (parameter) {
        const name =
          DRUM_CONTROLS.find((control) => control.parameter === parameter)
            ?.label ?? parameter;
        if (label) label.textContent = `${name} automation`;
        view.matrix.setAutomation({
          id: `${track.id}-${parameter}`,
          label: name,
          values: track.automation[parameter],
          base: normalizedDrumValue(track, parameter),
          format: (value) => {
            const actual = drumValueFromNormalized(
              parameter,
              value,
              project.scale,
            );
            return parameter === "pitch"
              ? `${actual} st`
              : parameter === "decay"
                ? `${Math.round(actual * 1000)} ms`
                : `${Math.round(actual * 100)}%`;
          },
        });
      } else {
        if (label) label.textContent = "Gates";
        view.matrix.setAutomation(null);
      }
    }
  }
  setStep(step: number): void {
    for (const view of this.views.values()) view.matrix.setStep(step);
  }
  setTick(absoluteTick: number, swing = 0): void {
    for (const track of this.options.getProject().drums) {
      this.pagers.get(track.id)?.controls.setTick(absoluteTick, swing);
      this.views
        .get(track.id)
        ?.matrix.setStep(
          absoluteTick < 0
            ? -1
            : trackPosition(track.timing, absoluteTick, swing).index,
        );
    }
  }
  private paint(id: DrumId, change: MatrixChange): void {
    const project = this.options.getProject();
    const track = project.drums.find((track) => track.id === id);
    if (!track) return;
    if (change.parameter === "restore") {
      track.steps = change.steps.map((step) => step.on);
      const parameter = DRUM_CONTROLS.find(
        (control) => `${id}-${control.parameter}` === change.automation?.id,
      )?.parameter;
      if (parameter && change.automation)
        track.automation[parameter] = change.automation.values
          ? [...change.automation.values]
          : null;
    } else if (change.parameter === "gate")
      track.steps[change.index] = change.value;
    else if (change.parameter === "automation") {
      const parameter = DRUM_CONTROLS.find(
        (control) => `${id}-${control.parameter}` === change.id,
      )?.parameter;
      if (!parameter) return;
      const lane =
        track.automation[parameter] ??
        Array.from({ length: track.steps.length }, () =>
          normalizedDrumValue(track, parameter),
        );
      lane[change.index] = change.value;
      track.automation[parameter] = lane;
    }
    if (!this.queued) {
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        this.refresh();
        this.options.onChange();
      });
    }
  }
  private click = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.drumMode)
      this.setMode(button.dataset.drumMode === "advanced");
    const id = this.options
      .getProject()
      .drums.find((track) =>
        [
          button.dataset.drumGates,
          button.dataset.drumTarget,
          button.dataset.drumClear,
        ].includes(track.id),
      )?.id;
    if (!id) return;
    const view = this.views.get(id);
    if (button.dataset.drumGates) {
      this.selected.set(id, null);
      view?.matrix.setParameter("gate");
      this.refresh(id);
    }
    const tool = button.dataset.drumTool;
    if (tool === "draw" || tool === "line") {
      view?.matrix.setTool(tool);
      this.container
        .querySelectorAll<HTMLElement>(`[data-drum-target="${id}"]`)
        .forEach((item) =>
          item.setAttribute(
            "aria-pressed",
            String(item.dataset.drumTool === tool),
          ),
        );
    }
    if (button.dataset.drumClear) {
      const track = this.options
        .getProject()
        .drums.find((track) => track.id === id);
      const parameter = this.selected.get(id);
      if (track && parameter) {
        view?.matrix.cancelStroke();
        track.automation[parameter] = null;
        this.refresh(id);
        this.options.onChange();
      }
    }
  };
}
