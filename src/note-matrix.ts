import { noteName, scaleNotes } from "./model";
import type { PatternViewport } from "./pattern-controls";
import type { BassStep, MusicalScale } from "./model";

export type MatrixParameter = "pitch" | "gate" | "accent" | "slide";
export type MatrixTool = "draw" | "line";
export type MatrixAutomationView = "page" | "loop";
export interface MatrixAutomation {
  id: string;
  label: string;
  values: ReadonlyArray<number> | null;
  base: number;
  format: (normalized: number) => string;
}
interface AutomationSnapshot {
  id: string;
  values: number[] | null;
}
export type MatrixChange =
  | { parameter: "pitch"; index: number; value: number }
  | { parameter: "gate" | "accent" | "slide"; index: number; value: boolean }
  | { parameter: "automation"; id: string; index: number; value: number }
  | {
      parameter: "restore";
      steps: ReadonlyArray<BassStep>;
      automation?: AutomationSnapshot;
    };
interface Point {
  x: number;
  y: number;
}
interface Stroke {
  anchor: Point;
  previous: Point;
  original: BassStep[];
  automation?: AutomationSnapshot;
  tool: MatrixTool;
}
const LEFT = 34,
  RIGHT = 8,
  TOP = 24,
  BOTTOM = 28;

/** Scale-quantized curve drawing with independent pointers and keyboard columns. */
export class NoteMatrix {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver;
  private readonly pointers = new Map<number, Stroke>();
  private readonly controls: HTMLDivElement[] = [];
  private steps: ReadonlyArray<BassStep> = [];
  private notes: number[] = [];
  private scale: MusicalScale | null = null;
  private parameter: MatrixParameter = "pitch";
  private automation: MatrixAutomation | null = null;
  private tool: MatrixTool = "draw";
  private current = -1;
  private selected = 0;
  private muted = false;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private viewportStart = 0;
  private viewportCount = 16;
  private groupSize = 4;
  private stepCount = 0;
  private automationViewPreference: MatrixAutomationView = "page";
  private loopBars = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly access: HTMLElement,
    private readonly label: string,
    private readonly min: number,
    private readonly max: number,
    private readonly onPaint: (change: MatrixChange) => void,
    private readonly onStroke: () => void,
    private readonly drums = false,
  ) {
    this.context = canvas.getContext("2d");
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("lostpointercapture", this.pointerCancel);
    window.addEventListener("blur", this.cancelPointers);
    this.resize();
  }

  update(
    steps: ReadonlyArray<BassStep>,
    scale: MusicalScale,
    muted = false,
  ): void {
    if (
      this.steps !== steps ||
      this.stepCount !== steps.length ||
      this.scale?.root !== scale.root ||
      this.scale?.mode !== scale.mode
    )
      this.cancelPointers();
    this.steps = steps;
    this.stepCount = steps.length;
    this.viewportStart = Math.min(
      this.viewportStart,
      Math.max(0, steps.length - 1),
    );
    this.scale = { ...scale };
    this.notes = scaleNotes(scale, this.min, this.max);
    this.muted = muted;
    this.draw();
  }
  get busy(): boolean {
    return this.pointers.size > 0;
  }
  setViewport(viewport: PatternViewport): void {
    const start = Number.isFinite(viewport.start)
      ? Math.max(0, Math.floor(viewport.start))
      : 0;
    const count = Number.isFinite(viewport.count)
      ? Math.max(1, Math.min(16, Math.floor(viewport.count)))
      : 16;
    const groupSize = [2, 3, 4, 6].includes(viewport.groupSize ?? 4)
      ? (viewport.groupSize ?? 4)
      : 4;
    if (
      start === this.viewportStart &&
      count === this.viewportCount &&
      groupSize === this.groupSize
    )
      return;
    if (!this.overview) this.cancelPointers();
    this.viewportStart = start;
    this.viewportCount = count;
    this.groupSize = groupSize;
    if (!this.overview) this.selected = start;
    this.draw();
  }
  get automationView(): MatrixAutomationView {
    return this.automationViewPreference;
  }
  setAutomationView(view: MatrixAutomationView, bars: number): void {
    const count = Number.isFinite(bars)
      ? Math.max(1, Math.min(16, Math.round(bars)))
      : 1;
    if (view === this.automationViewPreference && count === this.loopBars)
      return;
    this.cancelPointers();
    this.automationViewPreference = view;
    this.loopBars = count;
    this.draw();
  }
  private get overview(): boolean {
    return this.automation !== null && this.automationViewPreference === "loop";
  }
  private get viewStart(): number {
    return this.overview ? 0 : this.viewportStart;
  }
  private get visibleCount(): number {
    if (this.overview) return this.steps.length;
    return Math.max(
      0,
      Math.min(this.viewportCount, this.steps.length - this.viewportStart),
    );
  }
  private get visibleSteps(): ReadonlyArray<BassStep> {
    return this.steps.slice(this.viewStart, this.viewStart + this.visibleCount);
  }
  setParameter(parameter: MatrixParameter): void {
    this.cancelPointers();
    this.parameter = parameter;
    this.automation = null;
    this.draw();
  }
  setAutomation(lane: MatrixAutomation | null): void {
    if (this.automation?.id !== lane?.id) this.cancelPointers();
    this.automation = lane;
    if (!this.pointers.size) this.draw();
  }
  setTool(tool: MatrixTool): void {
    this.cancelPointers();
    this.tool = tool;
  }
  cancelStroke(): void {
    this.cancelPointers();
  }
  rebaseIncoming(
    steps: ReadonlyArray<BassStep>,
    values?: ReadonlyArray<number> | null,
  ): void {
    if (
      steps.length !== this.stepCount ||
      (values && values.length !== steps.length)
    ) {
      this.cancelPointers();
      return;
    }
    for (const stroke of this.pointers.values()) {
      stroke.original.forEach((original, index) => {
        const current = this.steps[index],
          next = steps[index];
        if (!current || !next) return;
        if (current.note !== next.note) original.note = next.note;
        if (current.on !== next.on) original.on = next.on;
        if (current.accent !== next.accent) original.accent = next.accent;
        if (current.slide !== next.slide) original.slide = next.slide;
      });
      if (stroke.automation && this.automation && values !== undefined) {
        const baseline = Array.from(
          { length: this.steps.length },
          (_, index) =>
            stroke.automation?.values?.[index] ?? this.automation?.base ?? 0,
        );
        let changed = false;
        for (let index = 0; index < this.steps.length; index++) {
          const current =
            this.automation.values?.[index] ?? this.automation.base;
          const next = values?.[index] ?? this.automation.base;
          if (current !== next) {
            baseline[index] = next;
            changed = true;
          }
        }
        if (changed) stroke.automation.values = baseline;
      }
    }
  }
  setStep(step: number): void {
    const next =
      Number.isInteger(step) && step >= 0 && step < this.steps.length
        ? step
        : -1;
    if (next === this.current) return;
    this.current = next;
    this.draw();
  }
  destroy(): void {
    this.cancelPointers();
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this.pointerCancel);
    window.removeEventListener("blur", this.cancelPointers);
    this.access.replaceChildren();
  }
  private readonly resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width);
    this.height = Math.max(1, bounds.height);
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.draw();
  };
  private get cellWidth(): number {
    return Math.max(
      0.001,
      (this.width - LEFT - RIGHT) / Math.max(1, this.visibleCount),
    );
  }
  private get plotHeight(): number {
    return Math.max(1, this.height - TOP - BOTTOM);
  }
  private point(event: PointerEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    const right = this.width - RIGHT - 0.01;
    const x = Math.max(LEFT, Math.min(right, event.clientX - bounds.left));
    return {
      x: this.overview && x >= right - 1 ? right : x,
      y: Math.max(
        TOP,
        Math.min(this.height - BOTTOM, event.clientY - bounds.top),
      ),
    };
  }
  private index(point: Point): number {
    return (
      this.viewStart +
      Math.max(
        0,
        Math.min(
          this.visibleCount - 1,
          Math.floor((point.x - LEFT) / this.cellWidth),
        ),
      )
    );
  }
  private paint(point: Point): void {
    const index = this.index(point);
    this.selected = index;
    if (this.automation) {
      this.onPaint({
        parameter: "automation",
        id: this.automation.id,
        index,
        value: Math.max(0, Math.min(1, 1 - (point.y - TOP) / this.plotHeight)),
      });
    } else if (this.parameter === "pitch") {
      const row = Math.round(
        (1 - (point.y - TOP) / this.plotHeight) * (this.notes.length - 1),
      );
      const note = this.notes[row];
      if (note === undefined) return;
      this.onPaint({ parameter: "pitch", index, value: note });
      this.onPaint({ parameter: "gate", index, value: true });
    } else
      this.onPaint({
        parameter: this.parameter,
        index,
        value: point.y < TOP + this.plotHeight / 2,
      });
  }
  private segment(from: Point, to: Point): void {
    const count = Math.max(
      1,
      Math.ceil((Math.abs(to.x - from.x) / this.cellWidth) * 4),
    );
    for (let index = 0; index <= count; index++) {
      const fraction = index / count;
      this.paint({
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
      });
    }
  }
  private move(stroke: Stroke, point: Point): void {
    if (stroke.tool === "line") {
      this.onPaint({
        parameter: "restore",
        steps: stroke.original,
        ...(stroke.automation
          ? {
              automation: {
                id: stroke.automation.id,
                values: stroke.automation.values
                  ? [...stroke.automation.values]
                  : null,
              },
            }
          : {}),
      });
      this.segment(stroke.anchor, point);
    } else this.segment(stroke.previous, point);
    stroke.previous = point;
    this.draw();
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.visibleCount === 0) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (
      event.clientX - bounds.left < LEFT ||
      event.clientX - bounds.left > this.width - RIGHT ||
      event.clientY - bounds.top < TOP ||
      event.clientY - bounds.top > this.height - BOTTOM
    )
      return;
    event.preventDefault();
    if (this.tool === "line" && this.pointers.size) return;
    if (!this.pointers.size) this.onStroke();
    const point = this.point(event);
    const stroke: Stroke = {
      anchor: point,
      previous: point,
      original: this.steps.map((step) => ({ ...step })),
      ...(this.automation
        ? {
            automation: {
              id: this.automation.id,
              values: this.automation.values
                ? [...this.automation.values]
                : null,
            },
          }
        : {}),
      tool: this.tool,
    };
    this.pointers.set(event.pointerId, stroke);
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      this.pointers.delete(event.pointerId);
      return;
    }
    this.paint(point);
    this.draw();
  };
  private readonly pointerMove = (event: PointerEvent): void => {
    const stroke = this.pointers.get(event.pointerId);
    if (!stroke) return;
    event.preventDefault();
    const samples =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [];
    if (samples.length && stroke.tool === "draw")
      for (const sample of samples) this.move(stroke, this.point(sample));
    else this.move(stroke, this.point(event));
  };
  private readonly pointerUp = (event: PointerEvent): void => {
    const stroke = this.pointers.get(event.pointerId);
    if (stroke) this.move(stroke, this.point(event));
    this.finish(event.pointerId);
  };
  private readonly pointerCancel = (event: PointerEvent): void => {
    this.finish(event.pointerId);
  };
  private finish(pointerId: number): void {
    this.pointers.delete(pointerId);
    if (this.canvas.hasPointerCapture(pointerId))
      this.canvas.releasePointerCapture(pointerId);
  }
  private readonly cancelPointers = (): void => {
    for (const id of this.pointers.keys()) this.finish(id);
  };

  private keyDown(event: KeyboardEvent, index: number): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = this.steps[index];
    if (!step) return;
    if (
      this.overview &&
      ["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(event.key)
    ) {
      event.preventDefault();
      const distance = event.key.startsWith("Page")
        ? Math.max(1, Math.round(this.steps.length / this.loopBars))
        : 1;
      const direction =
        event.key === "ArrowLeft" || event.key === "PageUp" ? -1 : 1;
      this.selected =
        (index + distance * direction + this.steps.length) % this.steps.length;
      this.draw();
      this.controls[0]?.focus();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.controls[
        (index -
          this.viewStart +
          (event.key === "ArrowLeft" ? this.visibleCount - 1 : 1)) %
          this.visibleCount
      ]?.focus();
      return;
    }
    if (
      !["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)
    )
      return;
    event.preventDefault();
    this.onStroke();
    if (this.automation) {
      const current = this.automation.values?.[index] ?? this.automation.base;
      this.onPaint({
        parameter: "automation",
        id: this.automation.id,
        index,
        value:
          event.key === "Enter" || event.key === " "
            ? Number(current <= 0.5)
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? 1
                : Math.max(
                    0,
                    Math.min(
                      1,
                      current + (event.key === "ArrowUp" ? 0.025 : -0.025),
                    ),
                  ),
      });
    } else if (event.key === "Enter" || event.key === " ")
      this.onPaint({ parameter: "gate", index, value: !step.on });
    else if (this.parameter === "pitch") {
      const position = this.notes.indexOf(step.note);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? this.notes.length - 1
            : Math.max(
                0,
                Math.min(
                  this.notes.length - 1,
                  position + (event.key === "ArrowUp" ? 1 : -1),
                ),
              );
      const note = this.notes[next];
      if (note !== undefined)
        this.onPaint({ parameter: "pitch", index, value: note });
    } else
      this.onPaint({
        parameter: this.parameter,
        index,
        value: event.key === "ArrowUp" || event.key === "End",
      });
    this.draw();
  }
  private accessIndex(column: number): number {
    return this.overview ? this.selected : this.viewStart + column;
  }
  private updateAccess(): void {
    const count = this.overview
      ? Math.min(1, this.visibleCount)
      : this.visibleCount;
    while (this.controls.length > count) this.controls.pop()?.remove();
    while (this.controls.length < count) {
      const column = this.controls.length;
      const control = document.createElement("div");
      control.setAttribute("role", "slider");
      control.setAttribute("aria-orientation", "vertical");
      control.setAttribute(
        "aria-keyshortcuts",
        "ArrowUp ArrowDown ArrowLeft ArrowRight PageUp PageDown Home End Enter Space",
      );
      control.addEventListener("focus", () => {
        this.selected = this.accessIndex(column);
        this.draw();
      });
      control.addEventListener("keydown", (event) =>
        this.keyDown(event, this.accessIndex(column)),
      );
      this.access.append(control);
      this.controls.push(control);
    }
    this.access.style.gridTemplateColumns = `repeat(${Math.max(1, count)}, minmax(0, 1fr))`;
    this.canvas.dataset.automationView = this.overview ? "loop" : "page";
    this.canvas.setAttribute(
      "aria-description",
      this.overview
        ? `${this.loopBars} bars, ${this.steps.length} automation points. Left and right move one point; Page Up and Page Down move one bar.`
        : "Current pattern page",
    );
    if (
      this.selected < this.viewStart ||
      this.selected >= this.viewStart + this.visibleCount
    )
      this.selected = this.viewStart;
    this.controls.forEach((control, column) => {
      const index = this.accessIndex(column);
      control.dataset.matrixStep = String(index);
      const step = this.steps[index];
      if (!step) return;
      const value = this.automation
        ? (this.automation.values?.[index] ?? this.automation.base)
        : this.parameter === "pitch"
          ? step.note
          : Number(this.parameter === "gate" ? step.on : step[this.parameter]);
      control.tabIndex = index === this.selected ? 0 : -1;
      control.setAttribute(
        "aria-label",
        `${this.label} ${this.automation ? this.automation.label.toLowerCase() : this.parameter === "pitch" ? "note" : this.parameter === "slide" ? "glide" : this.parameter} step ${index + 1}`,
      );
      control.setAttribute(
        "aria-valuemin",
        String(
          !this.automation && this.parameter === "pitch"
            ? (this.notes[0] ?? this.min)
            : 0,
        ),
      );
      control.setAttribute(
        "aria-valuemax",
        String(
          this.automation
            ? 100
            : this.parameter === "pitch"
              ? (this.notes.at(-1) ?? this.max)
              : 1,
        ),
      );
      control.setAttribute(
        "aria-valuenow",
        String(this.automation ? Math.round(value * 1000) / 10 : value),
      );
      control.setAttribute(
        "aria-valuetext",
        this.automation
          ? this.automation.format(value)
          : this.parameter === "pitch"
            ? `${noteName(step.note)}${step.on ? "" : ", rest"}`
            : value
              ? "On"
              : "Off",
      );
      control.dataset.on = String(step.on);
      control.dataset.accent = String(step.accent);
      control.dataset.slide = String(step.slide);
    });
  }
  private noteY(note: number): number {
    const row = this.notes.indexOf(note);
    return (
      TOP +
      this.plotHeight *
        (1 - Math.max(0, row) / Math.max(1, this.notes.length - 1))
    );
  }
  private draw(): void {
    this.updateAccess();
    const ctx = this.context;
    if (!ctx) return;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = "#131415";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (this.overview) {
      const barWidth = (this.width - LEFT - RIGHT) / this.loopBars;
      for (let bar = 0; bar < this.loopBars; bar++) {
        const x = LEFT + bar * barWidth;
        ctx.fillStyle = bar % 2 === 0 ? "#1c1e20" : "#161819";
        ctx.fillRect(x, TOP, barWidth, this.plotHeight);
        ctx.strokeStyle = "#555a60";
        ctx.beginPath();
        ctx.moveTo(x + 0.5, TOP);
        ctx.lineTo(x + 0.5, this.height - BOTTOM);
        ctx.stroke();
        ctx.fillStyle = "#aab0b6";
        ctx.fillText(
          String(bar + 1),
          x + barWidth / 2,
          TOP / 2,
          Math.max(1, barWidth - 2),
        );
      }
      if (this.current >= 0) {
        const x = LEFT + (this.current + 0.5) * this.cellWidth;
        ctx.fillStyle = "#b9bec8";
        ctx.fillRect(x - 0.75, TOP, 1.5, this.plotHeight);
      }
    } else {
      for (let index = 0; index < this.visibleCount; index++) {
        const x = LEFT + index * this.cellWidth;
        ctx.fillStyle =
          this.viewStart + index === this.current
            ? "#44484c"
            : Math.floor(index / this.groupSize) % 2 === 0
              ? "#1c1e20"
              : "#161819";
        ctx.fillRect(x, TOP, this.cellWidth, this.plotHeight);
        ctx.strokeStyle = index % this.groupSize === 0 ? "#555a60" : "#303438";
        ctx.beginPath();
        ctx.moveTo(x + 0.5, TOP);
        ctx.lineTo(x + 0.5, this.height - BOTTOM);
        ctx.stroke();
        ctx.fillStyle =
          this.viewStart + index === this.current ? "#fff" : "#969a9e";
        ctx.fillText(
          String(this.viewStart + index + 1).padStart(2, "0"),
          x + this.cellWidth / 2,
          TOP / 2,
        );
      }
    }
    this.notes.forEach((note, row) => {
      const y = this.noteY(note);
      ctx.strokeStyle = note % 12 === 0 ? "#34393e" : "#25282b";
      ctx.beginPath();
      ctx.moveTo(LEFT, y);
      ctx.lineTo(this.width - RIGHT, y);
      ctx.stroke();
      if (
        !this.automation &&
        (row % 3 === 0 || row === this.notes.length - 1)
      ) {
        ctx.fillStyle = "#9da2a7";
        ctx.fillText(noteName(note), LEFT / 2, y);
      }
    });
    if (this.automation) {
      for (const value of [1, 0.5, 0]) {
        const y = TOP + (1 - value) * this.plotHeight;
        ctx.fillStyle = "#aab0b6";
        ctx.fillText(this.automation.format(value), LEFT / 2, y, LEFT - 6);
      }
    }
    if (!this.automation && this.parameter !== "pitch") {
      const middle = TOP + this.plotHeight / 2;
      ctx.strokeStyle = "#757b81";
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(LEFT, middle);
      ctx.lineTo(this.width - RIGHT, middle);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = (this.muted ? 0.35 : 1) * (this.automation ? 0.46 : 1);
    if (this.overview) {
      ctx.strokeStyle = "#727e89";
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.visibleSteps.forEach((step, index) => {
        const x = LEFT + (index + 0.5) * this.cellWidth,
          y = this.noteY(step.note);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (step.on) {
          ctx.fillStyle = "#8d969e";
          ctx.fillRect(
            x,
            this.height - BOTTOM + 4,
            Math.max(0.5, this.cellWidth * 0.7),
            2,
          );
        }
      });
      ctx.stroke();
    } else {
      this.drawGates(ctx);
      this.drawPitch(ctx);
      if (!this.drums) {
        this.drawGlides(ctx);
        this.drawAccents(ctx);
      }
      this.visibleSteps.forEach((step, index) => {
        const center = LEFT + (index + 0.5) * this.cellWidth;
        ctx.fillStyle = step.on ? "#aab0b6" : "#697077";
        ctx.font = `${this.cellWidth < 28 ? 7 : 9}px "IBM Plex Mono", monospace`;
        ctx.fillText(noteName(step.note), center, this.height - 8);
      });
    }
    ctx.globalAlpha = this.muted ? 0.5 : 1;
    this.drawAutomation(ctx);
    if (this.overview && this.automation) {
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillStyle = "#c5ccd3";
      ctx.textAlign = "left";
      const value =
        this.automation.values?.[this.selected] ?? this.automation.base;
      ctx.fillText(
        `Step ${this.selected + 1} · ${this.automation.format(value)}`,
        LEFT,
        this.height - 8,
      );
      ctx.textAlign = "center";
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }
  private active(parameter: MatrixParameter): boolean {
    return !this.automation && this.parameter === parameter;
  }
  private drawGates(ctx: CanvasRenderingContext2D): void {
    const active = this.active("gate"),
      floor = this.height - BOTTOM,
      width = Math.max(3, this.cellWidth - 6);
    this.visibleSteps.forEach((step, index) => {
      const x = LEFT + index * this.cellWidth + 3,
        y = this.noteY(step.note);
      if (step.on) {
        ctx.fillStyle = active ? "#d9dde232" : "#aeb8c112";
        ctx.fillRect(x, y + 4, width, Math.max(0, floor - y - 4));
        ctx.fillStyle = active ? "#fff" : "#8d969e";
        ctx.fillRect(x, floor + 4, width, active ? 6 : 3);
      } else {
        ctx.strokeStyle = active ? "#899098" : "#41474d";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, floor + 4.5, width - 1, 3);
      }
    });
  }
  private drawPitch(ctx: CanvasRenderingContext2D): void {
    const active = this.active("pitch");
    ctx.strokeStyle = active ? "#d8dee4" : "#727e89";
    ctx.lineWidth = active ? 2 : 1;
    ctx.beginPath();
    this.visibleSteps.forEach((step, index) => {
      const x = LEFT + (index + 0.5) * this.cellWidth,
        y = this.noteY(step.note);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    this.visibleSteps.forEach((step, index) => {
      const x = LEFT + index * this.cellWidth + 3,
        y = this.noteY(step.note),
        width = Math.max(3, this.cellWidth - 6);
      ctx.fillStyle = step.on
        ? active
          ? "#fff"
          : "#9ba7b1"
        : active
          ? "#7b858f"
          : "#515b64";
      ctx.fillRect(x, y - (active ? 2.5 : 1.5), width, active ? 5 : 3);
      if (!step.on) {
        ctx.fillStyle = "#202427";
        ctx.fillRect(x + 1, y - 0.5, Math.max(1, width - 2), 1);
      }
    });
  }
  private drawAccents(ctx: CanvasRenderingContext2D): void {
    const active = this.active("accent");
    this.visibleSteps.forEach((step, index) => {
      const x = LEFT + (index + 0.5) * this.cellWidth,
        y = Math.max(TOP + 5, this.noteY(step.note) - 11),
        radius = active && step.accent ? 5 : 3;
      ctx.strokeStyle = step.accent
        ? active
          ? "#fff"
          : "#99a4ae"
        : active
          ? "#78838d"
          : "#47515a";
      ctx.fillStyle = active ? "#fff" : "#99a4ae";
      ctx.lineWidth = active ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      if (step.accent) ctx.fill();
      else ctx.stroke();
    });
  }
  private drawGlides(ctx: CanvasRenderingContext2D): void {
    const active = this.active("slide"),
      bend = Math.min(24, this.cellWidth * 0.4);
    ctx.strokeStyle = active ? "#fff" : "#84939e";
    ctx.lineWidth = active ? 3.5 : 1.5;
    const first = this.steps[this.viewStart];
    const previous =
      this.steps[(this.viewStart + this.steps.length - 1) % this.steps.length];
    if (first && previous?.slide) {
      const y = this.noteY(first.note) - 4;
      ctx.beginPath();
      ctx.moveTo(LEFT, y - 4);
      ctx.quadraticCurveTo(
        LEFT + 2,
        Math.max(TOP + 2, y - bend),
        LEFT + this.cellWidth / 2 - 3,
        y,
      );
      ctx.stroke();
    }
    this.visibleSteps.forEach((step, column) => {
      const index = this.viewStart + column;
      const next = this.steps[(index + 1) % this.steps.length];
      if (!step.slide || !next) return;
      const x = LEFT + (column + 0.5) * this.cellWidth,
        y = this.noteY(step.note) - 4;
      const nextY = this.noteY(next.note) - 4;
      ctx.beginPath();
      ctx.moveTo(x + 3, y);
      if (column < this.visibleCount - 1)
        ctx.bezierCurveTo(
          x + this.cellWidth * 0.35,
          Math.max(TOP + 2, y - bend),
          x + this.cellWidth * 0.65,
          Math.max(TOP + 2, nextY - bend),
          x + this.cellWidth - 3,
          nextY,
        );
      else
        ctx.quadraticCurveTo(
          this.width - RIGHT - 2,
          Math.max(TOP + 2, y - bend),
          this.width - RIGHT,
          y - 4,
        );
      ctx.stroke();
    });
  }
  private drawAutomation(ctx: CanvasRenderingContext2D): void {
    const lane = this.automation;
    if (!lane) return;
    const yAt = (index: number): number =>
      TOP +
      this.plotHeight *
        (1 - (lane.values?.[this.viewStart + index] ?? lane.base));
    const firstX = LEFT + this.cellWidth / 2,
      lastX = LEFT + (this.visibleCount - 0.5) * this.cellWidth;
    ctx.fillStyle = "#e0e8f016";
    ctx.beginPath();
    ctx.moveTo(firstX, this.height - BOTTOM);
    for (let index = 0; index < this.visibleCount; index++)
      ctx.lineTo(LEFT + (index + 0.5) * this.cellWidth, yAt(index));
    ctx.lineTo(lastX, this.height - BOTTOM);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.5;
    if (!lane.values) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(LEFT, yAt(0));
    for (let index = 0; index < this.visibleCount; index++)
      ctx.lineTo(LEFT + (index + 0.5) * this.cellWidth, yAt(index));
    ctx.lineTo(this.width - RIGHT, yAt(this.visibleCount - 1));
    ctx.stroke();
    ctx.setLineDash([]);
    for (let index = 0; index < this.visibleCount; index++) {
      if (this.overview && this.cellWidth < 8 && index !== this.selected)
        continue;
      const x = LEFT + (index + 0.5) * this.cellWidth,
        y = yAt(index);
      ctx.fillStyle = lane.values ? "#fff" : "#161819";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(
        x,
        y,
        this.viewStart + index === this.selected ? 4 : 2.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }
  }
}
