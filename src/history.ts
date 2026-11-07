/** Full project snapshots, grouped by one pointer or keyboard gesture. */
export class EditHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;
  private group: number | null = null;

  constructor(
    initial: T,
    private readonly limit = 100,
  ) {
    this.current = structuredClone(initial);
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  record(value: T, group: number): void {
    if (JSON.stringify(value) === JSON.stringify(this.current)) return;
    if (this.group !== group) {
      this.past.push(this.current);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.current = structuredClone(value);
    this.future = [];
    this.group = group;
  }
  undo(): T | null {
    const value = this.past.pop();
    if (value === undefined) return null;
    this.future.push(this.current);
    this.current = value;
    this.group = null;
    return structuredClone(value);
  }
  redo(): T | null {
    const value = this.future.pop();
    if (value === undefined) return null;
    this.past.push(this.current);
    this.current = value;
    this.group = null;
    return structuredClone(value);
  }
}
