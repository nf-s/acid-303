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
