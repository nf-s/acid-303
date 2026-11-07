import { noteName, scaleNotes } from "./model";
import type { MusicalScale } from "./model";
import type { TensionParameter, TensionTrack } from "./tension-model";

export interface TensionGesture {
  pointerId: number;
  note: number;
  velocity: number;
  values: Partial<Record<TensionParameter, number>>;
  cancelled: boolean;
}
export interface TensionSurfaceOptions {
  getTrack: () => TensionTrack;
  getScale: () => MusicalScale;
  onGesture: (
    phase: "begin" | "change" | "end",
    gesture: TensionGesture,
  ) => void;
  onViewChange: () => void;
}
interface Pull {
  string: number;
  anchor: number;
  displacement: number;
  pick: number;
  velocity: number;
}
interface Ring {
  start: number;
  velocity: number;
  pick: number;
}
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** Independent captured contacts pull strings; only a non-cancelled release strikes. */
export class TensionSurface {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver;
  private readonly pulls = new Map<number, Pull>();
  private readonly rings = new Map<number, Ring>();
  private notes: number[] = [];
  private octave = 0;
  private selected = 0;
  private keyboardVelocity = 0.65;
  private key: string | null = null;
  private enabled = true;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private frame = 0;
  private signature = "";
  private destroyed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: TensionSurfaceOptions,
  ) {
    this.context = canvas.getContext("2d");
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "group");
    canvas.setAttribute(
      "aria-keyshortcuts",
      "ArrowLeft ArrowRight ArrowUp ArrowDown Space Enter",
    );
    canvas.setAttribute(
      "aria-description",
      "Pull a string sideways and release to strike. Touch height sets Pick. Left and right choose a string; up and down set velocity. Hold then release Space or Enter to strike.",
    );
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("lostpointercapture", this.pointerCancel);
    canvas.addEventListener("keydown", this.keyDown);
    canvas.addEventListener("keyup", this.keyUp);
    canvas.addEventListener("blur", this.cancel);
    window.addEventListener("blur", this.cancel);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.refresh();
    this.resize();
  }
  get octaveLabel(): string {
    return `${noteName(this.notes[0] ?? 48)}–${noteName(this.notes.at(-1) ?? 60)}`;
  }
  get canLower(): boolean {
    return this.octave > -1;
  }
  get canRaise(): boolean {
    return this.octave < 1;
  }
  get busy(): boolean {
    return this.pulls.size > 0;
  }
  shiftOctave(direction: number): void {
    const next = Math.max(-1, Math.min(1, this.octave + Math.sign(direction)));
    if (next === this.octave) return;
    this.cancel();
    this.rings.clear();
    this.octave = next;
    this.refresh();
    this.options.onViewChange();
  }
  refresh(): void {
    const scale = this.options.getScale();
    const signature = `${scale.root}:${scale.mode}:${this.octave}`;
    if (signature !== this.signature) {
      this.cancel();
      this.rings.clear();
      this.signature = signature;
      this.notes = scaleNotes(scale, 48 + this.octave * 12, 84).slice(0, 7);
      this.selected = Math.min(this.selected, this.notes.length - 1);
    }
    this.describe();
    this.draw();
  }
  setEnabled(enabled: boolean): void {
    if (!enabled) this.cancel();
    this.enabled = enabled;
    this.canvas.setAttribute("aria-disabled", String(!enabled));
    this.canvas.tabIndex = enabled ? 0 : -1;
  }
  pulse(note: number, velocity: number): void {
    const string = this.notes.indexOf(note);
    if (string < 0 || this.destroyed) return;
    this.rings.set(string, {
      start: performance.now(),
      velocity,
      pick: this.options.getTrack().pick,
    });
    this.animate();
  }
  stop(): void {
    this.cancel();
    this.rings.clear();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.draw();
  }
  readonly cancel = (): void => {
    const pulls = [...this.pulls];
    this.pulls.clear();
    this.key = null;
    for (const [pointerId, pull] of pulls) {
      if (pointerId >= 0 && this.canvas.hasPointerCapture(pointerId))
        this.canvas.releasePointerCapture(pointerId);
      this.emit("end", pointerId, pull, true);
    }
    this.canvas.dataset.active = "false";
    this.describe();
    this.draw();
  };
  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this.pointerCancel);
    this.canvas.removeEventListener("keydown", this.keyDown);
    this.canvas.removeEventListener("keyup", this.keyUp);
    this.canvas.removeEventListener("blur", this.cancel);
    window.removeEventListener("blur", this.cancel);
  }
  private emit(
    phase: "begin" | "change" | "end",
    pointerId: number,
    pull: Pull,
    cancelled = false,
  ): void {
    const note = this.notes[pull.string];
    if (note === undefined) return;
    this.options.onGesture(phase, {
      pointerId,
      note,
      velocity: pull.velocity,
      values: { pick: pull.pick },
      cancelled,
    });
    this.describe();
  }
  private describe(): void {
    this.canvas.dataset.note = String(this.notes[this.selected] ?? 48);
    this.canvas.dataset.contacts = String(this.pulls.size);
    this.canvas.setAttribute(
      "aria-label",
      `Tension playable strings, ${noteName(this.notes[this.selected] ?? 48)}, velocity ${Math.round(this.keyboardVelocity * 100)}%`,
    );
  }
  private point(event: PointerEvent): { x: number; pick: number } {
    const box = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - box.left,
      pick: clamp(
        (event.clientY - box.top - 18) / Math.max(1, box.height - 50),
      ),
    };
  }
  private stringX(index: number): number {
    return (
      20 +
      ((index + 0.5) * Math.max(1, this.width - 40)) /
        Math.max(1, this.notes.length)
    );
  }
  private movePull(event: PointerEvent, pull: Pull): void {
    const point = this.point(event);
    pull.displacement = Math.max(-70, Math.min(70, point.x - pull.anchor));
    pull.velocity = Math.max(
      0.12,
      Math.min(1, 0.12 + Math.abs(pull.displacement) / 65),
    );
    pull.pick = point.pick;
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (
      !this.enabled ||
      event.button !== 0 ||
      this.key !== null ||
      this.pulls.size >= 7
    )
      return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    const point = this.point(event);
    const string = Math.max(
      0,
      Math.min(
        this.notes.length - 1,
        Math.floor(
          ((point.x - 20) / Math.max(1, this.width - 40)) * this.notes.length,
        ),
      ),
    );
    if ([...this.pulls.values()].some((pull) => pull.string === string)) return;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    this.selected = string;
    const pull: Pull = {
      string,
      anchor: point.x,
      displacement: 0,
      pick: point.pick,
      velocity: 0.12,
    };
    this.pulls.set(event.pointerId, pull);
    this.rings.delete(string);
    this.emit("begin", event.pointerId, pull);
    this.canvas.dataset.active = "true";
    this.animate();
  };
  private readonly pointerMove = (event: PointerEvent): void => {
    const pull = this.pulls.get(event.pointerId);
    if (!pull) return;
    event.preventDefault();
    this.movePull(event, pull);
    this.emit("change", event.pointerId, pull);
  };
  private readonly pointerUp = (event: PointerEvent): void => {
    const pull = this.pulls.get(event.pointerId);
    if (!pull) return;
    this.movePull(event, pull);
    this.finish(event.pointerId, false);
  };
  private readonly pointerCancel = (event: PointerEvent): void => {
    this.finish(event.pointerId, true);
  };
  private finish(pointerId: number, cancelled: boolean): void {
    const pull = this.pulls.get(pointerId);
    if (!pull) return;
    this.pulls.delete(pointerId);
    if (pointerId === -1) this.key = null;
    if (!cancelled)
      this.rings.set(pull.string, {
        start: performance.now(),
        velocity: pull.velocity,
        pick: pull.pick,
      });
    this.emit("end", pointerId, pull, cancelled);
    this.canvas.dataset.active = String(this.pulls.size > 0);
    this.animate();
  }
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (
      !this.enabled ||
      (this.pulls.size && !this.pulls.has(-1)) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        " ",
        "Enter",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const pull = this.pulls.get(-1);
    if (event.key === "ArrowLeft" && !pull)
      this.selected = Math.max(0, this.selected - 1);
    if (event.key === "ArrowRight" && !pull)
      this.selected = Math.min(this.notes.length - 1, this.selected + 1);
    if (event.key === "ArrowUp")
      this.keyboardVelocity = clamp(this.keyboardVelocity + 0.05);
    if (event.key === "ArrowDown")
      this.keyboardVelocity = Math.max(0.05, this.keyboardVelocity - 0.05);
    if (pull && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      pull.velocity = this.keyboardVelocity;
      pull.displacement = pull.velocity * 42;
      this.emit("change", -1, pull);
    }
    if (
      (event.key === " " || event.key === "Enter") &&
      !this.key &&
      !event.repeat
    ) {
      this.key = event.key;
      const next: Pull = {
        string: this.selected,
        anchor: this.stringX(this.selected),
        displacement: this.keyboardVelocity * 42,
        pick: this.options.getTrack().pick,
        velocity: this.keyboardVelocity,
      };
      this.pulls.set(-1, next);
      this.emit("begin", -1, next);
      this.canvas.dataset.active = "true";
      this.animate();
    }
    this.describe();
    this.draw();
  };
  private readonly keyUp = (event: KeyboardEvent): void => {
    if (event.key !== this.key) return;
    event.preventDefault();
    event.stopPropagation();
    this.finish(-1, false);
  };
  private readonly resize = (): void => {
    const box = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, box.width);
    this.height = Math.max(1, box.height);
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.draw();
  };
  private animate(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
      if (this.busy || this.rings.size) this.animate();
    });
  }
  private draw(): void {
    const ctx = this.context;
    if (!ctx || this.destroyed) return;
    const now = performance.now(),
      track = this.options.getTrack();
    const top = 18,
      height = Math.max(1, this.height - 50);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = "#101315";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = "#48535c";
    ctx.beginPath();
    ctx.moveTo(12, top);
    ctx.lineTo(this.width - 12, top);
    ctx.moveTo(12, top + height);
    ctx.lineTo(this.width - 12, top + height);
    ctx.stroke();
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.notes.forEach((note, index) => {
      const x = this.stringX(index),
        pull = [...this.pulls.values()].find(
          (candidate) => candidate.string === index,
        ),
        ring = this.rings.get(index);
      const age = ring ? (now - ring.start) / 1000 : 0;
      const tail = 0.3 + track.decay * 2;
      if (ring && age > tail * 3) this.rings.delete(index);
      const amplitude = ring
        ? ring.velocity * 18 * Math.exp((-age / tail) * 3)
        : 0;
      ctx.strokeStyle =
        pull || amplitude > 0.4
          ? "#f2f6fa"
          : index === this.selected
            ? "#b7c7d3"
            : "#748793";
      ctx.lineWidth = 1.2 + (6 - index) * 0.12;
      ctx.beginPath();
      for (let segment = 0; segment <= 48; segment++) {
        const fraction = segment / 48;
        const pick = Math.max(
          0.04,
          Math.min(0.96, pull?.pick ?? ring?.pick ?? track.pick),
        );
        const pulled = pull
          ? pull.displacement *
            (fraction < pick ? fraction / pick : (1 - fraction) / (1 - pick))
          : 0;
        const ringing =
          Math.sin(fraction * Math.PI) *
            Math.sin(age * (72 + index * 5)) *
            amplitude +
          Math.sin(fraction * Math.PI * 2) *
            Math.cos(age * 109) *
            amplitude *
            track.tension *
            0.25;
        if (!segment) ctx.moveTo(x, top);
        else ctx.lineTo(x + pulled + ringing, top + fraction * height);
      }
      ctx.stroke();
      if (pull) {
        ctx.fillStyle = "#dbe8f2";
        ctx.beginPath();
        ctx.arc(
          x + pull.displacement,
          top + pull.pick * height,
          3.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = index === this.selected ? "#f0f5fa" : "#9caebb";
      ctx.fillText(noteName(note), x, this.height - 14);
    });
  }
}
