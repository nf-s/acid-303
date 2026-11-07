import { describe, expect, it } from "vitest";
import { EditHistory } from "./history";
import { createProject } from "./model";
import { createPreset } from "./presets";

describe("project edit history", () => {
  it("undoes one whole gesture, then a preset, and redoes both", () => {
    const project = createProject();
    const history = new EditHistory(project);
    const before = structuredClone(project);
    project.bass.cutoff = 1200;
    history.record(project, 1);
    project.bass.cutoff = 2000;
    history.record(project, 1);
    project.bass.cutoff = 2500;
    history.record(project, 1);
    const edited = structuredClone(project);
    const preset = createPreset("house");
    history.record(preset, 2);
    expect(history.undo()).toEqual(edited);
    expect(history.undo()).toEqual(before);
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toEqual(edited);
    expect(history.redo()).toEqual(preset);
  });
  it("branches after undo and does not retain references to mutable values", () => {
    const history = new EditHistory({ value: 0 });
    const next = { value: 1 };
    history.record(next, 1);
    next.value = 999;
    expect(history.undo()).toEqual({ value: 0 });
    expect(history.redo()).toEqual({ value: 1 });
    history.undo();
    history.record({ value: 2 }, 2);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toEqual({ value: 0 });
  });
  it("ignores unchanged values and bounds retained history", () => {
    const history = new EditHistory({ value: 0 }, 2);
    history.record({ value: 0 }, 0);
    expect(history.canUndo).toBe(false);
    for (let value = 1; value <= 4; value++) history.record({ value }, value);
    expect(history.undo()).toEqual({ value: 3 });
    expect(history.undo()).toEqual({ value: 2 });
    expect(history.undo()).toBeNull();
  });
});
