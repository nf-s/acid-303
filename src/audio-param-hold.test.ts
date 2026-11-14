import { describe, expect, it } from "vitest";
import {
  cancelEvents,
  recordEvent,
  timelineValueAt,
  type ParamTimeline,
} from "./audio-param-hold";

const timeline = (base = 0): ParamTimeline => ({ base, events: [] });

describe("cancel-and-hold polyfill timeline", () => {
  it("holds the base value before any event and set values after them", () => {
    const param = timeline(0.5);
    recordEvent(param, { kind: "set", time: 1, value: 0.8 });
    expect(timelineValueAt(param, 0.5)).toBe(0.5);
    expect(timelineValueAt(param, 2)).toBe(0.8);
  });

  it("interpolates linear and exponential ramps that are still running", () => {
    const linear = timeline();
    recordEvent(linear, { kind: "set", time: 1, value: 0 });
    recordEvent(linear, { kind: "linear", time: 2, value: 1 });
    expect(timelineValueAt(linear, 1.25)).toBeCloseTo(0.25);
    const exponential = timeline();
    recordEvent(exponential, { kind: "set", time: 0, value: 1 });
    recordEvent(exponential, { kind: "exponential", time: 2, value: 100 });
    expect(timelineValueAt(exponential, 1)).toBeCloseTo(10);
  });

  it("follows a target approach, including a second target", () => {
    const param = timeline();
    recordEvent(param, { kind: "set", time: 0, value: 1 });
    recordEvent(param, { kind: "target", time: 1, value: 0, constant: 0.5 });
    expect(timelineValueAt(param, 1.5)).toBeCloseTo(Math.exp(-1));
    recordEvent(param, { kind: "target", time: 2, value: 1, constant: 1 });
    const start = Math.exp(-2);
    expect(timelineValueAt(param, 3)).toBeCloseTo(
      1 + (start - 1) * Math.exp(-1),
    );
  });

  it("reads inside a value curve and holds its last value after it", () => {
    const param = timeline();
    recordEvent(param, {
      kind: "curve",
      time: 1,
      values: Float32Array.from([0, 1, 0]),
      duration: 2,
    });
    expect(timelineValueAt(param, 1.5)).toBeCloseTo(0.5);
    expect(timelineValueAt(param, 4)).toBe(0);
  });

  it("cancels events at or after a time and keeps earlier ones", () => {
    const param = timeline();
    recordEvent(param, { kind: "set", time: 0, value: 1 });
    recordEvent(param, { kind: "linear", time: 2, value: 0 });
    cancelEvents(param, 1);
    expect(param.events).toEqual([{ kind: "set", time: 0, value: 1 }]);
  });

  it("keeps a bounded history without changing current values", () => {
    const param = timeline();
    for (let index = 0; index < 200; index++)
      recordEvent(param, { kind: "set", time: index, value: index });
    expect(param.events.length).toBeLessThanOrEqual(25);
    expect(timelineValueAt(param, 199.5)).toBe(199);
  });
});
