import type { MusicalScale } from "./model";
import {
  PPQ,
  padTimingSchema,
  ticksPerStep,
  swungTick,
  trackPosition,
  trackStepCount,
} from "./timing";
import type { Timing } from "./timing";
import { createInstrumentAutomation } from "./instrument-automation";
import {
  PAD_SOUNDS,
  normalizedPadValue,
  resizePadTrack,
  resizePadAutomation,
} from "./pad-model";
import type { PadParameter, PadTrack } from "./pad-model";
import {
  progressionChordAtTick,
  progressionChordLabel,
  progressionChordNotes,
} from "./progression-model";
import type { Progression } from "./progression-model";
import { createChordEditor } from "./progression-panel";

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
  getProgression: () => Progression;
  onProgressionEdit: () => void;
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
export function createPadPanel(
  container: HTMLElement,
  options: PadPanelOptions,
) {
  let playingTick = -1,
    currentSwing = 0,
    destroyed = false;
  const initial = options.getTrack();
  container.classList.add("pad-instrument");
  container.innerHTML = `
    <div class="section-header"><div class="section-title"><span class="section-number">05</span><h2 id="pad-title">Chord pads</h2></div><div class="bass-actions"><button class="text-button" data-pad-enable></button><button class="mute-button solo-button" data-solo="pad" aria-label="Solo chord pads" aria-pressed="false">S</button></div></div>
    <div class="bass-meta"><div class="waveform-switch pad-sounds" role="group" aria-label="Pad sound">${PAD_SOUNDS.map((sound, index) => `<button data-pad-sound="${index}">${sound}</button>`).join("")}</div><span class="pad-position"></span></div>
    <div class="acid-controls pad-controls">${controls.map((control) => options.renderControl(`pad-${control.parameter}`, control.label, 0, 100, Math.round(initial[control.parameter] * 100), `${Math.round(initial[control.parameter] * 100)}%`, "1", `Pad ${control.label.toLowerCase()}`)).join("")}</div>
    <details class="instrument-section instrument-sequence" open><summary>Sequence</summary>
    <div class="follow-chord-controls"><button id="pad-follow-chords" aria-pressed="${initial.followChords}">Follow chords</button><output class="follow-chord-context" id="pad-chord-context"></output><button id="pad-edit-chords">Edit chords</button></div>
    <div class="pad-instrument-loop"><span class="pad-loop-label">Instrument loop</span><div id="pad-pattern-controls" class="instrument-pattern-controls"></div></div>
    <div id="pad-local-chords"></div></details>
    <details class="instrument-section instrument-automation-section"><summary>Automation</summary><div id="pad-automation"></div></details>`;
  const automationContainer =
      container.querySelector<HTMLElement>("#pad-automation"),
    pagerContainer = container.querySelector<HTMLElement>(
      "#pad-pattern-controls",
    ),
    localContainer = container.querySelector<HTMLElement>("#pad-local-chords");
  if (!automationContainer || !pagerContainer || !localContainer)
    throw new Error("Pad controls are missing.");
  const localEditor = createChordEditor(localContainer, {
    prefix: "pad-local",
    getProgression: options.getTrack,
    getScale: options.getScale,
    getMuted: () => options.getTrack().muted,
    onChange: () => {
      render();
      options.onChange();
    },
  });
  const contextSteps = (timing: Timing) => {
    const track = options.getTrack(),
      progression = track.followChords ? options.getProgression() : track;
    return Array.from({ length: trackStepCount(timing) }, (_, index) => {
      const slot = progressionChordAtTick(
        progression,
        swungTick(index * ticksPerStep(timing), currentSwing, timing.grid),
        currentSwing,
      );
      return {
        note:
          progressionChordNotes(progression, options.getScale(), slot)[0] ?? 60,
        on: true,
        accent: false,
        slide: false,
      };
    });
  };
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
    getAutomationBars: () => options.getTrack().automationBars,
    onAutomationBarsChange: (bars) => {
      Object.assign(
        options.getTrack(),
        resizePadAutomation(options.getTrack(), bars),
      );
      render();
      options.onChange();
    },
    allowedBars: [2, 4, 8, 16],
    pagerContainer,
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
    getSteps: () => contextSteps(options.getTrack().timing),
    getContextSteps: contextSteps,
    onChange: options.onChange,
  });
  function setPosition(tick: number, swing: number): void {
    const swingChanged = currentSwing !== swing;
    playingTick = tick;
    currentSwing = swing;
    const track = options.getTrack(),
      progression = track.followChords ? options.getProgression() : track;
    const slot = progressionChordAtTick(progression, tick, swing);
    const position = container.querySelector(".pad-position");
    if (position)
      position.textContent =
        tick < 0
          ? `${progression.timing.bars} bars`
          : `Bar ${trackPosition(progression.timing, tick, swing).bar + 1} / ${progression.timing.bars}`;
    const context = container.querySelector<HTMLElement>("#pad-chord-context");
    if (context) {
      context.hidden = !track.followChords;
      context.textContent = `${progressionChordLabel(progression, options.getScale(), Math.max(0, slot))} · ${progression.timing.bars} bars`;
    }
    localEditor.setPosition(track.followChords ? -1 : tick, swing);
    if (swingChanged) automation.refresh();
    automation.setPosition(tick, swing);
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
    const track = options.getTrack();
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
    container
      .querySelector("#pad-follow-chords")
      ?.setAttribute("aria-pressed", String(track.followChords));
    const shortcut =
      container.querySelector<HTMLButtonElement>("#pad-edit-chords");
    if (shortcut) shortcut.hidden = !track.followChords;
    if (localContainer) localContainer.hidden = track.followChords;
    localEditor.render();
    controls.forEach((control) => displayControl(control.parameter));
    automation.refresh(resetHistory);
    setPosition(playingTick, currentSwing);
  }
  function updateControl(id: string, value: number): boolean {
    const control = controls.find((item) => id === `pad-${item.parameter}`);
    if (!control) return false;
    if (!Number.isFinite(value)) return true;
    const track = options.getTrack(),
      before = track[control.parameter];
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
    const track = options.getTrack();
    let changed = false;
    if (button.id === "pad-edit-chords") {
      options.onProgressionEdit();
      return;
    }
    if (button.id === "pad-follow-chords") {
      track.followChords = !track.followChords;
      changed = true;
    }
    if (button.dataset.padEnable !== undefined) {
      track.muted = !track.muted;
      changed = true;
    }
    if (button.dataset.padSound !== undefined) {
      const sound = Number(button.dataset.padSound);
      if (Number.isInteger(sound) && sound >= 0 && sound < PAD_SOUNDS.length) {
        track.sound = sound;
        changed = true;
      }
    }
    if (changed) {
      render();
      options.onChange();
    }
  }
  container.addEventListener("click", click);
  render();
  return {
    render,
    refreshAutomation: () => automation.refresh(),
    setPosition,
    setStep: (step: number) => setPosition(step < 0 ? -1 : (step * PPQ) / 4, 0),
    updateControl,
    activateControl: automation.activateControl,
    rebaseIncoming: (next: PadTrack) =>
      automation.rebaseIncoming(
        (parameter) => next.automation[parameter],
        next.timing,
        next.automationBars,
      ),
    destroy: () => {
      destroyed = true;
      localEditor.destroy();
      automation.destroy();
      container.removeEventListener("click", click);
      container.replaceChildren();
    },
  };
}
