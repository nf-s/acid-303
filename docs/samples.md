# Bundled drum samples

Fluff's drum kit plays the files in `public/drums/fluff/`. Recorded files were cut from the sources below, trimmed to their onset, faded out, high-passed where the source carried rumble, peak-normalised to -1 dBFS and saved as 44.1 kHz 16-bit WAV. The hats, snares and claps marked as synthesized were rendered by `scripts/fluff-drums.py` (numpy; run with `python3 -I scripts/fluff-drums.py <out-dir> <virtuosity-samples-dir>`) and are original to this project, released under CC0 1.0 like the rest of the kit. Licence texts are in `public/drums/licenses/`.

Hats and the tambourine are stereo: the body is the same in both channels and each side gets its own noise, so the sheen is wide while the hit stays centred. Everything else is mono.

The vocal samples have their own credits in `public/vocals/README.txt`.

## Synthesized slots (CC0 1.0)

Hats follow the TR-808/606 metal circuit: six free-running, band-limited square oscillators at 205.3, 304.4, 369.6, 522.7, 540 and 800 Hz are summed, band-passed, mixed with band-passed white noise, shaped by an exponential VCA envelope, then high-passed twice (12 dB each) and gently low-passed. Snares are 909-style: two tuned bodies (a fundamental and one about 1.78× above) whose pitch drops by half in the first few milliseconds, plus high- and low-passed "snappy" noise with a fast and a slow decay, softly saturated. Claps are 909-style: three or four band-passed noise bursts 8–13 ms apart, each falling with a 3–4.5 ms time constant, then a filtered noise "reverb" tail.

| File         | Sound                                                                          | 20 dB decay | Centroid |
| ------------ | ------------------------------------------------------------------------------ | ----------- | -------- |
| hat-closed   | 808 metal + 50% noise, 6.8 kHz band-pass, 4.8 kHz high-pass, 24 ms decay       | 37 ms       | 8.1 kHz  |
| hat-open     | 808 metal + 60% noise, two-stage decay (12 ms to 60%, then 150 ms)             | 230 ms      | 8.4 kHz  |
| hat-shaker   | Band-passed noise (6 kHz) with bead texture, 10 ms swell, 30 ms decay          | 59 ms       | 7.1 kHz  |
| hat-tick     | 606-style: metal 1.12× higher, 8.2 kHz band-pass, 12 ms decay                  | 23 ms       | 9.1 kHz  |
| hat-ride     | 700 inharmonic partials (2.6–14 kHz) with their own decays, noise and stick    | 790 ms      | 5.3 kHz  |
| hat-offbeat  | 808 metal + 60% noise, two-stage decay (10 ms to 65%, then 85 ms)              | 100 ms      | 8.6 kHz  |
| hat-dusty    | Darker closed hat (6.2 kHz band-pass), saturated, 10-bit, 22 kHz, 7.5 kHz LP   | 45 ms       | 5.7 kHz  |
| hat-sizzle   | 808 metal + 65% noise, two-stage decay (15 ms to 70%, then 240 ms)             | 350 ms      | 9.7 kHz  |
| snare-house  | 909: 185 Hz body, noise 1.1–9.5 kHz, 12 ms / 100 ms snappy decay               | 105 ms      | 3.6 kHz  |
| snare-garage | 909 tuned to 235 Hz, short noise 1.7–11 kHz, 808 rimshot click (455 + 1667 Hz) | 65 ms       | 4.3 kHz  |
| snare-roll   | 909 at 205 Hz with short snappy noise, for rolls                               | 56 ms       | 2.7 kHz  |
| clap-house   | Four bursts at 0, 10.5, 21.5 and 33 ms through 1.15 kHz, 70 ms tail            | 6 ms        | 2.5 kHz  |
| clap-tight   | Three bursts 8 ms apart through 1.5 kHz, 35 ms tail                            | 59 ms       | 3.1 kHz  |
| clap-hall    | Four bursts 12–13 ms apart through 1.1 kHz, 80 ms tail and a short room        | 107 ms      | 2.3 kHz  |
| clap-dusty   | House clap through 4.5 kHz low-pass, saturated, 10-bit                         | 7 ms        | 1.5 kHz  |
| clap-layered | House clap with the 909 snare at -4.4 dB                                       | 123 ms      | 2.8 kHz  |
| clap-soft    | Four slower bursts through 1.05 kHz, softened attack, 3.2 kHz low-pass         | 9 ms        | 1.6 kHz  |
| perc-tamb    | Nine jingle bands (6–11.5 kHz, Q 5) over bright noise, 40 ms decay             | 80 ms       | 7.5 kHz  |

Decay and centroid are measured on the bundled files (the clap figures show the gap between bursts, not the tail). No slot has a narrow spectral peak more than 22 dB above its surroundings in the tail; the previous recorded open hat and ride rang 24–26 dB above.

Targets came from bar-synchronous averages of reference club tracks (UK-leaning melodic house, garage and breaks): closed hats fall 20 dB in 40–90 ms, off-beat open hats in about 100–150 ms, and hats sit well under the kick.

## Recorded sources

### Sonic Pi sample library — CC0 1.0

- Source: https://github.com/sonic-pi-net/sonic-pi/tree/main/etc/samples
- Licence statement (`etc/samples/README.md`): the samples "are from http://freesound.org and have also been placed in the public domain via the Creative Commons 0 License".

| File       | Sonic Pi sample | Original upload                                                 |
| ---------- | --------------- | --------------------------------------------------------------- |
| kick-click | `bd_haus`       | https://freesound.org/people/Rodrigo%20The%20Mad/sounds/137722/ |
| kick-round | `bd_gas`        | https://freesound.org/people/menegass/sounds/89460/             |
| kick-deep  | `bd_pure`       | https://freesound.org/people/EKVelika/sounds/209571/            |
| kick-tight | `bd_tek`        | https://freesound.org/people/DWSD/sounds/171104/                |
| kick-boom  | `bd_boom`       | https://freesound.org/people/Snapper4298/sounds/157245/         |
| clap-snap  | `perc_snap`     | https://freesound.org/people/SoundCollectah/sounds/109400/      |

`kick-boom` has its slow swell lifted so the first cycle plays at full level.

### Virtuosity Drums — CC0 1.0

- Source: https://github.com/sfzinstruments/virtuosity_drums (Versilian Studios and Karoryfer Samples; auxiliary percussion from VSCO 2)
- Licence: the repository's `LICENSE` file is the CC0 1.0 Universal legal code.

| File          | Source samples                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kick-acoustic | `kick_snoff_vl4_rr1`, kick and room microphones                                                                                                                              |
| kick-lofi     | `kick_snoff_vl4_rr1`, lo-fi microphone with some kick microphone                                                                                                             |
| snare-break   | `snare_center_vl34`, snare microphone with the overheads at -8 dB; 100 Hz high-pass, +3 dB at 210 Hz, -4 dB at 1.15 kHz, +4 dB shelf above 4.5 kHz, saturated, cut to 420 ms |
| snare-dusty   | `snare_center_vl34`, lo-fi microphone                                                                                                                                        |
| snare-ghost   | `snare_center_vl30`, snare microphone                                                                                                                                        |
| snare-room    | `snare_center_vl34`, snare, overhead and room microphones                                                                                                                    |
| perc-rim      | `snare_crossstick_vl15`, snare and room microphones                                                                                                                          |
| perc-tom      | `ltom_center_vl14`, overhead microphones                                                                                                                                     |
| perc-conga    | `perc/close/conga/Conga_22_HitN_101_127_rr2`                                                                                                                                 |
| perc-crash    | `crash_crash_vl3_rr1`, overhead and room microphones                                                                                                                         |

## Synthesized at play time

The Perc lane's Blip and Sweep are synthesized live: Blip is a key-tuned FM tone and Sweep a filtered noise riser, neither a recorded drum.
