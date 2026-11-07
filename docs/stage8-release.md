# Stage 8 release

Released 7 November 2026 at 12:33:42 UTC.

- Public application: https://acid-303.pages.dev/
- Pages deployment: `c6326fd5-eba7-419b-ab0b-02e88390753d`
- Immutable deployment: https://c6326fd5.acid-303.pages.dev/
- Source: `70d764c700f53cfb3702e8b9c90e76a2896373aa`
- Production branch: `main`
- Assets: `index-BvYJKbJg.js` and `index-CCSDAr6e.css`

The release adds the supplied vector title, header visualizer controls, local
automation recording, whole-loop automation editing, timing dialogs and session
settings inside Tools.

## Payload

The exact commit was archived into an isolated directory and built there with
TypeScript checking and Vite. The existing analytics-enabled `public/_headers`
was copied explicitly into that archive. Its SHA-256 is
`066825393a4641664f0a951d51570be4b2bc08dee10b1bcbcf4c8bc56bbd436d`.

Only the resulting 13 static files were uploaded from a configuration-free
staging directory. The shared working tree and its existing `dist/` were not
used. Stage 9 vocals and the archived title-font studies were excluded.

The compatible session Worker had already been verified at version
`050ccabe-6e63-4fe3-a89b-a1104b633673`, deployment
`2261beb1-daf2-41a3-9d2c-2022928a218d`. This Pages release did not change the
Worker, protocol v3 or its existing SQLite namespace.

## Production verification

The archived browser suite ran against the canonical origin with normal CSP.
All 66 deployed-application tests passed, including local and shared-clock
recording, 480-point whole-loop editing, concurrent edits, guest silence,
reconnection, timing dialogs, exports and mobile controls.

Two additional component-harness tests initially depended on Vite's
`/src/note-matrix.ts` endpoint, which production correctly does not publish.
They passed after the archived module was bundled for the test harness and
served through explicit module/bootstrap fixture routes. The harness enforced
the production CSP without a bypass. These two checks validate the frozen
component; they are separate from the 66 tests of the deployed application.

Additional checks passed:

- Twenty public GET/HEAD route and CSP checks across canonical and immutable
  origins, plus 22 byte-for-byte asset SHA-256 comparisons.
- Six checks confirmed excluded vocal/font-study paths return only the SPA
  fallback, with no excluded asset content.
- At 320, 375 and 1440 pixels, the vector paths and viewBox matched the approved
  SVG exactly. The title was centered at 160, 187.5 and 720 pixels respectively,
  with widths of 212, 267 and 300 pixels.
- No horizontal page overflow, missing icons, console errors or page errors.
  Header visualizer controls, Record, bottom navigation, session settings and
  native timing dialogs remained usable at each width.
- Native Pages analytics settings were retained. Each page had one injected
  beacon, a successful script GET (200) and a RUM POST (204).
- NFS Home retained one Grain link to the canonical URL with `target="_self"`.
  Mobile navigation worked and the launcher root remained blank. No launcher
  edit or empty commit was needed.

All production test rooms were explicitly ended. Application access remains
public without sign-in.
