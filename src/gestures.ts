interface SliderRange {
  min: number;
  max: number;
  step: number;
  value: number;
  values?: number[];
}

interface DragState {
  element: HTMLElement;
  startX: number;
  startY: number;
  started: number;
  dragged: boolean;
  lastY: number;
  rawValue: number;
  emittedValue: number;
}

function numberAttribute(element: HTMLElement, name: string): number | null {
  const attribute = element.getAttribute(name);
  if (attribute === null || attribute.trim() === "") return null;
  const value = Number(attribute);
  return Number.isFinite(value) ? value : null;
}

function readRange(element: HTMLElement): SliderRange | null {
  const min = numberAttribute(element, "aria-valuemin");
  const max = numberAttribute(element, "aria-valuemax");
  const value = numberAttribute(element, "aria-valuenow");
  const step = numberAttribute(element, "data-step") ?? 1;
  if (
    min === null ||
    max === null ||
    value === null ||
    max <= min ||
    !Number.isFinite(max - min) ||
    step <= 0
  )
    return null;
  const values = element.dataset.values
    ?.split(",")
    .map(Number)
    .filter((item) => Number.isFinite(item) && item >= min && item <= max)
    .sort((a, b) => a - b);
  return { min, max, step, value: Math.min(max, Math.max(min, value)), values };
}

function quantize(value: number, range: SliderRange): number {
  const bounded = Math.min(range.max, Math.max(range.min, value));
  if (range.values?.length)
    return range.values.reduce((nearest, candidate) =>
      Math.abs(candidate - bounded) < Math.abs(nearest - bounded)
        ? candidate
        : nearest,
    );
  if (bounded === range.min || bounded === range.max) return bounded;
  const snapped =
    range.min + Math.round((bounded - range.min) / range.step) * range.step;
  return Math.min(
    range.max,
    Math.max(range.min, Number(snapped.toPrecision(12))),
  );
}

function showValue(
  element: HTMLElement,
  range: SliderRange,
  value: number,
): void {
  element.setAttribute("aria-valuenow", String(value));
  element.style.setProperty(
    "--knob-angle",
    `${-135 + ((value - range.min) / (range.max - range.min)) * 270}deg`,
  );
}

/** Delegated vertical controls: drag upward, or use arrows, +/- and Home/End. */
export function installGestures(
  root: HTMLElement,
  onChange: (element: HTMLElement, value: number) => void,
): () => void {
  const pointers = new Map<number, DragState>();
  let destroyed = false;
  let lastTap: {
    element: HTMLElement;
    time: number;
    x: number;
    y: number;
  } | null = null;

  const findControl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const control = target.closest(".gesture-control");
    if (!(control instanceof HTMLElement) || !root.contains(control))
      return null;
    if (
      control.getAttribute("aria-disabled") === "true" ||
      (control instanceof HTMLButtonElement && control.disabled)
    )
      return null;
    return control;
  };

  const initialize = (element: HTMLElement): void => {
    const controls = element.matches(".gesture-control") ? [element] : [];
    for (const candidate of element.querySelectorAll(".gesture-control")) {
      if (candidate instanceof HTMLElement) controls.push(candidate);
    }
    for (const control of controls) {
      const range = readRange(control);
      if (range) showValue(control, range, range.value);
    }
  };

  const change = (element: HTMLElement, value: number): number | null => {
    if (!root.contains(element)) return null;
    const range = readRange(element);
    if (!range) return null;
    const next = quantize(value, range);
    showValue(element, range, next);
    if (next !== range.value) onChange(element, next);
    return next;
  };

  const finish = (pointerId: number): void => {
    const state = pointers.get(pointerId);
    pointers.delete(pointerId);
    if (
      state &&
      !Array.from(pointers.values()).some(
        (pointer) => pointer.element === state.element,
      )
    )
      state.element.classList.remove("dragging");
    if (root.hasPointerCapture(pointerId))
      root.releasePointerCapture(pointerId);
  };

  const cancelAll = (): void => {
    lastTap = null;
    for (const pointerId of pointers.keys()) finish(pointerId);
  };

  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const element = findControl(event.target);
    if (!element) return;
    const range = readRange(element);
    if (!range) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
    pointers.set(event.pointerId, {
      element,
      startX: event.clientX,
      startY: event.clientY,
      started: performance.now(),
      dragged: false,
      lastY: event.clientY,
      rawValue: range.value,
      emittedValue: range.value,
    });
    element.classList.add("dragging");
    // Capture on the stable root so replacing an inspector does not strand a drag.
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      finish(event.pointerId);
    }
  };

  const pointerMove = (event: PointerEvent): void => {
    const state = pointers.get(event.pointerId);
    if (!state) return;
    const range = readRange(state.element);
    if (!root.contains(state.element) || !range) {
      finish(event.pointerId);
      return;
    }
    event.preventDefault();
    if (
      Math.abs(event.clientX - state.startX) > 4 ||
      Math.abs(event.clientY - state.startY) > 4
    )
      state.dragged = true;
    if (range.value !== state.emittedValue) state.rawValue = range.value;
    const delta =
      ((state.lastY - event.clientY) / 240) *
      (range.max - range.min) *
      (event.shiftKey ? 0.2 : 1);
    state.lastY = event.clientY;
    state.rawValue = Math.min(
      range.max,
      Math.max(range.min, state.rawValue + delta),
    );
    const value = change(state.element, state.rawValue);
    if (value !== null) state.emittedValue = value;
  };

  const pointerUp = (event: PointerEvent): void => {
    pointerMove(event);
    const state = pointers.get(event.pointerId);
    const now = performance.now();
    if (state && !state.dragged && now - state.started < 500) {
      if (
        lastTap?.element === state.element &&
        now - lastTap.time < 350 &&
        Math.abs(event.clientX - lastTap.x) < 16 &&
        Math.abs(event.clientY - lastTap.y) < 16
      ) {
        const reset = numberAttribute(state.element, "data-reset");
        if (reset !== null) change(state.element, reset);
        lastTap = null;
      } else
        lastTap = {
          element: state.element,
          time: now,
          x: event.clientX,
          y: event.clientY,
        };
    } else lastTap = null;
    finish(event.pointerId);
  };
  const pointerCancel = (event: PointerEvent): void => {
    finish(event.pointerId);
  };

  const keyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const element = findControl(event.target);
    if (!element) return;
    const range = readRange(element);
    if (!range) return;
    let next: number;
    if (
      range.values?.length &&
      [
        "ArrowUp",
        "ArrowRight",
        "+",
        "=",
        "ArrowDown",
        "ArrowLeft",
        "-",
        "_",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    ) {
      const index = range.values.indexOf(quantize(range.value, range));
      const direction = ["ArrowUp", "ArrowRight", "+", "=", "PageUp"].includes(
        event.key,
      )
        ? 1
        : -1;
      const nextValue =
        range.values[
          Math.max(
            0,
            Math.min(
              range.values.length - 1,
              index + direction * (event.key.startsWith("Page") ? 5 : 1),
            ),
          )
        ];
      if (nextValue !== undefined) {
        event.preventDefault();
        change(element, nextValue);
      }
      return;
    }
    if (["ArrowUp", "ArrowRight", "+", "="].includes(event.key))
      next = range.value + range.step;
    else if (["ArrowDown", "ArrowLeft", "-", "_"].includes(event.key))
      next = range.value - range.step;
    else if (event.key === "Home") next = range.min;
    else if (event.key === "End") next = range.max;
    else if (event.key === "PageUp") next = range.value + range.step * 10;
    else if (event.key === "PageDown") next = range.value - range.step * 10;
    else return;
    event.preventDefault();
    change(element, next);
  };

  const doubleClick = (event: MouseEvent): void => {
    const element = findControl(event.target);
    if (!element) return;
    const reset = numberAttribute(element, "data-reset");
    if (reset === null) return;
    event.preventDefault();
    change(element, reset);
  };

  const visibilityChange = (): void => {
    if (document.hidden) cancelAll();
  };
  const observer = new MutationObserver((mutations) => {
    for (const [pointerId, state] of pointers)
      if (!root.contains(state.element)) finish(pointerId);
    for (const mutation of mutations)
      for (const node of mutation.addedNodes)
        if (node instanceof HTMLElement) initialize(node);
  });
  initialize(root);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("pointerdown", pointerDown);
  root.addEventListener("pointermove", pointerMove);
  root.addEventListener("pointerup", pointerUp);
  root.addEventListener("pointercancel", pointerCancel);
  root.addEventListener("lostpointercapture", pointerCancel);
  root.addEventListener("keydown", keyDown);
  root.addEventListener("dblclick", doubleClick);
  window.addEventListener("blur", cancelAll);
  document.addEventListener("visibilitychange", visibilityChange);

  return () => {
    if (destroyed) return;
    destroyed = true;
    cancelAll();
    observer.disconnect();
    root.removeEventListener("pointerdown", pointerDown);
    root.removeEventListener("pointermove", pointerMove);
    root.removeEventListener("pointerup", pointerUp);
    root.removeEventListener("pointercancel", pointerCancel);
    root.removeEventListener("lostpointercapture", pointerCancel);
    root.removeEventListener("keydown", keyDown);
    root.removeEventListener("dblclick", doubleClick);
    window.removeEventListener("blur", cancelAll);
    document.removeEventListener("visibilitychange", visibilityChange);
  };
}
