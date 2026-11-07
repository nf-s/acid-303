# Playback recovery release

Released 7 November 2026 at 13:55 UTC.

- Public application: https://acid-303.pages.dev/
- Pages deployment: `7a0b0ab4-5a89-4f84-b750-97706b7efe74`
- Immutable deployment: https://7a0b0ab4.acid-303.pages.dev/
- Source: `47354ff8638f06e109432bb3090bfaa8295566ab`
- Assets: `index-DOPGdFY-.js` and `index-BATgSJQw.css`

Recent playback intent now survives a tab reload. When browser autoplay rules
block recovery, one editing gesture or a direct Play resumes audio. A fresh
visit, explicit Stop, incoming shared track or guest role stays silent. Ordinary
session reconnection does not restart playback. Instrument headings are white
again, and the visualizer Intensity and Swirl labels retain their light colour.

## Isolated payload

The exact pushed commit was archived, then built and tested independently:
TypeScript/Vite build and all 176 unit tests passed. The approved existing
analytics header override was copied explicitly, retaining SHA-256
`066825393a4641664f0a951d51570be4b2bc08dee10b1bcbcf4c8bc56bbd436d`.

Only the 44 resulting static files were uploaded from a configuration-free
staging directory. They retain the Stage 9 catalog of 24 vocal clips. Uncommitted
Stage 10 instruments, alternate vocals and other drafts were excluded. The
production read-back matches the exact source commit. No Worker deployment,
binding, namespace or access change was made.

## Live verification

Eight focused tests of the deployed application passed against the canonical
origin with normal CSP: four in Chrome and four in WebKit. They cover phone title
taps without reload, recent playing-intent recovery, explicit Stop, blocked
recovery through an editing gesture or direct Play, and incoming shared-track
silence. The blocked-autoplay cases deliberately instrument the browser audio
API to make the blocked condition deterministic; these are separate from the
real session probe below. Component harness tests and the full application suite
were not repeated in production.

A real WebKit phone host and private Chrome guest joined the production Worker.
The playing host reloaded and resumed automatically without a recovery gesture.
The reloaded guest created zero AudioContexts and remained audio-silent. Taking
the host offline stopped playback; reconnecting restored the host role while
remaining stopped. The identified room was created at 13:56:20.522 UTC and ended
at 13:56:23.612 UTC. No test room was left active by this release.

Additional checks passed:

- At 320, 375 and 1440 pixels, all six instrument headings computed to white and
  both visualizer labels to `#eee`. The title, fonts, icons, collapsible controls
  and ten-channel mixer remained intact, with no horizontal overflow or browser
  errors. Mobile checks used browser emulation.
- Eight signed-out GET/HEAD checks covered root and deep routes across canonical
  and immutable origins with the expected CSP. Eighty-four asset hashes matched
  the isolated payload, including all 24 vocal clips on each origin.
- Native Pages analytics settings were preserved, with one injected beacon per
  page, successful script GETs (200) and RUM POSTs (204).
- NFS Home still had one Grain link to the canonical URL with `target="_self"`.
  Mobile navigation worked and its root stayed blank. No launcher edit or empty
  commit was needed.

The app remains public without sign-in. Earlier Stage 9 release evidence and its
separate diagnostic-room expiry exception remain in
[the Stage 9 release record](stage9-release.md).
