# Stage 11 release

Published 7 November 2026 at 14:23:21.981866 UTC.

- Public application: https://acid-303.pages.dev/
- Pages deployment: `ba1da4a0-4e8f-4435-813d-6929e219c846`
- Immutable deployment: https://ba1da4a0.acid-303.pages.dev/
- Source: `e3ef989764569afd5ea4a504a44e3433b6f2651d`
- JavaScript: `index-CTXFZSiI.js`
- CSS: `index-CHgn4WOE.css`

Cloud and Tension now load twelve complete musical patches. Contact, Transit,
Drift and Halflight were reworked and lead the example strip. New browsers start
with Contact; saved projects and incoming shared tracks retain precedence.

The exact pushed commit was archived and built in isolation with TypeScript and
Vite. The approved analytics-enabled header override was copied explicitly:
SHA-256 `066825393a4641664f0a951d51570be4b2bc08dee10b1bcbcf4c8bc56bbd436d`.
Only its 78-file static output was uploaded from a configuration-free staging
directory. Production read-back matches the exact commit and successful release
timestamp. Pre-release integration checks included 197 unit tests, eight material
interaction cases in Chrome and WebKit, and twenty affected studio cases. Audio
checks rendered all twelve patches alone and with kick/hat/sub, plus four revised
example mixes and their featured stems in both browsers (64 renders). They
produced finite, unclipped output and complete silent tails; these were render
checks rather than a subjective listening review.

Canonical and immutable entry assets matched the isolated payload:

- JavaScript SHA-256:
  `ea445210ed9435ccc7473f1f38a3858f7396e578533935ed923e644fc2eed9e2`
- CSS SHA-256:
  `2635de7b9f7afa212a256ed870912699d94236852202abc828561054b9d60df2`

Nine focused tests passed against the public app with normal CSP, using desktop
Chrome, 320-pixel Chrome and 375-pixel WebKit. They verified all twelve sound
selectors, Contact startup, saved-project persistence, full patch articulation,
automation shifts, preservation of notes/timing/mix level, and single-step
undo/redo. At 320, 375 and 1440 pixels, the first examples were Contact, Transit,
Drift and Halflight, with no page overflow or browser errors.

Eight root/deep-route GET/HEAD checks and four entry-asset hash comparisons
passed. Native Pages analytics settings remained unchanged, with one injected
beacon, successful script GETs (200) and RUM POSTs (204). NFS Home retained its
unique canonical Grain link and working mobile navigation; no launcher edit was
needed. The unchanged audio catalog was not downloaded and rehashed again.

This was a Pages-only release. Worker version
`78889346-26cb-4ed2-b175-0b83c69f2f3a`, its Durable Object namespace and existing
API/schema were untouched. No session rooms were created. Access remains public
without sign-in; mobile checks used browser emulation.
