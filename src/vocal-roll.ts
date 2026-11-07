import { noteName, scaleNotes } from "./model";
import type { MusicalScale } from "./model";
import type { PatternViewport } from "./pattern-controls";
import { trackPosition, trackStepCount } from "./timing";
import { joinVocalNote, removeVocalNote, setVocalNote } from "./vocal-model";
import type { VocalNote, VocalTrack } from "./vocal-model";

interface VocalRollOptions {
  getTrack: () => VocalTrack;
  getScale: () => MusicalScale;
  onChange: (track: VocalTrack) => void;
  onStroke: () => void;
  onSelect: () => void;
  onPreview: (note: number) => void;
}
interface RollPoint {
  step: number;
  note: number;
  x: number;
  y: number;
}
interface RollStroke {
  pointer: number;
  anchor: RollPoint;
  original: VocalNote[];
  note: VocalNote | null;
  mode: "draw" | "move" | "resize";
  moved: boolean;
}
const LEFT = 36,
  RIGHT = 8,
  TOP = 24,
  BOTTOM = 8;

/** Pitched, monophonic rectangles; timing and overlap rules stay in the model. */
export class VocalRoll {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver;
  private readonly controls: HTMLDivElement[] = [];
  private stroke: RollStroke | null = null;
  private viewport: PatternViewport = { start: 0, count: 16 };
  private selectedStart: number | null = null;
  private cursor = 0;
  private cursorNote = 60;
  private octave = 4;
  private playing = -1;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private signature = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly access: HTMLElement,
    private readonly options: VocalRollOptions,
  ) {
    this.context = canvas.getContext("2d");
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.cancelStroke);
    canvas.addEventListener("lostpointercapture", this.cancelStroke);
    window.addEventListener("blur", this.cancelStroke);
    this.resize();
  }
  get busy(): boolean {
    return this.stroke !== null;
  }
  get selectedNote(): VocalNote | null {
    return (
      this.options
        .getTrack()
        .notes.find((note) => note.start === this.selectedStart) ?? null
    );
  }
  get octaveLabel(): string {
    return `${noteName(this.minimum)}–${noteName(this.maximum)}`;
  }
  get canLower(): boolean {
    return this.octave > 3;
  }
  get canRaise(): boolean {
    return this.octave < 5;
  }
  private get minimum(): number {
    return this.octave * 12;
  }
  private get maximum(): number {
    return this.minimum + 24;
  }
  private get pitches(): number[] {
    return scaleNotes(this.options.getScale(), this.minimum, this.maximum);
  }
  private get count(): number {
    return Math.min(
      this.viewport.count,
      trackStepCount(this.options.getTrack().timing) - this.viewport.start,
    );
  }
  private get cellWidth(): number {
    return Math.max(1, (this.width - LEFT - RIGHT) / Math.max(1, this.count));
  }
  private get rowHeight(): number {
    return Math.max(
      1,
      (this.height - TOP - BOTTOM) / Math.max(1, this.pitches.length),
    );
  }

  refresh(): void {
    const { timing } = this.options.getTrack();
    const scale = this.options.getScale();
    const next = `${timing.bars}:${timing.meter}:${timing.grid}:${scale.root}:${scale.mode}`;
    if (next !== this.signature) this.cancelStroke();
    this.signature = next;
    if (!this.selectedNote) this.selectedStart = null;
    this.draw();
    this.options.onSelect();
  }
  setViewport(viewport: PatternViewport): void {
    if (
      viewport.start !== this.viewport.start ||
      viewport.count !== this.viewport.count
    ) {
      this.cancelStroke();
      this.cursor = viewport.start;
    }
    this.viewport = viewport;
    this.draw();
  }
  setPosition(tick: number, swing: number): void {
    const step =
      tick < 0
        ? -1
        : trackPosition(this.options.getTrack().timing, tick, swing).index;
    if (this.playing === step) return;
    this.playing = step;
    this.draw();
  }
  shiftOctave(delta: number): void {
    this.cancelStroke();
    this.octave = Math.max(3, Math.min(5, this.octave + delta));
    this.draw();
    this.options.onSelect();
  }
  act(action: "delete" | "join" | "accent" | "shorter" | "longer"): void {
    const note = this.selectedNote;
    if (!note) return;
    this.cancelStroke();
    this.options.onStroke();
    const track = this.options.getTrack();
    let next: VocalTrack;
    if (action === "delete") next = removeVocalNote(track, note.start);
    else if (action === "join") next = joinVocalNote(track, note.start);
    else
      next = setVocalNote(
        track,
        {
          ...note,
          ...(action === "accent"
            ? { accent: !note.accent }
            : {
                length: Math.max(
                  1,
                  note.length + (action === "longer" ? 1 : -1),
                ),
              }),
        },
        this.options.getScale(),
        note.start,
      );
    this.options.onChange(next);
    this.refresh();
  }
  rebaseIncoming(next: VocalTrack): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const current = this.options.getTrack();
    if (JSON.stringify(current.timing) !== JSON.stringify(next.timing)) {
      this.cancelStroke();
      return;
    }
    let baseline = { ...current, notes: stroke.original };
    for (const note of current.notes) {
      const incoming = next.notes.find(
        (candidate) => candidate.start === note.start,
      );
      if (!incoming || JSON.stringify(incoming) !== JSON.stringify(note))
        baseline = removeVocalNote(baseline, note.start);
    }
    for (const note of next.notes) {
      const present = current.notes.find(
        (candidate) => candidate.start === note.start,
      );
      if (!present || JSON.stringify(present) !== JSON.stringify(note))
        baseline = setVocalNote(
          baseline,
          note,
          this.options.getScale(),
          note.start,
        );
    }
    stroke.original = baseline.notes;
  }
  readonly cancelStroke = (): void => {
    const pointer = this.stroke?.pointer;
    this.stroke = null;
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
  };
  destroy(): void {
    this.cancelStroke();
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.cancelStroke);
    this.canvas.removeEventListener("lostpointercapture", this.cancelStroke);
    window.removeEventListener("blur", this.cancelStroke);
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
  private point(event: PointerEvent): RollPoint {
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left,
      y = event.clientY - bounds.top;
    const pitches = this.pitches;
    const row = Math.max(
      0,
      Math.min(pitches.length - 1, Math.floor((y - TOP) / this.rowHeight)),
    );
    return {
      x,
      y,
      step:
        this.viewport.start +
        Math.max(
          0,
          Math.min(this.count - 1, Math.floor((x - LEFT) / this.cellWidth)),
        ),
      note: pitches[pitches.length - row - 1] ?? this.cursorNote,
    };
  }
  private noteAt(step: number): VocalNote | null {
    return (
      this.options
        .getTrack()
        .notes.find(
          (note) => note.start <= step && note.start + note.length > step,
        ) ?? null
    );
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.stroke || this.count < 1) return;
    const point = this.point(event);
    if (
      point.x < LEFT ||
      point.x > this.width - RIGHT ||
      point.y < TOP ||
      point.y > this.height - BOTTOM
    )
      return;
    event.preventDefault();
    const candidate = this.noteAt(point.step);
    const note = candidate?.note === point.note ? candidate : null;
    const end = note
      ? LEFT + (note.start + note.length - this.viewport.start) * this.cellWidth
      : 0;
    const mode = note
      ? Math.abs(point.x - end) <= Math.min(12, this.cellWidth * 0.45)
        ? "resize"
        : "move"
      : "draw";
    this.stroke = {
      pointer: event.pointerId,
      anchor: point,
      original: this.options.getTrack().notes.map((note) => ({ ...note })),
      note: note ? { ...note } : null,
      mode,
      moved: false,
    };
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      this.stroke = null;
      return;
    }
    this.options.onStroke();
    this.cursor = point.step;
    this.cursorNote = point.note;
    this.selectedStart = note?.start ?? point.step;
    if (!note) this.move(point);
    this.draw();
    this.options.onSelect();
  };
  private move(point: RollPoint): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const moved =
      Math.abs(point.x - stroke.anchor.x) +
        Math.abs(point.y - stroke.anchor.y) >
      4;
    stroke.moved ||= moved;
    if (stroke.mode !== "draw" && !stroke.moved) return;
    const count = trackStepCount(this.options.getTrack().timing);
    let note: VocalNote;
    if (stroke.mode === "draw")
      note = {
        start: Math.min(point.step, stroke.anchor.step),
        length: Math.abs(point.step - stroke.anchor.step) + 1,
        note: point.note,
        accent: false,
      };
    else if (stroke.note) {
      if (stroke.mode === "resize")
        note = {
          ...stroke.note,
          length: Math.max(1, point.step - stroke.note.start + 1),
        };
      else
        note = {
          ...stroke.note,
          start: Math.max(
            0,
            Math.min(
              count - stroke.note.length,
              stroke.note.start + point.step - stroke.anchor.step,
            ),
          ),
          note: point.note,
        };
    } else return;
    const current = this.options.getTrack();
    const next = setVocalNote(
      { ...current, notes: stroke.original },
      note,
      this.options.getScale(),
      stroke.note?.start,
    );
    this.selectedStart = note.start;
    this.cursor = point.step;
    this.cursorNote = note.note;
    this.options.onChange(next);
    this.draw();
    this.options.onSelect();
  }
  private readonly pointerMove = (event: PointerEvent): void => {
    if (this.stroke?.pointer !== event.pointerId) return;
    event.preventDefault();
    this.move(this.point(event));
  };
  private readonly pointerUp = (event: PointerEvent): void => {
    if (this.stroke?.pointer !== event.pointerId) return;
    this.move(this.point(event));
    const note = this.selectedNote;
    this.cancelStroke();
    if (note) this.options.onPreview(note.note);
  };
  private keyDown(event: KeyboardEvent, index: number): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const note = this.noteAt(index);
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Enter",
        " ",
        "Delete",
        "Backspace",
        "PageUp",
        "PageDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    if (event.key === "PageUp" || event.key === "PageDown") {
      this.shiftOctave(event.key === "PageUp" ? 1 : -1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (event.shiftKey && note) {
        this.selectedStart = note.start;
        this.act(event.key === "ArrowLeft" ? "shorter" : "longer");
      } else
        this.controls[
          (index -
            this.viewport.start +
            (event.key === "ArrowRight" ? 1 : this.count - 1)) %
            this.count
        ]?.focus();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      this.selectedStart = note?.start ?? null;
      this.act("delete");
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      this.options.onStroke();
      if (!note)
        this.options.onChange(
          setVocalNote(
            this.options.getTrack(),
            { start: index, length: 1, note: this.cursorNote, accent: false },
            this.options.getScale(),
          ),
        );
      this.selectedStart = this.noteAt(index)?.start ?? null;
      const selected = this.selectedNote;
      if (selected) this.options.onPreview(selected.note);
      this.refresh();
      return;
    }
    const pitches = scaleNotes(this.options.getScale(), 36, 84);
    const pitch = note?.note ?? this.cursorNote;
    const nearest = pitches.reduce(
      (best, candidate) =>
        Math.abs(candidate - pitch) < Math.abs(best - pitch) ? candidate : best,
      pitches[0] ?? 60,
    );
    const position = pitches.indexOf(nearest);
    const nextPosition =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? pitches.length - 1
          : Math.max(
              0,
              Math.min(
                pitches.length - 1,
                position + (event.key === "ArrowUp" ? 1 : -1),
              ),
            );
    this.cursorNote = pitches[nextPosition] ?? nearest;
    if (note) {
      this.options.onStroke();
      this.options.onChange(
        setVocalNote(
          this.options.getTrack(),
          { ...note, note: this.cursorNote },
          this.options.getScale(),
          note.start,
        ),
      );
    }
    if (this.cursorNote < this.minimum && this.canLower) this.octave--;
    if (this.cursorNote > this.maximum && this.canRaise) this.octave++;
    this.refresh();
  }
  private updateAccess(): void {
    while (this.controls.length > this.count) this.controls.pop()?.remove();
    while (this.controls.length < this.count) {
      const column = this.controls.length,
        control = document.createElement("div");
      control.setAttribute("role", "slider");
      control.setAttribute("aria-orientation", "vertical");
      control.setAttribute(
        "aria-description",
        "Enter adds or previews a note. Up and Down change pitch. Shift with Left or Right changes length. Delete removes the note.",
      );
      control.addEventListener("focus", () => {
        this.cursor = this.viewport.start + column;
        this.selectedStart = this.noteAt(this.cursor)?.start ?? null;
        this.cursorNote = this.selectedNote?.note ?? this.cursorNote;
        this.draw();
        this.options.onSelect();
      });
      control.addEventListener("keydown", (event) =>
        this.keyDown(event, this.viewport.start + column),
      );
      this.controls.push(control);
      this.access.append(control);
    }
    this.access.style.gridTemplateColumns = `repeat(${Math.max(1, this.count)},minmax(0,1fr))`;
    this.controls.forEach((control, column) => {
      const index = this.viewport.start + column,
        note = this.noteAt(index);
      control.dataset.vocalStep = String(index);
      control.tabIndex = index === this.cursor ? 0 : -1;
      control.setAttribute("aria-label", `Vocal note step ${index + 1}`);
      control.setAttribute("aria-valuemin", "36");
      control.setAttribute("aria-valuemax", "84");
      control.setAttribute(
        "aria-valuenow",
        String(note?.note ?? this.cursorNote),
      );
      control.setAttribute(
        "aria-valuetext",
        note
          ? `${noteName(note.note)}, ${note.length} steps${note.accent ? ", accent" : ""}`
          : `Empty, ${noteName(this.cursorNote)}`,
      );
    });
  }
  private draw(): void {
    this.updateAccess();
    const ctx = this.context;
    if (!ctx) return;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = "#131619";
    ctx.fillRect(0, 0, this.width, this.height);
    const pitches = this.pitches;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    pitches.forEach((note, index) => {
      const y = TOP + (pitches.length - index - 1) * this.rowHeight;
      ctx.fillStyle =
        note % 12 === this.options.getScale().root ? "#262c32" : "#1a1f23";
      ctx.fillRect(LEFT, y, this.width - LEFT - RIGHT, this.rowHeight - 1);
      ctx.fillStyle = "#b7c0c8";
      ctx.fillText(noteName(note), LEFT / 2, y + this.rowHeight / 2);
    });
    for (let column = 0; column < this.count; column++) {
      const x = LEFT + column * this.cellWidth,
        index = this.viewport.start + column;
      ctx.strokeStyle =
        column % (this.viewport.groupSize ?? 4) === 0 ? "#66727b" : "#303940";
      ctx.beginPath();
      ctx.moveTo(x, TOP);
      ctx.lineTo(x, this.height - BOTTOM);
      ctx.stroke();
      ctx.fillStyle = index === this.playing ? "#fff" : "#a6b0b9";
      ctx.fillText(String(index + 1), x + this.cellWidth / 2, TOP / 2);
      if (index === this.playing) {
        ctx.fillStyle = "#c8d8e52b";
        ctx.fillRect(x, TOP, this.cellWidth, this.height - TOP - BOTTOM);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(LEFT, TOP, this.width - LEFT - RIGHT, this.height - TOP - BOTTOM);
    ctx.clip();
    for (const note of this.options.getTrack().notes) {
      if (
        note.start + note.length <= this.viewport.start ||
        note.start >= this.viewport.start + this.count
      )
        continue;
      const row = pitches.indexOf(note.note);
      if (row < 0) continue;
      const x = LEFT + (note.start - this.viewport.start) * this.cellWidth + 1,
        y = TOP + (pitches.length - row - 1) * this.rowHeight + 2,
        w = note.length * this.cellWidth - 2,
        h = this.rowHeight - 4;
      const selected = note.start === this.selectedStart;
      ctx.fillStyle = selected ? "#dce4eb" : "#8f9eaa";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = selected ? "#fff" : "#c3cdd5";
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = "#15212a";
      if (w > 24) {
        ctx.textAlign = "left";
        ctx.fillText(
          `${note.accent ? "◆ " : ""}${noteName(note.note)}`,
          Math.max(LEFT + 3, x + 4),
          y + h / 2,
          Math.max(1, w - 10),
        );
        ctx.textAlign = "center";
      }
      ctx.fillRect(x + w - 4, y + 3, 2, Math.max(2, h - 6));
    }
    ctx.restore();
  }
}
