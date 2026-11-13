import { noteName, scaleNotes } from "./model";
import type { MusicalScale } from "./model";
import { canvasFont, canvasTheme, watchCanvasTheme } from "./canvas-theme";
import type { CloudParameter, CloudTrack } from "./cloud-model";

export interface CloudGesture {
  pointerId: number;
  note: number;
  velocity: number;
  values: Partial<Record<CloudParameter, number>>;
  cancelled: boolean;
}
export interface CloudSurfaceOptions {
  getTrack: () => CloudTrack;
  getScale: () => MusicalScale;
  onGesture: (phase: "begin" | "change" | "end", gesture: CloudGesture) => void;
  onViewChange: () => void;
}
interface Contact {
  x: number;
  y: number;
  pressure: number;
}
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** A single grain scan, with a second contact controlling stereo spread. */
export class CloudSurface {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver;
  private readonly contacts = new Map<number, Contact>();
  private readonly keys = new Set<string>();
  private notes: number[] = [];
  private octave = 0;
  private readonly baseNote: number;
  private selected = 0;
  private scan = 0.35;
  private spread = 0.55;
  private velocity = 0.75;
  private gestureId: number | null = null;
  private enabled = true;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private frame = 0;
  private pulseUntil = 0;
  private playingNote: number | null = null;
  private signature = "";
  private destroyed = false;
  private readonly unwatchTheme = watchCanvasTheme(() => this.draw());

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: CloudSurfaceOptions,
  ) {
    this.baseNote = Math.max(
      36,
      Math.min(
        72,
        options.getTrack().steps.find((step) => step.on)?.note ?? 48,
      ),
    );
    this.context = canvas.getContext("2d");
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "group");
    canvas.setAttribute("aria-label", "Cloud playable grain field");
    canvas.setAttribute(
      "aria-keyshortcuts",
      "ArrowUp ArrowDown ArrowLeft ArrowRight Space Enter",
    );
    canvas.setAttribute(
      "aria-description",
      "Drag left or right to scan material, up or down for pitch. A second finger changes width. Arrow keys play pitch and scan; hold Space or Enter to sustain.",
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
    return this.baseNote + this.octave * 12 >= 48;
  }
  get canRaise(): boolean {
    return this.baseNote + this.octave * 12 <= 60;
  }
  get busy(): boolean {
    return this.gestureId !== null;
  }
  shiftOctave(direction: number): void {
    const next = this.octave + Math.sign(direction);
    const low = this.baseNote + next * 12;
    if (next === this.octave || low < 36 || low > 72) return;
    this.cancel();
    this.octave = next;
    this.refresh();
    this.options.onViewChange();
  }
  refresh(): void {
    const scale = this.options.getScale();
    const signature = `${scale.root}:${scale.mode}:${this.octave}`;
    if (signature !== this.signature) {
      this.cancel();
      this.signature = signature;
      this.notes = scaleNotes(
        scale,
        this.baseNote + this.octave * 12,
        this.baseNote + (this.octave + 1) * 12,
      );
      this.selected = Math.min(this.selected, this.notes.length - 1);
    }
    if (!this.busy) {
      this.scan = this.options.getTrack().scan;
      this.spread = this.options.getTrack().width;
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
    if (this.destroyed) return;
    this.playingNote = note;
    this.pulseUntil = performance.now() + 180 + velocity * 160;
    this.animate();
  }
  stop(): void {
    this.cancel();
    this.pulseUntil = 0;
    this.playingNote = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.draw();
  }
  readonly cancel = (): void => {
    const id = this.gestureId;
    const pointers = [...this.contacts.keys()];
    this.gestureId = null;
    this.contacts.clear();
    this.keys.clear();
    for (const pointer of pointers) {
      if (this.canvas.hasPointerCapture(pointer))
        this.canvas.releasePointerCapture(pointer);
    }
    if (id !== null) this.emit("end", id, true);
    this.canvas.dataset.active = "false";
    this.draw();
  };
  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.unwatchTheme();
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
    cancelled = false,
  ): void {
    const note = this.notes[this.selected];
    if (note === undefined) return;
    this.options.onGesture(phase, {
      pointerId,
      note,
      velocity: this.velocity,
      values: {
        scan: this.scan,
        ...(this.contacts.size > 1 ? { width: this.spread } : {}),
      },
      cancelled,
    });
    this.describe();
  }
  private describe(): void {
    this.canvas.dataset.note = String(this.notes[this.selected] ?? 48);
    this.canvas.dataset.scan = this.scan.toFixed(3);
    this.canvas.dataset.width = this.spread.toFixed(3);
    this.canvas.setAttribute(
      "aria-label",
      `Cloud playable grain field, ${noteName(this.notes[this.selected] ?? 48)}, scan ${Math.round(this.scan * 100)}%`,
    );
  }
  private point(event: PointerEvent): Contact {
    const box = this.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left - 36) / Math.max(1, box.width - 48)),
      y: clamp((event.clientY - box.top - 16) / Math.max(1, box.height - 40)),
      pressure:
        event.pointerType === "pen" ? Math.max(0.15, event.pressure) : 0.75,
    };
  }
  private updateContacts(): void {
    const points = [...this.contacts.values()],
      first = points[0],
      second = points[1];
    if (!first) return;
    this.scan = first.x;
    this.selected = Math.round(
      (1 - first.y) * Math.max(0, this.notes.length - 1),
    );
    this.velocity = first.pressure;
    if (second)
      this.spread = clamp(Math.hypot(second.x - first.x, second.y - first.y));
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (
      !this.enabled ||
      event.button !== 0 ||
      this.keys.size ||
      this.contacts.size >= 2
    )
      return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const first = this.contacts.size === 0;
    this.contacts.set(event.pointerId, this.point(event));
    if (first) this.gestureId = event.pointerId;
    this.updateContacts();
    if (this.gestureId !== null)
      this.emit(first ? "begin" : "change", this.gestureId);
    this.canvas.dataset.active = "true";
    this.animate();
  };
  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.contacts.has(event.pointerId)) return;
    event.preventDefault();
    this.contacts.set(event.pointerId, this.point(event));
    this.updateContacts();
    if (this.gestureId !== null) this.emit("change", this.gestureId);
  };
  private readonly pointerUp = (event: PointerEvent): void => {
    if (!this.contacts.has(event.pointerId)) return;
    this.contacts.set(event.pointerId, this.point(event));
    this.updateContacts();
    const id = this.gestureId;
    if (id !== null) this.emit("change", id);
    this.contacts.delete(event.pointerId);
    if (!this.contacts.size) {
      this.gestureId = null;
      if (id !== null) this.emit("end", id);
      this.canvas.dataset.active = "false";
    } else {
      this.updateContacts();
      if (id !== null) this.emit("change", id);
    }
    this.draw();
  };
  private readonly pointerCancel = (event: PointerEvent): void => {
    if (this.contacts.has(event.pointerId)) this.cancel();
  };
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (
      !this.enabled ||
      this.contacts.size ||
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
    const first = !this.keys.size;
    this.keys.add(event.key);
    if (event.key === "ArrowLeft")
      this.scan = clamp(this.scan - (event.shiftKey ? 0.01 : 0.04));
    if (event.key === "ArrowRight")
      this.scan = clamp(this.scan + (event.shiftKey ? 0.01 : 0.04));
    if (event.key === "ArrowUp")
      this.selected = Math.min(this.notes.length - 1, this.selected + 1);
    if (event.key === "ArrowDown")
      this.selected = Math.max(0, this.selected - 1);
    this.gestureId = -1;
    this.emit(first ? "begin" : "change", -1);
    this.canvas.dataset.active = "true";
    this.animate();
  };
  private readonly keyUp = (event: KeyboardEvent): void => {
    if (!this.keys.delete(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.keys.size) {
      this.gestureId = null;
      this.emit("end", -1);
      this.canvas.dataset.active = "false";
    }
    this.draw();
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
      if (this.busy || performance.now() < this.pulseUntil) this.animate();
    });
  }
  private draw(): void {
    const ctx = this.context;
    if (!ctx || this.destroyed) return;
    const now = performance.now(),
      active = this.busy || now < this.pulseUntil;
    const track = this.options.getTrack();
    const left = 36,
      top = 16,
      width = Math.max(1, this.width - 48),
      height = Math.max(1, this.height - 40);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    const theme = canvasTheme();
    const colours = theme.cloud;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = colours.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    const phase = active ? now / 1500 : 0;
    for (let row = 0; row < 72; row++) {
      const y = top + (row / 71) * height;
      ctx.strokeStyle = row % 3 === 0 ? colours.ridgeMajor : colours.ridge;
      ctx.lineWidth = row % 3 === 0 ? 0.7 : 0.45;
      ctx.beginPath();
      for (let column = 0; column <= 64; column++) {
        const x = column / 64;
        const ridge =
          Math.sin(x * (19 + track.sound * 4) + row * 0.71 + phase) *
          Math.sin(x * 6 - row * 0.23 + phase * 0.6);
        const grain =
          Math.sin(column * 79.13 + row * 137.7 + track.seed) *
          (1 + track.roughness * 3);
        const offset = ridge * (4 + track.scatter * 9) + grain;
        if (column === 0) ctx.moveTo(left, y + offset);
        else ctx.lineTo(left + width * x, y + offset);
      }
      ctx.stroke();
    }
    const scanX = left + this.scan * width;
    const band = Math.max(5, width * (0.02 + track.size * 0.12));
    ctx.fillStyle = active ? colours.scanBandActive : colours.scanBand;
    ctx.fillRect(scanX - band / 2, top, band, height);
    ctx.strokeStyle = colours.scanLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(scanX, top);
    ctx.lineTo(scanX, top + height);
    ctx.stroke();
    ctx.restore();
    ctx.font = canvasFont(theme, 10);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    this.notes.forEach((note, index) => {
      const y = top + height * (1 - index / Math.max(1, this.notes.length - 1));
      const selected = this.busy
        ? index === this.selected
        : now < this.pulseUntil && note === this.playingNote;
      ctx.fillStyle = selected ? colours.noteSelected : colours.note;
      ctx.fillText(noteName(note), left - 6, y);
      ctx.strokeStyle = selected ? colours.noteLineSelected : colours.noteLine;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      if (selected) {
        ctx.fillStyle = colours.marker;
        ctx.fillRect(scanX - 3, y - 3, 6, 6);
      }
    });
    ctx.fillStyle = colours.label;
    ctx.textAlign = "left";
    ctx.fillText("SCAN", left, this.height - 9);
    ctx.textAlign = "right";
    ctx.fillText(
      `${Math.round(this.scan * 100)}%`,
      left + width,
      this.height - 9,
    );
  }
}
