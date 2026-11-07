import { STEP_COUNT, noteName, scaleNotes } from "./model";
import type { BassStep, MusicalScale } from "./model";

export type MatrixParameter = "pitch" | "gate" | "accent" | "slide";
export type MatrixTool = "draw" | "line";
export type MatrixChange =
  | { parameter: "pitch"; index: number; value: number }
  | { parameter: "gate" | "accent" | "slide"; index: number; value: boolean }
  | { parameter: "restore"; steps: ReadonlyArray<BassStep> };
interface Point {
  x: number;
  y: number;
}
interface Stroke {
  anchor: Point;
  previous: Point;
  original: BassStep[];
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
  private parameter: MatrixParameter = "pitch";
  private tool: MatrixTool = "draw";
  private current = -1;
  private selected = 0;
  private muted = false;
  private width = 1;
  private height = 1;
  private ratio = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly access: HTMLElement,
    private readonly label: string,
    private readonly min: number,
    private readonly max: number,
    private readonly onPaint: (change: MatrixChange) => void,
    private readonly onStroke: () => void,
  ) {
    this.context = canvas.getContext("2d");
    for (let index = 0; index < STEP_COUNT; index++) {
      const control = document.createElement("div");
      control.setAttribute("role", "slider");
      control.setAttribute("aria-orientation", "vertical");
      control.setAttribute(
        "aria-keyshortcuts",
        "ArrowUp ArrowDown ArrowLeft ArrowRight Enter",
      );
      control.tabIndex = index === 0 ? 0 : -1;
      control.dataset.matrixStep = String(index);
      control.addEventListener("focus", () => {
        this.selected = index;
        this.updateAccess();
      });
      control.addEventListener("keydown", (event) =>
        this.keyDown(event, index),
      );
      access.append(control);
      this.controls.push(control);
    }
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
    if (this.steps !== steps) this.cancelPointers();
    this.steps = steps;
    this.notes = scaleNotes(scale, this.min, this.max);
    this.muted = muted;
    this.draw();
  }
  setParameter(parameter: MatrixParameter): void {
    this.cancelPointers();
    this.parameter = parameter;
    this.draw();
  }
  setTool(tool: MatrixTool): void {
    this.cancelPointers();
    this.tool = tool;
  }
  setStep(step: number): void {
    this.current = step;
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
    return Math.max(1, (this.width - LEFT - RIGHT) / STEP_COUNT);
  }
  private get plotHeight(): number {
    return Math.max(1, this.height - TOP - BOTTOM);
  }
  private point(event: PointerEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(
        LEFT,
        Math.min(this.width - RIGHT - 0.01, event.clientX - bounds.left),
      ),
      y: Math.max(
        TOP,
        Math.min(this.height - BOTTOM, event.clientY - bounds.top),
      ),
    };
  }
  private index(point: Point): number {
    return Math.max(
      0,
      Math.min(STEP_COUNT - 1, Math.floor((point.x - LEFT) / this.cellWidth)),
    );
  }
  private paint(point: Point): void {
    const index = this.index(point);
    this.selected = index;
    if (this.parameter === "pitch") {
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
      this.onPaint({ parameter: "restore", steps: stroke.original });
      this.segment(stroke.anchor, point);
    } else this.segment(stroke.previous, point);
    stroke.previous = point;
    this.draw();
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.steps.length !== STEP_COUNT) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (
      event.clientX - bounds.left < LEFT ||
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
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.controls[
        (index + (event.key === "ArrowLeft" ? 15 : 1)) % STEP_COUNT
      ]?.focus();
      return;
    }
    if (
      !["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)
    )
      return;
    event.preventDefault();
    this.onStroke();
    if (event.key === "Enter" || event.key === " ")
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
  private updateAccess(): void {
    this.controls.forEach((control, index) => {
      const step = this.steps[index];
      if (!step) return;
      const value =
        this.parameter === "pitch"
          ? step.note
          : Number(this.parameter === "gate" ? step.on : step[this.parameter]);
      control.tabIndex = index === this.selected ? 0 : -1;
      control.setAttribute(
        "aria-label",
        `${this.label} ${this.parameter === "pitch" ? "note" : this.parameter === "slide" ? "glide" : this.parameter} step ${index + 1}`,
      );
      control.setAttribute(
        "aria-valuemin",
        String(this.parameter === "pitch" ? (this.notes[0] ?? this.min) : 0),
      );
      control.setAttribute(
        "aria-valuemax",
        String(
          this.parameter === "pitch" ? (this.notes.at(-1) ?? this.max) : 1,
        ),
      );
      control.setAttribute("aria-valuenow", String(value));
      control.setAttribute(
        "aria-valuetext",
        this.parameter === "pitch"
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
    ctx.font = '9px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let index = 0; index < STEP_COUNT; index++) {
      const x = LEFT + index * this.cellWidth;
      ctx.fillStyle =
        index === this.current
          ? "#44484c"
          : Math.floor(index / 4) % 2 === 0
            ? "#1c1e20"
            : "#161819";
      ctx.fillRect(x, TOP, this.cellWidth, this.plotHeight);
      ctx.strokeStyle = index % 4 === 0 ? "#555a60" : "#303438";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, TOP);
      ctx.lineTo(x + 0.5, this.height - BOTTOM);
      ctx.stroke();
      ctx.fillStyle = index === this.current ? "#fff" : "#969a9e";
      ctx.fillText(
        String(index + 1).padStart(2, "0"),
        x + this.cellWidth / 2,
        TOP / 2,
      );
    }
    if (this.parameter === "pitch") {
      this.notes.forEach((note, row) => {
        const y = this.noteY(note);
        ctx.strokeStyle = note % 12 === 0 ? "#43484d" : "#2a2d30";
        ctx.beginPath();
        ctx.moveTo(LEFT, y);
        ctx.lineTo(this.width - RIGHT, y);
        ctx.stroke();
        if (row % 3 === 0 || row === this.notes.length - 1) {
          ctx.fillStyle = "#9da2a7";
          ctx.fillText(noteName(note), LEFT / 2, y);
        }
      });
      ctx.strokeStyle = "#cbd0d5";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      this.steps.forEach((step, index) => {
        const x = LEFT + (index + 0.5) * this.cellWidth,
          y = this.noteY(step.note);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else {
      const middle = TOP + this.plotHeight / 2;
      ctx.strokeStyle = "#747a80";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(LEFT, middle);
      ctx.lineTo(this.width - RIGHT, middle);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9da2a7";
      ctx.fillText("ON", LEFT / 2, TOP + this.plotHeight * 0.25);
      ctx.fillText("OFF", LEFT / 2, TOP + this.plotHeight * 0.75);
    }
    this.steps.forEach((step, index) => {
      const x = LEFT + index * this.cellWidth,
        center = x + this.cellWidth / 2;
      const value =
        this.parameter === "gate"
          ? step.on
          : this.parameter === "accent"
            ? step.accent
            : step.slide;
      const y =
        this.parameter === "pitch"
          ? this.noteY(step.note)
          : TOP + this.plotHeight * (value ? 0.2 : 0.8);
      ctx.globalAlpha = this.muted ? 0.35 : 1;
      ctx.fillStyle = step.on ? (step.accent ? "#fff" : "#c1c6cb") : "#555b61";
      if (this.parameter !== "pitch")
        ctx.fillStyle = value ? "#e2e5e8" : "#555b61";
      ctx.fillRect(x + 2, y - 3, Math.max(3, this.cellWidth - 4), 6);
      if (this.parameter === "pitch" && step.on) {
        ctx.fillStyle = "#d9dde220";
        ctx.fillRect(
          x + 2,
          y + 3,
          Math.max(3, this.cellWidth - 4),
          this.height - BOTTOM - y - 3,
        );
        if (
          step.slide &&
          this.steps[(index + 1) % STEP_COUNT]?.on &&
          index < 15
        ) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(center, y);
          ctx.lineTo(
            center + this.cellWidth,
            this.noteY(this.steps[index + 1]?.note ?? step.note),
          );
          ctx.stroke();
        }
      }
      ctx.fillStyle = "#c1c6cb";
      ctx.font = `${this.cellWidth < 28 ? 7 : 9}px "Courier New", monospace`;
      ctx.fillText(
        this.parameter === "pitch" ? noteName(step.note) : value ? "●" : "·",
        center,
        this.height - BOTTOM / 2,
      );
      ctx.globalAlpha = 1;
    });
    ctx.lineWidth = 1;
  }
}
