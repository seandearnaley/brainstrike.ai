// Writes dist/, the Brainstrike landing page: dist/index.html plus everything
// in public/ (the WebGL2 backdrop, its synth, the fonts and the icons).
//
// The page is built from the newest published release (prereleases included)
// of seandearnaley/brainstrike-releases that carries a release-manifest.json
// asset. Releases come from the public Atom feed, newest first, so the build
// makes no GitHub API calls; the feed entry also carries the release notes,
// which the page shows. A manifest download that returns 404 means that
// release is still publishing, and the next entry is tried. The manifest is
// validated against schema v2, the shape written by
// scripts/generate-release-manifest.mjs in the brainstrike monorepo. With no
// release carrying a manifest the page says the first beta is coming soon. A
// manifest that fails validation, any other HTTP error or a network error
// fails the build.
//
// Environment:
//
// It also writes dist/privacy/index.html and dist/terms/index.html from
// legal/privacy.html and legal/terms.html, filling in the publisher and
// effective date below (a {{TOKEN}} left unfilled fails the build), and the
// contact form at dist/contact/index.html with its no-JavaScript thank-you page
// at dist/contact/sent/index.html. The form posts to api/contact.js.
//
//   RELEASE_MANIFEST_FILE  optional; render this local manifest file instead of
//                          reading GitHub, to preview the download state. The
//                          page then links to the notes instead of showing them.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIST = path.join(import.meta.dirname, 'dist');
const PUBLIC = path.join(import.meta.dirname, 'public');
const LEGAL = path.join(import.meta.dirname, 'legal');

// Who publishes the privacy policy and terms, and when they took effect. Change
// LEGAL_EFFECTIVE whenever either page's wording changes.
const LEGAL_NAME = 'brainstrike.ai';
const LEGAL_EFFECTIVE = 'November 1, 2026';
const LEGAL_PAGES = [
  {
    description: 'What Brainstrike and brainstrike.ai do with your information.',
    file: 'privacy.html',
    route: 'privacy',
    title: 'Privacy Policy',
  },
  {
    description: 'The terms for using the Brainstrike desktop app and brainstrike.ai.',
    file: 'terms.html',
    route: 'terms',
    title: 'Terms of Service',
  },
];

const MANIFEST_ASSET = 'release-manifest.json';
const ARTIFACT_BASE_URL =
  'https://github.com/seandearnaley/brainstrike-releases/releases/download/';
const RELEASES_HUB_URL = 'https://github.com/seandearnaley/brainstrike-releases/releases';
const RELEASES_FEED = `${RELEASES_HUB_URL}.atom`;
const FEED_ENTRY = /<entry>([\s\S]*?)<\/entry>/gu;
const ENTRY_TAG =
  /<link\b[^>]*\bhref="https:\/\/github\.com\/seandearnaley\/brainstrike-releases\/releases\/tag\/([^"]+)"/u;
const ENTRY_NOTES = /<content type="html">([\s\S]*?)<\/content>/u;

const PLATFORM_BY_PACKAGE = { appimage: 'linux', dmg: 'macos', nsis: 'windows' };
const ARCHITECTURES = new Set(['arm64', 'universal', 'x64']);
// The generator's tag rule: v<major>.<minor>.<patch>, optionally -alpha.<n> or
// -beta.<n>. The prerelease id is the manifest's channel; no id means stable.
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.(0|[1-9]\d*))?$/u;
const CHANNEL_LABELS = { alpha: 'Alpha', beta: 'Beta', stable: null };
const SOURCE_COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:([a-f0-9]{64})$/u;

const PLATFORMS = [
  { id: 'macos', label: 'macOS' },
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
];
const ARCHITECTURE_LABELS = {
  linux: { arm64: 'arm64', universal: 'Universal', x64: 'x64' },
  macos: { arm64: 'Apple silicon', universal: 'Universal', x64: 'Intel' },
  windows: { arm64: 'arm64', universal: 'Universal', x64: 'x64' },
};
const PACKAGE_LABELS = { appimage: 'AppImage', dmg: 'DMG', nsis: 'installer' };
// What a build needs, shown under the big button for the visitor's platform.
// macOS 12: Electron 38 and later need it, and the app ships Electron 45.
// Windows: the agent's commands run outside any sandbox there and no Python
// is bundled (docs/agents/code-execution.md in the brainstrike monorepo).
const PLATFORM_NOTES = {
  linux: 'Make the AppImage executable (chmod +x), then run it.',
  macos: 'Needs macOS 12 or later.',
  windows:
    'Needs Windows 10 or 11. Not code-signed yet, so SmartScreen warns first. On Windows, agent commands run without a sandbox, and Python is not included.',
};

function fail(message) {
  throw new Error(message);
}

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail(`${source} is not valid JSON: ${error.message}`);
  }
}

function expectKeys(value, keys, where) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${where} must be an object.`);
  }
  const actual = Object.keys(value).sort().join(', ');
  const expected = [...keys].sort().join(', ');
  if (actual !== expected) {
    fail(`${where} has keys [${actual}], expected [${expected}].`);
  }
}

function expectEqual(actual, expected, where) {
  if (actual !== expected) {
    fail(`${where} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
  }
}

function validateManifest(manifest, source) {
  const where = (path) => `${source}: ${path}`;
  expectKeys(manifest, ['channel', 'distribution', 'latest', 'product', 'schemaVersion'], where('manifest'));
  expectEqual(manifest.schemaVersion, 2, where('schemaVersion'));
  expectEqual(manifest.product, 'Brainstrike', where('product'));
  if (!Object.hasOwn(CHANNEL_LABELS, manifest.channel)) {
    fail(`${where('channel')} ${JSON.stringify(manifest.channel)} is not alpha, beta or stable.`);
  }
  expectKeys(manifest.distribution, ['artifactBaseUrl', 'releasesHubUrl'], where('distribution'));
  expectEqual(manifest.distribution.artifactBaseUrl, ARTIFACT_BASE_URL, where('distribution.artifactBaseUrl'));
  expectEqual(manifest.distribution.releasesHubUrl, RELEASES_HUB_URL, where('distribution.releasesHubUrl'));

  const { latest } = manifest;
  expectKeys(latest, ['assets', 'publishedAt', 'sourceCommit', 'tag', 'version'], where('latest'));
  const { tag, version } = latest;
  const tagMatch = typeof tag === 'string' ? TAG.exec(tag) : null;
  if (tagMatch === null) {
    fail(
      `${where('latest.tag')} ${JSON.stringify(tag)} is not v<major>.<minor>.<patch>, optionally -alpha.<n> or -beta.<n>.`
    );
  }
  expectEqual(version, tag.slice(1), where('latest.version'));
  expectEqual(manifest.channel, tagMatch[4] ?? 'stable', `${where('channel')} for version ${version}`);
  if (typeof latest.sourceCommit !== 'string' || !SOURCE_COMMIT.test(latest.sourceCommit)) {
    fail(`${where('latest.sourceCommit')} must be a full 40-hex Git commit id.`);
  }
  if (
    typeof latest.publishedAt !== 'string' ||
    Number.isNaN(Date.parse(latest.publishedAt)) ||
    new Date(latest.publishedAt).toISOString() !== latest.publishedAt
  ) {
    fail(`${where('latest.publishedAt')} must be an ISO 8601 UTC timestamp.`);
  }
  if (!Array.isArray(latest.assets) || latest.assets.length === 0) {
    fail(`${where('latest.assets')} must be a non-empty array.`);
  }

  const tuples = new Set();
  latest.assets.forEach((asset, index) => {
    const at = where(`latest.assets[${index}]`);
    expectKeys(asset, ['architecture', 'digest', 'name', 'package', 'platform', 'sizeBytes', 'url'], at);
    const { architecture, digest, name, package: pkg, platform, sizeBytes, url } = asset;
    if (typeof name !== 'string' || name.length === 0 || !name.includes(version)) {
      fail(`${at}.name ${JSON.stringify(name)} must embed release version ${version}.`);
    }
    if (!Object.hasOwn(PLATFORM_BY_PACKAGE, pkg) || PLATFORM_BY_PACKAGE[pkg] !== platform) {
      fail(`${at}: package ${JSON.stringify(pkg)} is not valid for platform ${JSON.stringify(platform)}.`);
    }
    if (!ARCHITECTURES.has(architecture)) {
      fail(`${at}.architecture ${JSON.stringify(architecture)} is not supported.`);
    }
    if (!(Number.isSafeInteger(sizeBytes) && sizeBytes > 0)) {
      fail(`${at}.sizeBytes must be a positive integer.`);
    }
    if (typeof digest !== 'string' || !DIGEST.test(digest)) {
      fail(`${at}.digest must be "sha256:" followed by a lowercase 64-hex digest.`);
    }
    const expectedUrl = new URL(
      `${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
      ARTIFACT_BASE_URL
    ).href;
    expectEqual(url, expectedUrl, `${at}.url`);
    const tuple = `${platform}:${architecture}:${pkg}`;
    if (tuples.has(tuple)) {
      fail(`${at}: duplicate platform/architecture/package "${tuple}".`);
    }
    tuples.add(tuple);
  });
  return manifest;
}

// Returns the response body, or null for a 404 when notFoundIsNull is set.
async function get(url, { notFoundIsNull = false } = {}) {
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': 'brainstrike.ai-build' } });
  } catch (error) {
    fail(`GET ${url} failed: ${error.cause?.message ?? error.message}`);
  }
  const body = await response.text();
  if (response.status === 404 && notFoundIsNull) {
    return null;
  }
  if (!response.ok) {
    fail(`GET ${url} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return body;
}

const XML_ENTITIES = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };
const unescapeXml = (text) =>
  text.replace(/&(?:(amp|apos|gt|lt|quot)|#(\d+)|#x([0-9a-fA-F]+));/gu, (_, name, decimal, hex) =>
    name ? XML_ENTITIES[name] : String.fromCodePoint(decimal ? Number(decimal) : Number.parseInt(hex, 16))
  );

// The tags release notes keep, and what each becomes. GitHub renders the
// notes' Markdown into the feed; the page keeps these tags, drops every
// attribute but an https link, and moves headings below the dialog's title.
const NOTE_TAGS = new Map(
  Object.entries({
    a: 'a',
    b: 'strong',
    blockquote: 'blockquote',
    br: 'br',
    code: 'code',
    em: 'em',
    h1: 'h3',
    h2: 'h3',
    h3: 'h4',
    h4: 'h4',
    h5: 'h4',
    h6: 'h4',
    i: 'em',
    li: 'li',
    ol: 'ol',
    p: 'p',
    pre: 'pre',
    strong: 'strong',
    ul: 'ul',
  })
);

function sanitizeNotes(html) {
  return html
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/gu, (_, closing, name, attributes) => {
      const tag = NOTE_TAGS.get(name.toLowerCase());
      if (tag === undefined) {
        return '';
      }
      if (closing) {
        return tag === 'br' ? '' : `</${tag}>`;
      }
      if (tag === 'a') {
        const href = /\bhref="(https:\/\/[^"]*)"/u.exec(attributes)?.[1];
        return href ? `<a href="${href}" rel="noopener">` : '<a>';
      }
      return `<${tag}>`;
    })
    .trim();
}

// Returns the newest published manifest and that release's notes, or a null
// manifest when no release carries one.
async function loadPublishedRelease() {
  const feed = await get(RELEASES_FEED);
  if (!/<feed\b/u.test(feed)) {
    fail(`${RELEASES_FEED} did not return an Atom feed.`);
  }
  for (const [, entry] of feed.matchAll(FEED_ENTRY)) {
    const encodedTag = ENTRY_TAG.exec(entry)?.[1];
    if (encodedTag === undefined) {
      fail(`${RELEASES_FEED} has an entry without a release link.`);
    }
    const tag = decodeURIComponent(encodedTag);
    const source = `${tag}/${MANIFEST_ASSET}`;
    const body = await get(new URL(`${encodeURIComponent(tag)}/${MANIFEST_ASSET}`, ARTIFACT_BASE_URL).href, {
      notFoundIsNull: true,
    });
    if (body === null) {
      console.log(`build.mjs: ${source} returned 404 (still publishing); trying the next release.`);
      continue;
    }
    const manifest = validateManifest(parseJson(body, source), source);
    expectEqual(manifest.latest.tag, tag, `${source}: latest.tag`);
    const notes = ENTRY_NOTES.exec(entry)?.[1];
    return { manifest, notes: notes === undefined ? null : sanitizeNotes(unescapeXml(notes)) };
  }
  return { manifest: null, notes: null };
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const formatSize = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const formatDate = (iso) =>
  new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC', year: 'numeric' }).format(
    new Date(iso)
  );

// The identity mark: a chartreuse circle with the zig-zag bolt cut out
// (Brainstrike-Mark.svg from the production identity pack).
const MARK =
  'M512 78 A434 434 0 1 1 512 946 A434 434 0 1 1 512 78 Z M618 128 L251 558 L493 558 L358 892 L734 440 L524 440 Z';
const brandMark = `<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="${MARK}" fill="#d0fb07" fill-rule="evenodd"/></svg>`;
const ISSUES_URL = 'https://github.com/seandearnaley/brainstrike-releases/issues';
const SITE_URL = 'https://brainstrike.ai';
const downloadIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

const ARCHITECTURE_ORDER = { linux: ['x64', 'arm64', 'universal'], macos: ['arm64', 'x64', 'universal'], windows: ['x64', 'arm64', 'universal'] };

// Every download, in the order the page lists them, with its labels.
function downloads(manifest) {
  const { assets } = manifest.latest;
  return PLATFORMS.flatMap(({ id, label }) =>
    assets
      .filter((asset) => asset.platform === id)
      .sort((a, b) => ARCHITECTURE_ORDER[id].indexOf(a.architecture) - ARCHITECTURE_ORDER[id].indexOf(b.architecture))
      .map((asset) => ({
        arch: ARCHITECTURE_LABELS[id][asset.architecture],
        architecture: asset.architecture,
        digest: DIGEST.exec(asset.digest)[1],
        key: `${id}-${asset.architecture}-${asset.package}`,
        note: PLATFORM_NOTES[id],
        os: label,
        package: PACKAGE_LABELS[asset.package],
        platform: id,
        size: formatSize(asset.sizeBytes),
        url: asset.url,
      }))
  );
}

function renderRelease(manifest, notes) {
  const { publishedAt, tag, version } = manifest.latest;
  const releasePage = `${manifest.distribution.releasesHubUrl}/tag/${encodeURIComponent(tag)}`;
  const sums = new URL(`${encodeURIComponent(tag)}/SHA256SUMS`, ARTIFACT_BASE_URL).href;
  const builds = downloads(manifest);
  const primary = builds.find((build) => build.platform === 'macos') ?? builds[0];
  const chips = builds
    .map(
      (build) =>
        `<a class="chip" href="${escapeHtml(build.url)}" data-build="${build.key}" data-agent="chip"${build === primary ? ' hidden' : ''}>${build.os}<span>${escapeHtml(build.arch)}</span></a>`
    )
    .join('');
  const date = formatDate(publishedAt);
  const rows = builds
    .map(
      (build) => `<tr><th scope="row"><a href="${escapeHtml(build.url)}">${build.os} ${escapeHtml(build.arch)}</a><span>${build.package} · ${build.size}</span></th><td><code>${build.digest}</code></td></tr>`
    )
    .join('\n');
  const buildsJson = JSON.stringify(builds).replaceAll('<', '\\u003c');
  return {
    card: `<button type="button" class="notes-pill" commandfor="notes" command="show-modal" data-agent="notes"><i aria-hidden="true"></i>What’s new in ${escapeHtml(version)}<span aria-hidden="true">→</span></button>`,
    dialog: `<dialog id="notes" closedby="any" aria-labelledby="notes-title">
<div class="dialog-head">
<div><p class="mono">Release notes · ${date}</p><h2 id="notes-title">Brainstrike ${escapeHtml(version)}</h2></div>
<button type="button" class="close" commandfor="notes" command="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
</div>
<div class="dialog-body">
<div class="notes-body">${notes ?? `<p>The notes for this release are <a href="${escapeHtml(releasePage)}">on GitHub</a>.</p>`}</div>
<h3 class="sums-title">Downloads and SHA-256 checksums</h3>
<table class="sums"><tbody>
${rows}
</tbody></table>
<p class="sums-links"><a href="${escapeHtml(sums)}">SHA256SUMS</a><a href="${escapeHtml(releasePage)}">Release on GitHub</a></p>
</div>
</dialog>`,
    footer: `<span>Signed and notarized for macOS</span><a href="${escapeHtml(sums)}">SHA256SUMS</a><a href="${ISSUES_URL}">Report a bug</a>`,
    get: `<div class="get">
<a class="primary" href="${escapeHtml(primary.url)}" data-primary data-agent="download">${downloadIcon}<span><span class="primary-title" data-title>Download for ${primary.os}</span><span class="primary-meta" data-meta>${escapeHtml(primary.arch)} · ${primary.package} · ${primary.size}</span></span></a>
<p class="elsewhere">For macOS, Windows and Linux.</p>
<div class="also">${chips}</div>
<p class="caveat" data-caveat>${escapeHtml(primary.note)}</p>
</div>
<script type="application/json" id="builds">${buildsJson}</script>
<script>${DETECT_SCRIPT}</script>`,
  };
}

// Points the big button at the visitor's own build. It runs inline, right
// after the buttons, so the label is right before the first paint.
const DETECT_SCRIPT = `(() => {
  const builds = JSON.parse(document.getElementById('builds').textContent);
  const primary = document.querySelector('[data-primary]');
  const chips = [...document.querySelectorAll('[data-build]')];
  const caveat = document.querySelector('[data-caveat]');
  const find = (os, arch) =>
    builds.find((b) => b.platform === os && b.architecture === arch) || builds.find((b) => b.platform === os);
  const show = (build) => {
    if (!build) return;
    primary.href = build.url;
    primary.querySelector('[data-title]').textContent = 'Download for ' + build.os;
    primary.querySelector('[data-meta]').textContent = build.arch + ' · ' + build.package + ' · ' + build.size;
    for (const chip of chips) chip.hidden = chip.dataset.build === build.key;
    caveat.textContent = build.note;
  };
  const hints = navigator.userAgentData;
  const ua = navigator.userAgent;
  const platform = ((hints && hints.platform) || navigator.platform || '').toLowerCase();
  if ((hints && hints.mobile) || /android|iphone|ipad|ipod/i.test(ua) || (/mac/.test(platform) && navigator.maxTouchPoints > 1)) {
    document.documentElement.dataset.get = 'elsewhere';
    for (const chip of chips) chip.hidden = false;
    caveat.hidden = true;
    return;
  }
  const os = /win/.test(platform) ? 'windows' : /mac/.test(platform) ? 'macos' : /linux|x11|cros/.test(platform) || /linux/i.test(ua) ? 'linux' : null;
  if (!os) return;
  show(find(os, os === 'macos' || /aarch64|arm64/i.test(ua + platform) ? 'arm64' : 'x64'));
  // Chromium reports the CPU; on another Mac browser the GPU vendor tells
  // Apple silicon from Intel.
  if (hints && hints.getHighEntropyValues) {
    hints.getHighEntropyValues(['architecture']).then((v) => {
      if (v.architecture) show(find(os, v.architecture === 'arm' ? 'arm64' : 'x64'));
    });
  } else if (os === 'macos' && navigator.gpu) {
    navigator.gpu.requestAdapter().then((adapter) => {
      const vendor = adapter && adapter.info && adapter.info.vendor;
      if (vendor && vendor !== 'apple') show(find('macos', 'x64'));
    });
  }
})();`;

// Invoker commands and light dismiss, for browsers that predate them.
const DIALOG_SCRIPT = `(() => {
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    for (const button of document.querySelectorAll('button[commandfor]')) {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.getAttribute('commandfor'));
        if (button.getAttribute('command') === 'close') target.close();
        else target.showModal();
      });
    }
  }
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
  }
  // The music video stops when its dialog closes, and the page's own music
  // pauses while it plays.
  const film = document.querySelector('#video video');
  if (film) {
    document.getElementById('video').addEventListener('close', () => film.pause());
    film.addEventListener('play', () => {
      const sound = document.querySelector('[data-sound]');
      if (sound && sound.getAttribute('aria-pressed') === 'true') sound.click();
    });
  }
})();`;

// The music video: a pill beside the release notes, and its dialog. The files
// live in public/media (H.264 1080p30, a poster, and the lyrics as captions).
const VIDEO_PILL = `<button type="button" class="notes-pill video-pill" commandfor="video" command="show-modal" data-agent="video"><img src="/media/press-approve-thumb.jpg" alt="" width="48" height="27">Watch “Press Approve”<span aria-hidden="true">2:50</span></button>`;
const VIDEO_DIALOG = `<dialog id="video" class="video-dialog" closedby="any" aria-labelledby="video-title">
<div class="dialog-head">
<div><p class="mono">Music video · 2:50</p><h2 id="video-title">Press Approve</h2></div>
<button type="button" class="close" commandfor="video" command="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
</div>
<video controls playsinline preload="none" width="1920" height="1080" poster="/media/press-approve-poster.jpg"><source src="/media/press-approve.mp4" type="video/mp4"><track kind="captions" src="/media/press-approve.vtt" srclang="en" label="Lyrics"></video>
<p class="video-note">Every line is something a Brainstrike agent did on a real ticket.</p>
</dialog>`;

const STYLES = `
@font-face { font-family: 'Instrument Sans'; src: url('/fonts/instrument-sans.woff2') format('woff2'); font-weight: 400 700; font-stretch: 75% 100%; font-display: swap; }
@font-face { font-family: 'Geist Mono'; src: url('/fonts/geist-mono.woff2') format('woff2'); font-weight: 400 500; font-display: swap; }
:root {
  color-scheme: dark;
  --blue: #000cde;
  --deep: #00055f;
  --volt: #d0fb07;
  --ink: #f7f8fa;
  --ink-soft: rgb(247 248 250 / 0.78);
  --dim: rgb(247 248 250 / 0.55);
  --line: rgb(247 248 250 / 0.16);
  --line-strong: rgb(247 248 250 / 0.32);
  --glass: rgb(0 8 120 / 0.38);
  --sans: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
  --mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --gutter: clamp(16px, 3.6vw, 56px);
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
* { box-sizing: border-box; }
html { background: var(--blue); }
body {
  margin: 0;
  min-height: 100dvh;
  display: grid;
  grid-template: "top top" auto "hero hero" 1fr "foot notes" auto / minmax(0, 1fr) auto;
  column-gap: var(--gutter);
  padding: 0 var(--gutter) clamp(16px, 3vh, 36px);
  color: var(--ink);
  font: 400 16px/1.5 var(--sans);
  -webkit-font-smoothing: antialiased;
  overflow-x: clip;
}
a { color: inherit; }
:focus-visible { outline: 2px solid var(--volt); outline-offset: 3px; border-radius: 6px; }
::selection { background: var(--volt); color: var(--blue); }
[hidden] { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* The field, and the still gradient under it when there is no WebGL2. */
.backdrop, .still { position: fixed; inset: 0; pointer-events: none; }
.still { z-index: -5; background: radial-gradient(70% 70% at 74% 30%, #1729ff, var(--blue) 55%, var(--deep)); }
.backdrop { z-index: -4; display: block; width: 100%; height: 100%; opacity: 0; transition: opacity 0.9s ease; }
html[data-backdrop="live"] .backdrop { opacity: 1; }
/* The agent draws in its own small canvas, moved to wherever it is; a round
   target under it takes touches, so a finger can pick it up too. */
.agent, .agent-hit { position: fixed; top: 0; left: 0; z-index: 30; pointer-events: none; }
.agent { width: 240px; height: 240px; display: none; }
.agent-hit { width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; touch-action: none; }
html[data-backdrop="live"] .agent { display: block; }
html[data-backdrop="live"][data-agent="out"] .agent-hit { pointer-events: auto; cursor: grab; }
html[data-dragging], html[data-dragging] * { cursor: grabbing !important; }
html[data-aim="agent"] body { cursor: grab; }

.top { grid-area: top; display: flex; align-items: center; gap: 12px; padding: clamp(16px, 2.8vh, 30px) 0; }
.brand { display: inline-flex; }
.brand svg { width: 28px; height: 28px; transition: rotate 0.6s var(--spring); }
.brand:hover svg { rotate: -14deg; }
.channel { padding: 4px 9px; border: 1px solid rgb(208 251 7 / 0.45); border-radius: 999px; color: var(--volt); font: 500 0.62rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; }

/* A little player: play and pause, the time, the levels. */
.player { display: flex; align-items: center; gap: 8px; margin-left: auto; }
html:not([data-backdrop="live"]) .player { display: none; }
.play {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--volt);
  color: var(--blue);
  cursor: pointer;
  transition: scale 0.3s var(--spring), box-shadow 0.3s;
}
.play:hover { scale: 1.08; box-shadow: 0 0 0 6px rgb(208 251 7 / 0.16); }
.play svg { width: 13px; height: 13px; }
.play .pause, .play[aria-pressed="true"] .start { display: none; }
.play[aria-pressed="true"] .pause { display: block; }
.lcd { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--glass); backdrop-filter: blur(12px); color: var(--ink-soft); font: 400 0.66rem/1 var(--mono); }
.lcd [data-time] { font-variant-numeric: tabular-nums; }
.levels { display: inline-flex; align-items: flex-end; gap: 2px; height: 11px; color: var(--volt); }
.levels i { width: 2px; height: calc(2px + var(--level, 0.2) * 9px); border-radius: 1px; background: currentColor; }
.links { display: flex; }
html:not([data-backdrop="live"]) .links { margin-left: auto; }
.link { padding: 9px 12px; border-radius: 999px; color: var(--ink-soft); font: 500 0.9rem/1 var(--sans); text-decoration: none; transition: color 0.2s, background 0.2s; }
.link:hover { background: rgb(255 255 255 / 0.08); color: var(--ink); }

.hero { grid-area: hero; align-self: center; max-width: min(56rem, 100%); padding-block: 2vh; }
.hero > * { transition: opacity 0.9s var(--ease), translate 0.9s var(--ease), filter 0.9s var(--ease); }
.hero > :nth-child(2) { transition-delay: 0.08s; }
.hero > :nth-child(3) { transition-delay: 0.16s; }
@starting-style { .hero > * { opacity: 0; translate: 0 16px; filter: blur(6px); } }
/* The wordmark. Both i's are dotless; their dots are elements, and the second
   is the agent's seat. */
.wordmark {
  margin: 0 0 0 -0.05em;
  color: var(--ink);
  font: 600 clamp(3.4rem, min(8.6vw, 15vh), 8.4rem)/0.9 var(--sans);
  letter-spacing: -0.055em;
  white-space: nowrap;
}
.wordmark .i { position: relative; display: inline-block; }
.dot { position: absolute; bottom: 0.66em; left: 50%; width: 0.19em; height: 0.19em; margin-left: -0.095em; border-radius: 50%; background: var(--volt); transition: background 0.3s, box-shadow 0.3s; }
html[data-backdrop="live"] [data-home] { background: transparent; }
html[data-backdrop="live"][data-agent="out"] [data-home] { box-shadow: inset 0 0 0 0.018em rgb(208 251 7 / 0.55); }
.tagline { margin: clamp(14px, 2.2vh, 24px) 0 0; color: var(--ink); font: 450 clamp(1.25rem, 0.9rem + 1.1vw, 2rem)/1.2 var(--sans); letter-spacing: -0.025em; }
.cursor { display: inline-block; width: 0.09em; height: 0.95em; margin-left: 0.12em; border-radius: 1px; background: var(--volt); translate: 0 0.14em; animation: blink 1.1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.soon { margin: clamp(22px, 4vh, 42px) 0 0; color: var(--ink); font: 400 0.9rem/1.4 var(--mono); }

.get { margin-top: clamp(24px, 4.4vh, 44px); }
.primary {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 13px 24px 13px 16px;
  border-radius: 999px;
  background: var(--volt);
  color: var(--blue);
  text-decoration: none;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5), 0 10px 40px -12px rgb(208 251 7 / 0.6);
  transition: translate 0.3s var(--spring), box-shadow 0.3s;
}
.primary:hover { translate: 0 -2px; box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5), 0 16px 50px -12px rgb(208 251 7 / 0.8); }
.primary svg { width: 20px; height: 20px; flex: none; }
.primary-title { display: block; font: 600 1rem/1.15 var(--sans); letter-spacing: -0.01em; }
.primary-meta { display: block; margin-top: 3px; font: 400 0.7rem/1.3 var(--mono); opacity: 0.75; }
.elsewhere { display: none; margin: 0; color: var(--ink-soft); }
.also { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--glass);
  backdrop-filter: blur(12px);
  color: var(--ink-soft);
  font-size: 0.82rem;
  text-decoration: none;
  transition: border-color 0.2s, color 0.2s;
}
.chip span { color: var(--dim); font: 400 0.7rem/1 var(--mono); }
.chip:hover { border-color: var(--line-strong); color: var(--ink); }
.caveat { max-width: 30rem; margin: 10px 0 0; color: var(--dim); font-size: 0.8rem; }
html[data-get="elsewhere"] .primary { display: none; }
html[data-get="elsewhere"] .elsewhere { display: block; }

/* What the agent noticed and decided, newest at the bottom. */
.log {
  position: fixed;
  right: var(--gutter);
  bottom: calc(clamp(16px, 3vh, 36px) + 52px);
  z-index: 1;
  display: grid;
  gap: 5px;
  width: min(23rem, 40vw);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ink-soft);
  font: 400 0.7rem/1.4 var(--mono);
  pointer-events: none;
}
.log li { display: flex; gap: 10px; animation: arrive 0.4s var(--ease); }
.log li:not(:last-child) { opacity: 0.5; }
.log li:nth-last-child(n + 4) { opacity: 0.25; }
.log time { flex: none; color: var(--volt); opacity: 0.8; }
@keyframes arrive { from { opacity: 0; translate: 0 6px; } }
html:not([data-backdrop="live"]) .log { display: none; }

/* The pills at the bottom right: the music video, then the release notes. */
.pills { grid-area: notes; align-self: end; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
.notes-pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--glass);
  backdrop-filter: blur(12px);
  color: var(--ink-soft);
  font: 500 0.78rem/1 var(--sans);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.notes-pill:hover { border-color: var(--line-strong); color: var(--ink); }
.notes-pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--volt); box-shadow: 0 0 10px var(--volt); }
.notes-pill span { transition: translate 0.25s var(--ease); }
.notes-pill:hover span { translate: 3px 0; }
.video-pill { padding-block: 5px; padding-left: 5px; }
.video-pill img { width: 48px; height: 27px; border-radius: 999px 6px 6px 999px; object-fit: cover; }
.video-pill span { color: var(--dim); font: 400 0.68rem/1 var(--mono); }
.video-pill:hover span { translate: none; }

.foot { grid-area: foot; align-self: end; display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--dim); font: 400 0.68rem/1.5 var(--mono); }
.foot a { color: var(--ink-soft); text-decoration: none; }
.foot a:hover { color: var(--ink); }

dialog {
  width: min(42rem, calc(100vw - 32px));
  max-height: min(82dvh, 46rem);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 22px;
  background: rgb(0 8 110 / 0.9);
  backdrop-filter: blur(24px) saturate(1.3);
  box-shadow: 0 40px 120px -30px rgb(0 0 0 / 0.7);
  color: var(--ink);
  opacity: 0;
  scale: 0.97;
  transition: opacity 0.25s var(--ease), scale 0.25s var(--ease), overlay 0.25s allow-discrete, display 0.25s allow-discrete;
}
dialog[open] { display: flex; flex-direction: column; opacity: 1; scale: 1; }
@starting-style { dialog[open] { opacity: 0; scale: 0.97; } }
dialog::backdrop { background: rgb(0 3 50 / 0.45); backdrop-filter: blur(4px); }
.dialog-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 18px 14px 22px; border-bottom: 1px solid var(--line); }
.dialog-head .mono { margin: 0; color: var(--volt); font: 400 0.68rem/1.3 var(--mono); }
.dialog-head h2 { margin: 6px 0 0; color: var(--ink); font: 600 1.3rem/1.2 var(--sans); letter-spacing: -0.02em; }
.close { display: grid; place-items: center; width: 32px; height: 32px; margin-left: auto; border: 1px solid var(--line-strong); border-radius: 50%; background: none; color: var(--ink); cursor: pointer; }
.close:hover { background: rgb(255 255 255 / 0.1); }
.close svg { width: 15px; height: 15px; }
.dialog-body { padding: 18px 22px 22px; overflow-y: auto; overscroll-behavior: contain; }
.notes-body { line-height: 1.6; }
.notes-body > :first-child { margin-top: 0; }
.notes-body p, .notes-body li { overflow-wrap: anywhere; }
.notes-body h3, .notes-body h4, .sums-title { margin: 22px 0 8px; color: var(--volt); font: 500 0.7rem/1.3 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; }
.notes-body a, .sums a { color: var(--ink); text-decoration-color: var(--volt); text-underline-offset: 3px; }
.notes-body code { font: 0.85em var(--mono); }
.sums { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.sums th, .sums td { padding: 10px 0; border-top: 1px solid var(--line); text-align: left; vertical-align: top; }
.sums th { width: 40%; padding-right: 16px; font-weight: 500; }
.sums th span { display: block; color: var(--dim); font: 400 0.72rem/1.4 var(--mono); }
.sums code { color: var(--ink-soft); font: 400 0.7rem/1.5 var(--mono); word-break: break-all; }
.sums-links { display: flex; gap: 18px; margin: 14px 0 0; font-size: 0.86rem; }
/* The video dialog is as wide as the screen allows, the film edge to edge. */
/* Its width also follows the height, so the head, film and note fit a short laptop screen. */
.video-dialog { width: min(72rem, calc(100vw - 32px), calc((100dvh - 150px) * 16 / 9)); max-height: none; }
.video-dialog video { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; background: var(--blue); }
.video-note { margin: 0; padding: 12px 22px 16px; color: var(--dim); font: 400 0.72rem/1.4 var(--mono); }

@media (max-width: 1100px) and (min-width: 761px) {
  .lcd [data-time] { display: none; }
}
@media (max-width: 760px) {
  body { grid-template: "top" auto "hero" 1fr "notes" auto "foot" auto / minmax(0, 1fr); row-gap: 14px; }
  /* Instrument Sans sets "Brainstrike" about 4.9em wide; this fills the column. */
  .wordmark { font-size: calc((100vw - 2 * var(--gutter)) / 5); }
  .hero { align-self: end; padding-block: 0; }
  .get { margin-top: 22px; }
  .primary { width: 100%; }
  .pills { justify-content: flex-start; }
  .foot > :not(.legal) { display: none; }
  .log { top: 74px; right: var(--gutter); bottom: auto; left: var(--gutter); width: auto; }
  .log li:nth-last-child(n + 3) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .player { display: none; }
}
`;

const LEGAL_LINKS =
  '<a class="legal" href="/privacy">Privacy</a><a class="legal" href="/terms">Terms</a><a class="legal" href="/contact">Contact</a>';

const LEGAL_STYLES = `
@font-face { font-family: 'Instrument Sans'; src: url('/fonts/instrument-sans.woff2') format('woff2'); font-weight: 400 700; font-stretch: 75% 100%; font-display: swap; }
@font-face { font-family: 'Geist Mono'; src: url('/fonts/geist-mono.woff2') format('woff2'); font-weight: 400 500; font-display: swap; }
:root { color-scheme: dark; --blue: #000cde; --deep: #00055f; --volt: #d0fb07; --ink: #f7f8fa; --ink-soft: rgb(247 248 250 / 0.82); --dim: rgb(247 248 250 / 0.6); --line: rgb(247 248 250 / 0.16); --sans: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif; --mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace; --gutter: clamp(16px, 3.6vw, 56px); }
* { box-sizing: border-box; }
html { background: var(--deep); }
body { margin: 0; padding: 0 var(--gutter) 40px; background: radial-gradient(90% 60% at 80% 0%, #0d1fff, var(--blue) 40%, var(--deep)) fixed; color: var(--ink-soft); font: 400 16px/1.65 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: var(--ink); text-decoration-color: var(--volt); text-underline-offset: 3px; }
:focus-visible { outline: 2px solid var(--volt); outline-offset: 3px; border-radius: 6px; }
::selection { background: var(--volt); color: var(--blue); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.top { display: flex; align-items: center; gap: 12px; padding: clamp(16px, 2.8vh, 30px) 0; }
.brand { display: inline-flex; }
.brand svg { width: 28px; height: 28px; }
.legal-doc { max-width: 44rem; margin: clamp(12px, 4vh, 48px) 0 0; }
.legal-doc h1 { margin: 0; color: var(--ink); font: 600 clamp(2rem, 1.4rem + 2.4vw, 3.2rem)/1.05 var(--sans); letter-spacing: -0.04em; }
.legal-doc .effective { margin: 10px 0 28px; color: var(--volt); font: 400 0.75rem/1.4 var(--mono); }
.legal-doc h2 { margin: 36px 0 8px; color: var(--ink); font: 600 1.15rem/1.3 var(--sans); letter-spacing: -0.01em; }
.legal-doc p, .legal-doc li { overflow-wrap: anywhere; }
.legal-doc strong { color: var(--ink); font-weight: 600; }
.legal-doc ul { padding-left: 1.2em; }
.legal-doc li { margin: 6px 0; }
.legal-doc code { font: 0.85em var(--mono); }
.legal-doc .lede { margin: 14px 0 28px; }
.legal-doc .note { margin-top: 28px; color: var(--dim); font-size: 0.9rem; }
.contact { display: grid; gap: 6px; }
.contact label { margin-top: 12px; color: var(--ink); font: 500 0.75rem/1.4 var(--mono); letter-spacing: 0.02em; }
.contact input, .contact textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: rgb(0 5 95 / 0.55); color: var(--ink); font: 400 1rem/1.5 var(--sans); }
.contact textarea { resize: vertical; }
.contact input:focus-visible, .contact textarea:focus-visible { border-color: var(--volt); outline-offset: 1px; }
.contact .trap { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.contact button { justify-self: start; margin-top: 18px; padding: 10px 18px; border: 0; border-radius: 999px; background: var(--volt); color: var(--blue); font: 600 0.95rem/1.2 var(--sans); cursor: pointer; }
.contact button:disabled { opacity: 0.6; cursor: progress; }
.contact .status { min-height: 1.5em; margin: 8px 0 0; font: 400 0.8rem/1.5 var(--mono); }
.contact .status.ok { color: var(--volt); }
.contact .status.error { color: #ffb4b4; }
.foot { display: flex; flex-wrap: wrap; gap: 4px 16px; max-width: 44rem; margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--dim); font: 400 0.68rem/1.5 var(--mono); }
.foot a { color: var(--ink-soft); text-decoration: none; }
.foot a:hover { color: var(--ink); }
`;

function renderSubpage({ body, description, route, script = '', title }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · Brainstrike</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#000cde">
<link rel="canonical" href="${SITE_URL}/${route}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${LEGAL_STYLES}</style>
</head>
<body>
<header class="top"><a class="brand" href="/">${brandMark}<span class="sr-only">Brainstrike home</span></a></header>
<main class="legal-doc">
${body.trim()}
</main>
<footer class="foot"><a href="/">Brainstrike</a>${LEGAL_LINKS}<a href="${ISSUES_URL}">Report a bug</a></footer>
${script ? `<script>${script}</script>\n` : ''}</body>
</html>
`;
}

function renderLegalPage({ description, file, route, title }) {
  const body = readFileSync(path.join(LEGAL, file), 'utf8')
    .replaceAll('{{LEGAL_NAME}}', escapeHtml(LEGAL_NAME))
    .replaceAll('{{EFFECTIVE}}', escapeHtml(LEGAL_EFFECTIVE));
  const unfilled = body.match(/\{\{[A-Z_]+\}\}|TODO_[A-Z_]+/u);
  if (unfilled) fail(`legal/${file} still has ${unfilled[0]}; set it at the top of build.mjs.`);
  return renderSubpage({ body, description, route, title });
}

// Posts the form as JSON and shows the answer in place. Without JavaScript the
// browser posts the form itself and api/contact.js redirects to /contact/sent.
const CONTACT_SCRIPT = `
const form = document.querySelector('[data-contact]');
const status = form.querySelector('[data-status]');
const button = form.querySelector('button');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.className = 'status';
  status.textContent = 'Sending…';
  try {
    const response = await fetch(form.action, {
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Your message could not be sent. Please try again later.');
    form.reset();
    status.textContent = data.message || 'Thanks, your message is on its way.';
    status.className = 'status ok';
  } catch (error) {
    status.textContent = error instanceof Error && error.message ? error.message : 'Your message could not be sent. Please try again later.';
    status.className = 'status error';
  } finally {
    button.disabled = false;
  }
});
`;

const CONTACT_BODY = `
<h1>Contact</h1>
<p class="lede">Questions, feedback or a privacy request? Send us a message and we will reply by email. To report a bug, you can also <a href="${ISSUES_URL}">open an issue on GitHub</a>.</p>
<form class="contact" action="/api/contact" method="post" data-contact>
<label for="contact-name">Name</label>
<input id="contact-name" name="name" type="text" autocomplete="name" maxlength="200" required>
<label for="contact-email">Email</label>
<input id="contact-email" name="email" type="email" autocomplete="email" maxlength="320" required>
<label for="contact-message">Message</label>
<textarea id="contact-message" name="message" rows="7" minlength="10" maxlength="5000" required></textarea>
<div class="trap" aria-hidden="true"><label for="contact-company">Company</label><input id="contact-company" name="company" type="text" tabindex="-1" autocomplete="off"></div>
<button type="submit">Send message</button>
<p class="status" role="status" aria-live="polite" data-status></p>
</form>
<p class="note">We use what you send only to reply to you. See the <a href="/privacy#support">privacy policy</a>.</p>
`;

const CONTACT_SENT_BODY = `
<h1>Message sent</h1>
<p class="lede">Thanks for writing. We will reply to the email address you gave.</p>
<p><a href="/">Back to Brainstrike</a></p>
`;

const SUBPAGES = [
  {
    body: CONTACT_BODY,
    description: 'Send the people behind Brainstrike a message.',
    route: 'contact',
    script: CONTACT_SCRIPT,
    title: 'Contact',
  },
  {
    body: CONTACT_SENT_BODY,
    description: 'Your message to Brainstrike was sent.',
    route: 'contact/sent',
    title: 'Message sent',
  },
];

function renderPage(manifest, notes) {
  const release = manifest ? renderRelease(manifest, notes) : null;
  const label = manifest ? CHANNEL_LABELS[manifest.channel] : null;
  const channel = label ? `<span class="channel">${label}</span>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Brainstrike — agents that show their work</title>
<meta name="description" content="Brainstrike runs agents inside your folders and shows you every step. A desktop app for macOS, Windows and Linux, in beta.">
<meta name="theme-color" content="#000cde">
<meta property="og:title" content="Brainstrike">
<meta property="og:description" content="Agents that show their work. A desktop app for macOS, Windows and Linux.">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:type" content="website">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/instrument-sans.woff2" as="font" type="font/woff2" crossorigin>
<style>${STYLES}</style>
</head>
<body>
<canvas class="backdrop" aria-hidden="true"></canvas>
<div class="still" aria-hidden="true"></div>
<canvas class="agent" aria-hidden="true"></canvas>
<div class="agent-hit" aria-hidden="true"></div>
<header class="top">
<a class="brand" href="/">${brandMark}<span class="sr-only">Brainstrike</span></a>
${channel}
<div class="player"><button type="button" class="play" data-sound data-agent="play" aria-pressed="false" hidden><svg class="start" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg><svg class="pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zm6 0h3v11h-3z" fill="currentColor"/></svg><span class="sr-only" data-sound-label>Play the music</span></button><span class="lcd" aria-hidden="true"><span data-time>00:00</span><span class="levels"><i data-level></i><i data-level></i><i data-level></i><i data-level></i><i data-level></i><i data-level></i></span></span></div>
<nav class="links" aria-label="Site"><a class="link" href="${RELEASES_HUB_URL}" data-agent="github">GitHub</a></nav>
</header>
<main class="hero">
<h1 class="wordmark" aria-label="Brainstrike" data-agent="wordmark"><span aria-hidden="true">Bra<span class="i">ı<i class="dot"></i></span>nstr<span class="i">ı<i class="dot" data-home></i></span>ke</span></h1>
<p class="tagline" data-agent="tagline">Agents that show their work.<span class="cursor" aria-hidden="true"></span></p>
${release ? release.get : '<p class="soon">The first beta is on its way.</p>'}
</main>
<div class="pills">${VIDEO_PILL}${release ? release.card : ''}</div>
<footer class="foot">${release ? release.footer : ''}${LEGAL_LINKS}</footer>
${release ? release.dialog : ''}
${VIDEO_DIALOG}
<ol class="log" data-log aria-hidden="true"></ol>
<script>${DIALOG_SCRIPT}</script>
<script type="module" src="/backdrop.js"></script>
</body>
</html>
`;
}

try {
  const localFile = process.env.RELEASE_MANIFEST_FILE;
  const { manifest, notes } = localFile
    ? { manifest: validateManifest(parseJson(readFileSync(localFile, 'utf8'), localFile), localFile), notes: null }
    : await loadPublishedRelease();
  rmSync(DIST, { force: true, recursive: true });
  mkdirSync(DIST);
  cpSync(PUBLIC, DIST, { recursive: true });
  writeFileSync(path.join(DIST, 'index.html'), renderPage(manifest, notes));
  for (const page of LEGAL_PAGES) {
    mkdirSync(path.join(DIST, page.route));
    writeFileSync(path.join(DIST, page.route, 'index.html'), renderLegalPage(page));
  }
  for (const page of SUBPAGES) {
    mkdirSync(path.join(DIST, page.route), { recursive: true });
    writeFileSync(path.join(DIST, page.route, 'index.html'), renderSubpage(page));
  }
  console.log(
    manifest
      ? `build.mjs: wrote dist/ for Brainstrike ${manifest.latest.version} (${manifest.latest.assets.length} downloads, ${notes ? 'with' : 'without'} release notes).`
      : `build.mjs: wrote dist/; no published release has ${MANIFEST_ASSET} yet, so the page says the first beta is coming soon.`
  );
} catch (error) {
  console.error(`build.mjs: ${error.message}`);
  process.exit(1);
}
