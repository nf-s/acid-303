import { DRUM_META } from "./model";
import type { InstrumentId, Project } from "./model";
import "./track-mixer.css";

const CHANNELS: ReadonlyArray<{ id: InstrumentId; label: string }> = [
  { id: "kick", label: DRUM_META.kick.name },
  { id: "snare", label: DRUM_META.snare.name },
  { id: "hat", label: DRUM_META.hat.name },
  { id: "clap", label: DRUM_META.clap.name },
  { id: "rim", label: DRUM_META.rim.name },
  { id: "bass", label: "Bass" },
  { id: "keys", label: "Texture" },
  { id: "arp", label: "Arp" },
  { id: "pad", label: "Pads" },
  { id: "vocal", label: "Vocals" },
  { id: "cloud", label: "Cloud" },
  { id: "tension", label: "Tension" },
];

export function mixerTrack(project: Project, id: string) {
  if (
    id === "bass" ||
    id === "keys" ||
    id === "arp" ||
    id === "pad" ||
    id === "vocal" ||
    id === "cloud" ||
    id === "tension"
  )
    return project[id];
  return project.drums.find((track) => track.id === id);
}

export class TrackMixer {
  constructor(private readonly container: HTMLElement) {
    container.innerHTML = `<details class="track-mixer"><summary>Mixer</summary><div class="mixer-channels">${CHANNELS.map(({ id, label }) => `<div class="mixer-channel"><span>${label}</span><button id="mixer-${id}" class="gesture-control mixer-fader" data-source-control="${id}-volume" role="slider" aria-label="Mixer ${label} level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-step="1"><span class="fader-track" aria-hidden="true"><span class="fader-fill"></span><span class="fader-thumb"></span></span></button><output id="mixer-${id}-value"></output><button data-mixer-mute="${id}" aria-label="Mixer mute ${label}" aria-pressed="false">M</button><button class="mute-button mixer-solo" data-solo="${id}" aria-label="Mixer solo ${label}" aria-pressed="false">S</button></div>`).join("")}</div></details>`;
  }

  update(project: Project): void {
    for (const { id } of CHANNELS) {
      const track = mixerTrack(project, id);
      const fader = this.container.querySelector<HTMLElement>(`#mixer-${id}`);
      if (!track || !fader) continue;
      const held = Number(fader.getAttribute("aria-valuenow"));
      const value =
        fader.classList.contains("dragging") && Number.isFinite(held)
          ? Math.max(0, Math.min(100, held))
          : Math.round(track.volume * 100);
      fader.setAttribute("aria-valuenow", String(value));
      fader.style.setProperty("--fader-level", `${value}%`);
      const output = this.container.querySelector(`#mixer-${id}-value`);
      if (output) output.textContent = `${value}%`;
      this.container
        .querySelector(`[data-mixer-mute="${id}"]`)
        ?.setAttribute("aria-pressed", String(track.muted));
    }
  }
}
