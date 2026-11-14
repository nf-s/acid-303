import type { MusicalScale } from "./model";
import { SCALE_MODES, noteName } from "./model";
import {
  meterSchema,
  gridSchema,
  padTimingSchema,
  trackPosition,
} from "./timing";
import {
  CHORD_BORROWS,
  CHORD_PROGRESSIONS,
  CHORD_QUALITIES,
  CHORD_QUALITY_NAMES,
  PROGRESSION_GROUPS,
  applyProgression,
  chordBorrowSchema,
  chordInversionCount,
  chordLabel,
  chordNumeral,
  chordPreview,
  chordQualitySchema,
  progressionChordAtTick,
  progressionChordLabel,
  progressionChordNotes,
  progressionEntryChords,
  progressionFitsScale,
  progressionMatches,
  progressionScaleDegrees,
} from "./progression-model";
import type {
  ChordProgressionEntry,
  PreviewChord,
  Progression,
  ProgressionGroup,
} from "./progression-model";
import "./progression-panel.css";

const degrees = ["I", "II", "III", "IV", "V", "VI", "VII"];
const playIcon = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 2.5v11l9-5.5z" fill="currentColor"/></svg>`;
/** `chord` is one edited or selected chord; `progression` an audition; `apply` a chosen progression. */
export type ChordPreviewKind = "chord" | "progression" | "apply";
export interface ProgressionPanelOptions {
  getProgression: () => Progression;
  getScale: () => MusicalScale;
  onChange: () => void;
  onPreview?: (chords: PreviewChord[], kind: ChordPreviewKind) => void;
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
function scaleName(mode: MusicalScale["mode"]): string {
  return SCALE_MODES.find((item) => item.id === mode)?.name ?? mode;
}
const entriesByMode = new Map<MusicalScale["mode"], ChordProgressionEntry[]>();
function libraryEntries(scale: MusicalScale): ChordProgressionEntry[] {
  const cached = entriesByMode.get(scale.mode);
  if (cached) return cached;
  const entries = CHORD_PROGRESSIONS.filter((entry) =>
    progressionFitsScale(entry, scale.mode),
  );
  entriesByMode.set(scale.mode, entries);
  return entries;
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
  let librarySignature = "";
  let groupSignature = "";
  let group: ProgressionGroup | null = null;
  const prefix = options.prefix;
  container.classList.add("progression-editor");
  container.innerHTML = `${options.timing ? `<div class="progression-timing"><div role="group" aria-label="Chord progression length">${[2, 4, 8, 16].map((bars) => `<button data-chord-bars="${bars}">${bars} bars</button>`).join("")}</div><div role="group" aria-label="Chord progression meter">${meterSchema.options.map((meter) => `<button data-chord-meter="${meter}">${meter}</button>`).join("")}</div><div role="group" aria-label="Chord progression grid"><button data-chord-grid="straight">Straight</button><button data-chord-grid="triplet">Triplet</button></div></div>` : ""}
    ${options.presets ? `<details class="progression-presets"><summary>Progressions</summary><div class="progression-library-tools"><div class="progression-groups" role="group" aria-label="Progression groups"></div><button data-progression-random>Random</button></div><div class="progression-options" role="group" aria-label="Chord progressions"></div></details>` : ""}
    <div class="progression-composition"><div class="progression-cards" role="group" aria-label="${prefix === "pad-local" ? "Pad local chords" : "Chord progression timeline"}">${Array.from({ length: 4 }, (_, slot) => `<button data-chord-slot="${slot}"><span class="progression-number">${slot + 1}</span><strong></strong><small></small><span class="progression-duration"></span></button>`).join("")}</div>
    <div class="progression-note-editor"><h3 id="${prefix}-selected-label"></h3><div class="progression-edit-group"><span>Degree</span><div class="progression-degrees" role="group"></div></div><div class="progression-edit-group"><span>Inversion</span><div class="progression-inversions" role="group">${["Root", "1st", "2nd", "3rd"].map((name, inversion) => `<button data-chord-inversion="${inversion}">${name}</button>`).join("")}</div></div><div class="progression-edit-group"><span>Type</span><div class="progression-qualities" role="group">${CHORD_QUALITIES.map((quality) => `<button data-chord-quality="${quality}">${CHORD_QUALITY_NAMES[quality]}</button>`).join("")}</div></div><div class="progression-edit-group progression-borrow-group"><span>Borrow</span><div class="progression-borrows" role="group"><button data-chord-borrow="">Off</button>${CHORD_BORROWS.map((borrow) => `<button data-chord-borrow="${borrow}">${scaleName(borrow)}</button>`).join("")}</div></div></div></div>`;
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
  function previewSelected(): void {
    const chord = options.getProgression().chords[selected];
    if (chord)
      options.onPreview?.([chordPreview(chord, options.getScale())], "chord");
  }
  function previewEntry(entry: ChordProgressionEntry, kind: ChordPreviewKind) {
    const scale = options.getScale();
    options.onPreview?.(
      progressionEntryChords(entry, scale).map((chord) =>
        chordPreview(chord, scale),
      ),
      kind,
    );
  }
  /** Rebuild the library only when its scale or group changes, so focus survives edits. */
  function renderLibrary(progression: Progression, scale: MusicalScale): void {
    const groupsContainer = container.querySelector(".progression-groups"),
      list = container.querySelector(".progression-options");
    if (!groupsContainer || !list) return;
    const entries = libraryEntries(scale);
    const available = PROGRESSION_GROUPS.filter((name) =>
      entries.some((entry) => entry.group === name),
    );
    if (!group || !available.includes(group))
      group =
        entries.find((entry) => progressionMatches(entry, progression, scale))
          ?.group ??
        available[0] ??
        null;
    const groups = available.join(",");
    if (groups !== groupSignature) {
      groupSignature = groups;
      groupsContainer.innerHTML = available
        .map(
          (name) => `<button data-progression-group="${name}">${name}</button>`,
        )
        .join("");
    }
    const signature = `${scale.root}:${scale.mode}:${group ?? ""}`;
    if (signature !== librarySignature) {
      librarySignature = signature;
      list.innerHTML = entries
        .filter((entry) => entry.group === group)
        .map((entry) => {
          const chords = progressionEntryChords(entry, scale);
          const names = chords.map((chord) => chordLabel(chord, scale));
          const numerals = chords
            .map((chord) => chordNumeral(chord, scale))
            .join(" · ");
          return `<div class="progression-option"><button class="progression-audition" data-progression-audition="${entry.id}" aria-label="Play ${names.join(", ")}">${playIcon}</button><button data-chord-progression="${entry.id}" aria-label="Use ${names.join(", ")} (${numerals})"><strong>${names.join(" · ")}</strong><small>${numerals}</small></button></div>`;
        })
        .join("");
    }
    for (const button of groupsContainer.querySelectorAll<HTMLButtonElement>(
      "[data-progression-group]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.progressionGroup === group),
      );
    for (const button of list.querySelectorAll<HTMLButtonElement>(
      "[data-chord-progression]",
    )) {
      const entry = CHORD_PROGRESSIONS.find(
        (item) => item.id === button.dataset.chordProgression,
      );
      button.setAttribute(
        "aria-pressed",
        String(
          entry !== undefined && progressionMatches(entry, progression, scale),
        ),
      );
    }
  }
  function render(): void {
    const progression = options.getProgression(),
      scale = options.getScale();
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
    const inversions = chord ? chordInversionCount(chord) : 4;
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-inversion]",
    )) {
      const inversion = Number(button.dataset.chordInversion);
      button.disabled = inversion >= inversions;
      button.setAttribute(
        "aria-pressed",
        String(
          chord !== undefined && inversion === chord.inversion % inversions,
        ),
      );
    }
    container
      .querySelector(".progression-qualities")
      ?.setAttribute("aria-label", `Chord ${selected + 1} type`);
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-quality]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.chordQuality === (chord?.quality ?? "seventh")),
      );
    const borrowGroup = container.querySelector<HTMLElement>(
      ".progression-borrow-group",
    );
    if (borrowGroup) borrowGroup.hidden = scale.mode === "pentatonic";
    container
      .querySelector(".progression-borrows")
      ?.setAttribute("aria-label", `Chord ${selected + 1} borrowed scale`);
    const borrow =
      chord?.borrow && chord.borrow !== scale.mode ? chord.borrow : "";
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-chord-borrow]",
    )) {
      button.hidden = button.dataset.chordBorrow === scale.mode;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.chordBorrow === borrow),
      );
    }
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
    if (options.presets) renderLibrary(progression, scale);
    setPosition(playingTick, currentSwing);
  }
  function applyEntry(entry: ChordProgressionEntry): boolean {
    const applied = applyProgression(
      options.getProgression(),
      entry.id,
      options.getScale(),
    );
    if (applied) previewEntry(entry, "apply");
    return applied;
  }
  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !container.contains(button))
      return;
    const progression = options.getProgression(),
      scale = options.getScale();
    const { dataset } = button;
    let changed = false,
      preview = false;
    if (dataset.chordSlot !== undefined) {
      const slot = Number(dataset.chordSlot);
      if (Number.isInteger(slot) && slot >= 0 && slot < 4) {
        selected = slot;
        preview = true;
      }
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
        changed = preview = true;
      }
    }
    if (chord && dataset.chordInversion !== undefined) {
      const inversion = Number(dataset.chordInversion);
      if (
        Number.isInteger(inversion) &&
        inversion >= 0 &&
        inversion < chordInversionCount(chord)
      ) {
        chord.inversion = inversion;
        changed = preview = true;
      }
    }
    if (chord && dataset.chordQuality !== undefined) {
      const quality = chordQualitySchema.safeParse(dataset.chordQuality);
      if (quality.success) {
        // The original seventh stays implicit so older peers and links keep the same shape.
        if (quality.data === "seventh") delete chord.quality;
        else chord.quality = quality.data;
        chord.inversion %= chordInversionCount(chord);
        changed = preview = true;
      }
    }
    if (chord && dataset.chordBorrow !== undefined) {
      const borrow = chordBorrowSchema.safeParse(dataset.chordBorrow);
      if (borrow.success && borrow.data !== scale.mode)
        chord.borrow = borrow.data;
      else delete chord.borrow;
      changed = preview = true;
    }
    if (options.presets && dataset.progressionGroup !== undefined) {
      const next = PROGRESSION_GROUPS.find(
        (name) => name === dataset.progressionGroup,
      );
      if (next) group = next;
    }
    if (options.presets && dataset.progressionAudition) {
      const entry = CHORD_PROGRESSIONS.find(
        (item) => item.id === dataset.progressionAudition,
      );
      if (entry) previewEntry(entry, "progression");
    }
    if (options.presets && dataset.chordProgression) {
      const entry = CHORD_PROGRESSIONS.find(
        (item) => item.id === dataset.chordProgression,
      );
      if (entry) changed = applyEntry(entry);
    }
    if (options.presets && dataset.progressionRandom !== undefined) {
      const choices = libraryEntries(scale).filter(
        (entry) =>
          entry.group === group &&
          !progressionMatches(entry, progression, scale),
      );
      const entry = choices[Math.floor(Math.random() * choices.length)];
      if (entry) changed = applyEntry(entry);
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
    if (preview) previewSelected();
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
