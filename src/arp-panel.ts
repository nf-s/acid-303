import { noteName } from "./model";
import { createInstrumentAutomation } from "./instrument-automation";
import type { InstrumentControl } from "./instrument-automation";
import type { MusicalScale } from "./model";
import {
  PPQ,
  sequenceTimingSchema,
  stepsPerBar,
  ticksPerStep,
  trackPosition,
  unswungTick,
  swungTick,
} from "./timing";
import {
  ARP_DIRECTIONS,
  ARP_RATES,
  ARP_SOUNDS,
  arpEventsAtTick,
  arpRateTicks,
  resizeArpTrack,
  resizeArpAutomation,
  arpNoteChoices,
  normalizedArpValue,
  retuneArp,
} from "./arp-model";
import type { ArpParameter, ArpTrack } from "./arp-model";
import type { Progression } from "./progression-model";
import {
  progressionChordAtTick,
  progressionChordLabel,
} from "./progression-model";
import type { Timing } from "./timing";
import { trackStepCount } from "./timing";
import "./progression-panel.css";

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
  getProgression: () => Progression;
  onProgressionEdit: () => void;
  onChange: () => void;
  renderControl: RenderControl;
}
export interface ArpPanel {
  render: () => void;
  refreshAutomation: () => void;
  setStep: (absoluteStep: number) => void;
  setPosition: (absoluteTick: number, swing: number) => void;
  updateControl: (id: string, value: number) => boolean;
  activateControl: (id: string) => boolean;
  rebaseIncoming: (next: ArpTrack) => void;
  destroy: () => void;
}
type Control = InstrumentControl<ArpParameter>;
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
  container.classList.add("arp-instrument");
  let current = -1;
  let swing = 0;
  let noteSignature = "";
  const updatePlayback = (): void => {
    const track = options.getTrack();
    const logical = unswungTick(Math.max(0, current), swing, track.timing.grid);
    const eventTick =
      Math.floor(logical / arpRateTicks(track.rate)) * arpRateTicks(track.rate);
    const events =
      current >= 0
        ? arpEventsAtTick(
            track,
            options.getScale(),
            eventTick,
            options.getProgression(),
            swungTick(eventTick, swing, track.timing.grid),
            swing,
          )
        : [];
    const chordContext =
      container.querySelector<HTMLElement>("#arp-chord-context");
    if (chordContext) {
      chordContext.hidden = !track.followChords;
      const progression = options.getProgression();
      const slot = progressionChordAtTick(
        progression,
        Math.max(0, current),
        swing,
      );
      chordContext.textContent = progressionChordLabel(
        progression,
        options.getScale(),
        slot,
      );
    }
    const position =
      current >= 0 ? trackPosition(track.timing, current, swing) : null;
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
        position !== null && Number(button.dataset.arpStep) === position.index,
      );
    const output = container.querySelector("#arp-playing-note");
    if (output)
      output.textContent = playing.length
        ? playing.map(noteName).join(" · ")
        : "—";
  };
  const initialRender = (): void => {
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
      <details class="instrument-section instrument-sequence" open><summary>Sequence</summary>
      <div class="follow-chord-controls"><button id="arp-follow-chords" aria-pressed="${track.followChords}">Follow chords</button><output class="follow-chord-context" id="arp-chord-context"></output><button id="arp-edit-chords">Edit chords</button></div>
      <div class="arp-settings"><div class="arp-setting"><span>Order</span><div class="waveform-switch" role="group" aria-label="Arpeggiator order">${ARP_DIRECTIONS.map((direction) => `<button data-arp-direction="${direction.id}" aria-pressed="${track.direction === direction.id}" class="${track.direction === direction.id ? "active" : ""}">${direction.label}</button>`).join("")}</div></div><div class="arp-setting"><span>Rate</span><div class="waveform-switch" role="group" aria-label="Arpeggiator rate">${ARP_RATES.map((rate) => `<button data-arp-rate="${rate}" aria-pressed="${track.rate === rate}" class="${track.rate === rate ? "active" : ""}">${rate}</button>`).join("")}</div></div><div class="arp-setting"><span>Octaves</span><div class="waveform-switch" role="group" aria-label="Arpeggiator octaves">${[1, 2, 3].map((octaves) => `<button data-arp-octaves="${octaves}" aria-pressed="${track.octaves === octaves}" class="${track.octaves === octaves ? "active" : ""}">${octaves}</button>`).join("")}</div></div></div>
      <div class="arp-manual-notes"><div class="arp-note-header"><span>Notes</span><button class="text-button" data-arp-clear="notes">Clear</button></div><div class="arp-note-options" role="group" aria-label="Arpeggiator notes">${arpNoteChoices(
        scale,
      )
        .map((note) => {
          const selected = notes.indexOf(note);
          return `<button data-arp-note="${note}" aria-label="Arpeggiator note ${noteName(note)}" aria-pressed="${selected >= 0}"><span>${noteName(note)}</span><small>${selected >= 0 ? selected + 1 : ""}</small></button>`;
        })
        .join("")}</div></div>
      <div class="arp-rhythm"><span>Steps</span><div class="arp-step-row" role="group" aria-label="Arpeggiator steps"></div><span>Accent</span><div class="arp-step-row" role="group" aria-label="Arpeggiator accents"></div></div>
      <div class="section-footer"><span>${notes.length ? "Tap notes to add or remove · Numbers show played order" : "Select notes to hear the arpeggiator"}</span><span>${track.muted ? "Muted" : `${notes.length} notes`}</span></div></details><details class="instrument-section instrument-automation-section"><summary>Automation</summary><div id="arp-automation"></div></details>`;
    updatePlayback();
  };

  initialRender();
  const automationContainer =
    container.querySelector<HTMLElement>("#arp-automation");
  const pagerContainer = document.createElement("div");
  pagerContainer.id = "arp-pattern-controls";
  pagerContainer.className = "instrument-pattern-controls";
  const rhythm = container.querySelector(".arp-rhythm");
  if (!automationContainer || !rhythm)
    throw new Error("Arpeggiator controls are missing.");
  rhythm.before(pagerContainer);
  const renderRhythm = (viewport: { start: number; count: number }): void => {
    const track = options.getTrack();
    const perBar = stepsPerBar(track.timing);
    for (const [row, accent] of [false, true].entries()) {
      const target =
        container.querySelectorAll<HTMLElement>(".arp-step-row")[row];
      if (!target) continue;
      const attribute = accent ? "arp-accent" : "arp-step";
      const values = accent ? track.accents : track.steps;
      const signature = `${viewport.start}:${viewport.count}:${perBar}`;
      if (target.dataset.viewport !== signature) {
        target.dataset.viewport = signature;
        target.style.gridTemplateColumns = `repeat(${viewport.count}, minmax(0, 1fr))`;
        target.innerHTML = Array.from(
          { length: viewport.count },
          (_, column) => {
            const index = viewport.start + column;
            return `<button data-${attribute}="${index}" aria-label="Arpeggiator ${accent ? "accent" : "step"} ${index + 1}, bar ${Math.floor(index / perBar) + 1}"></button>`;
          },
        ).join("");
      }
      for (const button of target.querySelectorAll<HTMLButtonElement>(
        "button",
      )) {
        const index = Number(
          accent ? button.dataset.arpAccent : button.dataset.arpStep,
        );
        button.setAttribute("aria-pressed", String(values[index] ?? false));
        button.textContent = accent
          ? values[index]
            ? "◆"
            : "◇"
          : String((index % perBar) + 1).padStart(2, "0");
      }
    }
    updatePlayback();
  };
  const contextSteps = (timing: Timing) => {
    const track = options.getTrack();
    return Array.from({ length: trackStepCount(timing) }, (_, index) => {
      const logicalTick = index * ticksPerStep(timing);
      const cell =
        Math.floor(logicalTick / ticksPerStep(track.timing)) %
        track.steps.length;
      const eventTick =
        Math.floor(logicalTick / arpRateTicks(track.rate)) *
        arpRateTicks(track.rate);
      return {
        on: track.steps[cell] ?? false,
        note:
          arpEventsAtTick(
            { ...track, muted: false },
            options.getScale(),
            eventTick,
            options.getProgression(),
            swungTick(eventTick, swing, track.timing.grid),
            swing,
          )[0]?.note ??
          track.notes[0] ??
          60,
        accent: false,
        slide: false,
      };
    });
  };
  const automation = createInstrumentAutomation(automationContainer, {
    prefix: "arp",
    label: "Arpeggiator",
    root: container,
    minNote: 48,
    maxNote: 108,
    controls: CONTROLS,
    getLane: (parameter) => options.getTrack().automation[parameter],
    setLane: (parameter, values) => {
      options.getTrack().automation[parameter] = values;
    },
    getBase: (parameter) => normalizedArpValue(options.getTrack(), parameter),
    getScale: options.getScale,
    getMuted: () => options.getTrack().muted,
    getTiming: () => options.getTrack().timing,
    getAutomationBars: () => options.getTrack().automationBars,
    onAutomationBarsChange: (bars) => {
      Object.assign(
        options.getTrack(),
        resizeArpAutomation(options.getTrack(), bars),
      );
      render();
      options.onChange();
    },
    onTimingChange: (timing) => {
      const parsed = sequenceTimingSchema.safeParse(timing);
      if (!parsed.success) return;
      Object.assign(
        options.getTrack(),
        resizeArpTrack(options.getTrack(), parsed.data),
      );
      render();
      options.onChange();
    },
    pagerContainer,
    onViewportChange: renderRhythm,
    getSteps: () => contextSteps(options.getTrack().timing),
    getContextSteps: contextSteps,
    onChange: options.onChange,
  });
  const displayControl = (control: Control): void => {
    const id = `arp-${control.parameter}`;
    const value = options.getTrack()[control.parameter] * control.multiplier;
    const element = container.querySelector<HTMLElement>(`#${id}`);
    const display = displayValue(control, value);
    element?.setAttribute("aria-valuenow", String(value));
    element?.setAttribute("aria-valuetext", display);
    element?.style.setProperty(
      "--knob-angle",
      `${-135 + ((value - control.min) / (control.max - control.min)) * 270}deg`,
    );
    const output = container.querySelector(`#${id}-value`);
    if (output) output.textContent = display;
  };
  const render = (): void => {
    const track = options.getTrack();
    container
      .querySelector("#arp-mute")
      ?.setAttribute("aria-pressed", String(track.muted));
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-arp-sound],[data-arp-direction],[data-arp-rate],[data-arp-octaves]",
    )) {
      const active =
        button.dataset.arpSound !== undefined
          ? Number(button.dataset.arpSound) === track.sound
          : button.dataset.arpDirection !== undefined
            ? button.dataset.arpDirection === track.direction
            : button.dataset.arpRate !== undefined
              ? button.dataset.arpRate === track.rate
              : Number(button.dataset.arpOctaves) === track.octaves;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    }
    const scale = options.getScale();
    const notes = retuneArp(track, scale).notes;
    container
      .querySelector("#arp-follow-chords")
      ?.setAttribute("aria-pressed", String(track.followChords));
    const manual = container.querySelector<HTMLElement>(".arp-manual-notes");
    const shortcut =
      container.querySelector<HTMLButtonElement>("#arp-edit-chords");
    if (manual) manual.hidden = track.followChords;
    if (shortcut) shortcut.hidden = !track.followChords;
    const noteOptions = container.querySelector(".arp-note-options");
    const signature = `${scale.root}:${scale.mode}`;
    if (noteOptions && signature !== noteSignature) {
      noteOptions.innerHTML = arpNoteChoices(scale)
        .map(
          (note) =>
            `<button data-arp-note="${note}" aria-label="Arpeggiator note ${noteName(note)}"><span>${noteName(note)}</span><small></small></button>`,
        )
        .join("");
      noteSignature = signature;
    }
    for (const button of container.querySelectorAll<HTMLElement>(
      "[data-arp-note]",
    )) {
      const selected = notes.indexOf(Number(button.dataset.arpNote));
      button.setAttribute("aria-pressed", String(selected >= 0));
      const order = button.querySelector("small");
      if (order) order.textContent = selected >= 0 ? String(selected + 1) : "";
    }
    renderRhythm(automation.viewport);
    const footer = container.querySelector(".section-footer");
    if (footer instanceof HTMLElement) {
      footer.hidden = track.followChords;
      footer.innerHTML = `<span>${notes.length ? "Tap notes to add or remove · Numbers show played order" : "Select notes to hear the arpeggiator"}</span><span>${track.muted ? "Muted" : `${notes.length} notes`}</span>`;
    }
    CONTROLS.forEach(displayControl);
    automation.refresh(true);
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
    if (button.id === "arp-edit-chords") {
      options.onProgressionEdit();
      return;
    }
    if (button.id === "arp-follow-chords") {
      track.followChords = !track.followChords;
      changed = true;
    }
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
    if (!track.followChords && dataset.arpNote !== undefined) {
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
    if (!track.followChords && dataset.arpClear === "notes") {
      track.notes = [];
      changed = true;
    }
    if (dataset.arpStep !== undefined || dataset.arpAccent !== undefined) {
      const index = Number(dataset.arpStep ?? dataset.arpAccent);
      if (Number.isInteger(index) && index >= 0 && index < track.steps.length) {
        automation.freezeFollow();
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
    const track = options.getTrack();
    const before = normalizedArpValue(track, control.parameter);
    const bounded = Math.max(control.min, Math.min(control.max, value));
    track[control.parameter] = bounded / control.multiplier;
    displayControl(control);
    automation.shiftControl(
      id,
      before,
      normalizedArpValue(track, control.parameter),
    );
    options.onChange();
    return true;
  };
  container.addEventListener("click", click);
  render();
  return {
    render,
    refreshAutomation: () => automation.refresh(),
    setPosition: (absoluteTick, amount) => {
      const swingChanged = swing !== amount;
      current = absoluteTick;
      swing = amount;
      updatePlayback();
      if (swingChanged) automation.refresh();
      automation.setPosition(absoluteTick, amount);
    },
    setStep: (absoluteStep) => {
      const swingChanged = swing !== 0;
      current = absoluteStep < 0 ? -1 : (absoluteStep * PPQ) / 4;
      swing = 0;
      updatePlayback();
      if (swingChanged) automation.refresh();
      automation.setPosition(current, 0);
    },
    updateControl,
    activateControl: automation.activateControl,
    rebaseIncoming: (next) =>
      automation.rebaseIncoming(
        (parameter) => next.automation[parameter],
        next.timing,
        next.automationBars,
      ),
    destroy: () => {
      automation.destroy();
      container.removeEventListener("click", click);
    },
  };
}
