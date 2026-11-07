interface SliderRange {
  min: number;
  max: number;
  step: number;
  value: number;
}

interface DragState {
  element: HTMLElement;
  startX: number;
  startY: number;
  started: number;
  dragged: boolean;
  lastX: number;
  lastY: number;
  rawValue: number;
  emittedValue: number;
  axis: "pending" | "pitch" | "scroll" | "held";
  holdTimer: ReturnType<typeof setTimeout> | null;
}

export type NoteAction = "gate" | "accent" | "join" | "separate";

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
  return { min, max, step, value: Math.min(max, Math.max(min, value)) };
}

function quantize(value: number, range: SliderRange): number {
  const bounded = Math.min(range.max, Math.max(range.min, value));
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

/** Vertical controls and note expression, leaving horizontal touch scrolling native. */
export function installGestures(
  root: HTMLElement,
  onChange: (element: HTMLElement, value: number) => void,
  onNoteAction?: (element: HTMLElement, action: NoteAction) => void,
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
    if (state?.holdTimer) clearTimeout(state.holdTimer);
    pointers.delete(pointerId);
    if (
      state &&
      !Array.from(pointers.values()).some(
        (pointer) => pointer.element === state.element,
      )
    )
      state.element.classList.remove("dragging", "holding", "held");
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
    if (
      Array.from(pointers.values()).some((state) => state.element === element)
    )
      return;
    if (!element.dataset.notePad || event.pointerType !== "touch")
      event.preventDefault();
    element.focus({ preventScroll: true });
    const state: DragState = {
      element,
      startX: event.clientX,
      startY: event.clientY,
      started: performance.now(),
      dragged: false,
      lastX: event.clientX,
      lastY: event.clientY,
      rawValue: range.value,
      emittedValue: range.value,
      axis: "pending",
      holdTimer: null,
    };
    pointers.set(event.pointerId, state);
    if (element.dataset.notePad && onNoteAction) {
      element.classList.add("holding");
      state.holdTimer = setTimeout(() => {
        state.holdTimer = null;
        if (
          !root.contains(element) ||
          state.axis !== "pending" ||
          !pointers.has(event.pointerId)
        )
          return;
        state.axis = "held";
        state.dragged = true;
        element.classList.remove("holding");
        element.classList.add("held");
        onNoteAction(element, "accent");
      }, 420);
    }
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
    if (state.element.dataset.notePad && onNoteAction) {
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (
        (state.axis === "pending" || state.axis === "held") &&
        Math.max(Math.abs(dx), Math.abs(dy)) > 8
      ) {
        state.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "scroll" : "pitch";
        state.dragged = true;
        if (state.holdTimer) clearTimeout(state.holdTimer);
        state.holdTimer = null;
        state.element.classList.remove("holding");
      }
      if (state.axis === "scroll") {
        if (event.pointerType !== "touch") {
          const strip = state.element.closest(".sequence-scroll");
          if (strip instanceof HTMLElement)
            strip.scrollLeft += state.lastX - event.clientX;
          state.lastX = event.clientX;
        }
        return;
      }
      if (state.axis !== "pitch") return;
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
    if (state?.element.dataset.notePad && onNoteAction) {
      if (!state.dragged && now - state.started < 420)
        onNoteAction(state.element, "gate");
      lastTap = null;
    } else if (state && !state.dragged && now - state.started < 500) {
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
    if (element.dataset.notePad && onNoteAction) {
      const action =
        event.key.toLowerCase() === "a"
          ? "accent"
          : event.key === "ArrowRight"
            ? "join"
            : event.key === "ArrowLeft"
              ? "separate"
              : event.key === "Enter" || event.key === " "
                ? "gate"
                : null;
      if (action) {
        event.preventDefault();
        if (!event.repeat) onNoteAction(element, action);
        return;
      }
    }
    let next: number;
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
    if (!element || element.dataset.notePad) return;
    const reset = numberAttribute(element, "data-reset");
    if (reset === null) return;
    event.preventDefault();
    change(element, reset);
  };

  const visibilityChange = (): void => {
    if (document.hidden) cancelAll();
  };
  const contextMenu = (event: MouseEvent): void => {
    if (findControl(event.target)?.dataset.notePad) event.preventDefault();
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
  root.addEventListener("contextmenu", contextMenu);
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
    root.removeEventListener("contextmenu", contextMenu);
    window.removeEventListener("blur", cancelAll);
    document.removeEventListener("visibilitychange", visibilityChange);
  };
}
