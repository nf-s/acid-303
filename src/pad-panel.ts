import type { MusicalScale } from "./model";
import { noteName } from "./model";
import { PPQ, padTimingSchema, trackPosition, trackStepCount } from "./timing";
import { createInstrumentAutomation } from "./instrument-automation";
import {
  PAD_PROGRESSIONS,
  PAD_SOUNDS,
  applyPadProgression,
  normalizedPadValue,
  padChordAtTick,
  resizePadTrack,
  padChordLabel,
  padChordNotes,
  padScaleDegrees,
} from "./pad-model";
import type { PadParameter, PadTrack } from "./pad-model";

const controlLabels: ReadonlyArray<{ parameter: PadParameter; label: string }> =
  [
    { parameter: "attack", label: "Attack" },
    { parameter: "release", label: "Release" },
    { parameter: "tone", label: "Tone" },
    { parameter: "motion", label: "Motion" },
    { parameter: "spread", label: "Spread" },
    { parameter: "space", label: "Space" },
    { parameter: "shape", label: "Shape" },
    { parameter: "volume", label: "Level" },
  ];
const controls = controlLabels.map((control) => ({
  ...control,
  min: 0,
  max: 100,
  multiplier: 100,
}));
interface PadPanelOptions {
  getTrack: () => PadTrack;
  getScale: () => MusicalScale;
  onChange: () => void;
  renderControl: (
    id: string,
    label: string,
    min: number,
    max: number,
    value: number,
    display: string,
    step?: string,
    ariaLabel?: string,
    allowedValues?: number[],
  ) => string;
}
const degrees = ["I", "II", "III", "IV", "V", "VI", "VII"];

function chordDuration(track: PadTrack, slot: number): string {
  const length = track.timing.bars / 4;
  const first = Math.floor(slot * length) + 1;
  if (length < 1)
    return `Bar ${first}, ${slot % 2 ? "second half" : "first half"}`;
  return length === 1 ? `Bar ${first}` : `Bars ${first}–${first + length - 1}`;
}

export function createPadPanel(
  container: HTMLElement,
  options: PadPanelOptions,
) {
  let selected = 0;
  let playingTick = -1;
  let currentSwing = 0;
  let presetsOpen = false;
  let destroyed = false;
  let degreeSignature = "";
  const initial = options.getTrack();
  container.classList.add("pad-instrument");
  container.innerHTML = `
    <div class="section-header"><div class="section-title"><span class="section-number">05</span><h2 id="pad-title">Chord pads</h2></div><button class="text-button" data-pad-enable></button></div>
    <div class="bass-meta"><div class="waveform-switch pad-sounds" role="group" aria-label="Pad sound">${PAD_SOUNDS.map((sound, index) => `<button data-pad-sound="${index}">${sound}</button>`).join("")}</div><span class="pad-position"></span></div>
    <div class="pad-composition"><div class="pad-timeline"><div class="pad-timeline-tools"><div class="pad-length" role="group" aria-label="Progression length">${[2, 4, 8, 16].map((bars) => `<button data-pad-bars="${bars}">${bars} bars</button>`).join("")}</div><div class="pad-progression-picker"><button data-pad-presets aria-controls="pad-progressions" aria-expanded="false">Progressions</button><div class="pad-progressions" id="pad-progressions" role="group" aria-label="Chord progressions" hidden>${PAD_PROGRESSIONS.map((progression) => `<button data-pad-progression="${progression.id}" aria-describedby="pad-progression-help-${progression.id}"><span class="pad-progression-name"></span><span class="pad-progression-tooltip" id="pad-progression-help-${progression.id}" role="tooltip"></span></button>`).join("")}</div></div></div><p class="pad-progression-description" id="pad-progression-description"></p><div class="pad-chords" role="group" aria-label="Chord progression timeline">${Array.from({ length: 4 }, (_, index) => `<button data-pad-slot="${index}"><span class="pad-chord-number">${index + 1}</span><span class="pad-chord-content"><strong></strong><small></small></span><span class="pad-chord-duration"></span></button>`).join("")}</div></div><div class="pad-chord-editor"><h3 id="pad-selected-label"></h3><div class="pad-edit-group"><span>Degree</span><div class="pad-degrees" role="group"></div></div><div class="pad-edit-group"><span>Inversion</span><div class="pad-inversions" role="group">${["Root", "1st", "2nd", "3rd"].map((name, inversion) => `<button data-pad-inversion="${inversion}">${name}</button>`).join("")}</div></div></div></div>
    <div class="acid-controls pad-controls">${controls.map((control) => options.renderControl(`pad-${control.parameter}`, control.label, 0, 100, Math.round(initial[control.parameter] * 100), `${Math.round(initial[control.parameter] * 100)}%`, "1", `Pad ${control.label.toLowerCase()}`)).join("")}</div><div id="pad-automation"></div>`;
  const progressionPicker = container.querySelector<HTMLElement>(
    ".pad-progression-picker",
  );
  const progressionButton =
    container.querySelector<HTMLButtonElement>("[data-pad-presets]");
  const progressionMenu =
    container.querySelector<HTMLElement>("#pad-progressions");
  if (!progressionPicker || !progressionButton || !progressionMenu)
    throw new Error("Pad progression picker is missing.");
  function positionProgressions(makeRoom = false): void {
    if (
      !presetsOpen ||
      !progressionPicker ||
      !progressionMenu ||
      !progressionButton
    )
      return;
    const width = Math.min(440, window.innerWidth - 32);
    const top = Math.max(
      8,
      (document.querySelector(".transport")?.getBoundingClientRect().bottom ??
        0) + 8,
    );
    progressionMenu.style.width = `${width}px`;
    if (makeRoom) {
      const needed = Math.min(300, progressionMenu.scrollHeight) + 10;
      const space = progressionButton.getBoundingClientRect().top - top;
      if (space < needed)
        window.scrollBy({ top: space - needed, behavior: "instant" });
    }
    const anchor = progressionPicker.getBoundingClientRect();
    progressionMenu.style.left = `${Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16)) - anchor.left}px`;
    progressionMenu.style.maxHeight = `${Math.max(80, progressionButton.getBoundingClientRect().top - top - 10)}px`;
  }
  function closeProgressions(restoreFocus = false): void {
    presetsOpen = false;
    if (progressionMenu) progressionMenu.hidden = true;
    progressionButton?.setAttribute("aria-expanded", "false");
    if (restoreFocus) progressionButton?.focus({ preventScroll: true });
  }
  function outsideProgressions(event: Event): void {
    if (
      presetsOpen &&
      event.target instanceof Node &&
      !progressionPicker?.contains(event.target)
    )
      closeProgressions();
  }
  function progressionKey(event: KeyboardEvent): void {
    if (presetsOpen && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeProgressions(true);
    }
    if (
      event.target === progressionButton &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      presetsOpen = true;
      render(false);
      positionProgressions(true);
      const choices = progressionMenu?.querySelectorAll<HTMLButtonElement>(
        "[data-pad-progression]",
      );
      const choice =
        event.key === "ArrowUp"
          ? choices?.item((choices?.length ?? 1) - 1)
          : choices?.item(0);
      choice?.focus({ preventScroll: true });
    }
  }
  function resizeProgressions(): void {
    positionProgressions();
  }
  const automationContainer =
    container.querySelector<HTMLElement>("#pad-automation");
  if (!automationContainer)
    throw new Error("Pad automation container is missing.");
  const automation = createInstrumentAutomation(automationContainer, {
    prefix: "pad",
    label: "Pad",
    root: container,
    controls,
    minNote: 36,
    maxNote: 84,
    getLane: (parameter) => options.getTrack().automation[parameter],
    setLane: (parameter, values) => {
      options.getTrack().automation[parameter] = values;
    },
    getBase: (parameter) => normalizedPadValue(options.getTrack(), parameter),
    getScale: options.getScale,
    getMuted: () => options.getTrack().muted,
    getTiming: () => options.getTrack().timing,
    allowedBars: [2, 4, 8, 16],
    onTimingChange: (timing) => {
      const parsed = padTimingSchema.safeParse(timing);
      if (!parsed.success) return;
      Object.assign(
        options.getTrack(),
        resizePadTrack(options.getTrack(), parsed.data),
      );
      render();
      options.onChange();
    },
    getSteps: () => {
      const track = options.getTrack();
      const roots = Array.from(
        { length: 4 },
        (_, slot) => padChordNotes(track, options.getScale(), slot)[0] ?? 60,
      );
      const count = trackStepCount(track.timing);
      return Array.from({ length: count }, (_, index) => ({
        note: roots[Math.floor((index * 4) / count)] ?? 60,
        on: true,
        accent: false,
        slide: false,
      }));
    },
    onChange: options.onChange,
  });

  function setPosition(absoluteTick: number, swing: number): void {
    playingTick = absoluteTick;
    currentSwing = swing;
    const track = options.getTrack();
    const current = padChordAtTick(track, absoluteTick, swing);
    container
      .querySelectorAll<HTMLElement>("[data-pad-slot]")
      .forEach((button) => {
        const active =
          Number(button.dataset.padSlot) === current && !track.muted;
        button.classList.toggle("current", active);
        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    const position = container.querySelector(".pad-position");
    if (position)
      position.textContent =
        absoluteTick < 0
          ? `${track.timing.bars} bars`
          : `Bar ${trackPosition(track.timing, absoluteTick, swing).bar + 1} / ${track.timing.bars}`;
    automation.setPosition(absoluteTick, swing);
  }
  function setStep(absoluteStep: number): void {
    setPosition(absoluteStep < 0 ? -1 : (absoluteStep * PPQ) / 4, 0);
  }
  function displayControl(parameter: PadParameter): void {
    const value = Math.round(options.getTrack()[parameter] * 100);
    const element = container.querySelector<HTMLElement>(`#pad-${parameter}`);
    element?.setAttribute("aria-valuenow", String(value));
    element?.setAttribute("aria-valuetext", `${value}%`);
    element?.style.setProperty("--knob-angle", `${-135 + value * 2.7}deg`);
    const output = container.querySelector(`#pad-${parameter}-value`);
    if (output) output.textContent = `${value}%`;
  }
  function render(resetHistory = true): void {
    if (destroyed) return;
    const track = options.getTrack(),
      scale = options.getScale();
    const count = padScaleDegrees(scale).length;
    const chord = track.chords[selected];
    const enable = container.querySelector("[data-pad-enable]");
    if (enable) {
      enable.textContent = track.muted ? "Off" : "On";
      enable.setAttribute("aria-pressed", String(!track.muted));
      enable.setAttribute(
        "aria-label",
        `${track.muted ? "Enable" : "Mute"} chord pads`,
      );
    }
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-pad-sound]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.padSound) === track.sound),
      );
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-pad-bars]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.padBars) === track.timing.bars),
      );
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-pad-slot]",
    )) {
      const slot = Number(button.dataset.padSlot);
      const name = padChordLabel(track, scale, slot);
      button.setAttribute("aria-pressed", String(slot === selected));
      button.setAttribute(
        "aria-label",
        `Edit chord ${slot + 1}: ${name}, ${chordDuration(track, slot)}`,
      );
      const title = button.querySelector("strong"),
        notes = button.querySelector("small"),
        duration = button.querySelector(".pad-chord-duration");
      if (title) title.textContent = name;
      if (notes)
        notes.textContent = padChordNotes(track, scale, slot)
          .map(noteName)
          .join(" ");
      if (duration) duration.textContent = chordDuration(track, slot);
    }
    const degreeOptions = container.querySelector(".pad-degrees");
    const signature = `${scale.root}:${scale.mode}`;
    if (degreeOptions) {
      degreeOptions.setAttribute("aria-label", `Chord ${selected + 1} degree`);
      if (degreeSignature !== signature) {
        degreeOptions.innerHTML = padScaleDegrees(scale)
          .map(
            (note, degree) =>
              `<button data-pad-degree="${degree}">${degrees[degree]} ${noteName(note).replace(/-?\d+$/, "")}</button>`,
          )
          .join("");
        degreeSignature = signature;
      }
    }
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-pad-degree]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.padDegree) === chord?.degree),
      );
    container
      .querySelector(".pad-inversions")
      ?.setAttribute("aria-label", `Chord ${selected + 1} inversion`);
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-pad-inversion]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.padInversion) === chord?.inversion),
      );
    const selectedLabel = container.querySelector("#pad-selected-label");
    if (selectedLabel)
      selectedLabel.textContent = `Chord ${selected + 1} · ${padChordLabel(track, scale, selected)}`;
    const progressions =
      container.querySelector<HTMLElement>("#pad-progressions");
    if (progressions) progressions.hidden = !presetsOpen;
    container
      .querySelector("[data-pad-presets]")
      ?.setAttribute("aria-expanded", String(presetsOpen));
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-pad-progression]",
    )) {
      const progression = PAD_PROGRESSIONS.find(
        (item) => item.id === button.dataset.padProgression,
      );
      if (!progression) continue;
      const name = button.querySelector(".pad-progression-name");
      const tooltip = button.querySelector(".pad-progression-tooltip");
      if (name)
        name.textContent = progression.degrees
          .map((degree) => degrees[degree % count])
          .join(" · ");
      if (tooltip) tooltip.textContent = progression.description;
      button.setAttribute(
        "aria-pressed",
        String(
          progression.degrees.every(
            (degree, index) => degree % count === track.chords[index]?.degree,
          ),
        ),
      );
      button.setAttribute(
        "aria-label",
        `Progression ${progression.degrees.map((degree) => degrees[degree % count]).join(" ")}`,
      );
    }
    const activeProgression = PAD_PROGRESSIONS.find((progression) =>
      progression.degrees.every(
        (degree, index) => degree % count === track.chords[index]?.degree,
      ),
    );
    const description = container.querySelector("#pad-progression-description");
    if (description)
      description.textContent =
        activeProgression?.description ?? "Custom progression";
    controls.forEach((control) => displayControl(control.parameter));
    automation.refresh(resetHistory);
    setPosition(playingTick, currentSwing);
  }
  function updateControl(id: string, value: number): boolean {
    const control = controls.find((item) => id === `pad-${item.parameter}`);
    if (!control) return false;
    if (!Number.isFinite(value)) return true;
    const track = options.getTrack();
    const before = track[control.parameter];
    track[control.parameter] = Math.min(1, Math.max(0, value / 100));
    displayControl(control.parameter);
    automation.shiftControl(id, before, track[control.parameter]);
    options.onChange();
    return true;
  }
  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !container.contains(button))
      return;
    const track = options.getTrack(),
      scale = options.getScale();
    const { dataset } = button;
    let changed = false,
      local = false;
    if (dataset.padEnable !== undefined) {
      track.muted = !track.muted;
      changed = true;
    }
    if (dataset.padSound !== undefined) {
      const sound = Number(dataset.padSound);
      if (Number.isInteger(sound) && sound >= 0 && sound < PAD_SOUNDS.length) {
        track.sound = sound;
        changed = true;
      }
    }
    if (dataset.padBars !== undefined) {
      const bars = Number(dataset.padBars);
      if (bars === 2 || bars === 4 || bars === 8 || bars === 16) {
        Object.assign(track, resizePadTrack(track, { ...track.timing, bars }));
        changed = true;
      }
    }
    if (dataset.padPresets !== undefined) {
      presetsOpen = !presetsOpen;
      local = true;
    }
    if (dataset.padProgression) {
      changed = applyPadProgression(track, dataset.padProgression, scale);
      closeProgressions();
      local = true;
    }
    if (dataset.padSlot !== undefined) {
      const slot = Number(dataset.padSlot);
      if (Number.isInteger(slot) && slot >= 0 && slot < track.chords.length) {
        selected = slot;
        local = true;
      }
    }
    const chord = track.chords[selected];
    if (chord && dataset.padDegree !== undefined) {
      const degree = Number(dataset.padDegree);
      if (
        Number.isInteger(degree) &&
        degree >= 0 &&
        degree < padScaleDegrees(scale).length
      ) {
        chord.degree = degree;
        changed = true;
      }
    }
    if (chord && dataset.padInversion !== undefined) {
      const inversion = Number(dataset.padInversion);
      if (Number.isInteger(inversion) && inversion >= 0 && inversion < 4) {
        chord.inversion = inversion;
        changed = true;
      }
    }
    if (changed || local) {
      render(changed);
      if (dataset.padProgression)
        progressionButton?.focus({ preventScroll: true });
      else button.focus({ preventScroll: true });
      if (dataset.padPresets !== undefined && presetsOpen)
        positionProgressions(true);
    }
    if (changed) options.onChange();
  }
  container.addEventListener("click", click);
  document.addEventListener("pointerdown", outsideProgressions);
  document.addEventListener("focusin", outsideProgressions);
  document.addEventListener("keydown", progressionKey);
  window.addEventListener("resize", resizeProgressions);
  render();
  return {
    render,
    refreshAutomation: () => automation.refresh(),
    setStep,
    setPosition,
    updateControl,
    activateControl: automation.activateControl,
    rebaseIncoming: (next: PadTrack) =>
      automation.rebaseIncoming(
        (parameter) => next.automation[parameter],
        next.timing,
      ),
    destroy(): void {
      destroyed = true;
      automation.destroy();
      container.removeEventListener("click", click);
      document.removeEventListener("pointerdown", outsideProgressions);
      document.removeEventListener("focusin", outsideProgressions);
      document.removeEventListener("keydown", progressionKey);
      window.removeEventListener("resize", resizeProgressions);
      container.replaceChildren();
    },
  };
}
