import { ARP_SOUNDS } from "./arp-model";
import { FLUFF_SOUNDS, PROJECT_MODES, projectModeSchema } from "./mode";
import type { ProjectMode } from "./mode";
import { BASS_SOUNDS, DRUM_META, KEYS_SOUNDS, trackFamily } from "./model";
import type { DrumId, FamilyTrack } from "./model";
import { PAD_SOUNDS } from "./pad-model";

/** Every instrument whose voices differ between Grain and Fluff. */
export type SoundInstrument = DrumId | "bass" | "keys" | "arp" | "pad";

export function familySounds(
  instrument: SoundInstrument,
  family: ProjectMode,
): readonly string[] {
  if (family === "fluff") return FLUFF_SOUNDS[instrument];
  if (instrument === "bass") return BASS_SOUNDS;
  if (instrument === "keys") return KEYS_SOUNDS;
  if (instrument === "arp") return ARP_SOUNDS;
  if (instrument === "pad") return PAD_SOUNDS;
  return DRUM_META[instrument].sounds;
}

function familyName(family: ProjectMode): string {
  return PROJECT_MODES.find((mode) => mode.id === family)?.label ?? family;
}

export interface SoundPicker {
  instrument: SoundInstrument;
  mode: ProjectMode;
  track: FamilyTrack;
  /** Attributes that identify a chip to its click handler, e.g. `data-bass-sound="3"`. */
  attributes: (sound: number) => string;
}

/** The project's own sounds, then the other studio's in their own labelled group. */
export function soundChipsMarkup(picker: SoundPicker): string {
  const selected = trackFamily(picker.mode, picker.track);
  const other: ProjectMode = picker.mode === "grain" ? "fluff" : "grain";
  const chips = (family: ProjectMode): string =>
    familySounds(picker.instrument, family)
      .map((name, sound) => {
        const active = family === selected && sound === picker.track.sound;
        const foreign =
          family === picker.mode
            ? ""
            : ` class="sound-family-chip${active ? " active" : ""}" aria-label="${name}, ${familyName(family)}"`;
        const own = family === picker.mode && active ? ' class="active"' : "";
        return `<button ${picker.attributes(sound)} data-sound-family="${family}" aria-pressed="${active}"${foreign}${own}>${name}</button>`;
      })
      .join("");
  return `${chips(picker.mode)}<div class="sound-family" role="group" aria-label="${familyName(other)} sounds"><span class="sound-family-label" aria-hidden="true">${familyName(other)}</span>${chips(other)}</div>`;
}

/** Rebuilds the chips when the project's mode changes; otherwise only marks the selection. */
export function syncSoundChips(
  container: Element,
  picker: SoundPicker,
  attribute: string,
): void {
  if (!(container instanceof HTMLElement)) return;
  if (container.dataset.soundMode !== picker.mode) {
    container.innerHTML = soundChipsMarkup(picker);
    container.dataset.soundMode = picker.mode;
    return;
  }
  const family = trackFamily(picker.mode, picker.track);
  container
    .querySelectorAll<HTMLElement>("[data-sound-family]")
    .forEach((button) => {
      const active =
        button.dataset.soundFamily === family &&
        Number(button.dataset[attribute]) === picker.track.sound;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    });
}

/** The family and sound a chip stands for, or null for anything else. */
export function soundChoice(
  element: HTMLElement,
  attribute: string,
  instrument: SoundInstrument,
): { family: ProjectMode; sound: number } | null {
  const family = projectModeSchema.safeParse(element.dataset.soundFamily);
  const sound = Number(element.dataset[attribute]);
  if (
    !family.success ||
    !Number.isInteger(sound) ||
    sound < 0 ||
    sound >= familySounds(instrument, family.data).length
  )
    return null;
  return { family: family.data, sound };
}
