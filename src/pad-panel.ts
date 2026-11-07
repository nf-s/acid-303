import type { MusicalScale } from "./model";
import { noteName } from "./model";
import {
  PAD_PROGRESSIONS,
  PAD_SOUNDS,
  applyPadProgression,
  padChordAtStep,
  padChordLabel,
  padChordNotes,
  padScaleDegrees,
} from "./pad-model";
import type { PadTrack } from "./pad-model";

type PadParameter =
  | "attack"
  | "release"
  | "tone"
  | "motion"
  | "spread"
  | "space"
  | "shape"
  | "volume";
interface PadControl {
  parameter: PadParameter;
  label: string;
}
const controls: PadControl[] = [
  { parameter: "attack", label: "Attack" },
  { parameter: "release", label: "Release" },
  { parameter: "tone", label: "Tone" },
  { parameter: "motion", label: "Motion" },
  { parameter: "spread", label: "Spread" },
  { parameter: "space", label: "Space" },
  { parameter: "shape", label: "Shape" },
  { parameter: "volume", label: "Level" },
];
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

export function createPadPanel(
  container: HTMLElement,
  options: PadPanelOptions,
) {
  let selected = 0;
  let playingStep = -1;
  let destroyed = false;

  function setStep(absoluteStep: number): void {
    playingStep = absoluteStep;
    const track = options.getTrack();
    const current = padChordAtStep(track, absoluteStep);
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
        absoluteStep < 0
          ? `${track.bars} bars`
          : `Bar ${(Math.floor(absoluteStep / 16) % track.bars) + 1} / ${track.bars}`;
  }

  function render(): void {
    if (destroyed) return;
    const track = options.getTrack(),
      scale = options.getScale();
    const count = padScaleDegrees(scale).length;
    const chord = track.chords[selected];
    container.innerHTML = `
      <div class="section-header"><div class="section-title"><span class="section-number">05</span><h2 id="pad-title">Chord pads</h2></div><button class="text-button" data-pad-enable aria-label="${track.muted ? "Enable" : "Mute"} chord pads" aria-pressed="${!track.muted}">${track.muted ? "Off" : "On"}</button></div>
      <div class="bass-meta"><div class="waveform-switch pad-sounds" role="group" aria-label="Pad sound">${PAD_SOUNDS.map((sound, index) => `<button data-pad-sound="${index}" aria-pressed="${track.sound === index}">${sound}</button>`).join("")}</div><span class="pad-position">${track.bars} bars</span></div>
      <div class="pad-length" role="group" aria-label="Progression length">${[2, 4, 8, 16].map((bars) => `<button data-pad-bars="${bars}" aria-pressed="${track.bars === bars}">${bars} bars</button>`).join("")}</div>
      <div class="pad-progressions" role="group" aria-label="Chord progressions">${PAD_PROGRESSIONS.map(
        (progression) => {
          const active = progression.degrees.every(
            (degree, index) => degree % count === track.chords[index]?.degree,
          );
          return `<button data-pad-progression="${progression.id}" aria-pressed="${active}" aria-label="Progression ${progression.degrees.map((degree) => degrees[degree % count]).join(" ")}">${progression.degrees.map((degree) => degrees[degree % count]).join(" · ")}</button>`;
        },
      ).join("")}</div>
      <div class="pad-chords" role="group" aria-label="Progression chords">${track.chords.map((_, index) => `<button data-pad-slot="${index}" aria-pressed="${selected === index}" aria-label="Edit chord ${index + 1}: ${padChordLabel(track, scale, index)}"><span>${index + 1}</span><strong>${padChordLabel(track, scale, index)}</strong><small>${padChordNotes(track, scale, index).map(noteName).join(" ")}</small></button>`).join("")}</div>
      <div class="pad-chord-editor"><div class="pad-degrees" role="group" aria-label="Chord ${selected + 1} degree">${padScaleDegrees(
        scale,
      )
        .map(
          (note, degree) =>
            `<button data-pad-degree="${degree}" aria-pressed="${chord?.degree === degree}">${degrees[degree]} ${noteName(note).replace(/-?\d+$/, "")}</button>`,
        )
        .join(
          "",
        )}</div><div class="pad-inversions" role="group" aria-label="Chord ${selected + 1} inversion">${["Root", "1st", "2nd", "3rd"].map((name, inversion) => `<button data-pad-inversion="${inversion}" aria-pressed="${chord?.inversion === inversion}">${name}</button>`).join("")}</div></div>
      <div class="acid-controls">${controls.map((control) => options.renderControl(`pad-${control.parameter}`, control.label, 0, 100, Math.round(track[control.parameter] * 100), `${Math.round(track[control.parameter] * 100)}%`, "1", `Pad ${control.label.toLowerCase()}`)).join("")}</div>`;
    setStep(playingStep);
  }

  function updateControl(id: string, value: number): boolean {
    const control = controls.find((item) => id === `pad-${item.parameter}`);
    if (!control || !Number.isFinite(value)) return false;
    const track = options.getTrack();
    track[control.parameter] = Math.min(1, Math.max(0, value / 100));
    const display = `${Math.round(track[control.parameter] * 100)}%`;
    const element = container.querySelector(`#${id}`);
    element?.setAttribute("aria-valuetext", display);
    const output = container.querySelector(`#${id}-value`);
    if (output) output.textContent = display;
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
    let changed = false;
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
        track.bars = bars;
        changed = true;
      }
    }
    if (dataset.padProgression)
      changed = applyPadProgression(track, dataset.padProgression, scale);
    if (dataset.padSlot !== undefined) {
      const slot = Number(dataset.padSlot);
      if (Number.isInteger(slot) && slot >= 0 && slot < track.chords.length)
        selected = slot;
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
      if (Number.isInteger(inversion) && inversion >= 0 && inversion <= 3) {
        chord.inversion = inversion;
        changed = true;
      }
    }
    const focusSelector = Array.from(button.attributes)
      .filter((attribute) => attribute.name.startsWith("data-pad-"))
      .map((attribute) => `[${attribute.name}="${attribute.value}"]`)
      .join("");
    render();
    if (focusSelector)
      container
        .querySelector<HTMLElement>(focusSelector)
        ?.focus({ preventScroll: true });
    if (changed) options.onChange();
  }

  container.addEventListener("click", click);
  render();
  return {
    render,
    setStep,
    updateControl,
    destroy(): void {
      destroyed = true;
      container.removeEventListener("click", click);
      container.replaceChildren();
    },
  };
}
