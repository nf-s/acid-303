import { ticksPerStep, trackStepCount, unswungTick } from "./timing";
import type { Timing } from "./timing";

export interface RecordingLane {
  timing: Timing;
  base: number;
  values: number[] | null;
  write: (values: number[]) => void;
}
interface Touch {
  value: number;
  cell: number;
  timing: string;
}

/** Local touch recording. Only recorded points belong to the shared project. */
export class AutomationRecorder {
  armed = false;
  private playing = false;
  private tick = 0;
  private swing = 0;
  private held = new Set<string>();
  private touches = new Map<string, Touch>();

  constructor(private readonly lane: (id: string) => RecordingLane | null) {}

  arm(value: boolean): void {
    this.armed = value;
    this.clearTouches();
  }

  clearTouches(): void {
    this.held.clear();
    this.touches.clear();
  }

  begin(id: string): void {
    this.held.add(id);
  }

  end(id: string): void {
    this.held.delete(id);
    this.touches.delete(id);
  }

  frame(playing: boolean, tick: number, swing: number): string[] {
    if (!playing || tick < this.tick) this.clearTouches();
    this.playing = playing;
    this.tick = tick;
    this.swing = swing;
    if (!playing || !this.armed) return [];
    const changed: string[] = [];
    for (const [id, touch] of this.touches)
      if (this.write(id, touch.value)) changed.push(id);
    return changed;
  }

  capture(id: string, value: number): boolean {
    if (
      !this.armed ||
      !this.playing ||
      !Number.isFinite(value) ||
      !this.lane(id)
    )
      return false;
    this.write(id, Math.max(0, Math.min(1, value)));
    if (!this.held.has(id)) this.touches.delete(id);
    return true;
  }

  private write(id: string, value: number): boolean {
    const lane = this.lane(id);
    if (!lane) {
      this.end(id);
      return false;
    }
    const { timing } = lane;
    const signature = `${timing.bars}:${timing.meter}:${timing.grid}`;
    const previous = this.touches.get(id);
    if (previous && previous.timing !== signature) {
      this.end(id);
      return false;
    }
    const count = trackStepCount(timing);
    const cell = Math.floor(
      unswungTick(Math.max(0, this.tick), this.swing, timing.grid) /
        ticksPerStep(timing) +
        1e-9,
    );
    const values = lane.values
      ? [...lane.values]
      : Array<number>(count).fill(lane.base);
    const start =
      previous && cell >= previous.cell && cell - previous.cell < count
        ? previous.cell
        : cell;
    let changed = lane.values === null;
    for (let point = start; point <= cell; point++) {
      const fraction = cell === start ? 1 : (point - start) / (cell - start);
      const next = previous
        ? previous.value + (value - previous.value) * fraction
        : value;
      const index = point % count;
      if (values[index] !== next) changed = true;
      values[index] = next;
    }
    this.touches.set(id, { value, cell, timing: signature });
    if (changed) lane.write(values);
    return changed;
  }
}
