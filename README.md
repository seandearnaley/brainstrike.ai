# brainstrike.ai

The landing page for the Brainstrike desktop app: one screen with an animated
WebGPU backdrop, the download for the visitor's platform and the release
notes. Static files, no framework and no dependencies.

`npm run build` (Node 24) runs `build.mjs`, which writes `dist/`: the page,
`index.html`, plus everything in `public/`. It walks the public release feed of
[seandearnaley/brainstrike-releases](https://github.com/seandearnaley/brainstrike-releases/releases)
(`releases.atom`, newest first, prereleases included) and downloads each
release's `release-manifest.json` until one exists. It makes no GitHub API
calls. The manifest is validated against schema v2 (the shape written by
`scripts/generate-release-manifest.mjs` in the brainstrike monorepo), and the
page links every download it lists, labelled Alpha or Beta from its channel.
The feed entry also carries the release notes, rendered by GitHub; the page
keeps their headings, lists, emphasis, code and https links and drops anything
else.

- A manifest download that returns 404: that release is still publishing, so
  the build tries the next one.
- No release with a manifest yet: the page says the first beta is coming soon.
- A manifest that fails validation, any other HTTP error or a network error:
  the build fails. It never guesses filenames.

Vercel builds `main` with `npm run build` and serves `dist/`. A new release
appears only after the next build; the brainstrike repo holds a Vercel deploy
hook for `main` as the Actions secret `VERCEL_SITE_DEPLOY_HOOK` for that.

## The page

- The big button names the visitor's build, from the browser's platform
  hints; the other builds sit beside it. On a phone the page lists every build
  and says Brainstrike is a desktop app.
- **Read the release notes** opens a dialog with the notes and every
  download's SHA-256 checksum.
- `public/backdrop.js` draws the backdrop, a scene the visitor can play: one
  WebGPU shader ray-marches a glass core that changes shape every four bars,
  shards orbiting and streaming past, and a neon tunnel, all at 128 BPM; every
  eight bars the colors move to the next area. Drag to orbit, scroll or pinch
  to zoom, click the core to change its shape, click anywhere else to strike
  lightning (on the next sixteenth note), and hold the core to stretch it.
  The header shows the area and the bar.
- `public/synth.js` is its music: a Web Audio synth on the scene's clock,
  off until the visitor presses **Sound**.
- Without WebGPU the page keeps a still gradient, and the console says why;
  reduced motion draws one frame and takes no input.

## Environment

| Variable | Use |
| --- | --- |
| `RELEASE_MANIFEST_FILE` | Optional. Path to a local manifest to render instead of reading GitHub, for previewing the download state before a release exists. The page then links to the notes on GitHub. |

Serve `dist/` over HTTP to preview it: the page loads `/backdrop.js` as a
module from the site root, which a `file://` page cannot.

```sh
npm run build
python3 -m http.server --directory dist 8000
```
