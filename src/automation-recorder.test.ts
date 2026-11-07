import { describe, it, expect } from "vitest";
import { AutomationRecorder } from "./automation-recorder";
import type { RecordingLane } from "./automation-recorder";

function setup() {
  const lane: RecordingLane = {
    timing: { bars: 1, meter: "4/4", grid: "straight" },
    base: 0.25,
    values: null,
    write: (values) => {
      lane.values = values;
    },
  };
  const recorder = new AutomationRecorder((id) =>
    id === "tone" ? lane : null,
  );
  return { lane, recorder };
}

describe("client-local touch recording", () => {
  it("arms independently and only writes while playing a supported control", () => {
    const { lane, recorder } = setup();
    const other = setup().recorder;
    recorder.frame(true, 0, 0);
    expect(recorder.capture("tone", 0.8)).toBe(false);
    recorder.arm(true);
    expect(other.armed).toBe(false);
    expect(recorder.capture("fx-echo", 0.8)).toBe(false);
    expect(recorder.capture("tone", 0.8)).toBe(true);
    expect(lane.base).toBe(0.25);
    expect(lane.values?.slice(0, 3)).toEqual([0.8, 0.25, 0.25]);
    recorder.frame(false, 0, 0);
    expect(recorder.capture("tone", 0.1)).toBe(false);
  });

  it("records held values across cells and the loop boundary, then stops on release", () => {
    const { lane, recorder } = setup();
    recorder.arm(true);
    recorder.frame(true, 90, 0);
    recorder.begin("tone");
    recorder.capture("tone", 0.7);
    recorder.frame(true, 108, 0);
    expect(lane.values?.slice(0, 4)).toEqual([0.7, 0.7, 0.7, 0.25]);
    expect(lane.values?.[15]).toBe(0.7);
    recorder.end("tone");
    recorder.frame(true, 114, 0);
    expect(lane.values?.[3]).toBe(0.25);
  });

  it("does not write merely touching a knob and keyboard changes write one cell", () => {
    const { lane, recorder } = setup();
    recorder.arm(true);
    recorder.frame(true, 0, 0);
    recorder.begin("tone");
    recorder.frame(true, 12, 0);
    expect(lane.values).toBeNull();
    recorder.end("tone");
    recorder.capture("tone", 1);
    recorder.frame(true, 30, 0);
    expect(lane.values?.filter((value) => value === 1)).toHaveLength(1);
  });

  it("merges writes with incoming edits outside the touched range", () => {
    const { lane, recorder } = setup();
    recorder.arm(true);
    recorder.frame(true, 0, 0);
    recorder.begin("tone");
    recorder.capture("tone", 0.8);
    if (!lane.values) throw new Error("Missing lane");
    lane.values[10] = 0.9;
    recorder.frame(true, 12, 0);
    expect(lane.values[10]).toBe(0.9);
    expect(lane.values[1]).toBe(0.8);
  });

  it("uses the instrument grid and swing for long patterns", () => {
    const { lane, recorder } = setup();
    lane.timing = { bars: 16, meter: "5/4", grid: "triplet" };
    recorder.arm(true);
    recorder.frame(true, 1916, 0.5);
    recorder.capture("tone", 0.9);
    expect(lane.values).toHaveLength(480);
    expect(lane.values?.[479]).toBe(0.9);
    lane.timing = { bars: 1, meter: "4/4", grid: "straight" };
    lane.values = null;
    recorder.frame(true, 7, 0.5);
    recorder.capture("tone", 0.8);
    expect(lane.values?.[0]).toBe(0.8);
    expect(lane.values?.[1]).toBe(0.25);
  });

  it("clears touch ownership on stop, rewind, disarm or timing changes", () => {
    for (const action of ["stop", "rewind", "disarm", "timing"]) {
      const { lane, recorder } = setup();
      recorder.arm(true);
      recorder.frame(true, 24, 0);
      recorder.begin("tone");
      recorder.capture("tone", 0.8);
      if (action === "stop") recorder.frame(false, 24, 0);
      if (action === "rewind") recorder.frame(true, 0, 0);
      if (action === "disarm") recorder.arm(false);
      if (action === "timing")
        lane.timing = { bars: 2, meter: "4/4", grid: "straight" };
      expect(recorder.frame(true, 42, 0)).toEqual([]);
      expect(lane.values?.[7]).toBe(0.25);
    }
  });
});
