# ACID 303

A local-first drum machine and 303-inspired bass sequencer. Audio is synthesized in the browser using Web Audio. Patterns are saved in this browser; no audio or patterns are sent to a server.

## Development

Run `npm install`, then `npm run dev`. `npm run build` checks TypeScript and creates the static `dist/` output. Run `npm test` for unit checks, `npm run test:e2e` for desktop and touch browser checks (requires Chrome), and `npm run format` before committing. Node 22.12 or later is required.

## Structure

- `src/model.ts`: validated project schema, shared types, presets and sequencer timing.
- `src/audio.ts`: browser audio synthesis, timing and WAV rendering.
- `src/visualizer.ts`: monochrome, audio-reactive full-page distortion.
- `src/beat-canvas.ts`: multi-pointer beat painting and rendering.
- `src/gestures.ts`: vertical drag, keyboard and double-tap controls.
- `src/main.ts` and `src/style.css`: interface and interaction.

Use strict TypeScript without type assertions or non-null assertions. Validate persisted data at its boundary using the shared schema. Keep rendering, audio and visualizer responsibilities separate. The design follows the operator’s monochrome retro direction: bevelled chrome, black/white surfaces and full-page reactive inversion. Keep sound controls beside the beat canvas. Use direct sound buttons and vertical gestures rather than dropdowns. Do not add slogans or decorative copy.

## Controls

Press Play or Space to start and stop. Remix generates a new rhythm and bass line, starts playback, and can be reversed with Undo.

Drag across the drum canvas to paint steps. Begin on a filled cell to erase; fast strokes interpolate across every crossed cell. Multiple fingers can paint and adjust a dial simultaneously. Tapping a lane or instrument tab brings that drum’s sound buttons, pitch, decay and level beside the canvas. Painting while stopped previews the drum sound.

Drag controls upward/downward to raise/lower their value. Hold Shift for finer movement. Double-tap to reset. Keyboard controls use arrows, Page Up/Down and Home/End. Drum-grid keyboard navigation uses arrow keys and Enter/Space. Bass pitches are draggable note cells; gate, accent and slide remain direct toggles.

The full-page visualizer follows the audio and inverts the interface spatially as it moves. Intensity zero hides it; motion can be paused. It respects reduced-motion preferences. No rapid strobe effect is used.

All drum steps fit on a phone. Swipe the bass sequence to reach later notes. Playback stays accessible while scrolling. WAV export includes two bars and a 1.6-second release tail. Saved patterns stay on the same device and browser.

## Deployment

Public app: https://acid-303.pages.dev/. No account or sign-in is required. Release instructions are in [docs/deployment.md](docs/deployment.md).
