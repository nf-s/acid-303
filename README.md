# Grain

A local-first drum machine, 303-inspired bass sequencer and percussion Texture instrument. Audio is synthesized in the browser using Web Audio. Patterns are saved in this browser; no audio or patterns are sent to a server.

## Development

Run `npm install`, then `npm run dev`. `npm run build` checks TypeScript and creates the static `dist/` output. Run `npm test` for unit checks, `npm run test:e2e` for desktop and touch browser checks (requires Chrome), and `npm run format` before committing. Node 22.12 or later is required.

## Structure

- `src/model.ts`: validated project schema, shared types, presets and sequencer timing.
- `src/audio.ts`: browser audio synthesis, timing and WAV rendering.
- `src/visualizer.ts`: monochrome, drum-pattern-driven full-page distortion.
- `src/beat-canvas.ts`: multi-pointer beat painting and rendering.
- `src/gestures.ts`: vertical drag, keyboard and double-tap controls.
- `src/main.ts` and `src/style.css`: interface and interaction.

Use strict TypeScript without type assertions or non-null assertions. Validate persisted data at its boundary using the shared schema. Keep rendering, audio and visualizer responsibilities separate. The design follows the operator’s monochrome retro direction: bevelled chrome, black/white surfaces and full-page reactive inversion. Keep sound controls beside the beat canvas. Use direct sound buttons and vertical gestures rather than dropdowns. Do not add slogans or decorative copy.

## Controls

Press Play or Space to start and stop. Remix generates a new drum pattern, bass line and Texture pattern, starts playback, and can be reversed with Undo.

Drag across the drum canvas to paint steps. Begin on a filled cell to erase; fast strokes interpolate across every crossed cell. Multiple fingers can paint and adjust a dial simultaneously. Tapping a lane or instrument tab brings that drum’s sound buttons, pitch, decay and level beside the canvas. Painting while stopped previews the drum sound.

Drag controls upward/downward to raise/lower their value. Hold Shift for finer movement. Double-tap to reset. Keyboard controls use arrows, Page Up/Down and Home/End. Drum-grid keyboard navigation uses arrow keys and Enter/Space. Bass and Texture use expressive note pads: tap to toggle a note, drag vertically for pitch, scroll horizontally through the sequence, use the note’s arrow button to join or separate the next note, and hold for 420 ms to toggle accent. Joining enables the following note; ties stop at rests and can wrap from step 16 to step 1. The pad shows accent and a link to the following note. Keyboard: Up/Down changes pitch, Right joins, Left separates, A toggles accent, and Enter/Space toggles the note. Horizontal scrolling works across the whole sequence, including note pads, on touchscreens and trackpads; mouse users can drag notes sideways to scroll.

Texture sits below the bass with Impact, Haze and Stab sounds: gritty pitched percussion, diffuse atmospheric noise and a dark chord strike. Tone, Decay, Space and Level shape each sound. New pattern changes only its steps; its sound settings stay intact. The rimshot replaces the cowbell with Dry, Wood and Click sounds. Crunch uses compensated parallel saturation, and Texture plays through the clean bus.

The full-page visualizer follows the programmed drum steps directly, including when master volume is zero. Kick, snare, clap, hats and rimshot drive distinct motion in the silver fluid shapes. Intensity controls overlay opacity without reducing movement; zero hides it. Motion can be paused. Reduced-motion preferences start it paused, and Enable motion overrides that preference for the session. No rapid strobe effect is used.

All drum steps fit on a phone. Swipe the bass sequence to reach later notes. Playback stays accessible while scrolling. WAV export includes two bars and enough release time for the selected sounds and echo taps. Saved patterns stay on the same device and browser. Version 1 saves upgrade automatically: steps, pitches and bass expression are preserved, cowbell becomes rimshot, and Texture is added. Version 2 saves without expression fields load with slides and Texture accents off.

## Deployment

Public app: https://acid-303.pages.dev/. No account or sign-in is required. Release instructions are in [docs/deployment.md](docs/deployment.md).
