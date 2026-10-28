# brainstrike.ai

The download page for the Brainstrike desktop app: one static HTML file, no
framework and no dependencies.

`npm run build` (Node 24) runs `build.mjs`, which writes `dist/index.html`.
It walks the public release feed of
[seandearnaley/brainstrike-releases](https://github.com/seandearnaley/brainstrike-releases/releases)
(`releases.atom`, newest first, prereleases included) and downloads each
release's `release-manifest.json` until one exists. It makes no GitHub API
calls. The manifest is validated against schema v2 (the shape written by
`scripts/generate-release-manifest.mjs` in the brainstrike monorepo), and the
page links every download it lists, labelled Alpha or Beta from its channel.

- A manifest download that returns 404: that release is still publishing, so
  the build tries the next one.
- No release with a manifest yet: the page says the first beta is coming soon.
- A manifest that fails validation, any other HTTP error or a network error:
  the build fails. It never guesses filenames.

Vercel builds `main` with `npm run build` and serves `dist/`. A new release
appears only after the next build; the brainstrike repo holds a Vercel deploy
hook for `main` as the Actions secret `VERCEL_SITE_DEPLOY_HOOK` for that.

## Environment

| Variable | Use |
| --- | --- |
| `RELEASE_MANIFEST_FILE` | Optional. Path to a local manifest to render instead of reading GitHub, for previewing the download state before a release exists. |

```sh
RELEASE_MANIFEST_FILE=./sample-manifest.json npm run build
open dist/index.html
```
