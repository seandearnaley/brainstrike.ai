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

## Privacy policy and terms

`/privacy` and `/terms` are built from `legal/privacy.html` and
`legal/terms.html`: the page body only, with `{{LEGAL_NAME}}` and
`{{EFFECTIVE}}` filled in from the constants at the top of `build.mjs`. A token
left unfilled fails the build. Change `LEGAL_EFFECTIVE` whenever the wording
changes. Both pages are linked from the footer of every page, on phones too,
and from the app's Help menu.

## Docs and devlog

`docs/` is a separate project: the documentation and the devlog, served at
`docs.brainstrike.ai`. It is [Astro](https://astro.build) with
[Starlight](https://starlight.astro.build), and it has its own `package.json`
and lockfile, so the landing page above stays dependency-free.

```sh
cd docs
npm install
npm run dev      # http://localhost:4321
npm run build    # writes docs/dist
```

- **A docs page** is a Markdown file under `docs/src/content/docs/`. Its path
  is its URL. `title` is required and `description` feeds search results, link
  previews and `llms.txt`. Add the page to `sidebar` in
  `docs/astro.config.mjs`.
- **A devlog post** is a Markdown file in `docs/src/content/docs/devlog/`,
  served at `/devlog/<file name>/`:

  ```md
  ---
  title: Why the agent asks first
  date: 2026-11-12
  excerpt: One or two sentences for the list, the feed and the link preview.
  tags: [approvals]
  ---
  ```

  `title` and `date` are required. `draft: true` keeps a post out of the
  production build while it still shows in `npm run dev`. The feed is
  `/devlog/rss.xml`.
- **A diagram** is a Mermaid file in `docs/src/diagrams/`, drawn at build time
  by [pele](https://pele.run), the renderer the app uses in a thread. A page
  ends in `.mdx`, imports the file with `?raw` and passes it to `<Diagram>`
  (see `docs/src/content/docs/develop/architecture.mdx`). The result is inline
  SVG with no JavaScript, coloured by the variables in `brand.css`. Give a
  node a link with `click <id> href "<url>"`; linked boxes are outlined in the
  accent colour. Keep a diagram under about 620 wide so it shows at full size,
  and split one that grows past that into two levels.
- **Read the code** (`docs/src/content/docs/develop/`) maps the app's source
  and links into `seandearnaley/brainstrike` on `main`. Those links are not
  checked by the build, so check them when files move there.
- **The build fails** on a broken internal link or heading anchor, on invalid
  Mermaid, and on front matter that does not match the schema.
- **Every page gets** a social card at `/og/<path>.png`, an entry in the
  sitemap and in the Pagefind search index. `llms.txt`, `llms-small.txt` and
  `llms-full.txt` cover the docs and leave the devlog out.
- **The look** is `docs/src/styles/brand.css`: the landing page's ultramarine
  and chartreuse on Starlight's theme tokens, with the same two fonts.
- The scripts set `TZ=UTC` so a post's date reads the same locally as on
  Vercel, which builds in UTC.

Vercel serves it from a second project on this repository:

1. Create a project from this repository with **Root Directory** `docs`.
   Vercel detects Astro; no adapter or `vercel.json` is needed.
2. Add the domain `docs.brainstrike.ai` to that project.
3. Optional: set an Ignored Build Step on each project so a post does not
   rebuild the landing page and a landing change does not rebuild the docs.
   Docs project: `git diff --quiet HEAD^ HEAD -- .` Landing project:
   `git diff --quiet HEAD^ HEAD -- . ':!docs'`

"Edit page" links point at this repository on GitHub, so they work for
visitors only once it is public.

The devlog used to live here at `/notes`. `vercel.json` redirects
`/notes`, `/notes/<slug>/` and `/notes/feed.xml` to the devlog, its posts and
its feed. Every page's header links to the docs and the devlog, and advertises
the devlog's feed.

## Contact form

`/contact` is a form that posts to `api/contact.js`, a Vercel function deployed
alongside `dist/`. It emails each message as plain text through Resend, with
the sender's address as Reply-To. Set these on the Vercel project:

- `RESEND_API_KEY` (required): a Resend API key. Without it the form answers
  that it isn't working and nothing is sent.
- `CONTACT_TO` (required): the inbox that receives messages. Without it the
  form answers that it isn't working and nothing is sent. The address is kept
  out of the repository.

Until brainstrike.ai is verified as a sending domain in Resend, mail goes out
from Resend's shared test sender, which only delivers to the Resend account's
own address. Run `npm test` for the function's tests. They live in `test/`,
not `api/`, so Vercel does not deploy them as functions.

## The page

- Brainstrike is open source (MIT), and the page says so as loudly as it
  offers the download. Beside the big button sits **Open source on GitHub**,
  the same size in glass, linking to
  [seandearnaley/brainstrike](https://github.com/seandearnaley/brainstrike).
  The header of every page carries a GitHub pill (just the mark on a phone),
  and every footer starts with the source code and the MIT license. On a
  phone the source button comes after the list of builds. **Report a bug**
  opens the source repository's issues; the builds stay on
  brainstrike-releases.
- The big button names the visitor's build, from the browser's platform
  hints; the other builds sit beside it. Under it, one line says what that
  build needs: macOS 12 or later; Windows 10 or 11, the SmartScreen warning
  of an unsigned installer, and that agent commands run without a sandbox
  there and no Python is included; for Linux, `chmod +x` on the AppImage. On
  a phone the page lists every build and says Brainstrike is a desktop app.
- **Read the release notes** opens a dialog with the notes and every
  download's SHA-256 checksum.
- **Watch “Press Approve”**, the pill beside the notes, opens the music
  video in a dialog: `public/media/press-approve.mp4` (H.264 1080p30, about
  33 MB, loaded only when played), a poster, and the lyrics as captions
  (`press-approve.vtt`, off until chosen). The page's own music pauses when
  the video plays, and closing the dialog stops it. The film's source is the
  `film/music-video` branch of the brainstrike-film repo; re-encode from its
  master with `ffmpeg -i press-approve-1080p60.mp4 -vf fps=30 -c:v libx264
  -preset slower -crf 27 -tune animation -c:a aac -b:a 160k -movflags
  +faststart press-approve.mp4`.
- Download clicks are counted with Umami Cloud (free plan, no cookies):
  every download link carries a `Download` event with the build's `os`,
  `arch` and `package`, and the detect script keeps them in step when it
  repoints the big button. Umami's automatic page views are off and only
  `brainstrike.ai` is counted; page views belong to Vercel Web Analytics.
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
