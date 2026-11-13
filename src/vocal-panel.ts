import { noteName, snapNote } from "./model";
import type { MusicalScale } from "./model";
import { createInstrumentAutomation } from "./instrument-automation";
import type { InstrumentControl } from "./instrument-automation";
import {
  PPQ,
  timingSchema,
  trackStepCount,
  swungTick,
  ticksPerStep,
} from "./timing";
import {
  VOCAL_BANKS,
  VOCAL_SOUNDS,
  VOCAL_PATTERNS,
  withVocalPattern,
  normalizedVocalValue,
  resizeVocalTrack,
  resizeVocalAutomation,
  setVocalValue,
  vocalStepNotes,
  vocalProgressionNote,
  vocalGainDecibels,
} from "./vocal-model";
import type { VocalParameter, VocalTrack } from "./vocal-model";
import { loadVocalCatalog, vocalSourceKey } from "./vocal-samples";
import type { VocalCatalog, VocalSampleStatus } from "./vocal-samples";
import { VocalRoll } from "./vocal-roll";
import { createSampleRecorder } from "./sample-recorder";
import type { RecordingStatus } from "./sample-recorder";
import { normalizeImportedWav } from "./recording-wav";
import { recordingNormalizationGain } from "./recording-normalization";
import {
  deleteLocalRecording,
  listRecordings,
  storeCapturedRecording,
  subscribeRecordings,
} from "./custom-sample-store";
import type { StoredRecording } from "./custom-sample-store";
import type { CustomSample } from "./custom-sample-schema";
import { deleteSharedRecording } from "./custom-samples";
import {
  progressionChordAtTick,
  progressionChordLabel,
} from "./progression-model";
import type { Progression } from "./progression-model";
import "./vocal-panel.css";

interface VocalPanelOptions {
  getTrack: () => VocalTrack;
  getScale: () => MusicalScale;
  getProgression: () => Progression;
  onProgressionEdit?: () => void;
  getSessionActive?: () => boolean;
  onUseRecording?: (sample: CustomSample) => Promise<void>;
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
    resetValue?: number,
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
function formatGain(value: number): string {
  const decibels = vocalGainDecibels(value);
  return `${decibels > 0 ? "+" : ""}${decibels.toFixed(1)} dB`;
}
const GAIN_CONTROL: InstrumentControl<VocalParameter> = {
  parameter: "gain",
  label: "Gain",
  min: -24,
  max: 24,
  multiplier: 48,
  step: "0.1",
  format: formatGain,
};
const CONTROLS: ReadonlyArray<InstrumentControl<VocalParameter>> = [
  ...LABELS.map((control) => ({
    ...control,
    min: 0,
    max: 100,
    multiplier: 100,
    step: "0.1",
  })),
  GAIN_CONTROL,
];

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
  let hostSupportsComposition = true;
  let hostSupportsGain = true;
  let recordings: StoredRecording[] = [];
  let recordingStatus: RecordingStatus = { phase: "idle", seconds: 0 };
  let recordingMessage = "";
  let recordingBusy = false;
  let captureTarget: { track: VocalTrack; key: string } | null = null;
  let currentTick = -1,
    currentSwing = 0;
  const controller = new AbortController();
  const held = new Set<"start" | "end">();
  container.innerHTML = `
    <div class="section-header"><div class="section-title"><span class="section-number">06</span><h2 id="vocal-title">Vocals</h2></div><div class="bass-actions"><button id="vocal-preview">Preview</button><button id="vocal-mute" class="mute-button" aria-label="Mute Vocals">M</button><button class="mute-button solo-button" data-solo="vocal" aria-label="Solo Vocals" aria-pressed="false">S</button></div></div>
    <p id="vocal-host-capability" class="vocal-status" hidden>Host must reload Grain to play vocals.</p>
    <div class="vocal-sample-picker"><div class="waveform-switch vocal-banks" role="group" aria-label="Vocal voice">${VOCAL_BANKS.map((item) => `<button data-vocal-bank="${item.id}">${item.label}</button>`).join("")}</div><div class="waveform-switch vocal-sounds" role="group" aria-label="Vocal sample"></div></div>
    <details class="vocal-recordings instrument-section"><summary>Recordings</summary><div class="vocal-recording-actions"><button id="vocal-record-mic">Record mic</button><button id="vocal-import-wav">Import WAV</button><input id="vocal-import-file" type="file" accept=".wav,audio/wav" aria-label="Import short PCM WAV" hidden><button id="vocal-record-stop" hidden>Stop recording</button><button id="vocal-record-cancel" hidden>Cancel</button><output id="vocal-record-time"></output></div><p class="vocal-recording-limit">On this device until shared · 10 seconds maximum. WAV imports: mono or stereo, 16-bit PCM, 24/44.1/48 kHz, up to 2 MiB.</p><p class="vocal-recording-limit">Sharing uploads audio. Anyone with the track or session link can hear it. Shared copies expire after 30 days without access.</p><output id="vocal-record-message" role="status"></output><div id="vocal-recording-list"></div></details>
    <div class="vocal-sample-level"><div class="vocal-waveform" aria-label="Vocal sample waveform"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path id="vocal-waveform-path"/><rect class="vocal-trim-shade" id="vocal-trim-before" y="0" height="100"/><rect class="vocal-trim-shade" id="vocal-trim-after" y="0" height="100"/><line class="vocal-trim-line" id="vocal-trim-start-line" y1="0" y2="100"/><line class="vocal-trim-line" id="vocal-trim-end-line" y1="0" y2="100"/></svg><label class="vocal-trim vocal-trim-start"><span>Start</span><input id="vocal-trim-start" data-source-control="vocal-start" type="range" min="0" max="100" step="0.1" aria-label="Vocal sample start"/></label><label class="vocal-trim vocal-trim-end"><span>End</span><input id="vocal-trim-end" data-source-control="vocal-end" type="range" min="0" max="100" step="0.1" aria-label="Vocal sample end"/></label></div>${options.renderControl("vocal-gain", "Gain", -24, 24, vocalGainDecibels(options.getTrack().gain), formatGain(options.getTrack().gain), "0.1", "Vocal gain", undefined, 0)}</div>
    <p id="vocal-gain-capability" class="vocal-status" hidden>The host needs updated Grain to use vocal gain.</p>
    <div class="vocal-waveform-info"><span id="vocal-pitch-reference"></span><output id="vocal-trim-duration"></output><button id="vocal-loop" aria-pressed="false">Sustain</button></div>
    <div class="vocal-status-row"><span id="vocal-sample-status" class="vocal-status" role="status"></span><button id="vocal-retry" hidden>Retry sample</button></div>
    <div class="acid-controls vocal-controls">${CONTROLS.filter(
      (control) => control.parameter !== "gain",
    )
      .map((control) => {
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
      })
      .join("")}</div>
    <details class="instrument-section instrument-sequence-section" open><summary>Sequence</summary><div class="follow-chord-controls"><button id="vocal-follow-chords" aria-pressed="false">Follow chords</button><output class="follow-chord-context" id="vocal-chord-context"></output><button id="vocal-edit-chords">Edit chords</button></div><div class="vocal-rhythms waveform-switch" role="group" aria-label="Vocal rhythm">${VOCAL_PATTERNS.map((item) => `<button data-vocal-pattern="${item.id}">${item.label}</button>`).join("")}</div>
    <div id="vocal-pattern-controls" class="instrument-pattern-controls"></div>
    <div class="vocal-roll-tools"><div class="vocal-octaves" role="group" aria-label="Vocal pitch view"><button data-vocal-octave="-1" aria-label="Lower vocal pitch view">−</button><output id="vocal-octave-label"></output><button data-vocal-octave="1" aria-label="Raise vocal pitch view">+</button></div><output id="vocal-selected-note">Select a note</output><div class="vocal-note-actions" role="group" aria-label="Selected vocal note"><button data-vocal-note-action="shorter" aria-label="Shorten selected vocal note">− length</button><button data-vocal-note-action="longer" aria-label="Lengthen selected vocal note">+ length</button><button data-vocal-note-action="accent" aria-pressed="false">Accent</button><button data-vocal-note-action="join">Join</button><button data-vocal-note-action="delete">Delete</button></div></div>
    <div class="vocal-roll"><canvas id="vocal-roll-canvas" aria-label="Draw vocal notes and lengths"></canvas><div id="vocal-roll-access" class="matrix-access"></div></div>
    <div class="section-footer"><span>Draw notes · Drag right edge for length</span></div></details><details class="instrument-section instrument-automation-section"><summary>Automation</summary><div id="vocal-automation"></div></details>`;
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
        options.getTrack().recording?.rootNote ??
          catalog?.samples[options.getTrack().sound]?.rootNote ??
          60,
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
    getLane: (parameter) => {
      const lane = options.getTrack().automation[parameter];
      return parameter === "gain" && !hostSupportsGain
        ? (lane?.slice() ?? null)
        : lane;
    },
    setLane: (parameter, values) => {
      if (parameter === "gain" && !hostSupportsGain) return;
      options.getTrack().automation[parameter] = values;
    },
    getBase: (parameter) => normalizedVocalValue(options.getTrack(), parameter),
    getScale: options.getScale,
    getMuted: () => options.getTrack().muted,
    getTiming: () => options.getTrack().timing,
    getAutomationBars: () => options.getTrack().automationBars,
    onAutomationBarsChange: (bars) => {
      Object.assign(
        options.getTrack(),
        resizeVocalAutomation(options.getTrack(), bars),
      );
      render();
      options.onChange();
    },
    getSteps: () => vocalStepNotes(options.getTrack()),
    getContextSteps: (timing) => {
      const track = options.getTrack(),
        count = trackStepCount(track.timing),
        steps = vocalStepNotes(track);
      return Array.from({ length: trackStepCount(timing) }, (_, index) => {
        const local = index % count,
          step = steps[local] ?? {
            note: 60,
            on: false,
            accent: false,
            slide: false,
          };
        const held = track.notes.find(
          (note) => local >= note.start && local < note.start + note.length,
        );
        if (!track.followChords || !held) return step;
        const onset = index - local + held.start;
        return {
          ...step,
          note: vocalProgressionNote(
            held.note,
            options.getScale(),
            options.getProgression(),
            swungTick(
              onset * ticksPerStep(track.timing),
              currentSwing,
              track.timing.grid,
            ),
            currentSwing,
          ),
        };
      });
    },
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
    sequenceViews: true,
    onViewportChange: (viewport) => roll.setViewport(viewport),
    onChange: options.onChange,
  });
  function renderChordContext(): void {
    const output = container.querySelector<HTMLElement>("#vocal-chord-context");
    if (!output) return;
    output.hidden = !options.getTrack().followChords;
    const progression = options.getProgression();
    output.textContent = progressionChordLabel(
      progression,
      options.getScale(),
      progressionChordAtTick(
        progression,
        Math.max(0, currentTick),
        currentSwing,
      ),
    );
  }
  function renderRecordingControls(): void {
    if (destroyed) return;
    const record =
        container.querySelector<HTMLButtonElement>("#vocal-record-mic"),
      stop = container.querySelector<HTMLButtonElement>("#vocal-record-stop"),
      cancel = container.querySelector<HTMLButtonElement>(
        "#vocal-record-cancel",
      ),
      time = container.querySelector("#vocal-record-time"),
      message = container.querySelector("#vocal-record-message"),
      list = container.querySelector("#vocal-recording-list");
    const active = recordingStatus.phase !== "idle";
    if (record) {
      record.hidden = active;
      record.disabled = recordingBusy;
    }
    const importer =
      container.querySelector<HTMLButtonElement>("#vocal-import-wav");
    if (importer) importer.disabled = recordingBusy || active;
    if (stop) stop.hidden = recordingStatus.phase !== "recording";
    if (cancel) cancel.hidden = !active;
    if (time)
      time.textContent =
        recordingStatus.phase === "requesting"
          ? "Allow microphone access"
          : recordingStatus.phase === "processing"
            ? "Saving…"
            : recordingStatus.phase === "recording"
              ? `${recordingStatus.seconds.toFixed(1)} / 10 s`
              : "";
    if (message) message.textContent = recordingMessage;
    if (!list) return;
    list.replaceChildren();
    for (const entry of recordings) {
      const row = document.createElement("div");
      row.className = "vocal-recording-row";
      const name = document.createElement("span");
      name.textContent = `${entry.sample.name} · ${entry.sample.duration.toFixed(1)} s`;
      row.append(name);
      for (const [action, label] of [
        ["use", options.getSessionActive?.() ? "Use in session" : "Use"],
        ["download", "Download"],
        ["delete", "Delete from device"],
        ...(entry.upload ? [["unshare", "Delete shared copy"]] : []),
      ]) {
        if (!action || !label) continue;
        const button = document.createElement("button");
        button.dataset.recordingAction = action;
        button.dataset.recordingId = entry.sample.id;
        button.textContent = label;
        button.disabled = recordingBusy || active;
        if (action === "use")
          button.setAttribute(
            "aria-pressed",
            String(
              options.getTrack().recording?.sha256 === entry.sample.sha256,
            ),
          );
        row.append(button);
      }
      list.append(row);
    }
  }
  async function refreshRecordings(): Promise<void> {
    try {
      const next = await listRecordings();
      if (!destroyed) recordings = next;
    } catch (error) {
      if (!destroyed)
        recordingMessage =
          error instanceof Error
            ? error.message
            : "Recordings could not be read.";
    }
    renderRecordingControls();
  }
  async function useRecording(sample: CustomSample): Promise<void> {
    if (options.onUseRecording) await options.onUseRecording(sample);
    else if (options.getSessionActive?.())
      throw new Error("Leave the session before using a local recording.");
    else {
      const track = options.getTrack();
      track.recording = sample;
      track.muted = false;
      options.onChange();
    }
    if (!destroyed) render();
  }
  async function recordingAction(action: string, id: string): Promise<void> {
    if (recordingBusy || recordingStatus.phase !== "idle") return;
    const record = recordings.find((entry) => entry.sample.id === id);
    if (!record) return;
    recordingBusy = true;
    recordingMessage =
      action === "use" && options.getSessionActive?.()
        ? "Uploading recording…"
        : "";
    renderRecordingControls();
    try {
      if (action === "use") await useRecording(record.sample);
      else if (action === "download") {
        const url = URL.createObjectURL(record.blob),
          link = document.createElement("a");
        link.href = url;
        link.download = `${record.sample.name.replace(/[^a-zA-Z0-9_-]/g, "-")}.wav`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (action === "delete") {
        await deleteLocalRecording(id);
        const track = options.getTrack();
        if (track.recording?.kind === "local" && track.recording.id === id) {
          track.recording = null;
          track.muted = true;
          options.onChange();
        }
      } else if (action === "unshare") {
        await deleteSharedRecording(record, controller.signal);
        recordingMessage =
          "Shared copy deleted. Downloaded copies remain on their devices.";
      }
      if (action !== "unshare") recordingMessage = "";
      await refreshRecordings();
    } catch (error) {
      if (!destroyed)
        recordingMessage =
          error instanceof Error
            ? error.message
            : "The recording could not be changed.";
    } finally {
      recordingBusy = false;
      if (!destroyed) render();
    }
  }
  async function acceptRecording(
    blob: Blob,
    name: string,
    signal?: AbortSignal,
    target = captureTarget,
  ): Promise<void> {
    const sample = await storeCapturedRecording(blob, name);
    if (signal?.aborted) {
      await deleteLocalRecording(sample.id);
      return;
    }
    if (destroyed) return;
    recordingMessage = options.getSessionActive?.()
      ? "Saved on this device. Use in session uploads this recording."
      : "Saved on this device.";
    await refreshRecordings();
    const track = options.getTrack();
    if (
      !signal?.aborted &&
      !options.getSessionActive?.() &&
      target?.track === track &&
      target.key === vocalSourceKey(track.sound, track.recording)
    )
      await useRecording(sample);
  }
  async function importFile(): Promise<void> {
    const input = container.querySelector("#vocal-import-file");
    if (
      !(input instanceof HTMLInputElement) ||
      !input.files?.[0] ||
      recordingBusy
    )
      return;
    const file = input.files[0];
    input.value = "";
    recordingBusy = true;
    renderRecordingControls();
    const track = options.getTrack(),
      target = { track, key: vocalSourceKey(track.sound, track.recording) };
    try {
      await acceptRecording(
        await normalizeImportedWav(file),
        file.name
          .replace(/\.wav$/i, "")
          .trim()
          .slice(0, 40) || "Recording",
        controller.signal,
        target,
      );
    } catch (error) {
      if (!destroyed)
        recordingMessage =
          error instanceof Error
            ? error.message
            : "Use a mono 24 kHz, 16-bit PCM WAV between 0.05 and 10 seconds.";
    } finally {
      recordingBusy = false;
      renderRecordingControls();
    }
  }
  const recorder = createSampleRecorder({
    onState: (status) => {
      recordingStatus = status;
      if (status.phase === "idle") captureTarget = null;
      renderRecordingControls();
    },
    onError: (message) => {
      recordingMessage = message;
      renderRecordingControls();
    },
    onComplete: (blob, signal) =>
      acceptRecording(blob, `Recording ${recordings.length + 1}`, signal),
  });
  const unsubscribeRecordings = subscribeRecordings(() => {
    void refreshRecordings();
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
        String(
          !options.getTrack().recording &&
            Number(button.dataset.vocalSound) === options.getTrack().sound,
        ),
      );
  }
  function displayControl(control: InstrumentControl<VocalParameter>): void {
    const element = container.querySelector<HTMLElement>(
      `#vocal-${control.parameter}`,
    );
    const normalized = options.getTrack()[control.parameter];
    const value = control.min + normalized * (control.max - control.min);
    const display = control.format?.(normalized) ?? `${Math.round(value)}%`;
    element?.setAttribute("aria-valuenow", String(value));
    element?.setAttribute("aria-valuetext", display);
    element?.style.setProperty("--knob-angle", `${-135 + normalized * 270}deg`);
    const output = container.querySelector(`#vocal-${control.parameter}-value`);
    if (output) output.textContent = display;
  }
  function renderWaveform(): void {
    const track = options.getTrack(),
      sample = track.recording ?? catalog?.samples[track.sound];
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
      path.getAttribute("data-source-key") !==
        vocalSourceKey(track.sound, track.recording)
    ) {
      const waveformGain = track.recording
        ? recordingNormalizationGain(Math.max(...sample.peaks))
        : 1;
      const peaks = sample.peaks.map((peak) => peak * waveformGain);
      const upper = peaks
        .map(
          (peak, index) =>
            `${(index * 1000) / (sample.peaks.length - 1)},${50 - peak * 45}`,
        )
        .join(" L ");
      const lower = [...peaks]
        .reverse()
        .map(
          (peak, index) =>
            `${((sample.peaks.length - 1 - index) * 1000) / (sample.peaks.length - 1)},${50 + peak * 45}`,
        )
        .join(" L ");
      path.setAttribute("d", `M ${upper} L ${lower} Z`);
      path.setAttribute(
        "data-sound",
        track.recording
          ? `recording:${track.recording.id}`
          : String(track.sound),
      );
      path.setAttribute(
        "data-source-key",
        vocalSourceKey(track.sound, track.recording),
      );
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
        ? "pitch" in sample && sample.pitch?.kind === "tuned-chop"
          ? `Tuned ${noteName(sample.rootNote)}`
          : "pitch" in sample && sample.pitch?.kind === "source-key"
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
    const track = options.getTrack();
    const current = status?.sourceKey
      ? status.sourceKey === vocalSourceKey(track.sound, track.recording)
        ? status
        : null
      : !track.recording && status?.sound === track.sound
        ? status
        : null;
    const message =
      (!track.recording ? catalogError : "") ||
      (current?.phase === "loading"
        ? "Loading sample…"
        : current?.phase === "error"
          ? current.message
          : !catalog && !track.recording
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
  function renderGainCapability(): void {
    const gain = container.querySelector("#vocal-gain");
    gain?.setAttribute("aria-disabled", String(!hostSupportsGain));
    const warning = container.querySelector<HTMLElement>(
      "#vocal-gain-capability",
    );
    if (warning) warning.hidden = hostSupportsGain;
    if (automationContainer)
      automationContainer.inert =
        !hostSupportsGain &&
        Boolean(gain?.classList.contains("automation-selected"));
  }
  function renderHostCapability(): void {
    const warning = container.querySelector<HTMLElement>(
      "#vocal-host-capability",
    );
    if (!warning) return;
    const track = options.getTrack(),
      newSound = track.sound >= 24;
    warning.hidden =
      hostSupportsVocal &&
      (!newSound || hostSupportsMusic) &&
      (!track.recording || hostSupportsComposition);
    warning.textContent =
      track.recording && !hostSupportsComposition
        ? "The host needs updated Grain to play recordings."
        : newSound && !hostSupportsMusic
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
    renderRecordingControls();
    renderChordContext();
    container
      .querySelector("#vocal-mute")
      ?.setAttribute("aria-pressed", String(track.muted));
    container
      .querySelector("#vocal-loop")
      ?.setAttribute("aria-pressed", String(track.loop));
    container
      .querySelector("#vocal-follow-chords")
      ?.setAttribute("aria-pressed", String(track.followChords));
    roll.refresh();
    automation.refresh(true);
    renderGainCapability();
  }
  function updateControl(id: string, value: number): boolean {
    const control = CONTROLS.find(
      (control) => `vocal-${control.parameter}` === id,
    );
    if (!control) return false;
    if (
      !Number.isFinite(value) ||
      (control.parameter === "gain" && !hostSupportsGain)
    )
      return true;
    const track = options.getTrack(),
      before = normalizedVocalValue(track, control.parameter);
    Object.assign(
      track,
      setVocalValue(
        track,
        control.parameter,
        (value - control.min) / (control.max - control.min),
      ),
    );
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
      options.getTrack().recording = null;
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
      const sample = track.recording ?? catalog?.samples[track.sound];
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
    if (button.id === "vocal-follow-chords") {
      options.getTrack().followChords = !options.getTrack().followChords;
      render();
      options.onChange();
      return;
    }
    if (button.id === "vocal-edit-chords") {
      options.onProgressionEdit?.();
      return;
    }
    if (button.id === "vocal-record-mic") {
      recordingMessage = "";
      const track = options.getTrack();
      captureTarget = {
        track,
        key: vocalSourceKey(track.sound, track.recording),
      };
      void recorder.start();
      return;
    }
    if (button.id === "vocal-import-wav") {
      const input = container.querySelector("#vocal-import-file");
      if (input instanceof HTMLInputElement) input.click();
      return;
    }
    if (button.id === "vocal-record-stop") {
      recorder.stop();
      return;
    }
    if (button.id === "vocal-record-cancel") {
      recorder.cancel();
      return;
    }
    if (button.dataset.recordingAction && button.dataset.recordingId) {
      void recordingAction(
        button.dataset.recordingAction,
        button.dataset.recordingId,
      );
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
  container
    .querySelector("#vocal-import-file")
    ?.addEventListener("change", importFile);
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
  void refreshRecordings();
  return {
    render,
    refreshAutomation: () => {
      automation.refresh();
      renderWaveform();
    },
    setPosition: (tick: number, swing: number) => {
      currentTick = tick;
      currentSwing = swing;
      renderChordContext();
      roll.setPosition(tick, swing);
      automation.setPosition(tick, swing);
    },
    setStep: (step: number) => {
      const tick = step < 0 ? -1 : (step * PPQ) / 4;
      currentTick = tick;
      currentSwing = 0;
      renderChordContext();
      roll.setPosition(tick, 0);
      automation.setPosition(tick, 0);
    },
    updateControl,
    activateControl: (id: string, reveal = true) => {
      if (id === "vocal-gain" && !hostSupportsGain) return true;
      const activated = automation.activateControl(id, reveal);
      renderGainCapability();
      return activated;
    },
    rebaseIncoming: (next: VocalTrack) => {
      roll.rebaseIncoming(next);
      automation.rebaseIncoming(
        (parameter) => next.automation[parameter],
        next.timing,
        next.automationBars,
      );
    },
    setSampleStatus: (next: VocalSampleStatus) => {
      status = next;
      renderStatus();
    },
    setHostCapability: (
      supported: boolean,
      music = supported,
      composition = music,
      gain = composition,
    ) => {
      hostSupportsVocal = supported;
      hostSupportsMusic = music;
      hostSupportsComposition = composition;
      hostSupportsGain = gain;
      renderGainCapability();
      renderHostCapability();
    },
    destroy: () => {
      endTrim();
      destroyed = true;
      controller.abort();
      recorder.destroy();
      unsubscribeRecordings();
      roll.destroy();
      automation.destroy();
      container.removeEventListener("click", click);
      container
        .querySelector("#vocal-import-file")
        ?.removeEventListener("change", importFile);
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
