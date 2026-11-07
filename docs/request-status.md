# Request status

Reviewed against the conversation on 8 November 2026 (Australia/Hobart).
Public app: https://acid-303.pages.dev/.

## Published

Stage 9 source is `2edeabbc686c221f1848d20f9f2b424f9948f0a3`.
Its Pages deployment was `ec548c46-934f-408d-8a24-0bb6a6dd0a29`.
The subsequent recovery/contrast release is source `47354ff`, deployment
`7a0b0ab4-5a89-4f84-b750-97706b7efe74`; see [release evidence](recovery-release.md).

| Request                                                  | Delivered behavior                                                                                                                                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public Cloudflare app, no sign-in, mobile layout         | Existing public Pages app; phone layouts and touch interactions covered.                                                                                                                                               |
| Drum sequencer, expressive pitch/decay and more sounds   | Five drums; cowbell replaced with rimshot; rebuilt eight-sound hat bank; seven sounds for each other drum.                                                                                                             |
| Crunchy acid and additional instrument sounds            | Eleven Bass, eight Texture, eight Arp and eight Pad sounds; eight controls per instrument.                                                                                                                             |
| Fluid expressive controls without dropdowns              | Drag, keyboard, double-tap reset and multiple pointers; beat painting and scale-locked note matrices.                                                                                                                  |
| Matrix pitch lines and simultaneous attribute visibility | Draw/Line editing with pitch, gates, accents and glide motifs visible together.                                                                                                                                        |
| All musical knob automation, including drums and pads    | Eight lanes per track; simple/advanced drum views; selected-knob curve editing; live outer automation markers. Manual global FX remain unautomated as requested.                                                       |
| Long automation without choosing every bar               | Page/Whole loop automation, including all 480 points in a 16-bar triplet pattern.                                                                                                                                      |
| Per-client recording                                     | Record is local to each participant; touched control curves become shared musical edits.                                                                                                                               |
| Arpeggiator and progressive chord pads                   | Note selection/order/rate/octaves, chord choices/inversions, progression descriptions, independent durations and automation.                                                                                           |
| Global scale lock                                        | Root/scale selection retunes all pitched instruments and pitched drum controls.                                                                                                                                        |
| Per-instrument bars, time signatures and triplets        | Independent timing; Timing dialog contains configuration; Previous/Page/Next/Follow now remain outside it.                                                                                                             |
| Global jam knobs and mixer                               | Sweep, Space and Dub echo; mixer level/mute mirrors each instrument, including Vocals.                                                                                                                                 |
| History, save and snapshot sharing                       | Grouped global Undo/Redo, local save and compressed track links. Share now opens inside the light transport panel.                                                                                                     |
| Collaborative remote control with host-only audio        | Persistent Cloudflare sessions, silent guests, ordered edits, reconnect recovery and compatible older clients.                                                                                                         |
| Sessions ending unexpectedly                             | Replay throttling/recovery fix published; sessions still have the intended 24-hour lifetime and explicit host End.                                                                                                     |
| Compact examples above drums, genre differentiation      | Horizontal strip of 21 examples. House/Tech house retained; others revised. Shared track added as Nightshift without changing its authored arrangement. Existing global scale behavior applies on loading.             |
| Grainy fluid across the whole interface                  | Full-page overlay, matrix coverage, timing-dialog mirror, default on at 30%, direct pattern reaction, Swirl and gradient/Rainbow choices.                                                                              |
| Fullscreen visualizer tap to exit                        | Tap the visual surface to exit; controls remain available.                                                                                                                                                             |
| Supplied title font, centered, vector and more legible G | Exact supplied letter outlines traced to SVG with the approved G adjustment; body monospace retained; left title icon removed.                                                                                         |
| Opening title/visualizer animation                       | Short fluid/title reveal with interaction skip and reduced-motion support.                                                                                                                                             |
| Collapsible instruments                                  | Tap any instrument header to collapse/expand. This does not mute it; bottom navigation expands the destination. Local layout preference persists.                                                                      |
| Remove redundant key labels and extra knob dots          | Per-instrument key labels removed; fixed curve-present dot removed while editable pointer and moving automation marker remain.                                                                                         |
| Phone knob taps opening unrelated controls               | Reproduced pointerup scroll retargeting a compatibility click into Timing; deferred scrolling fixes that path. The exact original Mixer-opening action was not reproduced.                                             |
| Vocal stab sampler                                       | 24 CC0 clips, waveform Start/End, duration rectangles, resize/join, Sustain, pitch/scale, eight automation lanes, recording, sharing, mixer and WAV export.                                                            |
| Browser reloads while playing                            | Removed a confirmed title-link reload trap. Reduced per-note delay allocation; desktop WebKit Nightshift audio-only memory was about 44% lower over three minutes. Spontaneous physical-iOS reload was not reproduced. |

## Latest follow-up requests

| Request                                             | Current state                                                                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two radical instruments                             | Cloud and Tension are implemented with six sounds each, eight controls, performance gestures, notes, automation, local recording, mixer, sharing and export. Chrome/WebKit checks pass; release verification is in progress. |
| Recover playback after a real reload                | Published in the recovery release. Same-tab recent playback resumes automatically when allowed or on the next control gesture. Explicit Stop, new tabs, incoming tracks and guests remain silent.                            |
| Vocal sound revision                                | Twenty-four real music recordings added in Soul, Chops and Dance banks; tuned chops retain their original registers. Four rhythm starters preserve trim and automation. Release verification is in progress.                 |
| Missing visualizer labels and dark instrument names | Published: the broad dark-label rule is scoped to light controls; visualizer labels are legible and instrument headings are white.                                                                                           |
| Exact unexplained Safari reload                     | Known navigation trigger fixed and audio memory pressure reduced. User reports no Safari error message. No automatic reload mechanism exists in the app; physical Safari cause remains unconfirmed.                          |

## Superseded requests

The PDF request was corrected to font samples. The font studies were superseded
by the supplied alphabet and the user's approval of its traced title. No further
font redesign or PDF generation is pending. Earlier colorful direction was
superseded by the requested monochrome retro interface; optional visualizer
palettes remain available. Cowbell and the original key instrument were replaced
as requested rather than kept as extra active parts.

## Verification limits

Automated phone checks use mobile viewports/touch and desktop WebKit, not a
physical iPhone or iPad. The isolated WebKit routed-socket fixture cannot reliably
force the local server to observe a close; its explicit outage case runs in
Chromium. Actual vocal collaboration and host-only audio are checked separately.
