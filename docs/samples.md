# Bundled drum samples

Fluff's drum kit plays the files in `public/drums/fluff/`. Each file was cut from one of the sources below, trimmed to its onset, faded out, high-passed where the source carried rumble, peak-normalised to -1 dBFS and saved as mono 44.1 kHz 16-bit WAV. Layered files mix several microphones or sources of the same hit. Licence texts are in `public/drums/licenses/`.

The vocal samples have their own credits in `public/vocals/README.txt`.

## Sources

### Sonic Pi sample library — CC0 1.0

- Source: https://github.com/sonic-pi-net/sonic-pi/tree/main/etc/samples
- Licence statement (`etc/samples/README.md`): the samples "are from http://freesound.org and have also been placed in the public domain via the Creative Commons 0 License".

| File         | Sonic Pi sample    | Original upload                                                 |
| ------------ | ------------------ | --------------------------------------------------------------- |
| kick-click   | `bd_haus`          | https://freesound.org/people/Rodrigo%20The%20Mad/sounds/137722/ |
| kick-round   | `bd_gas`           | https://freesound.org/people/menegass/sounds/89460/             |
| kick-deep    | `bd_pure`          | https://freesound.org/people/EKVelika/sounds/209571/            |
| kick-tight   | `bd_tek`           | https://freesound.org/people/DWSD/sounds/171104/                |
| kick-boom    | `bd_boom`          | https://freesound.org/people/Snapper4298/sounds/157245/         |
| snare-house  | `sn_dolf`          | https://freesound.org/people/Dolfeus/sounds/57534/              |
| snare-garage | `sn_dub`           | https://freesound.org/people/Adriak909/sounds/173142/           |
| snare-roll   | `elec_hi_snare`    | https://freesound.org/people/looppool/sounds/13125/             |
| hat-closed   | `hat_zild`         | https://freesound.org/people/pjcohen/sounds/45668/              |
| hat-open     | `drum_cymbal_open` | https://freesound.org/people/menegass/sounds/100055/            |
| hat-tick     | `hat_raw`          | https://freesound.org/people/cabled_mess/sounds/339278/         |
| hat-ride     | `ride_tri`         | https://freesound.org/people/trivialAccapella/sounds/425449/    |
| hat-offbeat  | `hat_gump`         | https://freesound.org/people/zgump/sounds/96144/                |
| hat-sizzle   | `elec_cymbal`      | https://freesound.org/people/looppool/sounds/13143/             |
| clap-snap    | `perc_snap`        | https://freesound.org/people/SoundCollectah/sounds/109400/      |
| clap-layered | `sn_dolf` (layer)  | https://freesound.org/people/Dolfeus/sounds/57534/              |

`kick-boom` has its slow swell lifted so the first cycle plays at full level.

### Virtuosity Drums — CC0 1.0

- Source: https://github.com/sfzinstruments/virtuosity_drums (Versilian Studios and Karoryfer Samples; auxiliary percussion from VSCO 2)
- Licence: the repository's `LICENSE` file is the CC0 1.0 Universal legal code.

| File          | Source samples                                                   |
| ------------- | ---------------------------------------------------------------- |
| kick-acoustic | `kick_snoff_vl4_rr1`, kick and room microphones                  |
| kick-lofi     | `kick_snoff_vl4_rr1`, lo-fi microphone with some kick microphone |
| snare-rimshot | `snare_rimshot_vl12`, snare and room microphones                 |
| snare-dusty   | `snare_center_vl34`, lo-fi microphone                            |
| snare-ghost   | `snare_center_vl30`, snare microphone                            |
| snare-room    | `snare_center_vl34`, snare, overhead and room microphones        |
| hat-shaker    | `perc/close/shaker/LShaker_Shake1D_rr1`, cut to its accent       |
| hat-dusty     | `hh_closed_vl3_rr1`, lo-fi microphone                            |
| perc-rim      | `snare_crossstick_vl15`, snare and room microphones              |
| perc-tom      | `ltom_center_vl14`, overhead microphones                         |
| perc-conga    | `perc/close/conga/Conga_22_HitN_101_127_rr2`                     |
| perc-tamb     | `perc/close/tambourine/Tamb1_Shake_rr2`, cut to its accent       |
| perc-crash    | `crash_crash_vl3_rr1`, overhead and room microphones             |

### AVL Percussions (AVL Drumkits) by Glen MacArthur — CC BY-SA 3.0

- Source: https://github.com/studiorack/avl-percussions, from http://www.bandshed.net/avldrumkits/
- Licence statement (bandshed.net): "AVL Drumkits are free to download and use and are licensed CC-BY-SA 3.0." Licence: https://creativecommons.org/licenses/by-sa/3.0/
- Used: `Samples/39-Handclap-5.flac`.

The clap files below are adaptations of that handclap and are themselves licensed under CC BY-SA 3.0, credited to Glen MacArthur (AVL Drumkits). Changes: high-pass at 250 Hz, trimming, fades and normalisation, plus the per-file edits listed.

| File         | Changes                                               |
| ------------ | ----------------------------------------------------- |
| clap-house   | a second, darker copy 11 ms later                     |
| clap-tight   | high-pass at 500 Hz, cut to 160 ms                    |
| clap-hall    | a second copy 14 ms later and short early reflections |
| clap-dusty   | low-pass at 4.5 kHz and 10-bit crush                  |
| clap-layered | mixed with the Sonic Pi `sn_dolf` snare (CC0)         |
| clap-soft    | low-pass at 3.2 kHz                                   |

## Synthesized slots

The Perc lane's Blip and Sweep stay synthesized: Blip is a key-tuned FM tone and Sweep a filtered noise riser, neither a recorded drum.
