import { noteName, snapNote } from "./model";
import type { MusicalScale } from "./model";
import { createInstrumentAutomation } from "./instrument-automation";
import type { InstrumentControl } from "./instrument-automation";
import { PPQ, timingSchema, trackStepCount } from "./timing";
import {
  VOCAL_BANKS,
  VOCAL_SOUNDS,
  VOCAL_PATTERNS,
  withVocalPattern,
  normalizedVocalValue,
  resizeVocalTrack,
  setVocalValue,
  vocalStepNotes,
} from "./vocal-model";
import type { VocalParameter, VocalTrack } from "./vocal-model";
import { loadVocalCatalog } from "./vocal-samples";
import type { VocalCatalog, VocalSampleStatus } from "./vocal-samples";
import { VocalRoll } from "./vocal-roll";
import "./vocal-panel.css";

interface VocalPanelOptions {
  getTrack: () => VocalTrack;
  getScale: () => MusicalScale;
  onChange: () => void;
  onPreview: (note: number) => void;
  onTrimGesture: (
    phase: "begin" | "change" | "end",
    parameter: "start" | "end",
    value: number,
  ) => void;
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
const LABELS: ReadonlyArray<{ parameter: VocalParameter; label: string }> = [
  { parameter: "start", label: "Start" },
  { parameter: "end", label: "End" },
  { parameter: "attack", label: "Attack" },
  { parameter: "release", label: "Release" },
  { parameter: "tone", label: "Tone" },
  { parameter: "drive", label: "Drive" },
  { parameter: "space", label: "Space" },
  { parameter: "volume", label: "Level" },
];
const CONTROLS: ReadonlyArray<InstrumentControl<VocalParameter>> = LABELS.map(
  (control) => ({ ...control, min: 0, max: 100, multiplier: 100, step: "0.1" }),
);

/** Stable knobs share root gestures and recording; waveform controls are aliases. */
export function createVocalPanel(
  container: HTMLElement,
  options: VocalPanelOptions,
) {
  container.classList.add("vocal-instrument");
  let bank =
    VOCAL_BANKS.find(
      (candidate) =>
        options.getTrack().sound >= candidate.start &&
        options.getTrack().sound < candidate.start + candidate.count,
    ) ?? VOCAL_BANKS[0];
  let displayedSound = options.getTrack().sound;
  let catalog: VocalCatalog | null = null;
  let catalogError = "";
  let status: VocalSampleStatus | null = null;
  let destroyed = false;
  let hostSupportsVocal = true;
  let hostSupportsMusic = true;
  const controller = new AbortController();
  const held = new Set<"start" | "end">();
  container.innerHTML = `
    <div class="section-header"><div class="section-title"><span class="section-number">06</span><h2 id="vocal-title">Vocals</h2></div><div class="bass-actions"><button id="vocal-preview">Preview</button><button id="vocal-mute" class="mute-button" aria-label="Mute Vocals">M</button></div></div>
    <p id="vocal-host-capability" class="vocal-status" hidden>Host must reload Grain to play vocals.</p>
    <div class="vocal-sample-picker"><div class="waveform-switch vocal-banks" role="group" aria-label="Vocal voice">${VOCAL_BANKS.map((item) => `<button data-vocal-bank="${item.id}">${item.label}</button>`).join("")}</div><div class="waveform-switch vocal-sounds" role="group" aria-label="Vocal sample"></div></div>
    <div class="vocal-waveform" aria-label="Vocal sample waveform"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path id="vocal-waveform-path"/><rect class="vocal-trim-shade" id="vocal-trim-before" y="0" height="100"/><rect class="vocal-trim-shade" id="vocal-trim-after" y="0" height="100"/><line class="vocal-trim-line" id="vocal-trim-start-line" y1="0" y2="100"/><line class="vocal-trim-line" id="vocal-trim-end-line" y1="0" y2="100"/></svg><label class="vocal-trim vocal-trim-start"><span>Start</span><input id="vocal-trim-start" data-source-control="vocal-start" type="range" min="0" max="100" step="0.1" aria-label="Vocal sample start"/></label><label class="vocal-trim vocal-trim-end"><span>End</span><input id="vocal-trim-end" data-source-control="vocal-end" type="range" min="0" max="100" step="0.1" aria-label="Vocal sample end"/></label></div>
    <div class="vocal-waveform-info"><span id="vocal-pitch-reference"></span><output id="vocal-trim-duration"></output><button id="vocal-loop" aria-pressed="false">Sustain</button></div>
    <div class="vocal-status-row"><span id="vocal-sample-status" class="vocal-status" role="status"></span><button id="vocal-retry" hidden>Retry sample</button></div>
    <div class="acid-controls vocal-controls">${CONTROLS.map((control) => {
      const value = options.getTrack()[control.parameter] * 100;
      return options.renderControl(
        `vocal-${control.parameter}`,
        control.label,
        0,
        100,
        value,
        `${Math.round(value)}%`,
        control.step,
        `Vocal ${control.label.toLowerCase()}`,
      );
    }).join("")}</div>
    <div class="vocal-rhythms waveform-switch" role="group" aria-label="Vocal rhythm">${VOCAL_PATTERNS.map((item) => `<button data-vocal-pattern="${item.id}">${item.label}</button>`).join("")}</div>
    <div id="vocal-pattern-controls" class="instrument-pattern-controls"></div>
    <div class="vocal-roll-tools"><div class="vocal-octaves" role="group" aria-label="Vocal pitch view"><button data-vocal-octave="-1" aria-label="Lower vocal pitch view">−</button><output id="vocal-octave-label"></output><button data-vocal-octave="1" aria-label="Raise vocal pitch view">+</button></div><output id="vocal-selected-note">Select a note</output><div class="vocal-note-actions" role="group" aria-label="Selected vocal note"><button data-vocal-note-action="shorter" aria-label="Shorten selected vocal note">− length</button><button data-vocal-note-action="longer" aria-label="Lengthen selected vocal note">+ length</button><button data-vocal-note-action="accent" aria-pressed="false">Accent</button><button data-vocal-note-action="join">Join</button><button data-vocal-note-action="delete">Delete</button></div></div>
    <div class="vocal-roll"><canvas id="vocal-roll-canvas" aria-label="Draw vocal notes and lengths"></canvas><div id="vocal-roll-access" class="matrix-access"></div></div>
    <div class="section-footer"><span>Draw notes · Drag right edge for length</span></div><div id="vocal-automation"></div>`;
  const canvas = container.querySelector("#vocal-roll-canvas"),
    access = container.querySelector<HTMLElement>("#vocal-roll-access"),
    automationContainer =
      container.querySelector<HTMLElement>("#vocal-automation"),
    pagerContainer = container.querySelector<HTMLElement>(
      "#vocal-pattern-controls",
    );
  function trimInput(id: string): HTMLInputElement {
    const element = container.querySelector(id);
    if (!(element instanceof HTMLInputElement))
      throw new Error("Vocal trim controls are missing.");
    return element;
  }
  const trimStart = trimInput("#vocal-trim-start"),
    trimEnd = trimInput("#vocal-trim-end");
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !access ||
    !automationContainer ||
    !pagerContainer ||
    !trimStart ||
    !trimEnd
  )
    throw new Error("Vocal controls are missing.");
  const preview = (
    note: number = roll.selectedNote?.note ??
      snapNote(
        catalog?.samples[options.getTrack().sound]?.rootNote ?? 60,
        options.getScale(),
        36,
        84,
      ),
  ): void => options.onPreview(note);
  const roll: VocalRoll = new VocalRoll(canvas, access, {
    getTrack: options.getTrack,
    getScale: options.getScale,
    onChange: (next) => {
      Object.assign(options.getTrack(), next);
      automation.refresh();
      options.onChange();
    },
    onStroke: () => automation.freezeFollow(),
    onSelect: updateSelection,
    onPreview: preview,
  });
  const automation = createInstrumentAutomation(automationContainer, {
    prefix: "vocal",
    label: "Vocal",
    root: container,
    controls: CONTROLS,
    minNote: 36,
    maxNote: 84,
    getLane: (parameter) => options.getTrack().automation[parameter],
    setLane: (parameter, values) => {
      options.getTrack().automation[parameter] = values;
    },
    getBase: (parameter) => normalizedVocalValue(options.getTrack(), parameter),
    getScale: options.getScale,
    getMuted: () => options.getTrack().muted,
    getTiming: () => options.getTrack().timing,
    getSteps: () => vocalStepNotes(options.getTrack()),
    onTimingChange: (timing) => {
      const parsed = timingSchema.safeParse(timing);
      if (!parsed.success) return;
      roll.cancelStroke();
      Object.assign(
        options.getTrack(),
        resizeVocalTrack(options.getTrack(), parsed.data),
      );
      render();
      options.onChange();
    },
    allowedBars: [1, 2, 4, 8, 16],
    pagerContainer,
    onViewportChange: (viewport) => roll.setViewport(viewport),
    onChange: options.onChange,
  });
  function updateSelection(): void {
    const selected = roll.selectedNote,
      track = options.getTrack();
    const label = container.querySelector("#vocal-selected-note");
    if (label)
      label.textContent = selected
        ? `${noteName(selected.note)} · ${selected.length} ${selected.length === 1 ? "step" : "steps"}`
        : "Select a note";
    const octave = container.querySelector("#vocal-octave-label");
    if (octave) octave.textContent = roll.octaveLabel;
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-vocal-note-action]",
    )) {
      button.disabled = !selected;
      if (button.dataset.vocalNoteAction === "join")
        button.disabled =
          !selected ||
          !track.notes.some(
            (note) =>
              note.start === selected.start + selected.length &&
              note.note === selected.note,
          );
      if (button.dataset.vocalNoteAction === "accent")
        button.setAttribute("aria-pressed", String(selected?.accent ?? false));
      if (button.dataset.vocalNoteAction === "shorter")
        button.disabled = !selected || selected.length <= 1;
      if (button.dataset.vocalNoteAction === "longer")
        button.disabled =
          !selected ||
          selected.start + selected.length >= trackStepCount(track.timing);
    }
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-vocal-octave]",
    ))
      button.disabled =
        button.dataset.vocalOctave === "-1" ? !roll.canLower : !roll.canRaise;
  }
  function renderSounds(): void {
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      "[data-vocal-bank]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.vocalBank === bank?.id),
      );
    const sounds = container.querySelector<HTMLElement>(".vocal-sounds");
    if (!sounds || !bank) return;
    if (sounds.dataset.bank !== bank.id) {
      sounds.replaceChildren();
      sounds.dataset.bank = bank.id;
      for (let index = bank.start; index < bank.start + bank.count; index++) {
        const button = document.createElement("button");
        button.dataset.vocalSound = String(index);
        button.textContent = VOCAL_SOUNDS[index] ?? "";
        sounds.append(button);
      }
    }
    for (const button of sounds.querySelectorAll<HTMLButtonElement>("button"))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.vocalSound) === options.getTrack().sound),
      );
  }
  function displayControl(control: InstrumentControl<VocalParameter>): void {
    const element = container.querySelector<HTMLElement>(
      `#vocal-${control.parameter}`,
    );
    const value = options.getTrack()[control.parameter] * 100;
    element?.setAttribute("aria-valuenow", String(value));
    element?.setAttribute("aria-valuetext", `${Math.round(value)}%`);
    element?.style.setProperty("--knob-angle", `${-135 + value * 2.7}deg`);
    const output = container.querySelector(`#vocal-${control.parameter}-value`);
    if (output) output.textContent = `${Math.round(value)}%`;
  }
  function renderWaveform(): void {
    const track = options.getTrack(),
      sample = catalog?.samples[track.sound];
    if (!held.has("start")) trimStart.value = String(track.start * 100);
    if (!held.has("end")) trimEnd.value = String(track.end * 100);
    const start = Number(trimStart.value) / 100,
      end = Number(trimEnd.value) / 100;
    for (const [input, value] of [
      [trimStart, start],
      [trimEnd, end],
    ]) {
      if (input instanceof HTMLInputElement && typeof value === "number")
        input.setAttribute(
          "aria-valuetext",
          `${Math.round(value * 100)}%${sample ? `, ${(value * sample.duration).toFixed(2)} seconds` : ""}`,
        );
    }
    const path = container.querySelector("#vocal-waveform-path");
    if (
      path &&
      sample &&
      path.getAttribute("data-sound") !== String(track.sound)
    ) {
      const upper = sample.peaks
        .map(
          (peak, index) =>
            `${(index * 1000) / (sample.peaks.length - 1)},${50 - peak * 45}`,
        )
        .join(" L ");
      const lower = [...sample.peaks]
        .reverse()
        .map(
          (peak, index) =>
            `${((sample.peaks.length - 1 - index) * 1000) / (sample.peaks.length - 1)},${50 + peak * 45}`,
        )
        .join(" L ");
      path.setAttribute("d", `M ${upper} L ${lower} Z`);
      path.setAttribute("data-sound", String(track.sound));
    }
    container
      .querySelector("#vocal-trim-before")
      ?.setAttribute("width", String(start * 1000));
    container
      .querySelector("#vocal-trim-after")
      ?.setAttribute("x", String(end * 1000));
    container
      .querySelector("#vocal-trim-after")
      ?.setAttribute("width", String((1 - end) * 1000));
    for (const [id, value] of [
      ["start", start],
      ["end", end],
    ]) {
      const line = container.querySelector(`#vocal-trim-${id}-line`);
      line?.setAttribute("x1", String(Number(value) * 1000));
      line?.setAttribute("x2", String(Number(value) * 1000));
    }
    const reference = container.querySelector("#vocal-pitch-reference");
    if (reference)
      reference.textContent = sample
        ? sample.pitch?.kind === "tuned-chop"
          ? `Tuned ${noteName(sample.rootNote)}`
          : sample.pitch?.kind === "source-key"
            ? `Phrase key ${noteName(sample.rootNote).replace(/-?\d+$/, "")} · original melody`
            : `${noteName(sample.rootNote)} = original speed · unpitched`
        : "";
    const duration = container.querySelector("#vocal-trim-duration");
    if (duration)
      duration.textContent = sample
        ? `${Math.round(Math.max(0.005, end - start) * sample.duration * 1000)} ms`
        : "";
  }
  function renderStatus(): void {
    const output = container.querySelector<HTMLElement>("#vocal-sample-status"),
      retry = container.querySelector<HTMLButtonElement>("#vocal-retry");
    const current = status?.sound === options.getTrack().sound ? status : null;
    const message =
      catalogError ||
      (current?.phase === "loading"
        ? "Loading sample…"
        : current?.phase === "error"
          ? current.message
          : !catalog
            ? "Loading waveform…"
            : "");
    if (output) output.textContent = message;
    if (retry) retry.hidden = !catalogError && current?.phase !== "error";
  }
  async function loadCatalog(): Promise<void> {
    catalogError = "";
    renderStatus();
    try {
      catalog = await loadVocalCatalog(controller.signal);
      if (!destroyed) {
        renderWaveform();
        renderStatus();
      }
    } catch (error) {
      if (destroyed) return;
      catalogError =
        error instanceof Error
          ? error.message
          : "The vocal waveform could not be loaded.";
      renderStatus();
    }
  }
  function renderHostCapability(): void {
    const warning = container.querySelector<HTMLElement>(
      "#vocal-host-capability",
    );
    if (!warning) return;
    const newSound = options.getTrack().sound >= 24;
    warning.hidden = hostSupportsVocal && (!newSound || hostSupportsMusic);
    warning.textContent =
      newSound && !hostSupportsMusic
        ? "The host needs updated Grain to play these vocal samples."
        : "The host needs updated Grain to play vocals.";
  }
  function render(): void {
    if (destroyed) return;
    const track = options.getTrack();
    if (displayedSound !== track.sound) {
      displayedSound = track.sound;
      bank =
        VOCAL_BANKS.find(
          (candidate) =>
            track.sound >= candidate.start &&
            track.sound < candidate.start + candidate.count,
        ) ?? bank;
    }
    renderSounds();
    renderHostCapability();
    CONTROLS.forEach(displayControl);
    renderWaveform();
    renderStatus();
    container
      .querySelector("#vocal-mute")
      ?.setAttribute("aria-pressed", String(track.muted));
    container
      .querySelector("#vocal-loop")
      ?.setAttribute("aria-pressed", String(track.loop));
    roll.refresh();
    automation.refresh(true);
  }
  function updateControl(id: string, value: number): boolean {
    const control = CONTROLS.find(
      (control) => `vocal-${control.parameter}` === id,
    );
    if (!control) return false;
    if (!Number.isFinite(value)) return true;
    const track = options.getTrack(),
      before = normalizedVocalValue(track, control.parameter);
    Object.assign(track, setVocalValue(track, control.parameter, value / 100));
    if (control.parameter === "start")
      trimStart.value = String(track.start * 100);
    if (control.parameter === "end") trimEnd.value = String(track.end * 100);
    displayControl(control);
    automation.shiftControl(
      id,
      before,
      normalizedVocalValue(track, control.parameter),
    );
    renderWaveform();
    options.onChange();
    return true;
  }
  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !container.contains(button))
      return;
    const nextBank = VOCAL_BANKS.find(
      (candidate) => candidate.id === button.dataset.vocalBank,
    );
    if (nextBank) {
      bank = nextBank;
      renderSounds();
      return;
    }
    const sound = Number(button.dataset.vocalSound);
    if (
      button.dataset.vocalSound !== undefined &&
      Number.isInteger(sound) &&
      VOCAL_SOUNDS[sound] !== undefined
    ) {
      options.getTrack().sound = sound;
      options.getTrack().muted = false;
      render();
      options.onChange();
      preview(
        snapNote(
          catalog?.samples[sound]?.rootNote ?? 60,
          options.getScale(),
          36,
          84,
        ),
      );
      return;
    }
    if (button.dataset.vocalPattern) {
      const track = options.getTrack();
      const sample = catalog?.samples[track.sound];
      Object.assign(
        track,
        withVocalPattern(
          track,
          button.dataset.vocalPattern,
          options.getScale(),
          sample?.rootNote ?? 60,
        ),
      );
      roll.cancelStroke();
      render();
      options.onChange();
      return;
    }
    if (button.id === "vocal-preview") {
      preview();
      return;
    }
    if (button.id === "vocal-retry") {
      if (catalogError) void loadCatalog();
      preview();
      return;
    }
    if (button.id === "vocal-loop" || button.id === "vocal-mute") {
      const track = options.getTrack();
      if (button.id === "vocal-loop") track.loop = !track.loop;
      else track.muted = !track.muted;
      render();
      options.onChange();
      return;
    }
    if (button.dataset.vocalOctave) {
      roll.shiftOctave(Number(button.dataset.vocalOctave));
      return;
    }
    const action = button.dataset.vocalNoteAction;
    if (
      action === "join" ||
      action === "delete" ||
      action === "accent" ||
      action === "shorter" ||
      action === "longer"
    )
      roll.act(action);
  }
  function trimParameter(target: EventTarget | null): "start" | "end" | null {
    return target === trimStart ? "start" : target === trimEnd ? "end" : null;
  }
  function beginTrim(event: Event): void {
    const parameter = trimParameter(event.target);
    if (!parameter || held.has(parameter)) return;
    if (
      event instanceof KeyboardEvent &&
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    )
      return;
    held.add(parameter);
    options.onTrimGesture(
      "begin",
      parameter,
      Number(parameter === "start" ? trimStart.value : trimEnd.value) / 100,
    );
  }
  function changeTrim(event: Event): void {
    const parameter = trimParameter(event.target);
    if (!parameter) return;
    const value =
      Number(parameter === "start" ? trimStart.value : trimEnd.value) / 100;
    options.onTrimGesture("change", parameter, value);
    renderWaveform();
  }
  function endTrim(event?: Event): void {
    const parameter = event ? trimParameter(event.target) : null;
    for (const item of [...held]) {
      if (parameter && item !== parameter) continue;
      held.delete(item);
      options.onTrimGesture(
        "end",
        item,
        Number(item === "start" ? trimStart.value : trimEnd.value) / 100,
      );
    }
    renderWaveform();
  }
  container.addEventListener("click", click);
  for (const input of [trimStart, trimEnd]) {
    input.addEventListener("pointerdown", beginTrim);
    input.addEventListener("keydown", beginTrim);
    input.addEventListener("input", changeTrim);
    input.addEventListener("keyup", endTrim);
    input.addEventListener("blur", endTrim);
  }
  window.addEventListener("pointerup", endTrim);
  window.addEventListener("pointercancel", endTrim);
  window.addEventListener("blur", endTrim);
  void document.fonts.ready.then(() => {
    if (!destroyed) roll.refresh();
  });
  render();
  void loadCatalog();
  return {
    render,
    refreshAutomation: () => {
      automation.refresh();
      renderWaveform();
    },
    setPosition: (tick: number, swing: number) => {
      roll.setPosition(tick, swing);
      automation.setPosition(tick, swing);
    },
    setStep: (step: number) => {
      const tick = step < 0 ? -1 : (step * PPQ) / 4;
      roll.setPosition(tick, 0);
      automation.setPosition(tick, 0);
    },
    updateControl,
    activateControl: automation.activateControl,
    rebaseIncoming: (next: VocalTrack) => {
      roll.rebaseIncoming(next);
      automation.rebaseIncoming(
        (parameter) => next.automation[parameter],
        next.timing,
      );
    },
    setSampleStatus: (next: VocalSampleStatus) => {
      status = next;
      renderStatus();
    },
    setHostCapability: (supported: boolean, music = supported) => {
      hostSupportsVocal = supported;
      hostSupportsMusic = music;
      renderHostCapability();
    },
    destroy: () => {
      endTrim();
      destroyed = true;
      controller.abort();
      roll.destroy();
      automation.destroy();
      container.removeEventListener("click", click);
      for (const input of [trimStart, trimEnd]) {
        input.removeEventListener("pointerdown", beginTrim);
        input.removeEventListener("keydown", beginTrim);
        input.removeEventListener("input", changeTrim);
        input.removeEventListener("keyup", endTrim);
        input.removeEventListener("blur", endTrim);
      }
      window.removeEventListener("pointerup", endTrim);
      window.removeEventListener("pointercancel", endTrim);
      window.removeEventListener("blur", endTrim);
    },
  };
}
