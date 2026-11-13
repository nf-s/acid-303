# Fluff mode

Fluff is a prototype second voice for the same studio. The Grain / Fluff switch in the title bar swaps the sound engine, effects, examples, palettes and theme; the sequencers, project schema and controls are shared. `project.mode` (`"grain"` or `"fluff"`, default `"grain"`) records which engine a project is voiced for. Each mode keeps its own saved project and palette in this browser, so switching does not overwrite the other mode's track.

## Sound

Every sound slot is reused, so saved sound numbers are valid in both modes; only the voices and names differ (`FLUFF_SOUNDS` in `src/mode.ts`).

- `src/fluff-audio.ts` holds the Fluff bus, drum kit, bass and lead. `BassVoice` in `src/audio.ts` hands every Fluff bass step to `FluffBass`.
- `src/fluff-synth.ts` is the melodic voice engine shared by the lead, arp and pads: unison oscillator stacks, FM pairs, filtered noise, key-tracked 12 or 24 dB filters with exponential envelopes, and a per-instrument rack (drive, ensemble chorus, vibrato and slow filter and pitch movement). `src/fluff-patches.ts` defines every lead, arp and pad patch as a function from the instrument's controls to a voice. `src/fluff-pad.ts` is the Fluff pad chord voice. `src/fluff-effects.ts` generates the reverb impulses and holds the ping-pong delay and melodic bus glue.
- Drums are recorded samples (`src/fluff-drums.ts`; files, sources and licences in `docs/samples.md`). Kicks: Click, Round, Deep, Tight, Acoustic, Boom and Lo-fi. Snares: House, Rimshot, Garage, Dusty, Roll, Ghost and Room. Hats: Closed, Open, Shaker, Tick, Ride, Offbeat, Dusty and Sizzle. Claps: House, Tight, Hall, Snap, Dusty, Layered and Soft. Perc: Rim, Tom, Conga, Tamb, Blip, Crash and Sweep; Blip and Sweep stay synthesized.
- Pitch sets the playback rate, Decay gates the sample (held, then faded over the last 40% of the gate), Tone tilts a 1.8 kHz shelf, then Drive, Attack, Pan, Space and a fixed per-slot hall send. Each slot carries a measured loudness and a trim, so slots in a lane are interchangeable at the same Volume.
- Kicks with a measured fundamental (Click, Round, Deep, Tight, Boom: 46–65 Hz) are retuned by playback rate to the root or fifth of the project key nearest that fundamental, at most 3.5 semitones. Acoustic and Lo-fi carry their weight at 84 Hz, so a clean sine sub, tuned to the key near 52 Hz and started in the polarity that sums with the sample's 30–120 Hz band, plays under them.
- Samples load when the Fluff audio graph is created. Play waits up to 1.5 s for them; any hit whose sample has not decoded, or failed to load, uses the previous synthesized voice for that slot. Export decodes every sample into its offline context before rendering.
- Bass: Sub, Offbeat, Rolling, Pluck, Long, Reese, Organ, FM, Growl, Warm and Garage. Every patch is two layers: a clean mono sine sub that is always folded into 40–80 Hz, whatever note is written, and a mono mid layer of up to four oscillators (saws, squares, pulses, organ partials or FM) that is driven through a 2× oversampled soft clipper, low-passed by a key-tracked 24 dB filter (Cutoff/Resonance/Envelope) and high-passed just above the sub. Long and Reese drift their filter slowly, and each note gets a few cents of random tuning. Held steps tie into one note; a held step with a new pitch glides.
- Lead replaces Texture: Supersaw, Pluck, Bell, Piano, Organ, Square, Soft and Voice. A step followed by a held step of the same note ties into one longer note. Organ plays a three-note house chord on every step.
- Arp: Pluck, Super, Glass, Keys, Pulse, Dream, Poly and Mallet. Pads: Super, Air, Choir, Glass, Tape, Warm, Phase and Organ.
- Effects: the master Crunch control becomes Pump, a kick-triggered sidechain that ducks everything melodic. The bass has its own shorter duck that always runs, so kick and sub never overlap even with Pump at zero. Pads, leads, arps and vocals pass a 150 Hz high-pass so 40–150 Hz belongs to the kick and bass, then a gentle bus compressor. Instrument Space sends feed a shared plate and hall (generated impulses; returns are low-cut at 250 Hz and ducked a little by Pump); echoes are a tempo-synced ping-pong delay whose feedback is filtered and softly saturated. The performance dials become a resonant sweep, Plate/Hall (the same impulses) and 1/8 or dotted ping-pong.

### Patches

| Lead     | Patch                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- |
| Supersaw | Seven detuned saws (supersaw spacing) plus an octave of three, 24 dB filter with a short bloom. |
| Pluck    | Five saws over an octave-down square, resonant 24 dB filter falling fast; progressive pluck.    |
| Bell     | Two FM pairs (harmonic body, 3.5:1 shimmer) and a fast-fading fourth partial.                   |
| Piano    | House piano: hollow wave pair, FM hammer brightness, felt thump; filter closes as it decays.    |
| Organ    | Drawbar organ chord stab with key click and third-harmonic percussion.                          |
| Square   | Two narrow pulses and a square through a resonant 24 dB filter, delayed vibrato.                |
| Soft     | Detuned triangles with a saw edge that grows with Tone; gentle 12 dB filter.                    |
| Voice    | Saws and a pulse through gliding vowel formants with breath; Tone opens the vowel.              |

| Arp    | Patch                                                              |
| ------ | ------------------------------------------------------------------ |
| Pluck  | Three saws and a sub-octave square, resonant 24 dB pluck envelope. |
| Super  | Seven-saw supersaw, gated with a short bloom; trance arps.         |
| Glass  | FM glass bell with a fifth-and-octave shimmer.                     |
| Keys   | Electric piano: FM tine strike over a sine body, chorused.         |
| Pulse  | Two narrow pulses through a resonant 24 dB filter; eighties pluck. |
| Dream  | Soft FM bell and sines with a long ring.                           |
| Poly   | Two saws and a square, 24 dB filter and wide chorus; detuned poly. |
| Mallet | Sine with an FM strike and a marimba-like fourth partial.          |

| Pad   | Patch                                                           |
| ----- | --------------------------------------------------------------- |
| Super | Five-saw supersaw per note, slow filter drift.                  |
| Air   | Detuned triangles, an octave of saws and filtered noise.        |
| Choir | Saws and a pulse through vowel formants; Shape picks the vowel. |
| Glass | Two sustained FM pairs; Tone and Shape set the FM depth.        |
| Tape  | Soft electric piano chord with slow tape wow and hiss.          |
| Warm  | Analog strings: three saws and an octave, deep ensemble chorus. |
| Phase | String ensemble through a slow four-stage phaser.               |
| Organ | Drawbar organ chord with a sub-octave and ensemble vibrato.     |

Controls keep their meaning on every patch. Lead: Tone is the filter (and FM depth or vowel where there is no filter to speak of), Decay the decay or release, Width the unison detune and stereo spread, Motion delayed vibrato plus slow filter movement, Grit the rack drive, Attack the amp attack. Arp: Tone, Resonance, Shape (detune, FM depth or layer balance), Width, Decay and Gate. Pads: Tone, Shape, Motion (filter drift, phaser, pitch wander), Spread (stereo width), Attack and Release.

Patch levels were calibrated from offline renders: each lead, arp, pad and bass patch was rendered alone with a fixed test pattern and level, and trimmed (`FLUFF_*_LEVELS` in `src/fluff-patches.ts`, `FLUFF_BASS_LEVELS` in `src/fluff-audio.ts`) to the median integrated loudness of the previous patches in that slot, so patches are interchangeable and the examples keep their balance.

## Sound design notes

Working reference distilled from producer tutorials and genre breakdowns; the values are starting points, not rules.

- **Kick.** Fundamental 45–60 Hz, tuned to the key (root or fifth). Pitch falls from 3–5× to the fundamental within 25–50 ms, the body holds for 40–90 ms, then a 200–450 ms tail. A short click (2–4 kHz) and a 100–200 Hz knock make it audible on small speakers.
- **Sub and bass.** Split the bass into a mono sine sub (roughly 40–80 Hz) and a mid layer high-passed around 80–120 Hz so the layers do not phase against each other. Duck the sub hardest under the kick (a few tens of milliseconds, release before the next sixteenth); the mid layer can duck less.
- **Bass patterns by genre.** Trance: offbeat eighths, often octave-jumping, or rolling sixteenths that skip the kick. Progressive house (deadmau5, Prydz): rolling sixteenths or long, gated, filtered saw notes under pumping chords; a filtered pluck over a sub. Breaks (Bicep): sustained Reese (two saws detuned 10–20 cents) following the chords, syncopated against a broken kick. UK garage and deep house: organ bass (sine partials 1–4, short decay) or bendy square/FM basses in a syncopated 3-3-2 or 2-step rhythm. Dark melodic house (CamelPhat): driven sixteenth growl with a slowly opening filter.
- **Harmony.** Seventh chords throughout; minor keys for trance and house, major for future bass and J-pop. Progressive house and trance use 8- or 16-bar loops with one chord every 2–4 bars; holding one bass note under two chords (a shared root or a slash chord) gives more colour from fewer chords. Kawaii future bass favours IV–V–iii–vi; J-pop trance favours vi–IV–V–I. Deep house loops two to four minor sevenths.
- **Leads and plucks.** Progressive pluck: detuned saws, filter envelope from about 3–5 kHz down to 1–2 kHz over 150–300 ms, dotted-eighth delay. Supersaw: 5–7 detuned saws with a gentle filter. Hooks repeat a one- or two-bar rhythmic motif and change only the last notes; large leaps and long scale runs read as cheesy.
- **Snares and claps.** Layer a 180–230 Hz tuned body with noise high-passed around 400–900 Hz; reverb is a short send, not the sound. Future bass snares are a snare and clap together on beat 3 of a half-time bar.
- **Sidechain.** House and progressive: the melodic bus dips 6–10 dB per kick and recovers by the offbeat. Future bass and Prydz-style tracks pump deeper.
- **Supersaw.** Seven saws with the side voices spaced unevenly (closer near the centre, the outer pair far out, as on the JP-8000), the centre voice slightly quieter than the sides, random start phases so the stack never begins as one hard edge, and the side voices split hard left and right. Around 12–40 cents to the outer voice reads as trance; more turns into chorus mush.
- **Why synths sound cheap.** Bare oscillators with linear envelopes and a static filter read as chiptune. What makes them sound like records: band-limited waves with full harmonics (browser oscillators are band-limited per pitch; custom waves with only a few dozen harmonics sound dull and boxy), several detuned voices with slow independent pitch drift, a filter envelope shaped exponentially in pitch, key tracking so high notes are not muffled, small per-note differences (start phase, tuning), gentle saturation for density, ensemble chorus for width, and a long, smooth, dark reverb.
- **Classic keys.** House piano and electric piano are bright at the strike and darken quickly: an FM or filter envelope that closes over 0.2–0.4 s, plus a short noise or high-ratio FM strike for the hammer or tine. House organ is drawbars 8', 4', 2⅔' and 2' with a key click and a decaying third-harmonic percussion.
- **Reverb.** A smooth tail is noise with a different exponential decay per band (highs die first), equal energy per band at the start, a soft build-up and, for a hall, a few sparse early reflections before it. Pre-delay of 10–30 ms keeps the dry attack clear; a 250 Hz low cut on the send keeps the low end mono and the kick clean.
- **Balance.** Measured on a whole loop, a club mix carries most of its energy below 120 Hz. Targets used here, as each band's share of total power: 30–120 Hz combined −1 to −3 dB (the kick fundamental usually lands in 30–60 Hz, so that band alone can read −2 to −7 dB), 120–300 Hz −7 to −11 dB, 300 Hz–2 kHz −7 to −13 dB, 2–16 kHz −15 to −21 dB. Below 150 Hz the mix stays mono. Tempos: deep and lo-fi house 118–124, progressive house 124–128, breaks and garage 128–134, trance 132–140, fast trance 140–150, future bass 140–160 in half time, J-pop trance 160–175.

## Examples

`src/fluff-presets.ts` defines twelve tracks in a compact notation (sixteen cells per bar for drums, scale-degree tokens for notes) and builds validated projects from them. Every track has an 8-bar bassline and an 8- or 16-bar chord loop; the 16-bar loops share each bass bar between two chords.

| Track       | Genre               | BPM | Key      | Chords                |
| ----------- | ------------------- | --- | -------- | --------------------- |
| Cotton      | Progressive house   | 126 | A minor  | i–VI–III–iv, 16 bars  |
| Skylark     | Uplifting trance    | 138 | F♯ minor | i–VI–iv–VII, 8 bars   |
| Halflight   | Melodic progressive | 126 | D minor  | i–VI–VII–v, 8 bars    |
| Tidepool    | Melodic breaks      | 130 | E minor  | VI–VII–i–III, 8 bars  |
| Hush        | Lo-fi house         | 120 | G minor  | iv–VII–III–VI, 8 bars |
| Kite String | Kawaii future bass  | 150 | C major  | IV–V–iii–vi, 8 bars   |
| Hoshi       | Vocaloid trance pop | 164 | D major  | vi–IV–V–I, 8 bars     |
| Glasshouse  | Progressive trance  | 132 | B minor  | iv–VI–i–v, 8 bars     |
| Night Swim  | UK garage           | 132 | F minor  | i–VI–iv–v, 8 bars     |
| Overpass    | Fast trance         | 145 | F♯ minor | i–VII–VI–VII, 8 bars  |
| Low Sun     | Deep house          | 122 | D minor  | i–iv–VII–III, 8 bars  |
| Undertone   | Dark melodic house  | 124 | C minor  | i–VI–i–VII, 16 bars   |

## Look

Grain lays one visualizer canvas over the whole page with `mix-blend-mode: difference`, so every panel, control and title shifts with the smoke. Fluff keeps the same single live layer but puts it under the interface: the visualizer draws slow pastel clouds and bokeh, and every surface is a translucent veil, so the clouds, the palette and the drum swells (kick swells, hat twinkle, snare or clap puff) move through panels, controls and editors. Intensity sets how strongly the clouds show; Fluff lifts it so the default 30% stays visible. Palettes are Cotton, Sorbet, Lilac, Dusk and Prism.

- `src/fluff-theme.css` restyles the interface under `:root[data-mode="fluff"]`: no outlines or nested cards, lumpy radii and soft white halos on outer shapes, pill chips, and accents taken from the current palette. The sticky transport stays opaque so scrolled content does not show through it.
- `src/canvas-theme.ts` holds the colours and cell shapes for every canvas editor (beat grid, note and automation matrices, vocal roll, Cloud and Tension surfaces). Grain keeps its original values exactly; Fluff draws light, translucent surfaces with rounded cells. Palette accents are darkened in their own hue until they reach 3:1 (marks) and 4.5:1 (text and thin lines) on a pale surface, and the same values are published to CSS as `--fluff-palette-*`. Editors redraw when the mode or palette changes.
- `src/fluff-wordmark.svg` builds FLUFF from overlapping puffs with a palette-tinted underside and a slow displacement drift; reduced motion shows it still.

## Verification and limits

- `src/fluff-presets.test.ts` checks that all twelve tracks build, validate, stay in key and have 8-bar basslines and 8- or 16-bar chord loops.
- `src/fluff-drums.test.ts` checks that every Fluff drum slot maps to a bundled file (or is one of the two synthesized slots), that kick tuning stays in 40–70 Hz, Decay gating, render tails and the loader's caching, validation and retry.
- Each track was rendered offline in headless Chrome (full mix, kick alone, bass alone, bass with the sidechain running) and measured for peak, integrated loudness, band balance against the targets above, low-frequency stereo correlation, bass ducking at each kick and recovery by the offbeat, and kick/bass summing. Nothing has been judged by ear.
- `src/fluff-patches.test.ts` checks that every lead, arp and pad patch builds finite, audible voices at the extremes of every control. Every patch was also rendered alone at default, darkest/shortest and brightest/longest settings, across low and high registers, and checked on spectrograms and by measurement: loudness, stereo width and mono sum, spectral centroid movement, inharmonic energy on a held high note (aliasing) and onset transients. The plate measures about 1.8 s RT60 in the mids falling to 1.3 s at 8 kHz, the hall about 4.8 s falling to 3.6 s; both decay as straight lines (within 0.4 dB from −5 to −35 dB) with no periodic peaks in the tail. Grain renders sample-identical (within 16-bit rounding) to the previous release.
- The chord progression holds exactly four chords; longer progressions would need a schema change.
- Shared sessions do not carry `mode` until the sessions Worker is redeployed with the updated schema, so a Fluff project joined through a session plays with Grain voices.
- During playback in headless Chrome on an Apple M4 Max GPU, the Fluff page held a 16.7 ms median and p95 frame interval at 1440 × 1100 and at 375 × 812 with 4× CPU throttling; at 6× throttling, 2 of 345 frames exceeded 33 ms. Real phones are unchecked.
- Grain renders pixel-identically to the previous release at 1440 × 1100 and 375 × 812, including after switching to Fluff and back.
