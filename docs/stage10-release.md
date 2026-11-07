# Stage 10 release

Released 7 November 2026 at 14:06 UTC.

- Public application: https://acid-303.pages.dev/
- Pages deployment: `d02485f4-45e4-47d5-b994-807be2dba7db`
- Immutable deployment: https://d02485f4.acid-303.pages.dev/
- Source: `a0ff876b2635a19489d5893ef0968ab043bb508f`
- Assets: `index-BzFNyZAr.js` and `index-CHgn4WOE.css`

Cloud and Tension add granular and resonator performance surfaces, six sounds
each, independent sequencing and eight automation controls per instrument. The
new musical vocal bank adds 24 clips while retaining the original 24. The app
now has eight collapsible instrument panels and twelve mixer channels. The
default vocal selection is sound 34.

## Coordinated payload

The exact pushed commit was archived and built in isolation with TypeScript
checking and Vite. The approved analytics-enabled `public/_headers` override was
copied explicitly; its SHA-256 remains
`066825393a4641664f0a951d51570be4b2bc08dee10b1bcbcf4c8bc56bbd436d`.

Only the resulting 78 static files were uploaded from a configuration-free
staging directory. The shared working tree and `dist/` were not uploaded. The
new catalog has 48 entries with matching WAV paths; the original catalog and
original 24 files remain available for older tabs. The production read-back
identifies the exact source commit and expected entry assets. Before release,
the checkpoint passed 190 unit tests and the integration checks recorded by the
implementation agents; the full suite was not repeated in production.

The compatible Worker was deployed and verified before Pages:

- Version: `78889346-26cb-4ed2-b175-0b83c69f2f3a`
- Deployment: `f3b13d35-4937-4b8d-9758-eae182c98c8a`, serving 100%
- Downloaded module: 426,317 bytes
- SHA-256: `86258c5161ead75bc7859ea8be3e5a809098a26bdf17b85fb6300b656f41c8ff`

Its production protocol probe retained an existing v4 host and v3 guest across
the update. Both stayed connected. A v5 guest, highest new sound indexes,
preservation of new fields through legacy edits, role/capability reporting,
host replacement and room revocation passed. The identified room was created
at 14:04:41.344 UTC and ended at 14:05:28.738 UTC. Health returned 200; missing
and disallowed origins returned 403. Namespace and bindings were retained.
See [the session runbook](sessions.md) for compatibility and metered-usage checks.

## Live verification

The canonical app immediately showed both new performance surfaces, eight
collapse controls, twelve mixer channels and default vocal 34.

Six focused tests from the frozen source passed against the public application
with normal CSP: three in Chrome and three in WebKit. They exercised both new
instruments' six sounds, eight adjacent controls and preview; 320-pixel
performance gestures and scrolling outside the surfaces; and all vocal banks,
waveform selection, preview and persistence without changing the notes.

Additional checks passed:

- At 320, 375 and 1440 pixels, the title matched its approved SVG and remained
  centered. Eight instrument headings stayed white; Intensity and Swirl labels
  stayed light. Fonts, icons, mixer and vocal navigation worked, with no page
  overflow or console/page errors. Mobile checks used browser emulation.
- Eight public GET/HEAD checks covered root and deep routes across canonical
  and immutable origins, retaining the expected CSP.
- One hundred fifty direct asset SHA-256 comparisons matched the payload,
  including all 48 WAV files on both origins. The two audition HTML checks
  followed Pages' extensionless redirect and matched the original payload after
  removing only the native analytics injection, for 152 content comparisons in
  total.
- Native Pages analytics configuration was unchanged. Checked pages had one
  injected beacon, script GETs returned 200 and RUM POSTs returned 204.
- NFS Home retained one Grain link to the canonical URL with `target="_self"`.
  Mobile navigation worked and its root stayed blank. No launcher change or
  empty commit was required.

The Pages smoke checks used solo browser contexts and created no session rooms.
The Worker compatibility room was explicitly ended. The separate earlier
diagnostic expiry exception remains documented in
[the Stage 9 release record](stage9-release.md). Access remains public without
sign-in.
