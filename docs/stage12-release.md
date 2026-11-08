# Stage 12 release

Source: `00522b0baa6625f887c6bfddc1292e51e7c9d1cb`.
Public application: https://acid-303.pages.dev/.

Pages completed at 09:35:23.068462 UTC on 8 November 2026:

- Pages deployment: `d80be0c4-24f8-4724-9cab-3daa79c2080b`
- Immutable deployment: https://d80be0c4.acid-303.pages.dev/
- JavaScript: `index-_bJt4xw4.js`
- CSS: `index-CtA3rBn2.css`
- Capture worklet: `recording-worklet-B37fVpVw.js`

The exact pushed commit was archived and built in isolation. The approved current
analytics-enabled headers were copied explicitly, including the committed
`microphone=(self)` policy. Only the 79-file static output was uploaded from a
configuration-free staging directory. The approved header SHA-256 is
`2353170acfe2bbaad8255725ee77e36963470e258eb41cae7c64d1743971649a`.

Canonical and immutable asset hashes:

- JavaScript: `6b69c25665a1c3d99126578fc74f8677a5115a21089f2990baca3202592a2887`
- CSS: `a5da8d78141bc04aa3abf51191ce9024b9e630c0ba0b4afdbaace0b495a6344b`
- Worklet: `10cb3b2e60283be23624439c652c397983a397343022d94364ee31a0bda877cf`

The Worker was published first at 09:33:52.726777 UTC on 8 November 2026:

- Worker version: `4a1cab38-0323-46c8-91b6-a1b3f21870f7`
- Worker deployment: `4b997b2d-c4fc-4a29-85c0-48fd46229aa8` at 100%
- Module size: 453,440 bytes
- Module SHA-256: `35820c87781d692c3fe011ca2822fdcc4382129779721a4f28d6d297b53f0ad0`
- Existing SessionRoom namespace: `ffe237d4fde14ba99780aa4f28eb4bec`, unchanged
- New SampleStore namespace: `f368b26b743f4b3393c20bdd93f866bd`

The resource diff added only the sample namespace and its upload/read rate limits.
Localhost access remains disabled in production. The exact prebuilt Worker was
uploaded using the existing authenticated script API workflow after the CLI
ownership guard declined the already script-API-managed service.

## Delivered behavior

Shared Chords is independent of the Pad, with Follow chords switches on Pad,
Arp and Vocal. Local note pools and chord settings remain available when following
is turned off. Sequence and Automation use consistent collapsible sections with
musical context visible beneath curves. Each instrument can keep automation
linked to its sequence or choose its own 1, 2, 4, 8 or 16-bar loop on the common
transport clock. Drum Advanced mode provides these controls per drum.

Vocal records up to ten seconds through a same-origin AudioWorklet, or imports
bounded PCM WAV files and normalizes them locally. Canonical audio is stored on
the device until Share, Create session or Use in session explicitly uploads it.
Separate capability-protected assets avoid embedding PCM in project links.
Shared copies expire after approximately 30 days without server access, with
bounded durable quotas and authenticated deletion. Missing samples leave the
rest of the project playable. See [recording design and limits](recordings.md).

Project version 6 preserves existing musical values, with migration covering
saved projects, presets, Undo/Redo, sharing and sessions. Older clients receive
compatible projections and cannot erase hidden independent curves or recording
references. See [composition architecture](composition.md) and
[session compatibility](sessions.md).

## Pre-release verification

- 237 unit tests across 24 files, strict TypeScript, formatting and diff checks.
- Worker typecheck and all 30 runtime tests, including durable quota,
  authentication, expiry, session compatibility and reserved close-code handling.
- 45 studio browser cases; 19 automation overview/recording/drum section cases.
- Eight composition UI cases across Chrome and WebKit, including 390px touch,
  following/local restoration, history, persistence and longer automation.
- 44 focused audio/performance/vocal browser cases across Chrome and desktop
  WebKit. These verify render/timing behavior rather than subjective listening.
- Seven recording flows in each browser, plus four built-production strict-CSP
  recording cases in each browser. The latter exercise the real emitted
  AudioWorklet, local storage, capture cancellation, denial and import.
- Targeted regressions cover all 480 automation points, a late upload response,
  expiry/re-share credential reuse, deletion racing upload, and microphone release
  when a worklet stops responding.

WebKit checks exposed and fixed local Blob persistence failures by storing PCM
ArrayBuffers and reconstructing Blobs on read. Production CSP checks also caught
an inlined worklet URL; the build now emits a separate same-origin asset. Mobile
checks use touch/viewport emulation and desktop WebKit, not physical iPhone
microphone hardware.

## Production verification

Seven Chrome recording/private-sharing cases and four WebKit recording cases
passed against the canonical public app with its normal CSP. These cover the
actual worklet, persistence, WAV import, cancellation/denial, explicit guest
sharing while the host edits, host-only preview, lost-response renewal,
authenticated deletion and End session. Fixture audio is synthetic; no physical
microphone was opened.

Canonical and immutable JavaScript, CSS and worklet assets match the isolated
payload. Deep routes return 200; microphone permission is restricted to self,
public access needs no sign-in, and native Pages analytics settings remain intact.
The unique NFS Home Grain entry still points to the canonical URL, requiring no
launcher change.

A separate root review of the published 390px touch layout confirmed the Chords
disclosure works, document width equals the viewport, and no page errors occurred.
The screenshot was visually inspected with the normal visualizer and controls.

A further three production composition cases passed for shared chords,
eight-bar automation and phone timing. Fresh Chrome/WebKit contexts at 320,
375 and 1440 pixels had no overflow or page errors. Each loaded one native
analytics beacon (GET 200) and sent a successful RUM request (POST 204).

The recording suite ended its identified v6 test room. Uploaded/renewed copies
were deleted with their matching owner capabilities, including both known IDs
from the lost-response fixture and the guest-session copy.

## Live session continuity

One separate identified v5 host/guest room was created at 09:19:30 UTC and held
open through both deployments. The original pages had no additional navigation,
reloads, reconnect welcomes or page errors. Bass and Pad edits synchronized
before and after the upgrade.

A fresh canonical v6 guest joined the same room at revision 4, correctly saw
`supportsComposition: false`, and displayed the older-host limitation when
Session was opened. Its cutoff edit reached both older clients. Independent
eight-bar Bass automation and Arp chord following persisted canonically while
the v5 projection omitted unsupported fields and muted the following Arp.
Attempting Use in session for an imported local recording was rejected with the
older-host message before any sample upload; the guest created no AudioContexts.

At 09:39:21 UTC the original host explicitly ended this room, and all three
clients displayed Session ended. Probe contexts/processes were closed and the
private credential files removed. This check did not touch any other room.
