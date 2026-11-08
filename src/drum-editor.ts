import {
  DRUM_META,
  automatedDrum,
  drumValueFromNormalized,
  normalizedDrumValue,
  resizeDrumTrack,
  resizeDrumAutomation,
  scaleNotes,
} from "./model";
import type {
  BassStep,
  DrumAutomationParameter,
  DrumId,
  DrumTrack,
  Project,
  MusicalScale,
} from "./model";
import { NoteMatrix } from "./note-matrix";
import type {
  MatrixAutomationView,
  MatrixChange,
  MatrixTool,
} from "./note-matrix";
import { PatternControls } from "./pattern-controls";
import type { PatternViewport } from "./pattern-controls";
import {
  automationPosition,
  automationStepCount,
  automationTiming,
  sequenceTimingSchema,
  trackPosition,
} from "./timing";
import type { AutomationBars } from "./timing";

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
type Surface = "sequence" | "automation";
interface DrumSurface {
  matrix: NoteMatrix;
  steps: BassStep[];
}
interface DrumView {
  sequence: DrumSurface;
  automation: DrumSurface;
}
interface Pager {
  element: HTMLDivElement;
  controls: PatternControls;
}
interface LaneSnapshot {
  parameter: DrumAutomationParameter;
  values: number[] | null;
}

export class DrumEditor {
  private advanced = false;
  private readonly views = new Map<DrumId, DrumView>();
  private readonly selected = new Map<DrumId, DrumAutomationParameter>();
  private readonly automationViews = new Map<DrumId, MatrixAutomationView>();
  private readonly pagers = new Map<DrumId, Pager>();
  private readonly automationPagers = new Map<DrumId, Pager>();
  private readonly disclosures = new Map<
    DrumId,
    { sequence: boolean; automation: boolean }
  >();
  private readonly tools = new Map<string, MatrixTool>();
  private readonly undo = new Map<DrumId, LaneSnapshot>();
  private queued = false;
  private pendingScroll: number | null = null;
  private renderedProject: Project | null = null;
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
  private track(id: DrumId): DrumTrack | undefined {
    return this.options.getProject().drums.find((track) => track.id === id);
  }
  private parameter(id: DrumId): DrumAutomationParameter {
    return this.selected.get(id) ?? "pitch";
  }
  private pager(track: DrumTrack, surface: Surface): Pager {
    const collection =
      surface === "sequence" ? this.pagers : this.automationPagers;
    const existing = collection.get(track.id);
    if (existing) return existing;
    const element = document.createElement("div"),
      id = track.id;
    element.id = `${id}-${surface}-pattern-controls`;
    const automation = surface === "automation";
    const controls = new PatternControls(element, {
      label: `${DRUM_META[id].name}${automation ? " automation" : ""}`,
      barsOnly: automation,
      allowedBars: automation ? [1, 2, 4, 8, 16] : [1, 2, 4, 8],
      onFollowSequence: automation
        ? () => this.resizeAutomation(id, null)
        : undefined,
      isBusy: () =>
        Boolean(
          this.views.get(id)?.[surface].matrix.busy ||
          (!automation &&
            !this.advanced &&
            this.options.getSelected() === id &&
            this.options.isBusy?.()),
        ),
      onViewportChange: (viewport) => {
        this.views.get(id)?.[surface].matrix.setViewport(viewport);
        if (!automation && !this.advanced && this.options.getSelected() === id)
          this.options.onViewportChange?.(viewport);
      },
      onTimingChange: (timing) => {
        if (automation) {
          this.resizeAutomation(id, timing.bars);
          return;
        }
        const parsed = sequenceTimingSchema.safeParse(timing),
          current = this.track(id);
        if (!parsed.success || !current) return;
        this.views.get(id)?.sequence.matrix.cancelStroke();
        this.views.get(id)?.automation.matrix.cancelStroke();
        this.options.beforeTimingChange?.();
        this.options.onStroke();
        this.undo.delete(id);
        Object.assign(current, resizeDrumTrack(current, parsed.data));
        this.refresh(id);
        this.options.onChange();
      },
    });
    const pager = { element, controls };
    collection.set(id, pager);
    return pager;
  }
  private resizeAutomation(id: DrumId, bars: AutomationBars): void {
    const track = this.track(id);
    if (!track) return;
    this.views.get(id)?.automation.matrix.cancelStroke();
    this.options.onStroke();
    this.undo.delete(id);
    Object.assign(track, resizeDrumAutomation(track, bars));
    this.refresh(id);
    this.options.onChange();
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
  private section(track: DrumTrack, surface: Surface): string {
    const open =
      this.disclosures.get(track.id)?.[surface] ?? surface === "sequence";
    const automation = surface === "automation",
      id = track.id;
    const stem = automation ? `${id}-matrix` : `${id}-sequence`;
    const tool = this.tools.get(`${id}-${surface}`) ?? "draw";
    return `<details class="instrument-section instrument-${automation ? "automation-section" : "sequence"}" data-drum-${surface}="${id}" ${open ? "open" : ""}><summary>${automation ? "Automation" : "Sequence"}</summary><div data-drum-pager="${id}-${surface}"></div>
      <div class="matrix-toolbar">${automation ? `<div class="matrix-parameters"><span id="${id}-lane-label">Pitch automation</span></div><div class="automation-view" role="group" aria-label="${DRUM_META[id].name} automation view"><button data-drum-view="page" data-drum-target="${id}" aria-pressed="true">Page</button><button data-drum-view="loop" data-drum-target="${id}" aria-pressed="false">Whole loop</button></div>` : `<span>Gates</span>`}<div class="matrix-tools"><button data-drum-tool="draw" data-drum-target="${id}" data-drum-surface="${surface}" aria-pressed="${tool === "draw"}">Draw</button><button data-drum-tool="line" data-drum-target="${id}" data-drum-surface="${surface}" aria-pressed="${tool === "line"}">Line</button>${automation ? `<button data-drum-undo="${id}" disabled>Undo</button><button data-drum-clear="${id}">Clear curve</button>` : ""}</div></div>
      <div class="note-matrix drum-matrix"><canvas id="${stem}-canvas" aria-label="Draw ${DRUM_META[id].name} ${automation ? "automation" : "gates"}"></canvas><div class="matrix-access" id="${stem}-access"></div></div></details>`;
  }
  render(): void {
    if (this.pendingScroll !== null) window.clearTimeout(this.pendingScroll);
    this.pendingScroll = null;
    const project = this.options.getProject(),
      selected = this.options.getSelected();
    if (this.renderedProject !== project) this.undo.clear();
    this.renderedProject = project;
    for (const track of project.drums) {
      const sequence = this.container.querySelector<HTMLDetailsElement>(
          `[data-drum-sequence="${track.id}"]`,
        ),
        automation = this.container.querySelector<HTMLDetailsElement>(
          `[data-drum-automation="${track.id}"]`,
        );
      if (sequence && automation)
        this.disclosures.set(track.id, {
          sequence: sequence.open,
          automation: automation.open,
        });
    }
    for (const view of this.views.values()) {
      view.sequence.matrix.destroy();
      view.automation.matrix.destroy();
    }
    this.views.clear();
    document.getElementById("drum-simple-pattern")?.replaceChildren();
    this.container.innerHTML = `<div class="drum-mode-bar" role="group" aria-label="Drum editor mode"><button data-drum-mode="simple" aria-pressed="${!this.advanced}">Simple</button><button data-drum-mode="advanced" aria-pressed="${this.advanced}">Advanced</button></div>${
      this.advanced
        ? project.drums
            .map(
              (track) =>
                `<section class="drum-detail" aria-label="${DRUM_META[track.id].name} editor"><div class="drum-detail-header"><h3>${DRUM_META[track.id].name}</h3>${this.sounds(track)}</div>${this.controls(track)}${this.section(track, "sequence")}${this.section(track, "automation")}</section>`,
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
    for (const track of project.drums) {
      if (!this.advanced && track.id !== selected) continue;
      if (this.advanced) {
        const sequence = this.createSurface(track, "sequence"),
          automation = this.createSurface(track, "automation");
        if (sequence && automation)
          this.views.set(track.id, { sequence, automation });
        else {
          sequence?.matrix.destroy();
          automation?.matrix.destroy();
        }
      }
      const surfaces: Surface[] = this.advanced
        ? ["sequence", "automation"]
        : ["sequence"];
      for (const surface of surfaces) {
        const pager = this.pager(track, surface);
        if (this.advanced)
          this.container
            .querySelector(`[data-drum-pager="${track.id}-${surface}"]`)
            ?.append(pager.element);
        else
          (
            document.getElementById("drum-simple-pattern") ?? this.container
          ).append(pager.element);
        pager.controls.update(
          surface === "automation" ? automationTiming(track) : track.timing,
          surface === "automation" && track.automationBars === null,
        );
        this.views
          .get(track.id)
          ?.[surface].matrix.setViewport(pager.controls.viewport);
        if (!this.advanced)
          this.options.onViewportChange?.(pager.controls.viewport);
      }
    }
    this.refresh();
    const simple = document.getElementById("drum-simple-sequence");
    if (simple) simple.hidden = this.advanced;
    const beat = document.querySelector(".beat-surface"),
      footer = document
        .getElementById("paint-help")
        ?.closest(".section-footer");
    if (beat instanceof HTMLElement) beat.hidden = this.advanced;
    if (footer instanceof HTMLElement) footer.hidden = this.advanced;
  }
  private createSurface(
    track: DrumTrack,
    surface: Surface,
  ): DrumSurface | null {
    const id = track.id,
      stem = surface === "automation" ? `${id}-matrix` : `${id}-sequence`;
    const canvas = this.container.querySelector(`#${stem}-canvas`),
      access = this.container.querySelector(`#${stem}-access`);
    if (
      !(canvas instanceof HTMLCanvasElement) ||
      !(access instanceof HTMLElement)
    )
      return null;
    const matrix = new NoteMatrix(
      canvas,
      access,
      `${DRUM_META[id].name}${surface === "automation" ? " automation" : " sequence"}`,
      24,
      72,
      (change) => this.paint(id, surface, change),
      () => {
        (surface === "automation" ? this.automationPagers : this.pagers)
          .get(id)
          ?.controls.freezeFollow();
        if (surface === "automation") this.snapshot(id);
        this.options.onStroke();
      },
      true,
    );
    matrix.setParameter("gate");
    matrix.setTool(this.tools.get(`${id}-${surface}`) ?? "draw");
    access.addEventListener("focusin", () =>
      (surface === "automation" ? this.automationPagers : this.pagers)
        .get(id)
        ?.controls.freezeFollow(),
    );
    return { matrix, steps: this.context(track, surface) };
  }
  private context(
    track: DrumTrack,
    surface: Surface,
    scale: MusicalScale = this.options.getProject().scale,
  ): BassStep[] {
    const count =
      surface === "automation"
        ? automationStepCount(track)
        : track.steps.length;
    return Array.from({ length: count }, (_, index) => ({
      on: track.steps[index % track.steps.length] ?? false,
      note:
        (surface === "automation"
          ? automatedDrum(track, index, scale).pitch
          : track.pitch) + 48,
      accent: false,
      slide: false,
    }));
  }
  select(id: DrumId, parameter: DrumAutomationParameter): void {
    this.selected.set(id, parameter);
    if (!this.advanced) this.setMode(true);
    else this.refresh(id);
    const section = this.container.querySelector<HTMLDetailsElement>(
      `[data-drum-automation="${id}"]`,
    );
    if (section) section.open = true;
    if (this.pendingScroll !== null) window.clearTimeout(this.pendingScroll);
    this.pendingScroll = window.setTimeout(() => {
      this.pendingScroll = null;
      if (this.advanced)
        this.container
          .querySelector(`#${id}-matrix-canvas`)
          ?.scrollIntoView({ block: "nearest" });
    }, 0);
  }
  cancel(id: DrumId): void {
    this.views.get(id)?.automation.matrix.cancelStroke();
    this.undo.delete(id);
  }
  rebaseIncoming(project: Project): void {
    for (const track of project.drums) {
      const view = this.views.get(track.id);
      if (!view) continue;
      view.sequence.matrix.rebaseIncoming(
        this.context(track, "sequence", project.scale),
      );
      view.automation.matrix.rebaseIncoming(
        this.context(track, "automation", project.scale),
        track.automation[this.parameter(track.id)],
      );
      this.undo.delete(track.id);
    }
  }
  refresh(id?: DrumId): void {
    const project = this.options.getProject();
    for (const track of project.drums) {
      if (id && track.id !== id) continue;
      this.pagers.get(track.id)?.controls.update(track.timing);
      this.automationPagers
        .get(track.id)
        ?.controls.update(
          automationTiming(track),
          track.automationBars === null,
        );
      const parameter = this.parameter(track.id);
      for (const control of DRUM_CONTROLS) {
        const element = document.getElementById(
            `${track.id}-${control.parameter}`,
          ),
          automated = track.automation[control.parameter] !== null;
        element?.setAttribute("data-automated", String(automated));
        element?.classList.toggle("automated", automated);
        element?.classList.toggle(
          "automation-selected",
          this.advanced && parameter === control.parameter,
        );
      }
      const view = this.views.get(track.id);
      if (!view) continue;
      const surfaces: Surface[] = ["sequence", "automation"];
      for (const surface of surfaces) {
        const target = view[surface],
          next = this.context(track, surface);
        if (target.steps.length !== next.length) {
          target.matrix.cancelStroke();
          target.steps = next;
        } else
          target.steps.forEach((step, index) => {
            const value = next[index];
            if (value) Object.assign(step, value);
          });
        target.matrix.update(
          target.steps,
          { root: 0, mode: project.scale.mode },
          track.muted,
        );
      }
      const automationView = this.automationViews.get(track.id) ?? "page";
      view.automation.matrix.setAutomationView(
        automationView,
        automationTiming(track).bars,
      );
      for (const button of this.container.querySelectorAll<HTMLElement>(
        `[data-drum-view][data-drum-target="${track.id}"]`,
      ))
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.drumView === automationView),
        );
      const clear = this.container.querySelector<HTMLButtonElement>(
          `[data-drum-clear="${track.id}"]`,
        ),
        undo = this.container.querySelector<HTMLButtonElement>(
          `[data-drum-undo="${track.id}"]`,
        );
      if (clear) clear.disabled = track.automation[parameter] === null;
      if (undo) undo.disabled = !this.undo.has(track.id);
      const name =
        DRUM_CONTROLS.find((control) => control.parameter === parameter)
          ?.label ?? parameter;
      const label = document.getElementById(`${track.id}-lane-label`);
      if (label) label.textContent = `${name} automation`;
      view.automation.matrix.setAutomation({
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
    }
  }
  setStep(step: number): void {
    for (const view of this.views.values()) {
      view.sequence.matrix.setStep(step);
      view.automation.matrix.setStep(step);
    }
  }
  setTick(tick: number, swing = 0): void {
    for (const track of this.options.getProject().drums) {
      this.pagers.get(track.id)?.controls.setTick(tick, swing);
      this.automationPagers.get(track.id)?.controls.setTick(tick, swing);
      const view = this.views.get(track.id);
      view?.sequence.matrix.setStep(
        tick < 0 ? -1 : trackPosition(track.timing, tick, swing).index,
      );
      view?.automation.matrix.setStep(
        tick < 0 ? -1 : automationPosition(track, tick, swing).index,
      );
    }
  }
  private snapshot(id: DrumId): void {
    const track = this.track(id);
    if (!track) return;
    const parameter = this.parameter(id),
      values = track.automation[parameter];
    this.undo.set(id, { parameter, values: values ? [...values] : null });
  }
  private paint(id: DrumId, surface: Surface, change: MatrixChange): void {
    const track = this.track(id);
    if (!track) return;
    if (surface === "sequence") {
      if (
        change.parameter === "restore" &&
        change.steps.length === track.steps.length
      )
        track.steps = change.steps.map((step) => step.on);
      else if (
        change.parameter === "gate" &&
        Number.isInteger(change.index) &&
        change.index >= 0 &&
        change.index < track.steps.length
      )
        track.steps[change.index] = change.value;
      else return;
    } else {
      const controlId =
        change.parameter === "restore"
          ? change.automation?.id
          : change.parameter === "automation"
            ? change.id
            : undefined;
      const parameter = DRUM_CONTROLS.find(
        (control) => `${id}-${control.parameter}` === controlId,
      )?.parameter;
      if (!parameter) return;
      const count = automationStepCount(track);
      if (change.parameter === "restore" && change.automation) {
        const values = change.automation.values;
        if (values && values.length !== count) return;
        track.automation[parameter] = values ? [...values] : null;
      } else if (
        change.parameter === "automation" &&
        Number.isInteger(change.index) &&
        change.index >= 0 &&
        change.index < count
      ) {
        const lane =
          track.automation[parameter] ??
          Array.from({ length: count }, () =>
            normalizedDrumValue(track, parameter),
          );
        lane[change.index] = change.value;
        track.automation[parameter] = lane;
      } else return;
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
    if (
      !(button instanceof HTMLButtonElement) ||
      !this.container.contains(button)
    )
      return;
    if (button.dataset.drumMode) {
      this.setMode(button.dataset.drumMode === "advanced");
      return;
    }
    const id = this.options
      .getProject()
      .drums.find((track) =>
        [
          button.dataset.drumTarget,
          button.dataset.drumClear,
          button.dataset.drumUndo,
        ].includes(track.id),
      )?.id;
    if (!id) return;
    const view = this.views.get(id),
      automationView = button.dataset.drumView;
    if (automationView === "page" || automationView === "loop") {
      this.automationPagers.get(id)?.controls.freezeFollow();
      this.automationViews.set(id, automationView);
      this.refresh(id);
    }
    const tool = button.dataset.drumTool,
      surface = button.dataset.drumSurface;
    if (
      (tool === "draw" || tool === "line") &&
      (surface === "sequence" || surface === "automation")
    ) {
      this.tools.set(`${id}-${surface}`, tool);
      view?.[surface].matrix.setTool(tool);
      for (const item of this.container.querySelectorAll<HTMLElement>(
        `[data-drum-tool][data-drum-target="${id}"][data-drum-surface="${surface}"]`,
      ))
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.drumTool === tool),
        );
    }
    const track = this.track(id);
    if (!track) return;
    if (button.dataset.drumClear) {
      view?.automation.matrix.cancelStroke();
      this.snapshot(id);
      track.automation[this.parameter(id)] = null;
      this.refresh(id);
      this.options.onChange();
    }
    const saved = this.undo.get(id);
    if (button.dataset.drumUndo && saved) {
      view?.automation.matrix.cancelStroke();
      this.selected.set(id, saved.parameter);
      track.automation[saved.parameter] = saved.values
        ? [...saved.values]
        : null;
      this.undo.delete(id);
      this.refresh(id);
      this.options.onChange();
    }
  };
}
