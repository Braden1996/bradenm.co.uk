<!-- cspell:ignore bunx -->

# Deployment

GitHub Actions builds and checks the static Astro site, then uploads the tested `dist/` output to
Cloudflare Pages project `bradenm-co-uk`. The production branch is `master` and the intended custom
domain is [bradenm.co.uk](https://bradenm.co.uk).

The Cloudflare dashboard was verified on 8 September 2026: this is a Direct Upload project with
production branch `master`, and both `bradenm.co.uk` and `www.bradenm.co.uk` are active with SSL.
GitHub has the deployment secret and matching account variable. The CD run records the tested
commit and deployment URL after each successful upload.

## Build and CI

Use Node 24 from `.node-version` and the Bun version pinned in `package.json`. Install dependencies
with `bun ci`, which uses the committed lockfile without updating it. Reproduce the CI build with:

```sh
bun ci
BOOKSHELF_METADATA_OFFLINE=1 bun run check
BOOKSHELF_METADATA_OFFLINE=1 bun run build
bun run check:deployment
bunx playwright install --with-deps chromium
bun run check:browser
bun run check:performance
```

Offline metadata generation uses the committed catalogue sources. Refresh and commit those sources
separately when changing the bookshelf; see [bookshelf metadata](bookshelf-metadata.md).

[CI](../.github/workflows/ci.yml) runs for pull requests, pushes to `master`, and manual runs. It
runs repository checks and produces one static build. The `site-dist-<commit SHA>` artifact contains
`dist/`; browser behaviour and performance checks download and test that exact output. Build output
and browser/performance evidence are retained for 14 days. Lighthouse runs separately from three
browser shards, each with one browser worker on its own machine. All jobs must succeed before
deployment. Diagnostic artifacts are named `lighthouse` and `browser-1` through `browser-3`.

The deployment output check verifies required pages and headers, rejects non-regular files, and
enforces the [Pages Free plan asset limits](https://developers.cloudflare.com/pages/platform/limits/)
of 20,000 files and 25 MiB per file before upload.

[CD](../.github/workflows/cd.yml) runs after CI succeeds. It accepts only a push or manual CI run
from this repository on `master`, checks that the tested commit is still the latest `master`
commit, and downloads the artifact from that specific CI run. Deployment passes `--branch=master`
and the tested `--commit-hash` to Wrangler. Pull requests, failed CI, and superseded commits do not
deploy. There is no separate unchecked manual deployment trigger.

The normal build uses committed assets in `public/`, including every font referenced by the site.
Astro includes the shared layout stylesheet in the HTML (up to 32 KiB) to avoid an extra request
before first paint; route styles remain separately cached.
Docker is optional: `bun run build:docker` packages a static build, and `bun run build:fonts`
regenerates font subsets from `fonts/source/`. Review and commit regenerated `public/fonts/` files
when changing fonts; CI does not regenerate them during deployment.

## Cloudflare and GitHub configuration

This uses [Pages Direct Upload with CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).
GitHub owns the build process, so a Cloudflare build command, framework preset, and Git integration
are not required. Do not enable a second automatic Cloudflare build alongside this pipeline.

1. In the intended Cloudflare account, open **Workers & Pages** and select `bradenm-co-uk`. If it
   does not exist, create a Pages project using Direct Upload with that exact name. Confirm its
   production branch is `master`.
2. Create or verify a Cloudflare API token with **Account → Cloudflare Pages → Edit**, scoped to
   that account. In the GitHub repository's **Settings → Secrets and variables → Actions**, save
   it as the repository secret `CLOUDFLARE_API_TOKEN` and save the account ID as the repository
   variable `CLOUDFLARE_ACCOUNT_ID`. Token values belong in GitHub secrets, never in the repository.
3. In the Pages project's **Custom domains**, associate `bradenm.co.uk` through **Set up a domain**.
   For this apex domain, the zone must belong to the same Cloudflare account and its registrar
   nameservers must point to Cloudflare. Confirm the DNS record offered by the setup flow and wait
   for the custom domain to become active. See [Cloudflare custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).
4. Run CI on `master` once the workflow changes are on that branch. After CI and CD succeed,
   confirm the production deployment in Pages names the same commit. Open the deployment URL and
   `https://bradenm.co.uk`, then test `/`, `/bookshelf`, navigation, missing-page behaviour, fonts,
   and the response headers in `public/_headers`. Follow the
   [deployment verification checks](performance.md#deployment-verification).

## Redeploy and recover

For a fresh deployment of the current source, open **GitHub Actions → CI → Run workflow**, select
`master`, and run it. All checks run again before CD uploads the new artifact. This also works after
the previous artifact expires. An older commit is intentionally skipped when it is no longer the
latest `master` commit.

If CD fails because of an expired token or account configuration, fix the setting and rerun CI on
`master`. Review the failing job log first: an authentication failure is separate from a build or
browser test failure. A skipped CD job usually means CI failed, the run was ineligible, or a newer
commit reached `master`.

For an immediate rollback, open **Workers & Pages → bradenm-co-uk → Deployments**. Find a known good
production deployment, open its three-dot menu, choose **Rollback to this deployment**, and confirm.
Only successful production deployments are rollback targets; see [Cloudflare rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/).
Verify the custom domain afterwards. A rollback changes hosted output, not Git history: revert or
fix the source on `master` before the next successful CI deployment replaces it. If a deployment
is already pending during recovery, pause the CD workflow in GitHub until the source is ready.
