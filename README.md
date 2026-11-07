# Grain

A local-first drum machine, 303-inspired bass sequencer and percussion Texture instrument. Audio is synthesized in the browser using Web Audio. Patterns are saved in this browser; no audio or patterns are sent to a server.

## Development

Run `npm install`, then `npm run dev`. `npm run build` checks TypeScript and creates the static `dist/` output. Run `npm test` for unit checks, `npm run test:e2e` for desktop and touch browser checks (requires Chrome), and `npm run format` before committing. Node 22.12 or later is required.

## Structure

- `src/model.ts`: validated project schema, scale locking, shared types and sequencer timing.
- `src/presets.ts`: nine authored genre examples.
- `src/audio.ts`: browser audio synthesis, timing and WAV rendering.
- `src/visualizer.ts`: monochrome, drum-pattern-driven full-page distortion.
- `src/beat-canvas.ts`: multi-pointer beat painting and rendering.
- `src/note-matrix.ts`: scale-locked pitch curves and gate/accent/glide drawing.
- `src/gestures.ts`: vertical drag, keyboard and double-tap controls.
- `src/main.ts` and `src/style.css`: interface and interaction.

Use strict TypeScript without type assertions or non-null assertions. Validate persisted data at its boundary using the shared schema. Keep rendering, audio and visualizer responsibilities separate. The design follows the operator’s monochrome retro direction: bevelled chrome, black/white surfaces and full-page reactive inversion. Keep sound controls beside the beat canvas. Use direct sound buttons and vertical gestures rather than dropdowns. Do not add slogans or decorative copy.

## Controls

Press Play or Space to start and stop. Remix generates a new drum pattern, bass line and Texture pattern, starts playback, and can be reversed with Undo.

Drag across the drum canvas to paint steps. Begin on a filled cell to erase; fast strokes interpolate across every crossed cell. Multiple fingers can paint and adjust a dial simultaneously. Tapping a lane or instrument tab brings that drum’s sound buttons, pitch, decay and level beside the canvas. Painting while stopped previews the drum sound.

The root and scale controls at the top lock bass notes, Texture notes and pitched drum tuning to the selected scale. Choose Major, Minor, Dorian, Phrygian or Pentatonic. Changing scale moves existing notes to the nearest allowed pitch. Loading an example preserves your selected scale; Remix and new-pattern actions remain in scale too. Tonal Stab and Dub chords follow the scale's degrees.

Drag dials upward/downward to raise/lower their value. Hold Shift for finer movement. Double-tap to reset. Keyboard controls use arrows, Page Up/Down and Home/End. Drum pitch advances through allowed scale intervals. Drum-grid keyboard navigation uses arrow keys and Enter/Space.

Bass and Texture each have a taller 16-step matrix. Choose Pitch, Gate, Accent or Glide, then draw across the steps. Pitch draws notes in scale and enables their gates. In the other modes, drawing above the middle enables values and drawing below disables them. Glide enables and joins the immediately following step, including the loop boundary. Line draws a straight contour from the start to the release point; dragging back restores values outside the final line. Undo restores the previous stroke. Generating a new pattern clears drawing Undo. The parameter-lane approach follows the [Reason Matrix interaction](https://docs.reasonstudios.com/reason13/matrix-pattern-sequencer).

The entire matrix fits on a phone. Multiple fingers can draw independent curves. Drag outside a drawing surface to scroll the page. Keyboard focus moves between matrix steps with Left/Right; Up/Down edits the selected parameter, Home/End chooses its limits, and Enter/Space toggles its gate.

Texture includes Impact, Haze, Stab, Scatter, Dub and Frost: pitched strikes, atmospheric noise, chord percussion and granular textures. Each drum has five sounds. All voices retain pitch, decay, tone and/or level controls appropriate to the instrument. Crunch uses compensated parallel saturation. WAV export includes two bars and the full sound/reverb/delay tail.

Genre examples:

| Name           | Genre                           |
| -------------- | ------------------------------- |
| Sunday Socks   | House                           |
| Pocket Disco   | Tech house                      |
| Little Machine | Techno                          |
| Night Train    | Driving techno                  |
| Moon Jelly     | Melodic techno                  |
| Cloud Goblin   | Experimental atmospheric techno |
| Velvet Steps   | Garage                          |
| Turbo Biscuit  | Speed garage                    |
| Jungle Gym     | Jungle                          |

The visualizer uses organic fluid motion and fine film grain, driven directly by the programmed drum steps even with master volume at zero. Motion is enabled by default, including when the system requests reduced motion, as explicitly requested for this instrument. Intensity starts at 30% and changes overlay opacity without reducing movement; zero hides it. Pause freezes both fluid and grain. A Canvas fallback works without WebGL.

Patterns stay on the same device and browser. Old saves upgrade automatically: cowbell becomes rimshot, Texture is added where missing, and saved notes are snapped to the chosen scale. Missing scale settings default to A minor. Valid pitches, patterns, sound selections and expression settings are preserved.

## Deployment

Public app: https://acid-303.pages.dev/. No account or sign-in is required. Release instructions are in [docs/deployment.md](docs/deployment.md).
