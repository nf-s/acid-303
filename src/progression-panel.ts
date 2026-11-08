import type { MusicalScale } from "./model";
import { noteName } from "./model";
import {
  meterSchema,
  gridSchema,
  padTimingSchema,
  trackPosition,
} from "./timing";
import {
  CHORD_PROGRESSIONS,
  applyProgression,
  progressionChordAtTick,
  progressionChordLabel,
  progressionChordNotes,
  progressionScaleDegrees,
} from "./progression-model";
import type { Progression } from "./progression-model";
import "./progression-panel.css";

const degrees = ["I", "II", "III", "IV", "V", "VI", "VII"];
export interface ProgressionPanelOptions {
  getProgression: () => Progression;
  getScale: () => MusicalScale;
  onChange: () => void;
}
interface ChordEditorOptions extends ProgressionPanelOptions {
  prefix: string;
  presets?: boolean;
  timing?: boolean;
  getMuted?: () => boolean;
}
function chordDuration(progression: Progression, slot: number): string {
  const length = progression.timing.bars / 4;
  const first = Math.floor(slot * length) + 1;
  if (length < 1)
    return `Bar ${first}, ${slot % 2 ? "second half" : "first half"}`;
  return length === 1 ? `Bar ${first}` : `Bars ${first}–${first + length - 1}`;
}

/** Shared editor for the project progression and the Pads' preserved local voicings. */
export function createChordEditor(
  container: HTMLElement,
  options: ChordEditorOptions,
) {
  let selected = 0;
  let playingTick = -1;
  let currentSwing = 0;
  let degreeSignature = "";
  const prefix = options.prefix;
  container.classList.add("progression-editor");
  container.innerHTML = `${options.timing ? `<div class="progression-timing"><div role="group" aria-label="Chord progression length">${[2, 4, 8, 16].map((bars) => `<button data-chord-bars="${bars}">${bars} bars</button>`).join("")}</div><div role="group" aria-label="Chord progression meter">${meterSchema.options.map((meter) => `<button data-chord-meter="${meter}">${meter}</button>`).join("")}</div><div role="group" aria-label="Chord progression grid"><button data-chord-grid="straight">Straight</button><button data-chord-grid="triplet">Triplet</button></div></div>` : ""}
    ${options.presets ? `<details class="progression-presets"><summary>Progressions</summary><div class="progression-options" role="group" aria-label="Chord progressions">${CHORD_PROGRESSIONS.map((progression) => `<button data-chord-progression="${progression.id}" title="${progression.description}"></button>`).join("")}</div></details>` : ""}
    <div class="progression-composition"><div class="progression-cards" role="group" aria-label="${prefix === "pad-local" ? "Pad local chords" : "Chord progression timeline"}">${Array.from({ length: 4 }, (_, slot) => `<button data-chord-slot="${slot}"><span class="progression-number">${slot + 1}</span><strong></strong><small></small><span class="progression-duration"></span></button>`).join("")}</div>
    <div class="progression-note-editor"><h3 id="${prefix}-selected-label"></h3><div class="progression-edit-group"><span>Degree</span><div class="progression-degrees" role="group"></div></div><div class="progression-edit-group"><span>Inversion</span><div class="progression-inversions" role="group">${["Root", "1st", "2nd", "3rd"].map((name, inversion) => `<button data-chord-inversion="${inversion}">${name}</button>`).join("")}</div></div></div></div>`;
  const presetDisclosure = container.querySelector<HTMLDetailsElement>(
    ".progression-presets",
  );
  function setPosition(tick: number, swing: number): void {
    playingTick = tick;
    currentSwing = swing;
    const current = progressionChordAtTick(
      options.getProgression(),
      tick,
      swing,
    );
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-chord-slot]",
    )) {
      const active =
        !options.getMuted?.() && Number(button.dataset.chordSlot) === current;
      button.classList.toggle("current", active);
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
  }
  function render(): void {
    const progression = options.getProgression(),
      scale = options.getScale();
    const count = progressionScaleDegrees(scale).length;
    const chord = progression.chords[selected];
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-slot]",
    )) {
      const slot = Number(button.dataset.chordSlot);
      const name = progressionChordLabel(progression, scale, slot);
      button.setAttribute("aria-pressed", String(slot === selected));
      button.setAttribute(
        "aria-label",
        `Edit chord ${slot + 1}: ${name}, ${chordDuration(progression, slot)}`,
      );
      const title = button.querySelector("strong"),
        notes = button.querySelector("small"),
        duration = button.querySelector(".progression-duration");
      if (title) title.textContent = name;
      if (notes)
        notes.textContent = progressionChordNotes(progression, scale, slot)
          .map(noteName)
          .join(" ");
      if (duration) duration.textContent = chordDuration(progression, slot);
    }
    const degreeOptions = container.querySelector(".progression-degrees");
    const signature = `${scale.root}:${scale.mode}`;
    if (degreeOptions) {
      degreeOptions.setAttribute("aria-label", `Chord ${selected + 1} degree`);
      if (degreeSignature !== signature) {
        degreeOptions.innerHTML = progressionScaleDegrees(scale)
          .map(
            (note, degree) =>
              `<button data-chord-degree="${degree}">${degrees[degree]} ${noteName(note).replace(/-?\d+$/, "")}</button>`,
          )
          .join("");
        degreeSignature = signature;
      }
    }
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-degree]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.chordDegree) === chord?.degree),
      );
    container
      .querySelector(".progression-inversions")
      ?.setAttribute("aria-label", `Chord ${selected + 1} inversion`);
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-inversion]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.chordInversion) === chord?.inversion),
      );
    const label = container.querySelector(`#${prefix}-selected-label`);
    if (label)
      label.textContent = `Chord ${selected + 1} · ${progressionChordLabel(progression, scale, selected)}`;
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-bars],[data-chord-meter],[data-chord-grid]",
    )) {
      const active =
        button.dataset.chordBars !== undefined
          ? Number(button.dataset.chordBars) === progression.timing.bars
          : button.dataset.chordMeter !== undefined
            ? button.dataset.chordMeter === progression.timing.meter
            : button.dataset.chordGrid === progression.timing.grid;
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-progression]",
    )) {
      const preset = CHORD_PROGRESSIONS.find(
        (item) => item.id === button.dataset.chordProgression,
      );
      if (!preset) continue;
      button.textContent = preset.degrees
        .map((degree) => degrees[degree % count])
        .join(" · ");
      button.setAttribute(
        "aria-pressed",
        String(
          preset.degrees.every(
            (degree, slot) =>
              degree % count === progression.chords[slot]?.degree,
          ),
        ),
      );
    }
    setPosition(playingTick, currentSwing);
  }
  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !container.contains(button))
      return;
    const progression = options.getProgression(),
      scale = options.getScale();
    const { dataset } = button;
    let changed = false;
    if (dataset.chordSlot !== undefined) {
      const slot = Number(dataset.chordSlot);
      if (Number.isInteger(slot) && slot >= 0 && slot < 4) selected = slot;
    }
    const chord = progression.chords[selected];
    if (chord && dataset.chordDegree !== undefined) {
      const degree = Number(dataset.chordDegree);
      if (
        Number.isInteger(degree) &&
        degree >= 0 &&
        degree < progressionScaleDegrees(scale).length
      ) {
        chord.degree = degree;
        changed = true;
      }
    }
    if (chord && dataset.chordInversion !== undefined) {
      const inversion = Number(dataset.chordInversion);
      if (Number.isInteger(inversion) && inversion >= 0 && inversion < 4) {
        chord.inversion = inversion;
        changed = true;
      }
    }
    if (options.presets && dataset.chordProgression) {
      changed = applyProgression(progression, dataset.chordProgression, scale);
      if (presetDisclosure) presetDisclosure.open = false;
      presetDisclosure?.querySelector("summary")?.focus();
    }
    if (
      options.timing &&
      (dataset.chordBars !== undefined ||
        dataset.chordMeter !== undefined ||
        dataset.chordGrid !== undefined)
    ) {
      const meter = meterSchema.safeParse(
        dataset.chordMeter ?? progression.timing.meter,
      );
      const grid = gridSchema.safeParse(
        dataset.chordGrid ?? progression.timing.grid,
      );
      const timing = padTimingSchema.safeParse({
        ...progression.timing,
        bars:
          dataset.chordBars === undefined
            ? progression.timing.bars
            : Number(dataset.chordBars),
        meter: meter.success ? meter.data : dataset.chordMeter,
        grid: grid.success ? grid.data : dataset.chordGrid,
      });
      if (timing.success) {
        progression.timing = timing.data;
        changed = true;
      }
    }
    render();
    if (changed) options.onChange();
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && presetDisclosure?.open) {
      event.preventDefault();
      event.stopPropagation();
      presetDisclosure.open = false;
      presetDisclosure.querySelector("summary")?.focus();
    }
  }
  container.addEventListener("click", click);
  container.addEventListener("keydown", keydown);
  render();
  return {
    render,
    setPosition,
    focus: () =>
      container
        .querySelector<HTMLButtonElement>(`[data-chord-slot="${selected}"]`)
        ?.focus(),
    destroy: () => {
      container.removeEventListener("click", click);
      container.removeEventListener("keydown", keydown);
      container.replaceChildren();
    },
  };
}

export function createProgressionPanel(
  container: HTMLElement,
  options: ProgressionPanelOptions,
) {
  container.innerHTML = `<details id="chords-disclosure" class="chords-disclosure"><summary>Chords <output class="progression-position"></output></summary><div class="project-chord-editor"></div></details>`;
  const disclosure = container.querySelector<HTMLDetailsElement>("details"),
    editorContainer = container.querySelector<HTMLElement>(
      ".project-chord-editor",
    ),
    position = container.querySelector(".progression-position");
  if (!disclosure || !editorContainer || !position)
    throw new Error("Chord progression controls are missing.");
  let tick = -1,
    swing = 0;
  const editor = createChordEditor(editorContainer, {
    ...options,
    prefix: "project-chords",
    presets: true,
    timing: true,
    onChange: () => {
      updatePosition();
      options.onChange();
    },
  });
  function updatePosition(): void {
    const progression = options.getProgression();
    const slot = progressionChordAtTick(progression, tick, swing);
    if (!position) return;
    position.textContent =
      slot < 0
        ? `${progression.timing.bars} bars`
        : `${progressionChordLabel(progression, options.getScale(), slot)} · Bar ${trackPosition(progression.timing, tick, swing).bar + 1} / ${progression.timing.bars}`;
  }
  updatePosition();
  return {
    render: () => {
      editor.render();
      updatePosition();
    },
    setPosition: (nextTick: number, nextSwing: number) => {
      tick = nextTick;
      swing = nextSwing;
      editor.setPosition(tick, swing);
      updatePosition();
    },
    open: () => {
      disclosure.open = true;
      editor.focus();
    },
    destroy: () => {
      editor.destroy();
      container.replaceChildren();
    },
  };
}
