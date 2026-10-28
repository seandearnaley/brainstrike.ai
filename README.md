# brainstrike.ai

The download page for the Brainstrike desktop app: one static HTML file, no
framework and no dependencies.

`npm run build` (Node 24) runs `build.mjs`, which writes `dist/index.html`.
It reads the newest published release of
[seandearnaley/brainstrike-releases](https://github.com/seandearnaley/brainstrike-releases/releases),
prereleases included, that carries a `release-manifest.json` asset, validates
that manifest against schema v2 (the shape written by
`scripts/generate-release-manifest.mjs` in the brainstrike monorepo) and links
every download it lists.

- No release with a manifest yet: the page says the first beta is coming soon.
- A manifest that fails validation, or a network or GitHub API error: the build
  fails. It never guesses filenames.

Vercel builds `main` with `npm run build` and serves `dist/`. A new release
appears only after the next build; the brainstrike repo holds a Vercel deploy
hook for `main` as the Actions secret `VERCEL_SITE_DEPLOY_HOOK` for that.

## Environment

| Variable | Use |
| --- | --- |
| `GITHUB_TOKEN` | Optional. Sent to the GitHub API when set. |
| `RELEASE_MANIFEST_FILE` | Optional. Path to a local manifest to render instead of querying GitHub, for previewing the download state before a release exists. |

```sh
RELEASE_MANIFEST_FILE=./sample-manifest.json npm run build
open dist/index.html
```
