# Stage 9 release

Released 7 November 2026 at 13:33:10 UTC.

- Public application: https://acid-303.pages.dev/
- Pages deployment: `ec548c46-934f-408d-8a24-0bb6a6dd0a29`
- Immutable deployment: https://ec548c46.acid-303.pages.dev/
- Source: `2edeabbc686c221f1848d20f9f2b424f9948f0a3`
- Production branch: `main`
- Assets: `index-CPMlPnzk.js` and `index-CqGMSqMx.css`

This release adds the 24-clip Vocal instrument, collapsible instrument headers,
inline page selection, the opening title animation, the Nightshift example and
the updated controls. The title no longer navigates or reloads the document.
The extra automation dot, key labels and brand icon are removed. Vocal state is
compatible with the preceding client through the coordinated Worker update.

## Payload and backend

The exact pushed commit was archived and built in an isolated directory with
TypeScript checking and Vite. The approved analytics-enabled `public/_headers`
was copied into that archive explicitly. Its SHA-256 remains
`066825393a4641664f0a951d51570be4b2bc08dee10b1bcbcf4c8bc56bbd436d`.

Only the resulting 44 static files were uploaded from a configuration-free
staging directory. All 24 WAV clips, their catalog, provenance and licenses are
included. The shared `dist/`, untracked playback-recovery files and subsequent
feature drafts were excluded. The production read-back identifies the exact
source commit and a successful deployment.

The compatible Worker was deployed and verified first:

- Version: `3c56cfca-efd3-4922-8842-40602c104ab5`
- Deployment: `87b4e001-a0c6-46af-8de8-5be5769f8af7`, serving 100%
- Downloaded module: 417,344 bytes
- SHA-256: `3ad4ae9fd22af2c49c81c816b2d206431f9afc797667595a264a9c7b2e104cfe`

The Worker release probe retained an identified v3 host and guest across the
update. Their sockets stayed open. Legacy edits, v4 vocal edits, projected empty
legacy revisions, capability reporting, host replacement and revocation passed.
That room was created at 13:31:55.982 UTC and ended at 13:32:31.256 UTC. Health
returned 200; missing and disallowed origins returned 403. The existing namespace
and bindings were retained. Backend tests and metered-usage details are recorded
in [the session runbook](sessions.md).

## Production verification

Fourteen focused tests from the frozen checkout passed against the canonical
origin with normal CSP. They cover the phone title regression, instrument
collapse, opening animation, mixer controls, touch page selection, vocal banks,
note rectangles, all eight vocal automation lanes, phone trim controls, pending
sample cancellation and the timing of trim automation in WAV export. The full
browser suite was not repeated in production; this pass targets the released
changes after the integration checks performed before release.

Additional production checks passed:

- Chrome and WebKit at 320 and 375 pixels: tapping the title did not reload the
  document or stop playback; collapsed drums stayed collapsed; bottom navigation
  reopened them; no page overflow or page errors occurred.
- At 320, 375 and 1440 pixels: the SVG matched the approved source and remained
  centered. All six collapse controls, the ten-channel mixer, vocal navigation,
  waveform and eight-sound bank were present. Fonts and icons loaded, the extra
  automation dot was absent, and no console/page errors or overflow occurred.
- Eight public GET/HEAD checks covered root and deep routes on canonical and
  immutable origins with the expected CSP. Eighty-four asset SHA-256 comparisons
  matched the isolated payload, including all 24 WAV clips on both origins.
- Native Pages analytics settings were retained. Each checked page had one
  injected beacon; script GETs returned 200 and RUM POSTs returned 204.
- NFS Home retained one Grain link to the canonical URL with `target="_self"`.
  Mobile navigation worked and the launcher root remained blank. No launcher
  edit or empty commit was needed.

A Chrome host and a WebKit phone guest synchronized Vocal sound and trim edits.
With the other instruments muted, the host scheduled eight sample starts while
the guest created zero audio contexts, including after pressing Preview. Guest
Play/Stop requests reached the host and both interfaces followed the clock. The
room was created at 13:36:12.844 UTC and ended at 13:36:16.825 UTC, with no browser
errors.

An earlier identified session probe was also explicitly ended at 13:35:15.730
UTC. Its transport assertion ran ahead of the guest's updated clock display;
the corrected probe waited for both interfaces before each subsequent toggle.
All rooms created for this Stage 9 release were ended. The separate, previously
reported Stage 8 diagnostic room without retained credentials remains subject
to its existing expiry; it was not identified or modified during this release.

Access remains public without sign-in. Mobile verification used browser
emulation, not a physical device.
