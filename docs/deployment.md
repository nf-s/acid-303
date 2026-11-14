# Cloudflare Pages release

Production: https://acid-303.pages.dev/

The `acid-303` Pages project uses direct uploads to its `main` production branch.
Only the generated `dist/` directory is uploaded to Pages. Shared sessions use
the separate `grain-sessions` Worker and SQLite Durable Objects. Follow
[the session release and metered-usage review](sessions.md) for that backend.

## Access

The operator explicitly chose public access without sign-in for this app on
7 November 2026. Both the canonical Pages URL and its deployment addresses are
public. The temporary ACID 303 Access application was removed before release;
other applications and account identity providers were left unchanged.

Account identifiers remain in Cloudflare configuration; credentials are never
part of the build or source repository. Solo patterns stay in each visitor's
browser; creating or joining a session synchronizes its musical state through
the session Worker. Audio stays on the host device.

## Release procedure

1. Check the authenticated Cloudflare account and current `acid-303` project.
2. Run `npm test` and `npm run build`. Verify audio, controls, exported WAV, and
   responsive layouts locally. Run the configured formatter before committing.
3. Using the existing authenticated Pages CLI, upload only `dist/`:

   ```sh
   wrangler pages deploy dist --project-name acid-303 --branch main
   ```

4. Read back the production deployment. Check that signed-out GET and HEAD
   requests to the canonical URL, a deep route, direct assets and the immutable
   deployment URL return the intended public application content. Confirm that
   no sign-in redirect remains and that the mobile layout works.
5. Keep the canonical production URL in NFS Home's app directory. Publish
   launcher edits through its existing GitHub Pages `main`/`docs` process.

The initial release uses the existing authenticated Wrangler 4.152.0 install
for Pages Direct Upload, without adding a CLI dependency to this application.
Audio and visualization run on visitors' devices. Shared sessions add metered
Worker requests, Durable Object messages and SQLite snapshot writes; review
[session costs and measured queries](sessions.md#metered-usage-review) before
changing or publishing those paths.

Reference: [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Web Analytics

Cloudflare Pages native Web Analytics is enabled for this project. Do not add a
manual beacon script: Pages injects one during deployment. The public CSP in
`public/_headers` permits `https://static.cloudflareinsights.com` for scripts and
`https://cloudflareinsights.com` for analytics connections; retain the other
security directives.

Keep the project's `build_config.web_analytics_tag` and
`build_config.web_analytics_token` settings intact during releases. Upload from a
config-free staging directory containing only the approved built assets when
Wrangler config discovery could override those settings. Read the project back
after upload and verify one injected beacon, a successful beacon script GET
(200), and an analytics POST to `/cdn-cgi/rum` (204) in a fresh browser context.
Analytics does not require sign-in or change local pattern/audio storage.

The analytics-only release on 7 November 2026 used an isolated build of commit
`0e7bcbe`, verified byte-for-byte against the prior live assets before deployment.
Only CSP allowances and native analytics injection changed in production; the
concurrent local visual redesign was not included.

## Session screen and tool row release

Published 14 November 2026 at 04:15:48 UTC from commit `86e6f0a` as deployment
`76e3744c-7e82-4c53-9abc-bc91e0333cae` (https://76e3744c.acid-303.pages.dev).
`cf` exposes Pages publishing only as the raw API, so `dist/` was uploaded with an
already-authenticated Wrangler 4.160.1 from a config-free staging directory.
114 files; 3 were new. JavaScript `index-D3hfqQ3V.js` served from the canonical
and immutable URLs matched the local build (SHA-256 prefix `69c1a572fe1b99a6`).

Read-back: the analytics tag and token settings remain set; the canonical page
has one beacon, the beacon script returns 200, and the CSP matches
`public/_headers`. A deep route returns 200. Before release, 4,278 unit tests
passed. On the canonical origin, a host created a session, a guest joined with the
studio switch disabled, the host's switch to Fluff reached the guest with the same
track (134 BPM), ending showed "Session ended" on both sides and Continue solo
restored editing. An invite to a missing room showed "Can't connect to session"
within five seconds and Leave session cleared it. The test room was ended.

## Chords and Fluff examples release

Published 14 November 2026 at 04:20 UTC from commit `cfbba4e` as deployment
https://9384e10c.acid-303.pages.dev. `dist/` (115 files) was uploaded with the
already-authenticated Wrangler 4.158.0 from a config-free staging directory. The
build includes the session screen and tool row release above.

Read-back on the canonical origin: one analytics beacon, the CSP header is
present and a deep route returns 200. Fluff lists the five new examples (Sodium,
Slow Turn, Brickwork, Late Bus, Parallax), the progression groups and chord types
are present, playback starts and the console shows no errors. Before release,
400 unit tests and 170 end-to-end tests passed; the last merge after that run
changed only documentation, `public/_headers` and the Worker config. The session
Worker was not redeployed, so chord types fall back to sevenths in live sessions.
