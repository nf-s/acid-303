import type { BassStep, MusicalScale } from "./model";
import { NoteMatrix } from "./note-matrix";
import { PatternControls } from "./pattern-controls";
import { PPQ, trackPosition, trackStepCount } from "./timing";
import type { Timing } from "./timing";
import type { MatrixChange, MatrixTool } from "./note-matrix";

export interface InstrumentControl<Parameter extends string> {
  parameter: Parameter;
  label: string;
  min: number;
  max: number;
  multiplier: number;
  step?: string;
}
interface AutomationOptions<Parameter extends string> {
  prefix: string;
  label: string;
  root: HTMLElement;
  minNote: number;
  maxNote: number;
  controls: ReadonlyArray<InstrumentControl<Parameter>>;
  getLane: (parameter: Parameter) => number[] | null;
  setLane: (parameter: Parameter, values: number[] | null) => void;
  getBase: (parameter: Parameter) => number;
  getSteps: () => ReadonlyArray<BassStep>;
  getScale: () => MusicalScale;
  getMuted: () => boolean;
  getTiming: () => Timing;
  onTimingChange: (timing: Timing) => void;
  allowedBars?: ReadonlyArray<Timing["bars"]>;
  pagerContainer?: HTMLElement;
  onViewportChange?: (viewport: { start: number; count: number }) => void;
  onChange: () => void;
}
interface LaneSnapshot<Parameter extends string> {
  parameter: Parameter;
  values: number[] | null;
}

export function createInstrumentAutomation<Parameter extends string>(
  container: HTMLElement,
  options: AutomationOptions<Parameter>,
) {
  const first =
    options.controls.find((control) => control.parameter === "tone") ??
    options.controls[0];
  if (!first) throw new Error("Automation controls are missing.");
  let selected = first;
  let tool: MatrixTool = "draw";
  let undo: LaneSnapshot<Parameter> | null = null;
  let queued = false;
  let destroyed = false;
  let absoluteTick = -1;
  let swing = 0;
  let timingSignature = "";
  const sweeps = new Map<string, { base: number; values: number[] }>();
  const steps: BassStep[] = [];
  const id = (parameter: Parameter): string => `${options.prefix}-${parameter}`;
  container.classList.add("instrument-automation");
  container.innerHTML = `${options.pagerContainer ? "" : `<div id="${options.prefix}-pattern-controls" class="instrument-pattern-controls"></div>`}<div class="matrix-toolbar"><div class="instrument-lane-title"><span id="${options.prefix}-lane-label"></span><span id="${options.prefix}-lane-duration"></span></div><div class="matrix-tools"><button data-automation-tool="draw" aria-pressed="true">Draw</button><button data-automation-tool="line" aria-pressed="false">Line</button><button id="${options.prefix}-automation-undo" disabled>Undo</button><button id="${options.prefix}-automation-clear">Clear curve</button></div></div><div class="note-matrix instrument-automation-matrix"><canvas id="${options.prefix}-matrix-canvas" aria-label="Draw ${options.label} automation"></canvas><div class="matrix-access" id="${options.prefix}-matrix-access"></div></div>`;
  const canvas = container.querySelector("canvas");
  const access = container.querySelector<HTMLElement>(".matrix-access");
  if (!(canvas instanceof HTMLCanvasElement) || !access)
    throw new Error("Automation matrix is missing.");

  const snapshot = (): void => {
    pager.freezeFollow();
    const values = options.getLane(selected.parameter);
    undo = {
      parameter: selected.parameter,
      values: values ? [...values] : null,
    };
  };
  const commit = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (destroyed) return;
      refresh();
      options.onChange();
    });
  };
  const paint = (change: MatrixChange): void => {
    if (change.parameter === "restore" && change.automation) {
      const control = options.controls.find(
        (control) => id(control.parameter) === change.automation?.id,
      );
      if (!control) return;
      options.setLane(
        control.parameter,
        change.automation.values ? [...change.automation.values] : null,
      );
    } else if (change.parameter === "automation") {
      const control = options.controls.find(
        (control) => id(control.parameter) === change.id,
      );
      if (!control) return;
      const lane =
        options.getLane(control.parameter) ??
        Array.from({ length: trackStepCount(options.getTiming()) }, () =>
          options.getBase(control.parameter),
        );
      if (
        !Number.isInteger(change.index) ||
        change.index < 0 ||
        change.index >= lane.length
      )
        return;
      lane[change.index] = change.value;
      options.setLane(control.parameter, lane);
    } else return;
    commit();
  };
  const matrix = new NoteMatrix(
    canvas,
    access,
    options.label,
    options.minNote,
    options.maxNote,
    paint,
    snapshot,
    true,
  );

  const internalPager = container.querySelector<HTMLElement>(
    `#${options.prefix}-pattern-controls`,
  );
  const pagerContainer = options.pagerContainer ?? internalPager;
  if (!pagerContainer) throw new Error("Pattern controls are missing.");
  if (options.pagerContainer && internalPager) internalPager.hidden = true;
  const pager = new PatternControls(pagerContainer, {
    label: options.label,
    allowedBars: options.allowedBars,
    onTimingChange: options.onTimingChange,
    onViewportChange: (viewport) => {
      matrix.setViewport(viewport);
      options.onViewportChange?.(viewport);
    },
    isBusy: () => matrix.busy,
  });

  function refresh(resetHistory = false): void {
    if (destroyed) return;
    if (resetHistory) {
      undo = null;
      sweeps.clear();
    }
    const timing = options.getTiming();
    const nextSignature = `${timing.bars}:${timing.meter}:${timing.grid}`;
    if (timingSignature !== nextSignature) {
      matrix.cancelStroke();
      undo = null;
      sweeps.clear();
      timingSignature = nextSignature;
    }
    const incoming = options.getSteps();
    steps.length = incoming.length;
    incoming.forEach((step, index) => {
      const target = steps[index];
      if (target) Object.assign(target, step);
      else steps[index] = { ...step };
    });
    matrix.update(steps, options.getScale(), options.getMuted());
    matrix.setAutomation({
      id: id(selected.parameter),
      label: selected.label,
      values: options.getLane(selected.parameter),
      base: options.getBase(selected.parameter),
      format: (value) => {
        const actual = selected.min + value * (selected.max - selected.min);
        return `${Math.round(actual)}${selected.parameter === "decay" ? " ms" : "%"}`;
      },
    });
    const label = container.querySelector(`#${options.prefix}-lane-label`);
    if (label) label.textContent = `${selected.label} automation`;
    const duration = container.querySelector(
      `#${options.prefix}-lane-duration`,
    );
    if (duration)
      duration.textContent = `${trackStepCount(timing)} ${options.prefix === "pad" ? "points" : "steps"}`;
    pager.update(timing);
    const clear = container.querySelector(
      `#${options.prefix}-automation-clear`,
    );
    if (clear instanceof HTMLButtonElement)
      clear.disabled = options.getLane(selected.parameter) === null;
    const undoButton = container.querySelector(
      `#${options.prefix}-automation-undo`,
    );
    if (undoButton instanceof HTMLButtonElement)
      undoButton.disabled = undo === null;
    for (const control of options.controls) {
      const element = options.root.querySelector(`#${id(control.parameter)}`);
      const face = element?.querySelector(".knob-face");
      if (face && !face.querySelector(".automation-live")) {
        const marker = document.createElement("span");
        marker.className = "automation-live";
        marker.setAttribute("aria-hidden", "true");
        face.append(marker);
      }
      const automated = options.getLane(control.parameter) !== null;
      element?.classList.toggle("automated", automated);
      element?.classList.toggle(
        "automation-selected",
        control.parameter === selected.parameter,
      );
      element?.setAttribute("data-automated", String(automated));
      element?.setAttribute("data-automation-control", id(control.parameter));
      element?.setAttribute("aria-controls", `${options.prefix}-matrix-canvas`);
      element?.setAttribute(
        "title",
        "Click or Enter to draw automation · Drag to adjust",
      );
      element?.setAttribute(
        "aria-description",
        "Drag to adjust. Press Enter to draw automation.",
      );
    }
    setPosition(absoluteTick, swing);
  }
  function setPosition(tick: number, amount: number): void {
    absoluteTick = tick;
    swing = amount;
    pager.setTick(tick, amount);
    matrix.setStep(
      tick < 0 ? -1 : trackPosition(options.getTiming(), tick, amount).index,
    );
  }
  function setStep(step: number): void {
    setPosition(step < 0 ? -1 : (step * PPQ) / 4, 0);
  }
  const click = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!button || !container.contains(button)) return;
    const nextTool = button.dataset.automationTool;
    if (nextTool === "draw" || nextTool === "line") {
      tool = nextTool;
      matrix.setTool(tool);
      container
        .querySelectorAll<HTMLElement>("[data-automation-tool]")
        .forEach((element) =>
          element.setAttribute(
            "aria-pressed",
            String(element.dataset.automationTool === tool),
          ),
        );
    }
    if (button.id === `${options.prefix}-automation-clear`) {
      matrix.cancelStroke();
      snapshot();
      options.setLane(selected.parameter, null);
      refresh();
      options.onChange();
    }
    if (button.id === `${options.prefix}-automation-undo` && undo) {
      matrix.cancelStroke();
      const saved = undo;
      const control = options.controls.find(
        (control) => control.parameter === saved.parameter,
      );
      if (control) selected = control;
      options.setLane(saved.parameter, saved.values ? [...saved.values] : null);
      undo = null;
      refresh();
      options.onChange();
    }
  };
  const keyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.dataset.matrixStep === undefined
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(event.target.dataset.matrixStep);
    snapshot();
    const value =
      options.getLane(selected.parameter)?.[index] ??
      options.getBase(selected.parameter);
    paint({
      parameter: "automation",
      id: id(selected.parameter),
      index,
      value: value > 0.5 ? 0 : 1,
    });
  };
  const startGesture = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return;
    const element = event.target.closest(".gesture-control");
    if (element && options.root.contains(element)) sweeps.delete(element.id);
  };
  const focusMatrix = (): void => pager.freezeFollow();
  container.addEventListener("click", click);
  access.addEventListener("focusin", focusMatrix);
  access.addEventListener("keydown", keyDown, true);
  document.addEventListener("pointerdown", startGesture, true);
  void document.fonts.ready.then(() => refresh());
  refresh();
  return {
    refresh,
    setStep,
    setPosition,
    freezeFollow: () => pager.freezeFollow(),
    get viewport() {
      return pager.viewport;
    },
    rebaseIncoming(
      getLane: (parameter: Parameter) => ReadonlyArray<number> | null,
      timing: Timing,
    ): void {
      const current = options.getTiming();
      if (
        current.bars !== timing.bars ||
        current.meter !== timing.meter ||
        current.grid !== timing.grid
      )
        matrix.cancelStroke();
      else matrix.rebaseIncoming(steps, getLane(selected.parameter));
      undo = null;
      sweeps.clear();
    },
    activateControl(controlId: string): boolean {
      const control = options.controls.find(
        (control) => id(control.parameter) === controlId,
      );
      if (!control) return false;
      if (selected.parameter !== control.parameter) matrix.cancelStroke();
      selected = control;
      refresh();
      container.scrollIntoView({ block: "nearest" });
      return true;
    },
    shiftControl(controlId: string, before: number, after: number): void {
      const control = options.controls.find(
        (control) => id(control.parameter) === controlId,
      );
      if (!control) return;
      const lane = options.getLane(control.parameter);
      if (lane) {
        const held = options.root
          .querySelector(`#${controlId}`)
          ?.classList.contains("dragging");
        if (!held) sweeps.delete(controlId);
        if (held && !sweeps.has(controlId))
          sweeps.set(controlId, { base: before, values: [...lane] });
        const sweep = held ? sweeps.get(controlId) : undefined;
        const delta = after - (sweep?.base ?? before);
        options.setLane(
          control.parameter,
          (sweep?.values ?? lane).map((value) =>
            Math.max(0, Math.min(1, value + delta)),
          ),
        );
      }
      undo = null;
      refresh();
    },
    destroy(): void {
      destroyed = true;
      matrix.destroy();
      pager.destroy();
      container.removeEventListener("click", click);
      access.removeEventListener("keydown", keyDown, true);
      access.removeEventListener("focusin", focusMatrix);
      document.removeEventListener("pointerdown", startGesture, true);
    },
  };
}
