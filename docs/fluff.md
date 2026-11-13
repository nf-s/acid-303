# Fluff mode

Fluff is a prototype second voice for the same studio. The Grain / Fluff switch in the title bar swaps the sound engine, effects, examples, palettes and theme; the sequencers, project schema and controls are shared. `project.mode` (`"grain"` or `"fluff"`, default `"grain"`) records which engine a project is voiced for. Each mode keeps its own saved project and palette in this browser, so switching does not overwrite the other mode's track.

## Sound

Every sound slot is reused, so saved sound numbers are valid in both modes; only the voices and names differ (`FLUFF_SOUNDS` in `src/mode.ts`).

- `src/fluff-audio.ts` holds the Fluff bus, drum kit, lead and the shared note synth used by the lead and arpeggiator.
- Drums: seven kicks, snares, claps and percussion voices and eight hats, tuned for trance, progressive, breaks and lo-fi house.
- Bass (`FLUFF_BASS_PROFILES` in `src/audio.ts`): Sub, Offbeat, Roller, Pluck, Saw, Reese, Organ, FM, Square, Warm and Garage.
- Lead replaces Texture: Supersaw, Pluck, Bell, Piano, Stab, Chip, Whistle and Vox. A step followed by a held step of the same note ties into one longer note.
- Arp: Pluck, Super, Glass, Pizz, Chip, Dream, Rave and Mallet. Pads: Super, Air, Choir, Glass, Haze, Warm, Phase and Organ, with unison saws on the wide patches.
- Effects: the master Crunch control becomes Pump, a kick-triggered sidechain that ducks everything melodic. Instrument Space sends feed a shared plate and hall; echoes are a tempo-synced ping-pong delay. The performance dials become a resonant sweep, Plate/Hall and 1/8 or dotted ping-pong.

Patch levels were calibrated from offline renders: each lead, arp, pad and bass patch was rendered alone at a fixed level and trimmed so that patches in a slot are interchangeable without re-mixing.

## Examples

`src/fluff-presets.ts` defines twelve tracks in a compact notation (sixteen cells per bar for drums, scale-degree tokens for notes) and builds validated projects from them. Most use eight-bar chord loops, basslines and leads.

| Track       | Genre               | BPM |
| ----------- | ------------------- | --- |
| Cotton      | Progressive house   | 128 |
| Skylark     | Uplifting trance    | 138 |
| Opaline     | Melodic house       | 122 |
| Tidepool    | Melodic breaks      | 130 |
| Hush        | Lo-fi house         | 120 |
| Kite String | Kawaii future bass  | 150 |
| Hoshi       | Vocaloid trance pop | 160 |
| Glasshouse  | Progressive trance  | 126 |
| Night Swim  | Melodic garage      | 132 |
| Overpass    | Fast trance         | 145 |
| Low Sun     | Deep house          | 124 |
| Undertone   | Dark melodic house  | 123 |

## Look

`src/fluff-theme.css` restyles the interface under `:root[data-mode="fluff"]`: cool grey page, white rounded panels, slate text and pastel accents. The visualizer draws slow pastel clouds and bokeh behind the panels instead of inverting the page; kick swells the clouds, hats twinkle and snare or clap sends a soft puff. Palettes are Cotton, Sorbet, Lilac, Dusk and Prism.

## Verification and limits

- `src/fluff-presets.test.ts` checks that all twelve tracks build, validate and stay in key.
- Each track was rendered offline in headless Chrome and measured for peak level, loudness and band balance; none clips. Sidechain ducking of roughly 4–5 dB per kick was confirmed on Cotton. Nothing has been judged by ear.
- Shared sessions do not carry `mode` until the sessions Worker is redeployed with the updated schema, so a Fluff project joined through a session plays with Grain voices.
- Frame rate of the Fluff visualizer on phones is unchecked.
