# ACID 303

A local-first drum machine and 303-inspired bass sequencer. Audio is synthesized in the browser using Web Audio. Patterns are saved in this browser; no audio or patterns are sent to a server.

## Development

Run `npm install`, then `npm run dev`. `npm run build` checks TypeScript and creates the static `dist/` output. Run `npm test` for unit checks, `npm run test:e2e` for desktop and touch browser checks (requires Chrome), and `npm run format` before committing. Node 22.12 or later is required.

## Structure

- `src/model.ts`: validated project schema, shared types, presets and sequencer timing.
- `src/audio.ts`: browser audio synthesis, timing and WAV rendering.
- `src/visualizer.ts`: audio-reactive fluid canvas visualizer.
- `src/main.ts` and `src/style.css`: interface and interaction.

Use strict TypeScript without type assertions or non-null assertions. Validate persisted data at its boundary using the shared schema. Keep rendering, audio and visualizer responsibilities separate. Use slate, cool grey and white for controls; no green theme, slogans or decorative copy.

## Controls

Press Play or Space to start and stop. Toggle drum steps to edit the rhythm. Select a drum to edit its sound, pitch, decay and level. The bass sequence has a note, gate, accent and slide per step. A slide connects into the next enabled step. Cutoff, resonance, envelope and drive shape the acid sound. Export renders the current loop as a WAV file.

The visualizer avoids rapid strobing and respects reduced-motion preferences. Its intensity and motion can be changed independently of playback.

On a phone, swipe each sequencer horizontally to reach all 16 steps. Instrument labels remain visible while scrolling. WAV export includes two bars and a 1.6-second release tail. Saved patterns stay on the same device and browser.

## Deployment

Public app: https://acid-303.pages.dev/. No account or sign-in is required. Release instructions are in [docs/deployment.md](docs/deployment.md).
