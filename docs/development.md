# Development

Run `npm install`, then `npm run dev`. `npm run build` checks TypeScript and creates the static `dist/` output. Run `npm test` for unit checks, `npm run test:e2e` for desktop and touch browser checks (requires Chrome), and `npm run format` before committing. Node 22.12 or later is required. For shared-session browser tests, also run `npm ci` and `npm run dev` inside `workers/sessions`; its isolated tools use Node 24 and serve port 8787. See [session architecture, costs and release steps](sessions.md).

## Structure

- `src/model.ts` and `src/timing.ts`: validated project schema, scale locking, per-instrument timing and migrations.
- `src/presets.ts`: twenty authored genre examples and one supplied track with distinct sound palettes and automation.
- `src/audio.ts`: browser audio synthesis, timing and WAV rendering.
- `src/mode.ts`, `src/fluff-audio.ts`, `src/fluff-presets.ts` and `src/fluff-theme.css`: the Fluff mode switch, instruments, examples and theme.
- `src/sound-family.ts` and `src/sound-family.css`: sound pickers that list both studios' sounds.
- `src/visualizer.ts` and `src/visualizer-palettes.ts`: drum-pattern-driven full-page fluid distortion and colour palettes.
- `src/beat-canvas.ts`: multi-pointer beat painting and rendering.
- `src/note-matrix.ts`: scale-locked pitch curves and gate/accent/glide drawing.
- `src/drum-editor.ts`: simple drum grid controls and expanded per-drum automation matrices.
- `src/history.ts` and `src/share.ts`: grouped project Undo/Redo and validated compressed track links.
- `src/arp-model.ts`, `src/arp-audio.ts`, `src/arp-panel.ts`: scale-locked arpeggiator sequencing, synthesis and controls.
- `src/progression-model.ts` and `src/progression-panel.ts`: shared chord timing, voicings and progression editing.
- `src/pad-model.ts`, `src/pad-audio.ts`, `src/pad-panel.ts`: sustained pad synthesis and local/shared chord controls.
- `src/sample-recorder.ts`, `src/custom-sample-store.ts` and `src/custom-samples.ts`: microphone capture, local recordings and private shared sample assets.
- `src/vocal-model.ts`, `src/vocal-audio.ts`, `src/vocal-panel.ts` and `src/vocal-roll.ts`: validated sample playback, trim controls and duration-note editing.
- `src/gestures.ts`: drag, keyboard and double-tap controls.
- `src/pattern-controls.ts`: per-instrument timing disclosures, page navigation and playback follow.
- `src/studio-navigation.ts` and `src/track-mixer.ts`: instrument navigation, header disclosures and shared level/mute controls.
- `src/motion-controls.ts`: phone sensor permission and Tilt, Move and Twist controls.
- `src/session-client.ts`, `src/session-sync.ts` and `src/session-protocol.ts`: authenticated live rooms, ordered field updates and reconnect recovery.
- `src/instrument-automation.ts`: shared automation drawing, sequence context and independent curve timing.
- `workers/sessions`: Cloudflare Worker and SQLite Durable Objects for shared sessions and bounded recording storage.
- `src/main.ts` and `src/style.css`: interface and interaction.

Use strict TypeScript without type assertions or non-null assertions. Validate persisted data at its boundary using the shared schema. Keep rendering, audio and visualizer responsibilities separate. The design follows the operator’s monochrome retro direction: bevelled chrome, black/white surfaces and full-page reactive inversion. Keep sound controls beside the beat canvas. Use direct sound buttons and vertical gestures rather than dropdowns. Do not add slogans or decorative copy.

Interface and canvas labels use locally bundled IBM Plex Mono. The centred GRAIN title uses vector outlines traced from the supplied alphabet reference, with a small adjustment to the G opening for legibility. Earlier title studies are archived in `design/title-font-studies/`; they are not shipped with the app. Title styling is independent of musical state.
