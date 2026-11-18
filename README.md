<div align="center">

# Grain

A drum machine and synth studio that runs in your browser. No install, no account.

<a href="https://acid-303.pages.dev/"><img src="https://img.shields.io/badge/%E2%96%B6%20%20Open%20Grain-acid--303.pages.dev-334155?style=for-the-badge&labelColor=0f172a" alt="Open Grain at acid-303.pages.dev" height="56"></a>

## [acid-303.pages.dev](https://acid-303.pages.dev/)

<a href="https://acid-303.pages.dev/"><img src="docs/images/grain.jpg" alt="Grain: transport, performance dials, genre examples and the drum sequencer over the fluid visualizer"></a>

</div>

## What you get

- **Eight instruments**: five-lane drum machine, 303-style acid bass, Texture, Arpeggiator, Chord pads, Vocal sampler, Cloud (granular) and Tension (tuned resonator).
- **Draw everything**: paint drum steps, draw pitch, gate, accent and glide, and draw automation for every knob. Notes stay locked to your chosen scale.
- **21 genre examples** from house and techno to jungle and UK bass, plus Remix for a fresh pattern.
- **Fluff mode**: a second, melodic studio for trance, progressive house and melodic breaks, with 17 more examples.
- **Play together**: live sessions for one host and up to seven guests. Guests edit; audio plays only on the host's device.
- **Share and export**: compressed track links, WAV export, Undo/Redo, and projects saved in your browser.
- **Phone-ready**: multi-touch drawing, and tilt or move your phone to turn a knob.

## Two studios

Switch between **Grain** and **Fluff** in the title bar. Each has its own sounds, effects, examples and look; the sequencers and your project carry over. Any track can also use the other studio's sounds.

<a href="https://acid-303.pages.dev/"><img src="docs/images/fluff.jpg" alt="Fluff mode: the same studio with a soft lilac theme and melodic examples"></a>

## Instruments

<table>
  <tr>
    <td width="50%"><img src="docs/images/drums.jpg" alt="Drum sequencer"><br><b>Drums</b>: paint steps across kick, snare, hat, clap and rim, each with eight automatable controls.</td>
    <td width="50%"><img src="docs/images/bass.jpg" alt="Acid bass pitch matrix"><br><b>Acid bass</b>: draw pitch, gate, accent and glide in scale.</td>
  </tr>
  <tr>
    <td><img src="docs/images/vocals.jpg" alt="Vocal sampler"><br><b>Vocals</b>: trim a sung or chopped sample and draw notes of any length.</td>
    <td><img src="docs/images/fluff-arp.jpg" alt="Arpeggiator in Fluff mode"><br><b>Arpeggiator</b>: pick notes, order, rate and octaves, or follow the chord progression.</td>
  </tr>
  <tr>
    <td><img src="docs/images/cloud.jpg" alt="Cloud granular instrument"><br><b>Cloud</b>: drag to scan granular material and change pitch.</td>
    <td><img src="docs/images/tension.jpg" alt="Tension string instrument"><br><b>Tension</b>: pull and release strings to strike tuned percussion.</td>
  </tr>
</table>

## On your phone

<p align="center">
  <img src="docs/images/phone-grain.jpg" alt="Grain on a phone" width="300">
  &nbsp;&nbsp;
  <img src="docs/images/phone-fluff.jpg" alt="Fluff on a phone" width="300">
</p>

## Documentation

- [User guide](docs/guide.md): every control, gesture and keyboard shortcut
- [Fluff mode](docs/fluff.md): the second studio and its sounds
- [Chords and composition](docs/composition.md)
- [Shared sessions](docs/sessions.md)
- [Samples and licences](docs/samples.md)

## Development

Requires Node 22.12 or later.

```bash
npm install
npm run dev
```

`npm test` runs unit checks and `npm run test:e2e` runs browser checks (requires Chrome). See [development](docs/development.md) for the code structure and [deployment](docs/deployment.md) for release steps.
