# Vocal gain and normalization release

Public application: https://acid-303.pages.dev/.
Frontend source: `cf017d1c3181233ec4726a682820f2ac891f073a`.
The Worker source is `0b893812b4ba6bf5ec42b5858ad3a35d84192cb0`; the later
frontend checkpoint only corrects the live-recorded Gain readout and adds its
regression test.

## Changes

New captures/imports now peak-normalize after resampling to 0.8 (approximately
−2 dBFS). Existing custom recordings normalize their playback buffers after
integrity validation, preserving stored WAVs, hashes and share references.
Near-silence stays quiet; nonfinite input becomes zero. Built-in samples retain
their authored levels.

Vocal Gain sits beside the waveform, ranges from −24 to +24 dB, resets to 0 dB
on double-tap, and has a separate automation lane. The original eight controls
and mixer Level remain in place. Gain supports history, save, sharing, local
automation recording, live markers and export. Missing gain in older projects
defaults to unity. The total automation lane count is now 97.

Phone checks reproduced a tap/scroll retargeting defect: the first knob tap moved
the control before reset or the native compatibility click. Pointer activation
now opens automation without scrolling; keyboard activation still reveals it.
The fix uses the same activation path for instruments sharing this editor.

Protocol v7 advertises gain support while retaining additive project v6 storage.
Older peers omit gain from their wire projection, preserve canonical gain during
whole-track/automation edits, and resample its hidden curve if timing changes.
Guests with an older host see Gain disabled with an explanation. No new server
resources or namespace migration is required.

Before the fix, a 0.01-peak synthetic recording remained about 0.01 after capture,
import and playback. Chrome/WebKit rendering now measures 0.8 peak. Static and
automated +6 dB gain produce the expected amplitude ratio after smoothing, with
silent tails and unchanged source hashes.

## Verification

Pre-release checks passed: 248 unit tests, strict TypeScript/production build,
31 Worker runtime tests, six Chrome/WebKit normalization and gain audio cases,
twelve Gain UI cases, four maximum-share/480-point automation checks and six
shared knob gesture regressions. Mobile coverage includes 320 and 390 pixels.
These use generated audio and browser emulation, not physical microphone hardware.

The exact pushed sources were archived for isolated builds. The approved current
headers were copied explicitly: SHA-256
`2353170acfe2bbaad8255725ee77e36963470e258eb41cae7c64d1743971649a`.

## Worker deployment

Published 8 November 2026 at 10:17:39.910576 UTC:

- Version: `ed96973a-7d39-49df-908d-bccfa3d29603`
- Deployment: `12347069-cb5f-4939-a88e-24745487e907` at 100%
- Module: 455,179 bytes, SHA-256 `0fead004d5c9abc46e3218a87afc926d5eba9d0627e451ada114b85f97830eba`

Both existing namespaces, rate limits and observability settings remain intact;
export reconciliation made no resource changes.

One identified v6 host/guest fixture was created at 10:17:28.567 UTC. Both
sockets survived the update. A v7 guest correctly saw gain unsupported by the
old host; v6 projections hid gain, and an older whole-automation edit preserved
canonical gain and its curve. An authenticated v7 host replacement advertised
gain support. This sole test room was ended at 10:18:07.429 UTC and its private
credentials removed.

## Pages deployment and live checks

Published 8 November 2026 at 10:18:44.120441 UTC from `cf017d1`:

- Deployment: `7cc883c7-5cde-4329-9df8-a10eb28321d0`
- Immutable URL: https://7cc883c7.acid-303.pages.dev/
- JavaScript: `index-BZ4tNxJG.js`, SHA-256 `4a4a1b3f3377ca3e2c19f8506428ce83cfe436ac1d001e89b479bf9d6520ebfc`
- CSS: `index-M_L6sWHP.css`, SHA-256 `edb25b9d9b9e5a1e5313c92ece202fd77dbc73ec1c74abb2e6dae941eeb3582c`
- Unchanged worklet SHA-256: `10cb3b2e60283be23624439c652c397983a397343022d94364ee31a0bda877cf`

Canonical and immutable assets match the isolated payload. Native analytics
still completes GET 200/POST 204, and the unique Grain launcher points to the
canonical site. Permissions and CSP remain intact.

All six Gain UI behaviors were verified in both Chrome and WebKit, including
reset, automation, history, sharing and phone layouts. The recording regression
now explicitly waits for AUDIO LIVE: a pending Play also displays Stop, but
control movement before audio starts legitimately edits the manual base.
The corrected recording precondition passed against production in both engines.

A real UI import of a quiet WAV measured a normalized peak of
0.79998779296875 at 24 kHz in both engines. It remained local, generated no
sample upload requests or page errors, and the local test copies were deleted.
The separate session fixture described above was the only room created.
