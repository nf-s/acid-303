# Grain

A local-first drum machine, 303-inspired bass sequencer, percussion Texture instrument, arpeggiator and sustained chord pads. Audio is synthesized in the browser using Web Audio. Solo projects are saved in this browser. Shared sessions synchronize musical state through Cloudflare; audio stays on the host device and is never streamed.

## Development

Run `npm install`, then `npm run dev`. `npm run build` checks TypeScript and creates the static `dist/` output. Run `npm test` for unit checks, `npm run test:e2e` for desktop and touch browser checks (requires Chrome), and `npm run format` before committing. Node 22.12 or later is required. For shared-session browser tests, also run `npm ci` and `npm run dev` inside `workers/sessions`; its isolated tools use Node 24 and serve port 8787. See [session architecture, costs and release steps](docs/sessions.md).

## Structure

- `src/model.ts` and `src/timing.ts`: validated project schema, scale locking, per-instrument timing and migrations.
- `src/presets.ts`: twenty authored genre examples with distinct sound palettes and automation.
- `src/audio.ts`: browser audio synthesis, timing and WAV rendering.
- `src/visualizer.ts` and `src/visualizer-palettes.ts`: drum-pattern-driven full-page fluid distortion and colour palettes.
- `src/beat-canvas.ts`: multi-pointer beat painting and rendering.
- `src/note-matrix.ts`: scale-locked pitch curves and gate/accent/glide drawing.
- `src/drum-editor.ts`: simple drum grid controls and expanded per-drum automation matrices.
- `src/history.ts` and `src/share.ts`: grouped project Undo/Redo and validated compressed track links.
- `src/arp-model.ts`, `src/arp-audio.ts`, `src/arp-panel.ts`: scale-locked arpeggiator sequencing, synthesis and controls.
- `src/pad-model.ts`, `src/pad-audio.ts`, `src/pad-panel.ts`: multi-bar chord progressions, sustained pad synthesis and controls.
- `src/gestures.ts`: drag, keyboard and double-tap controls.
- `src/pattern-controls.ts`: per-instrument timing disclosures, page navigation and playback follow.
- `src/studio-navigation.ts` and `src/track-mixer.ts`: instrument navigation, header disclosures and shared level/mute controls.
- `src/motion-controls.ts`: phone sensor permission and Tilt, Move and Twist controls.
- `src/session-client.ts`, `src/session-sync.ts` and `src/session-protocol.ts`: authenticated live rooms, ordered field updates and reconnect recovery.
- `src/instrument-automation.ts`: shared Arp and Pad drawing controls.
- `workers/sessions`: Cloudflare Worker and SQLite Durable Objects for shared sessions.
- `src/main.ts` and `src/style.css`: interface and interaction.

Use strict TypeScript without type assertions or non-null assertions. Validate persisted data at its boundary using the shared schema. Keep rendering, audio and visualizer responsibilities separate. The design follows the operator’s monochrome retro direction: bevelled chrome, black/white surfaces and full-page reactive inversion. Keep sound controls beside the beat canvas. Use direct sound buttons and vertical gestures rather than dropdowns. Do not add slogans or decorative copy.

Interface and canvas labels use locally bundled IBM Plex Mono. The GRAIN title uses original animated vector lettering, developed from the modular [Techno Vibe reference](https://designfamilymarket.gumroad.com/l/bashw).

## Controls

The sticky header keeps Play and three performance dials available. Track controls opens tempo, swing, crunch, master level, scale, history, sharing, sessions, motion and export. Mixer opens nine instrument level faders and mute buttons; these control the same saved levels and mutes as the individual instruments. Bottom navigation jumps directly between instruments, and View opens visualizer controls. Existing sound knobs retain their size.

Sweep is a low-pass filter to the left and a high-pass filter to the right. Space adds a short room to the left and a long reverb wash to the right. Dub echo gives short triplet repeats to the left and dotted repeats to the right. These larger dials accept vertical or horizontal dragging and multiple fingers. The centre is off; double-tap resets to the centre. They are saved and shared, and included in WAV export, but are not automated.

Press Play or Space to start and stop. Remix generates a new drum pattern, bass line and Texture pattern, starts playback, and can be reversed with Undo.

Drag across the drum canvas to paint steps. Begin on a filled cell to erase; fast strokes interpolate across every crossed cell. Multiple fingers can paint and adjust a dial simultaneously. Tapping a lane or instrument tab brings that drum’s sound buttons and eight controls beside the canvas. Simple mode keeps the combined grid; Advanced expands all five drums into separate matrices. Tap any drum knob to draw its automation, or choose Gates to paint the rhythm. Painting while stopped previews the drum sound.

The root and scale controls at the top lock bass notes, Texture notes and pitched drum tuning to the selected scale. Choose Major, Minor, Dorian, Phrygian or Pentatonic. Changing scale moves existing notes to the nearest allowed pitch. Loading an example preserves your selected scale; Remix and new-pattern actions remain in scale too. Tonal Stab and Dub chords follow the scale's degrees.

Drag dials upward/downward to raise/lower their value. Hold Shift for finer movement. Double-tap to reset. Keyboard controls use arrows, Page Up/Down and Home/End. Drum pitch advances through allowed scale intervals. Drum-grid keyboard navigation uses arrow keys and Enter/Space.

On a phone, enable Motion and allow sensor access if requested. Hold a knob, then tilt forwards/back or sideways to adjust it; release to keep the value. Tilt is the default. Move responds to linear movement along any axis; Twist retains rotation control. Modes have independent baselines and do not carry motion across a pause or mode change. Finger dragging still works at the same time. Motion changes only held knobs, including automated controls, and stops when disabled or the page is left. Devices without motion data keep the regular controls. Sensor access uses the browser’s [DeviceMotion permission API](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static).

Bass and Texture each have a pitch matrix. Choose Pitch, Gate, Accent or Glide, then draw across the steps. Pitch draws notes in scale and enables their gates. In the other modes, drawing above the middle enables values and drawing below disables them. Glide enables and joins the immediately following step, including the loop boundary. Line draws a straight contour from the start to the release point; dragging back restores values outside the final line. Undo restores the previous stroke. Generating a new pattern clears drawing Undo. The parameter-lane approach follows the [Reason Matrix interaction](https://docs.reasonstudios.com/reason13/matrix-pattern-sequencer).

All note attributes remain visible together: pitch contours, gate bars, accent diamonds and curved glide ties. The selected attribute is brighter and thicker. The fluid visualizer passes over every interface element, including transport, labels, knobs, matrices and the visualizer controls.

Tap any instrument knob, or focus it and press Enter/Space, to draw its automation in that instrument’s matrix. All five drums, Bass, Texture, Arpeggiator and Chord pads have eight controls and eight independent curves (72 lanes in total). Draw and Line work without changing notes or gates. Clear curve returns to the knob’s base value; Undo restores the previous curve, including an empty lane. Dragging an automated knob shifts the whole curve, bounded by its range. Automated knobs have an outer live-value marker that moves during playback while the base pointer remains editable. The marker follows the host clock in shared sessions and clears when stopped. Curves are saved with the pattern and used during playback and WAV export. Drum pitch curves follow the selected scale. Bass Pulse changes its articulation; Texture Width and Attack control stereo spread and transient softness. Drum Pan, Attack and Space add positioning, transient shaping and echoes.

Each matrix page fits on a phone. Timing opens independent bars, meter and grid settings for every drum, Bass, Texture, Arp and Pads. Sequence instruments support 1, 2, 4 or 8 bars; Pads support 2, 4, 8 or 16. Choose 4/4, 3/4, 5/4, 6/8 or 7/8 and straight or triplet sixteenths. Page buttons scroll horizontally outside the drawing surface, with up to 16 straight or 12 triplet cells per page; pages never cross bar boundaries. Follow advances pages with playback. Choosing a page, drawing or keyboard editing freezes Follow until it is re-enabled. Adding bars repeats existing material; shortening keeps the beginning and can be undone. Meter/grid changes map events by beat time and resize curves alongside them.

Multiple fingers can draw independent curves. Drag outside a drawing surface to scroll the page. Keyboard focus moves between matrix steps with Left/Right; Up/Down edits the selected parameter, Home/End chooses its limits, and Enter/Space toggles its gate.

Bass includes Round, Knock, Acid, Drive, Bloom, Fog, Rubber, Reese and Pressure, with a different profile assigned to each genre example. Shape changes each profile’s harmonic character, and Drive adds local saturation. Texture includes Impact, Haze, Stab, Scatter, Dub and Frost: pitched strikes, atmospheric noise, chord percussion and granular textures. Grit adds crunch and Motion adds modulation. Each drum has five sounds, with Tone and Drive beside its pitch, decay and level. Crunch uses compensated parallel saturation. WAV export follows independent loops and includes a complete common cycle when it fits within 128 quarter-note beats. Longer polymeters export the longest active cycle instead, labelled as an excerpt in the export tooltip. Every export includes instrument releases and performance-effect tails.

The Arpeggiator plays your selected notes in Up, Down, Up/down, Played or deterministic Random order. Note buttons show their Played order. Choose 1/8, 1/16, 1/16 triplets or 1/32, one to three octaves, and per-step gates and accents. Rate sets note intervals independently of the editable gate grid. Swing follows that grid: Triplet gives rigid triplets; Straight keeps the swung timing. Pluck, Pulse, Glass, Acid, Reed and Dust each have eight controls. Clicking a sound or selecting a note enables the arpeggiator; M mutes it. Timing and order follow familiar [Ableton](https://www.ableton.com/en/manual/live-midi-effect-reference/) and [Arturia](https://support.arturia.com/hc/en-us/articles/23309705010716-KeyStep-mk2-Control-Modes) arpeggiator controls.

Chord pads play four sustained chords over 2, 4, 8 or 16 bars. Choose a progression, then select a chord card to edit its scale degree and inversion. The exact notes appear on each card. Velvet, Air, Choir, Glass, Dust and Drone provide six textures with eight controls. Enable pads with On; the transport and chord cards show the current bar and chord. The chord timeline shows each chord’s bar or beat span, with degree and inversion controls beside the selected chord. Progression presets open with Progressions. Arp automation follows its own pattern length. Pad automation spans the full progression with one editable point per grid cell. Existing 16-point pad curves migrate without changing their former playback values. Both instruments follow the global scale and are included in saving, history and sharing. Upgrading an existing project leaves them muted.

Twenty genre examples sit above the instrument sections in a compact horizontal strip. Swipe horizontally or use the side arrows to browse. Vertical swipes within the strip do not move the page; scrolling remains available outside it. Drawing gestures do not intercept this strip. House and Tech house preserve their original musical settings. The other eight original examples use fewer active layers: Techno has short, low-resonance Knock bass; Melodic techno pairs a restrained one-octave arp with sub; atmospheric techno leaves room for Frost and slow pads; Bass house focuses on Pressure bass and drums.

Genre examples:

| Name        | Genre                           |
| ----------- | ------------------------------- |
| Afterhours  | House                           |
| Lowline     | Tech house                      |
| Contact     | Techno                          |
| Transit     | Driving techno                  |
| Halflight   | Melodic techno                  |
| Drift       | Experimental atmospheric techno |
| Side Street | Garage                          |
| Undertow    | Speed garage                    |
| Crosscut    | Jungle                          |
| Offset      | Bass house                      |
| Vapour      | Dub techno                      |
| Relay       | Electro                         |
| Pinpoint    | Microhouse                      |
| Stillwater  | Deep techno                     |
| Etch        | Acid techno                     |
| Meridian    | Detroit techno                  |
| Ferrite     | Industrial techno               |
| Blue Hour   | Ambient breaks                  |
| Stagger     | Broken beat                     |
| Sublevel    | UK bass                         |

The visualizer uses organic fluid motion and fine film grain, driven directly by the programmed drum steps even with master volume at zero. Motion is enabled by default, including when the system requests reduced motion, as explicitly requested for this instrument. Intensity starts at 30% and changes overlay opacity without reducing movement; zero hides it. Swirl increases vortex deformation and circulation speed; zero preserves the original motion exactly. Swirl is saved locally, and double-tap resets it to zero. Pause freezes both fluid and grain. Colour opens direct swatches for Mono, Cobalt, Violet, Ember and Rainbow. Mono remains the default and renders identically to the original visualizer; Rainbow continuously changes hue with the fluid and freezes when motion pauses. Palette selection is saved locally on each device and is independent of shared musical state. Tap the fullscreen visual surface anywhere to exit; the toolbar remains available for colour, intensity and motion. A Canvas fallback supports every palette without WebGL.

Global Undo and Redo restore whole projects, including example changes, notes, sounds and automation. One continuous gesture is one history entry. Use the header buttons or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (Ctrl+Y also redoes). The session retains up to 100 edits.

Share creates a compressed, URL-safe track link in the URL fragment. The recipient loads the full musical project, including automation, without an account. Opening a shared track saves an editable copy in this browser. The link contains a snapshot; later edits do not change a link already shared. Incoming links are size-limited, decompressed with a bound and validated through the existing project schema.

Use Session → Create session → Copy invite to share live control. A room supports one host and up to seven guests for 24 hours, or until the host ends it. Guests edit the same musical project and control transport while remaining silent. The host must keep the tab open; after a reload, press Play on that device to unlock audio. Connection loss pauses editing, stops host playback and reconnects without promoting a guest. Returning from a disconnect does not restart audio automatically. Invite links grant editing access; snapshot Share links remain independent.

Solo patterns stay on the same device and browser. Old saves upgrade automatically: cowbell becomes rimshot, Texture is added where missing, and saved notes are snapped to the chosen scale. Missing scale settings default to A minor. Valid pitches, patterns, sound selections and expression settings are preserved.

## Deployment

Public app: https://acid-303.pages.dev/. No account or sign-in is required. Release instructions are in [docs/deployment.md](docs/deployment.md).
