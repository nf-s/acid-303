# Fluff mode

Fluff is a prototype second voice for the same studio. The Grain / Fluff switch in the title bar swaps the sound engine, effects, examples, palettes and theme; the sequencers, project schema and controls are shared. `project.mode` (`"grain"` or `"fluff"`, default `"grain"`) records which engine a project is voiced for. Each mode keeps its own saved project and palette in this browser, so switching does not overwrite the other mode's track.

## Sound

Every sound slot is reused, so saved sound numbers are valid in both modes; only the voices and names differ (`FLUFF_SOUNDS` in `src/mode.ts`).

- `src/fluff-audio.ts` holds the Fluff bus, drum kit, bass, lead and the shared note synth used by the lead and arpeggiator. `BassVoice` in `src/audio.ts` hands every Fluff bass step to `FluffBass`.
- Kicks: Trance, Prog, Deep, Tight, Breaks, Boom and Dusty. Each is tuned to the root or fifth of the project key nearest its designed pitch (46–58 Hz); the Pitch control still offsets it.
- Snares (House, Break, Garage, Dusty, Roll, Ghost, Fat) and claps (House, Tight, Hall, Snap, Dusty, Layered, Soft) have a tuned 180–330 Hz body under the noise.
- Bass: Sub, Offbeat, Rolling, Pluck, Long, Reese, Organ, Donk, Growl, Warm and Garage. Every patch is two layers: a clean mono sine sub that is always folded into 40–80 Hz, whatever note is written, and a mid layer (saws, squares, organ partials or FM) that is driven, low-passed by Cutoff/Resonance/Envelope and high-passed just above the sub. Held steps tie into one note; a held step with a new pitch glides.
- Lead replaces Texture: Supersaw, Pluck, Bell, Piano, Stab, Chip, Soft and Vox. A step followed by a held step of the same note ties into one longer note.
- Arp: Pluck, Super, Glass, Pizz, Chip, Dream, Rave and Mallet. Pads: Super, Air, Choir, Glass, Haze, Warm, Phase and Organ, with unison saws on the wide patches.
- Effects: the master Crunch control becomes Pump, a kick-triggered sidechain that ducks everything melodic. The bass has its own shorter duck that always runs, so kick and sub never overlap even with Pump at zero. Pads, leads, arps and vocals pass a 150 Hz high-pass so 40–150 Hz belongs to the kick and bass. Instrument Space sends feed a shared plate and hall; echoes are a tempo-synced ping-pong delay. The performance dials become a resonant sweep, Plate/Hall and 1/8 or dotted ping-pong.

Patch levels were calibrated from offline renders: each lead, arp, pad and bass patch was rendered alone at a fixed level and trimmed so that patches in a slot are interchangeable without re-mixing.

## Sound design notes

Working reference distilled from producer tutorials and genre breakdowns; the values are starting points, not rules.

- **Kick.** Fundamental 45–60 Hz, tuned to the key (root or fifth). Pitch falls from 3–5× to the fundamental within 25–50 ms, the body holds for 40–90 ms, then a 200–450 ms tail. A short click (2–4 kHz) and a 100–200 Hz knock make it audible on small speakers.
- **Sub and bass.** Split the bass into a mono sine sub (roughly 40–80 Hz) and a mid layer high-passed around 80–120 Hz so the layers do not phase against each other. Duck the sub hardest under the kick (a few tens of milliseconds, release before the next sixteenth); the mid layer can duck less.
- **Bass patterns by genre.** Trance: offbeat eighths, often octave-jumping, or rolling sixteenths that skip the kick. Progressive house (deadmau5, Prydz): rolling sixteenths or long, gated, filtered saw notes under pumping chords; a filtered pluck over a sub. Breaks (Bicep): sustained Reese (two saws detuned 10–20 cents) following the chords, syncopated against a broken kick. UK garage and deep house: organ bass (sine partials 1–4, short decay) or bendy square/FM basses in a syncopated 3-3-2 or 2-step rhythm. Dark melodic house (CamelPhat): driven sixteenth growl with a slowly opening filter.
- **Harmony.** Seventh chords throughout; minor keys for trance and house, major for future bass and J-pop. Progressive house and trance use 8- or 16-bar loops with one chord every 2–4 bars; holding one bass note under two chords (a shared root or a slash chord) gives more colour from fewer chords. Kawaii future bass favours IV–V–iii–vi; J-pop trance favours vi–IV–V–I. Deep house loops two to four minor sevenths.
- **Leads and plucks.** Progressive pluck: detuned saws, filter envelope from about 3–5 kHz down to 1–2 kHz over 150–300 ms, dotted-eighth delay. Supersaw: 5–7 detuned saws with a gentle filter. Hooks repeat a one- or two-bar rhythmic motif and change only the last notes; large leaps and long scale runs read as cheesy.
- **Snares and claps.** Layer a 180–230 Hz tuned body with noise high-passed around 400–900 Hz; reverb is a short send, not the sound. Future bass snares are a snare and clap together on beat 3 of a half-time bar.
- **Sidechain.** House and progressive: the melodic bus dips 6–10 dB per kick and recovers by the offbeat. Future bass and Prydz-style tracks pump deeper.
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

`src/fluff-theme.css` restyles the interface under `:root[data-mode="fluff"]`: cool grey page, white rounded panels, slate text and pastel accents. The visualizer draws slow pastel clouds and bokeh behind the panels instead of inverting the page; kick swells the clouds, hats twinkle and snare or clap sends a soft puff. Palettes are Cotton, Sorbet, Lilac, Dusk and Prism.

## Verification and limits

- `src/fluff-presets.test.ts` checks that all twelve tracks build, validate, stay in key and have 8-bar basslines and 8- or 16-bar chord loops.
- Each track was rendered offline in headless Chrome (full mix, kick alone, bass alone, bass with the sidechain running) and measured for peak, integrated loudness, band balance against the targets above, low-frequency stereo correlation, bass ducking at each kick and recovery by the offbeat, and kick/bass summing. Nothing has been judged by ear.
- The chord progression holds exactly four chords; longer progressions would need a schema change.
- Shared sessions do not carry `mode` until the sessions Worker is redeployed with the updated schema, so a Fluff project joined through a session plays with Grain voices.
- Frame rate of the Fluff visualizer on phones is unchecked.
