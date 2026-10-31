# brainstrike.ai

The landing page for the Brainstrike desktop app: one screen with a live
WebGL2 agent, the download for the visitor's platform and the release
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
- `public/backdrop.js` is the live layer: the page is an agent that knows the
  visitor is there. A small chartreuse drop lives as the dot on the second
  "i" of the wordmark; it hops off, follows the cursor, visits whatever is
  hovered (elements marked `data-agent`), can be booped, picked up and
  thrown, and naps on its "i" after 15 idle seconds. It shows its work in a
  short log: the visitor's platform and the build it picked, the time of day,
  return visits (counted in this browser's `localStorage` only), tab
  switches and the like. Behind it a fine dot field leans toward it and
  lights up when it thinks.
- `public/synth.js` is the music, soft machine pop at 90 BPM: a Web
  Audio synth, off until the visitor presses play. The agent plays along: a
  chirp for each thought, a felt note for a boop, and the band drops to the
  pad while it naps.
- A lost GL context is rebuilt when the browser restores it. Without WebGL2
  the wordmark keeps its plain dot and the page says why in
  `html[data-backdrop-reason]`; reduced motion keeps the agent on its "i" and
  writes the log at once.
- The colours, favicon and social card come from the Brainstrike identity
  pack: ultramarine `#000CDE`, close to the web's original link blue, and
  chartreuse `#D0FB07`. The type is Instrument Sans with Geist Mono for the
  log, both OFL and served from `public/fonts/`.

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
