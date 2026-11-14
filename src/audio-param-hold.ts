/**
 * Firefox has no AudioParam.cancelAndHoldAtTime. This polyfill records each
 * parameter's scheduled automation so it can work out the value at the hold
 * time, cancel later events, and pin that value, including for envelopes
 * scheduled ahead of the playhead.
 */
export type ParamEvent =
  | { kind: "set" | "linear" | "exponential"; time: number; value: number }
  | { kind: "target"; time: number; value: number; constant: number }
  | { kind: "curve"; time: number; values: Float32Array; duration: number };

export interface ParamTimeline {
  base: number;
  events: ParamEvent[];
}

const RETAINED_EVENTS = 24;

function curveValue(values: Float32Array, position: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(1, Math.max(0, position)) * (values.length - 1);
  const lower = Math.floor(index);
  const upper = Math.min(values.length - 1, lower + 1);
  const start = values[lower] ?? 0;
  const end = values[upper] ?? start;
  return start + (end - start) * (index - lower);
}

function curveEnd(values: Float32Array): number {
  return values[values.length - 1] ?? 0;
}

function approach(
  start: number,
  target: number,
  constant: number,
  elapsed: number,
): number {
  if (constant <= 0) return target;
  return target + (start - target) * Math.exp(-elapsed / constant);
}

/** The automation value at `time`, following the Web Audio event rules. */
export function timelineValueAt(timeline: ParamTimeline, time: number): number {
  let pointTime = 0;
  let pointValue = timeline.base;
  let target: { value: number; constant: number } | null = null;
  for (const event of timeline.events) {
    if (event.kind === "curve") {
      if (event.time > time) break;
      const end = event.time + event.duration;
      if (time < end)
        return curveValue(event.values, (time - event.time) / event.duration);
      pointTime = end;
      pointValue = curveEnd(event.values);
      target = null;
      continue;
    }
    if (event.time > time) {
      const progress = (time - pointTime) / (event.time - pointTime);
      if (event.kind === "linear")
        return pointValue + (event.value - pointValue) * progress;
      if (event.kind === "exponential")
        return pointValue * event.value > 0
          ? pointValue * (event.value / pointValue) ** progress
          : pointValue;
      break;
    }
    if (event.kind === "target") {
      if (target)
        pointValue = approach(
          pointValue,
          target.value,
          target.constant,
          event.time - pointTime,
        );
      target = { value: event.value, constant: event.constant };
    } else {
      pointValue = event.value;
      target = null;
    }
    pointTime = event.time;
  }
  return target
    ? approach(pointValue, target.value, target.constant, time - pointTime)
    : pointValue;
}

/** Adds an event in time order and drops history no later query can reach. */
export function recordEvent(timeline: ParamTimeline, event: ParamEvent): void {
  const index = timeline.events.findIndex((item) => item.time > event.time);
  if (index < 0) timeline.events.push(event);
  else timeline.events.splice(index, 0, event);
  const limit = timeline.events.length - RETAINED_EVENTS;
  let anchor = -1;
  for (let item = 0; item < limit; item++) {
    const kind = timeline.events[item]?.kind;
    if (kind === "set" || kind === "linear" || kind === "exponential")
      anchor = item;
  }
  if (anchor <= 0) return;
  const point = timeline.events[anchor];
  if (!point || point.kind === "target" || point.kind === "curve") return;
  timeline.events.splice(0, anchor + 1, {
    kind: "set",
    time: point.time,
    value: point.value,
  });
}

export function cancelEvents(timeline: ParamTimeline, time: number): void {
  timeline.events = timeline.events.filter((event) => event.time < time);
}

export function installCancelAndHold(): void {
  if (typeof AudioParam === "undefined") return;
  const prototype = AudioParam.prototype;
  if (typeof prototype.cancelAndHoldAtTime === "function") return;
  const timelines = new WeakMap<AudioParam, ParamTimeline>();
  const timelineFor = (parameter: AudioParam, base: number): ParamTimeline => {
    const existing = timelines.get(parameter);
    if (existing) return existing;
    const created: ParamTimeline = { base, events: [] };
    timelines.set(parameter, created);
    return created;
  };
  const tracked = <Args extends number[]>(
    native: (this: AudioParam, ...args: Args) => AudioParam,
    describe: (...args: Args) => ParamEvent,
  ) =>
    function (this: AudioParam, ...args: Args): AudioParam {
      // Read before scheduling: the first event's starting point is the current value.
      const base = this.value;
      const result = native.apply(this, args);
      recordEvent(timelineFor(this, base), describe(...args));
      return result;
    };
  const {
    setValueAtTime,
    linearRampToValueAtTime,
    exponentialRampToValueAtTime,
    setTargetAtTime,
    setValueCurveAtTime,
    cancelScheduledValues,
  } = prototype;
  prototype.setValueAtTime = tracked(setValueAtTime, (value, time) => ({
    kind: "set",
    time,
    value,
  }));
  prototype.linearRampToValueAtTime = tracked(
    linearRampToValueAtTime,
    (value, time) => ({ kind: "linear", time, value }),
  );
  prototype.exponentialRampToValueAtTime = tracked(
    exponentialRampToValueAtTime,
    (value, time) => ({ kind: "exponential", time, value }),
  );
  prototype.setTargetAtTime = tracked(
    setTargetAtTime,
    (value, time, constant) => ({ kind: "target", time, value, constant }),
  );
  prototype.setValueCurveAtTime = function (values, time, duration) {
    const base = this.value;
    const result = setValueCurveAtTime.call(this, values, time, duration);
    recordEvent(timelineFor(this, base), {
      kind: "curve",
      time,
      values: Float32Array.from(values),
      duration,
    });
    return result;
  };
  prototype.cancelScheduledValues = function (time) {
    const result = cancelScheduledValues.call(this, time);
    const timeline = timelines.get(this);
    if (timeline) cancelEvents(timeline, time);
    return result;
  };
  prototype.cancelAndHoldAtTime = function (time) {
    const timeline = timelines.get(this);
    if (!timeline) return this;
    const value = timelineValueAt(timeline, time);
    const curve = timeline.events.find(
      (event) =>
        event.kind === "curve" &&
        event.time < time &&
        time < event.time + event.duration,
    );
    if (curve && curve.kind === "curve") {
      // A curve cannot be cut short, so replace it with a ramp to the held value.
      this.cancelScheduledValues(curve.time);
      this.setValueAtTime(curve.values[0] ?? value, curve.time);
      this.linearRampToValueAtTime(value, time);
      return this;
    }
    const next = timeline.events.find((event) => event.time >= time);
    this.cancelScheduledValues(time);
    if (next && next.time > time && next.kind === "linear")
      this.linearRampToValueAtTime(value, time);
    else if (
      next &&
      next.time > time &&
      next.kind === "exponential" &&
      value * next.value > 0
    )
      this.exponentialRampToValueAtTime(value, time);
    else this.setValueAtTime(value, time);
    return this;
  };
}
