# brainstrike.ai

The landing page for the Brainstrike desktop app: one screen with a playable
WebGL2 backdrop, the download for the visitor's platform and the release
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
- `public/backdrop.js` draws the backdrop, the 1990s pipe screensaver
  rebuilt with WebGL2: chrome, enamel and pearl pipes grow one cell a beat
  over an endless checkerboard floor under a link-blue sky, with two Mystify
  ribbons behind them. The music's two 16-bar sections, Daylight and Night
  mall, change the sky; at each change the pipes dissolve, dithered down to
  the web-safe palette, and new ones start. Drag to orbit, scroll or pinch to
  zoom, click empty space to start a pipe, click a pipe to ring it, pull a
  pipe to bend it. The header's little CD player shows the track and time.
- `public/synth.js` is its music, 90s internet dreamwave at 100 BPM: a Web
  Audio synth on the scene's clock, off until the visitor presses play. Every
  turn a pipe takes plays a note of the chord.
- A lost GL context (sleep and wake, a GPU switch, a backgrounded phone tab)
  is rebuilt when the browser restores it. Without WebGL2 the page keeps its
  CSS sky and says why in `html[data-backdrop-reason]`; reduced motion draws
  one frame and takes no input.
- The colours, favicon and social card come from the Brainstrike identity
  pack: ultramarine `#000CDE`, close to the web's original link blue, and
  chartreuse `#D0FB07`. The fonts (Geist, Geist Mono and Silkscreen, all OFL)
  are served from `public/fonts/`, so no outside stylesheet holds up the page.

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
