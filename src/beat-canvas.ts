import type { PatternViewport } from "./pattern-controls";
import type { DrumId, Project } from "./model";
import { MODE_LABELS } from "./mode";
import {
  canvasFont,
  canvasTheme,
  fillCell,
  watchCanvasTheme,
} from "./canvas-theme";

interface Point {
  x: number;
  y: number;
}
interface PaintPointer {
  point: Point;
  desired: boolean | null;
  visited: Set<string>;
  pressure: number;
}
interface Cell {
  drum: DrumId;
  step: number;
}

const DRUMS: DrumId[] = ["kick", "snare", "hat", "clap", "rim"];
const LABELS: Record<DrumId, string> = {
  kick: "KICK",
  snare: "SNARE",
  hat: "HAT",
  clap: "CLAP",
  rim: "RIM",
};
const LABEL_WIDTH = 54;
const HEADER_HEIGHT = 27;
const RIGHT_PADDING = 8;
const BOTTOM_PADDING = 8;

/** A responsive, multi-pointer paint surface for the shared drum pattern. */
export class BeatCanvas {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver;
  private readonly originalTouchAction: string;
  private readonly pointers = new Map<number, PaintPointer>();
  private project: Project | null = null;
  private selected: DrumId = "kick";
  private step = -1;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private destroyed = false;
  private viewportStart = 0;
  private viewportCount = 16;
  private groupSize = 4;
  private readonly trackLengths = new Map<DrumId, number>();
  private trackSteps: Partial<Record<DrumId, number>> = {};
  private readonly unwatchTheme = watchCanvasTheme(() => this.draw());

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onPaint: (drum: DrumId, step: number, on: boolean) => void,
    private readonly onSelect: (drum: DrumId) => void,
    private readonly onStartEdit?: () => void,
  ) {
    this.context = canvas.getContext("2d");
    this.originalTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = "none";
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("lostpointercapture", this.pointerCancel);
    window.addEventListener("resize", this.resize);
    window.addEventListener("blur", this.cancelPointers);
    this.resize();
  }

  update(project: Project): void {
    if (
      project.drums.some(
        (track) => this.trackLengths.get(track.id) !== track.steps.length,
      )
    )
      this.cancelPointers();
    for (const track of project.drums)
      this.trackLengths.set(track.id, track.steps.length);
    this.project = project;
    this.draw();
  }
  get busy(): boolean {
    return this.pointers.size > 0;
  }
  cancelStroke(): void {
    this.cancelPointers();
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
    this.cancelPointers();
    this.viewportStart = start;
    this.viewportCount = count;
    this.groupSize = groupSize;
    this.draw();
  }
  setStep(step: number): void {
    this.step = Number.isInteger(step) && step >= 0 ? step : -1;
    this.trackSteps = {};
    this.draw();
  }
  setTrackSteps(steps: Partial<Record<DrumId, number>>): void {
    let changed = false;
    for (const id of DRUMS) {
      const index = steps[id];
      if (index !== undefined) {
        const next = Number.isInteger(index) && index >= 0 ? index : -1;
        if (this.trackSteps[id] !== next) {
          this.trackSteps[id] = next;
          changed = true;
        }
      }
    }
    if (changed) this.draw();
  }
  setSelectedDrum(id: DrumId): void {
    this.selected = id;
    this.draw();
  }

  private resize = (): void => {
    if (this.destroyed) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width);
    this.height = Math.max(1, bounds.height);
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.width * this.ratio));
    this.canvas.height = Math.max(1, Math.round(this.height * this.ratio));
    this.draw();
  };

  private get cellWidth(): number {
    return Math.max(
      1,
      (this.width - LABEL_WIDTH - RIGHT_PADDING) / this.viewportCount,
    );
  }
  private get rowHeight(): number {
    return Math.max(
      1,
      (this.height - HEADER_HEIGHT - BOTTOM_PADDING) / DRUMS.length,
    );
  }
  private point(event: PointerEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  private lane(point: Point): DrumId | null {
    if (
      point.y < HEADER_HEIGHT ||
      point.y >= this.height - BOTTOM_PADDING ||
      point.x < 0 ||
      point.x >= this.width
    )
      return null;
    return (
      DRUMS[Math.floor((point.y - HEADER_HEIGHT) / this.rowHeight)] ?? null
    );
  }
  private cell(point: Point): Cell | null {
    const drum = this.lane(point);
    if (!drum || point.x < LABEL_WIDTH || point.x >= this.width - RIGHT_PADDING)
      return null;
    const column = Math.floor((point.x - LABEL_WIDTH) / this.cellWidth);
    const length =
      this.project?.drums.find((track) => track.id === drum)?.steps.length ?? 0;
    if (column < 0 || column >= this.viewportCount || !length) return null;
    return { drum, step: (this.viewportStart + column) % length };
  }
  private select(drum: DrumId): void {
    if (this.selected === drum) return;
    this.selected = drum;
    this.onSelect(drum);
  }
  private paint(point: Point, pointer: PaintPointer): void {
    const cell = this.cell(point);
    if (!cell || !this.project) return;
    const key = `${cell.drum}:${cell.step}`;
    if (pointer.visited.has(key)) return;
    pointer.visited.add(key);
    this.select(cell.drum);
    if (!this.busy) return;
    const track = this.project.drums.find(
      (candidate) => candidate.id === cell.drum,
    );
    const current = track?.steps[cell.step];
    if (current === undefined) return;
    if (pointer.desired === null) pointer.desired = !current;
    if (current !== pointer.desired)
      this.onPaint(cell.drum, cell.step, pointer.desired);
  }
  private segment(point: Point, pointer: PaintPointer): void {
    const dx = point.x - pointer.point.x;
    const dy = point.y - pointer.point.y;
    const distance = Math.max(
      Math.abs(dx) / this.cellWidth,
      Math.abs(dy) / this.rowHeight,
    );
    const samples = Math.min(512, Math.max(1, Math.ceil(distance * 3)));
    for (let sample = 1; sample <= samples; sample += 1) {
      this.paint(
        {
          x: pointer.point.x + (dx * sample) / samples,
          y: pointer.point.y + (dy * sample) / samples,
        },
        pointer,
      );
    }
    pointer.point = point;
  }
  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.project) return;
    const point = this.point(event);
    const drum = this.lane(point);
    if (!drum) return;
    event.preventDefault();
    const pointer: PaintPointer = {
      point,
      desired: null,
      visited: new Set(),
      pressure: event.pressure || 0.5,
    };
    if (!this.pointers.size) this.onStartEdit?.();
    this.pointers.set(event.pointerId, pointer);
    this.select(drum);
    if (!this.pointers.has(event.pointerId)) return;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      this.pointers.delete(event.pointerId);
      return;
    }
    this.paint(point, pointer);
    this.draw();
  };
  private pointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    pointer.pressure = event.pressure || pointer.pressure;
    const events =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [];
    if (events.length > 0)
      for (const sample of events) this.segment(this.point(sample), pointer);
    else this.segment(this.point(event), pointer);
    this.draw();
  };
  private pointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (pointer) {
      event.preventDefault();
      this.segment(this.point(event), pointer);
    }
    this.finishPointer(event.pointerId);
  };
  private pointerCancel = (event: PointerEvent): void => {
    this.finishPointer(event.pointerId);
  };
  private finishPointer(pointerId: number): void {
    this.pointers.delete(pointerId);
    if (this.canvas.hasPointerCapture(pointerId))
      this.canvas.releasePointerCapture(pointerId);
    this.draw();
  }
  private cancelPointers = (): void => {
    for (const pointerId of this.pointers.keys()) this.finishPointer(pointerId);
  };

  private draw(): void {
    const context = this.context;
    if (!context || this.destroyed) return;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    const theme = canvasTheme();
    const colours = theme.beat;
    context.fillStyle = colours.background;
    context.fillRect(0, 0, this.width, this.height);
    context.font = canvasFont(theme, 9);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = colours.drawLabel;
    context.fillText("DRAW", LABEL_WIDTH / 2 - 1, HEADER_HEIGHT / 2);
    for (let step = 0; step < this.viewportCount; step += 1) {
      context.fillStyle =
        step % this.groupSize === 0 ? colours.stepMajor : colours.stepMinor;
      context.fillText(
        String(this.viewportStart + step + 1).padStart(2, "0"),
        LABEL_WIDTH + (step + 0.5) * this.cellWidth,
        HEADER_HEIGHT / 2,
      );
    }
    const gap = this.width < 500 ? 2 : 4;
    DRUMS.forEach((drum, row) => {
      const y = HEADER_HEIGHT + row * this.rowHeight;
      const track = this.project?.drums.find(
        (candidate) => candidate.id === drum,
      );
      const selected = drum === this.selected;
      context.fillStyle = selected
        ? colours.labelBackgroundSelected
        : colours.labelBackground;
      fillCell(context, theme, 0, y, LABEL_WIDTH - 5, this.rowHeight - gap);
      context.fillStyle = colours.labelMarker;
      if (selected)
        fillCell(context, theme, 0, y + 4, 2, this.rowHeight - gap - 8);
      context.fillStyle = selected
        ? colours.labelTextSelected
        : colours.labelText;
      context.font = canvasFont(theme, 9, selected);
      context.fillText(
        drum === "rim" && theme.mode === "fluff"
          ? MODE_LABELS.fluff.rim.toUpperCase()
          : LABELS[drum],
        LABEL_WIDTH / 2 - 2,
        y + (this.rowHeight - gap) / 2,
      );
      for (let step = 0; step < this.viewportCount; step += 1) {
        const groupGap = step % this.groupSize === 0 && step !== 0 ? gap : 0;
        const x = LABEL_WIDTH + step * this.cellWidth + groupGap;
        const width = Math.max(2, this.cellWidth - gap - groupGap);
        const height = this.rowHeight - gap;
        const localStep = track?.steps.length
          ? (this.viewportStart + step) % track.steps.length
          : -1;
        const on = track?.steps[localStep] === true;
        context.globalAlpha = track?.muted ? 0.4 : 1;
        if (on) {
          const gradient = context.createLinearGradient(0, y, 0, y + height);
          gradient.addColorStop(0, colours.onTop);
          gradient.addColorStop(1, colours.onBottom);
          context.fillStyle = gradient;
        } else
          context.fillStyle =
            Math.floor(step / this.groupSize) % 2 === 0
              ? colours.offEven
              : colours.offOdd;
        fillCell(context, theme, x, y, width, height);
        const bevel = colours.bevel;
        if (bevel) {
          context.fillStyle = on ? bevel.onLight : bevel.offLight;
          context.fillRect(x, y, width, 1);
          context.fillStyle = on ? bevel.onShade : bevel.offShade;
          context.fillRect(x + width - 1, y + 1, 1, height - 1);
          context.fillRect(x, y + height - 2, width, 2);
          context.fillStyle = on ? bevel.onNotch : bevel.offNotch;
          context.fillRect(
            x + width * 0.35,
            y + height - 10,
            Math.max(3, width * 0.3),
            2,
          );
        }
        if (on && colours.gloss) {
          context.fillStyle = colours.gloss;
          fillCell(
            context,
            theme,
            x + 3,
            y + 3,
            Math.max(1, width - 6),
            Math.max(1, height * 0.32),
          );
        }
        context.globalAlpha = 1;
        const playing = this.trackSteps[drum] ?? this.step;
        if (
          playing >= 0 &&
          track?.steps.length &&
          localStep === playing % track.steps.length
        ) {
          context.strokeStyle = colours.playhead;
          context.lineWidth = colours.playheadWidth;
          if (theme.radius > 0) {
            context.beginPath();
            context.roundRect(
              x - 1,
              y - 1,
              width + 2,
              height + 2,
              Math.min(theme.radius + 1, (width + 2) / 2, (height + 2) / 2),
            );
            context.stroke();
          } else context.strokeRect(x - 1, y - 1, width + 2, height + 2);
        }
      }
    });
    for (const pointer of this.pointers.values()) {
      context.beginPath();
      context.arc(
        pointer.point.x,
        pointer.point.y,
        7 + pointer.pressure * 6,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = colours.pointer;
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancelPointers();
    this.destroyed = true;
    this.unwatchTheme();
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this.pointerCancel);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("blur", this.cancelPointers);
    this.canvas.style.touchAction = this.originalTouchAction;
  }
}
