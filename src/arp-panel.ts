import { noteName } from "./model";
import type { MusicalScale } from "./model";
import {
  ARP_DIRECTIONS,
  ARP_RATES,
  ARP_SOUNDS,
  arpEvents,
  arpNoteChoices,
  retuneArp,
} from "./arp-model";
import type { ArpParameter, ArpTrack } from "./arp-model";

type RenderControl = (
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
export interface ArpPanelOptions {
  getTrack: () => ArpTrack;
  getScale: () => MusicalScale;
  onChange: () => void;
  renderControl: RenderControl;
}
export interface ArpPanel {
  render: () => void;
  setStep: (absoluteStep: number) => void;
  updateControl: (id: string, value: number) => boolean;
  destroy: () => void;
}
interface Control {
  parameter: ArpParameter;
  label: string;
  min: number;
  max: number;
  multiplier: number;
  step: string;
}
const CONTROLS: Control[] = [
  {
    parameter: "gate",
    label: "Gate",
    min: 5,
    max: 100,
    multiplier: 100,
    step: "1",
  },
  {
    parameter: "decay",
    label: "Decay",
    min: 30,
    max: 1500,
    multiplier: 1000,
    step: "10",
  },
  {
    parameter: "tone",
    label: "Tone",
    min: 0,
    max: 100,
    multiplier: 100,
    step: "1",
  },
  {
    parameter: "resonance",
    label: "Resonance",
    min: 0,
    max: 100,
    multiplier: 100,
    step: "1",
  },
  {
    parameter: "shape",
    label: "Shape",
    min: 0,
    max: 100,
    multiplier: 100,
    step: "1",
  },
  {
    parameter: "space",
    label: "Space",
    min: 0,
    max: 100,
    multiplier: 100,
    step: "1",
  },
  {
    parameter: "width",
    label: "Width",
    min: 0,
    max: 100,
    multiplier: 100,
    step: "1",
  },
  {
    parameter: "volume",
    label: "Level",
    min: 0,
    max: 100,
    multiplier: 100,
    step: "1",
  },
];

function displayValue(control: Control, value: number): string {
  return control.parameter === "decay"
    ? `${Math.round(value)} ms`
    : `${Math.round(value)}%`;
}

/** Buttons edit the live track; delegated root gestures own the eight dials. */
export function createArpPanel(
  container: HTMLElement,
  options: ArpPanelOptions,
): ArpPanel {
  let current = -1;
  const updatePlayback = (): void => {
    const track = options.getTrack();
    const events =
      current >= 0 ? arpEvents(track, options.getScale(), current) : [];
    const playing = events.map((event) => event.note);
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-arp-note]",
    )) {
      const note = Number(button.dataset.arpNote);
      button.classList.toggle(
        "current",
        playing.some((pitch) => pitch % 12 === note % 12),
      );
    }
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-arp-step]",
    ))
      button.classList.toggle(
        "current",
        current >= 0 && Number(button.dataset.arpStep) === current % 16,
      );
    const output = container.querySelector("#arp-playing-note");
    if (output)
      output.textContent = playing.length
        ? playing.map(noteName).join(" · ")
        : "—";
  };
  const render = (): void => {
    const track = options.getTrack();
    const scale = options.getScale();
    const notes = retuneArp(track, scale).notes;
    container.innerHTML = `
      <div class="section-header"><div class="section-title"><span class="section-number">04</span><h2 id="arp-title">Arpeggiator</h2></div><div class="bass-actions"><output id="arp-playing-note" aria-label="Arpeggiator playing note">—</output><button id="arp-mute" class="mute-button" aria-label="Mute Arpeggiator" aria-pressed="${track.muted}">M</button></div></div>
      <div class="bass-meta"><div class="waveform-switch arp-sounds" role="group" aria-label="Arpeggiator sound">${ARP_SOUNDS.map((sound, index) => `<button data-arp-sound="${index}" aria-pressed="${track.sound === index}" class="${track.sound === index ? "active" : ""}">${sound}</button>`).join("")}</div></div>
      <div class="acid-controls arp-controls">${CONTROLS.map((control) => {
        const value = track[control.parameter] * control.multiplier;
        return options.renderControl(
          `arp-${control.parameter}`,
          control.label,
          control.min,
          control.max,
          value,
          displayValue(control, value),
          control.step,
          `Arpeggiator ${control.label.toLowerCase()}`,
        );
      }).join("")}</div>
      <div class="arp-settings"><div class="arp-setting"><span>Order</span><div class="waveform-switch" role="group" aria-label="Arpeggiator order">${ARP_DIRECTIONS.map((direction) => `<button data-arp-direction="${direction.id}" aria-pressed="${track.direction === direction.id}" class="${track.direction === direction.id ? "active" : ""}">${direction.label}</button>`).join("")}</div></div><div class="arp-setting"><span>Rate</span><div class="waveform-switch" role="group" aria-label="Arpeggiator rate">${ARP_RATES.map((rate) => `<button data-arp-rate="${rate}" aria-pressed="${track.rate === rate}" class="${track.rate === rate ? "active" : ""}">${rate}</button>`).join("")}</div></div><div class="arp-setting"><span>Octaves</span><div class="waveform-switch" role="group" aria-label="Arpeggiator octaves">${[1, 2, 3].map((octaves) => `<button data-arp-octaves="${octaves}" aria-pressed="${track.octaves === octaves}" class="${track.octaves === octaves ? "active" : ""}">${octaves}</button>`).join("")}</div></div></div>
      <div class="arp-note-header"><span>Notes</span><button class="text-button" data-arp-clear="notes">Clear</button></div><div class="arp-note-options" role="group" aria-label="Arpeggiator notes">${arpNoteChoices(
        scale,
      )
        .map((note) => {
          const selected = notes.indexOf(note);
          return `<button data-arp-note="${note}" aria-label="Arpeggiator note ${noteName(note)}" aria-pressed="${selected >= 0}"><span>${noteName(note)}</span><small>${selected >= 0 ? selected + 1 : ""}</small></button>`;
        })
        .join("")}</div>
      <div class="arp-rhythm"><span>Steps</span><div class="arp-step-row" role="group" aria-label="Arpeggiator steps">${track.steps.map((on, index) => `<button data-arp-step="${index}" aria-label="Arpeggiator step ${index + 1}" aria-pressed="${on}">${String(index + 1).padStart(2, "0")}</button>`).join("")}</div><span>Accent</span><div class="arp-step-row" role="group" aria-label="Arpeggiator accents">${track.accents.map((on, index) => `<button data-arp-accent="${index}" aria-label="Arpeggiator accent ${index + 1}" aria-pressed="${on}">${on ? "◆" : "◇"}</button>`).join("")}</div></div>
      <div class="section-footer"><span>${notes.length ? "Tap notes to add or remove · Numbers show played order" : "Select notes to hear the arpeggiator"}</span><span>${track.muted ? "Muted" : `${notes.length} notes`}</span></div>`;
    updatePlayback();
  };

  const click = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !container.contains(button))
      return;
    const track = options.getTrack();
    const { dataset } = button;
    let changed = false;
    if (button.id === "arp-mute") {
      track.muted = !track.muted;
      changed = true;
    }
    if (dataset.arpSound !== undefined) {
      const sound = Number(dataset.arpSound);
      if (Number.isInteger(sound) && ARP_SOUNDS[sound] !== undefined) {
        track.sound = sound;
        track.muted = false;
        changed = true;
      }
    }
    const direction = ARP_DIRECTIONS.find(
      (direction) => direction.id === dataset.arpDirection,
    );
    if (direction) {
      track.direction = direction.id;
      changed = true;
    }
    const rate = ARP_RATES.find((rate) => rate === dataset.arpRate);
    if (rate) {
      track.rate = rate;
      changed = true;
    }
    if (dataset.arpOctaves !== undefined) {
      const octaves = Number(dataset.arpOctaves);
      if (Number.isInteger(octaves) && octaves >= 1 && octaves <= 3) {
        track.octaves = octaves;
        changed = true;
      }
    }
    if (dataset.arpNote !== undefined) {
      const note = Number(dataset.arpNote);
      if (arpNoteChoices(options.getScale()).includes(note)) {
        track.notes = retuneArp(track, options.getScale()).notes;
        if (track.notes.includes(note))
          track.notes = track.notes.filter((value) => value !== note);
        else if (track.notes.length < 16) track.notes.push(note);
        track.muted = false;
        changed = true;
      }
    }
    if (dataset.arpClear === "notes") {
      track.notes = [];
      changed = true;
    }
    if (dataset.arpStep !== undefined || dataset.arpAccent !== undefined) {
      const index = Number(dataset.arpStep ?? dataset.arpAccent);
      if (Number.isInteger(index) && index >= 0 && index < 16) {
        const steps =
          dataset.arpStep !== undefined ? track.steps : track.accents;
        steps[index] = !steps[index];
        changed = true;
      }
    }
    if (changed) {
      const focusSelector = button.id
        ? `#${button.id}`
        : Array.from(button.attributes)
            .filter((attribute) => attribute.name.startsWith("data-arp-"))
            .map((attribute) => `[${attribute.name}="${attribute.value}"]`)
            .join("");
      options.onChange();
      render();
      if (focusSelector)
        container
          .querySelector<HTMLElement>(focusSelector)
          ?.focus({ preventScroll: true });
    }
  };
  const updateControl = (id: string, value: number): boolean => {
    const control = CONTROLS.find(
      (control) => `arp-${control.parameter}` === id,
    );
    if (!control) return false;
    if (!Number.isFinite(value)) return true;
    const bounded = Math.max(control.min, Math.min(control.max, value));
    options.getTrack()[control.parameter] = bounded / control.multiplier;
    const element = container.querySelector<HTMLElement>(`#${id}`);
    const display = displayValue(control, bounded);
    element?.setAttribute("aria-valuenow", String(bounded));
    element?.setAttribute("aria-valuetext", display);
    element?.style.setProperty(
      "--knob-angle",
      `${-135 + ((bounded - control.min) / (control.max - control.min)) * 270}deg`,
    );
    const output = container.querySelector(`#${id}-value`);
    if (output) output.textContent = display;
    options.onChange();
    return true;
  };
  container.addEventListener("click", click);
  render();
  return {
    render,
    setStep: (absoluteStep) => {
      current = absoluteStep;
      updatePlayback();
    },
    updateControl,
    destroy: () => container.removeEventListener("click", click),
  };
}
