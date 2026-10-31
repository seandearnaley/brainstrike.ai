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
//   RELEASE_MANIFEST_FILE  optional; render this local manifest file instead of
//                          reading GitHub, to preview the download state. The
//                          page then links to the notes instead of showing them.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIST = path.join(import.meta.dirname, 'dist');
const PUBLIC = path.join(import.meta.dirname, 'public');

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

// The first list items of the notes, or their first paragraphs, as text.
function noteExcerpt(notes, limit) {
  const items = [...notes.matchAll(/<li>([\s\S]*?)<\/li>/gu)];
  const blocks = items.length > 0 ? items : [...notes.matchAll(/<p>([\s\S]*?)<\/p>/gu)];
  return blocks
    .map(([, inner]) => inner.replace(/<[^>]+>/gu, '').trim())
    .filter(Boolean)
    .slice(0, limit);
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
        `<a class="chip" href="${escapeHtml(build.url)}" data-build="${build.key}"${build === primary ? ' hidden' : ''}>${build.os}<span>${escapeHtml(build.arch)}</span></a>`
    )
    .join('');
  const excerpt = notes ? noteExcerpt(notes, 3) : [];
  const date = formatDate(publishedAt);
  const rows = builds
    .map(
      (build) => `<tr><th scope="row"><a href="${escapeHtml(build.url)}">${build.os} ${escapeHtml(build.arch)}</a><span>${build.package} · ${build.size}</span></th><td><code>${build.digest}</code></td></tr>`
    )
    .join('\n');
  const buildsJson = JSON.stringify(builds).replaceAll('<', '\\u003c');
  return {
    card: `<aside class="notes-card" aria-labelledby="notes-card-title">
<div class="notes-head"><h2 id="notes-card-title">What’s new</h2><span class="mono">${escapeHtml(version)} · ${date}</span></div>
${excerpt.length > 0 ? `<ul class="excerpt">${excerpt.map((line) => `<li>${line}</li>`).join('')}</ul>` : ''}
<button type="button" class="more" commandfor="notes" command="show-modal">Read the release notes <span aria-hidden="true">→</span></button>
</aside>`,
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
    eyebrow: `Desktop agent workspace · v${escapeHtml(version)}`,
    footer: `<footer class="foot"><span>v${escapeHtml(version)} · ${date}</span><span>macOS builds signed and notarized</span><a href="${escapeHtml(sums)}">SHA256SUMS</a></footer>`,
    get: `<div class="get">
<a class="primary" href="${escapeHtml(primary.url)}" data-primary>${downloadIcon}<span><span class="primary-title" data-title>Download for ${primary.os}</span><span class="primary-meta" data-meta>${escapeHtml(primary.arch)} · ${primary.package} · ${primary.size}</span></span></a>
<p class="elsewhere">Brainstrike is a desktop app for macOS, Windows and Linux.</p>
<div class="also"><span class="also-label">Also for</span>${chips}</div>
<p class="caveat" data-caveat hidden>The Windows installer is not code-signed yet, so SmartScreen will warn before it runs.</p>
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
    caveat.hidden = build.platform !== 'windows';
  };
  const hints = navigator.userAgentData;
  const ua = navigator.userAgent;
  const platform = ((hints && hints.platform) || navigator.platform || '').toLowerCase();
  if ((hints && hints.mobile) || /android|iphone|ipad|ipod/i.test(ua) || (/mac/.test(platform) && navigator.maxTouchPoints > 1)) {
    document.documentElement.dataset.get = 'elsewhere';
    for (const chip of chips) chip.hidden = false;
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
  const dialog = document.getElementById('notes');
  if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
})();`;

const STYLES = `
@font-face { font-family: 'Geist'; src: url('/fonts/geist.woff2') format('woff2'); font-weight: 400 700; font-display: swap; }
@font-face { font-family: 'Geist Mono'; src: url('/fonts/geist-mono.woff2') format('woff2'); font-weight: 400 500; font-display: swap; }
@font-face { font-family: 'Silkscreen'; src: url('/fonts/silkscreen.woff2') format('woff2'); font-weight: 400; font-display: swap; }
:root {
  color-scheme: dark;
  --blue: #000cde;
  --blue-deep: #00078a;
  --night: #01042a;
  --volt: #d0fb07;
  --ink: #f7f8fa;
  --ink-soft: rgb(247 248 250 / 0.8);
  --dim: rgb(247 248 250 / 0.62);
  --line: rgb(247 248 250 / 0.22);
  --line-strong: rgb(247 248 250 / 0.45);
  --panel: rgb(1 6 120 / 0.72);
  --sans: 'Geist', ui-sans-serif, system-ui, sans-serif;
  --mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --pixel: 'Silkscreen', 'Geist Mono', ui-monospace, monospace;
  --gutter: clamp(16px, 3.6vw, 56px);
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
}
* { box-sizing: border-box; }
html { background: var(--blue); }
body {
  margin: 0;
  min-height: 100dvh;
  display: grid;
  grid-template: "top top" auto "hero hero" 1fr "foot notes" auto / minmax(0, 1fr) minmax(0, 24rem);
  column-gap: var(--gutter);
  padding: 0 var(--gutter) clamp(16px, 3vh, 40px);
  color: var(--ink);
  font: 400 16px/1.5 var(--sans);
  -webkit-font-smoothing: antialiased;
  overflow-x: clip;
}
a { color: inherit; }
:focus-visible { outline: 2px solid var(--volt); outline-offset: 3px; }
::selection { background: var(--volt); color: var(--blue); }
[hidden] { display: none !important; }
.mono { margin: 0; font: 400 0.72rem/1.3 var(--mono); letter-spacing: 0.02em; color: var(--dim); }

.backdrop, .still, .stage, .scrim { position: fixed; inset: 0; }
.backdrop, .still, .scrim { pointer-events: none; }
/* The sky without WebGL: a link-blue gradient over a checkerboard floor. */
.still {
  z-index: -5;
  overflow: hidden;
  background: linear-gradient(180deg, #000658 0%, var(--blue) 34%, #4a63ff 56%, #c3cdff 63.5%, #c3cdff 64%, var(--blue) 64.2%);
}
.still::after {
  position: absolute;
  top: 64%;
  left: -60%;
  width: 220%;
  height: 90%;
  background: repeating-conic-gradient(var(--blue) 0 25%, #8c9dff 0 50%) 0 0 / 140px 140px;
  content: '';
  transform: perspective(420px) rotateX(72deg);
  transform-origin: 50% 0;
  -webkit-mask-image: linear-gradient(0deg, #000 30%, transparent 92%);
  mask-image: linear-gradient(0deg, #000 30%, transparent 92%);
}
.backdrop { z-index: -4; display: block; width: 100%; height: 100%; opacity: 0; transition: opacity 1.2s ease; }
html[data-backdrop="live"] .backdrop { opacity: 1; }
/* The scene's own surface: it takes drags and pinches where nothing else is. */
.stage { z-index: -3; display: none; touch-action: none; }
html[data-backdrop="live"] .stage { display: block; }
html[data-aim="pipe"] .stage { cursor: grab; }
html[data-dragging] .stage { cursor: grabbing; }
.scrim {
  z-index: -2;
  background:
    linear-gradient(90deg, rgb(0 5 110 / 0.72) 0%, rgb(0 5 110 / 0.42) 32%, rgb(0 5 110 / 0) 58%),
    linear-gradient(0deg, rgb(0 4 70 / 0.55) 0%, rgb(0 4 70 / 0) 24%);
}

.top { grid-area: top; display: flex; align-items: center; gap: 12px; padding: clamp(16px, 2.8vh, 32px) 0; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); font: 650 1.05rem/1 var(--sans); letter-spacing: -0.03em; text-decoration: none; }
.brand svg { width: 28px; height: 28px; }
.channel {
  padding: 4px 6px 3px;
  background: var(--volt);
  color: var(--blue);
  font: 400 0.6rem/1 var(--pixel);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* A little CD player: play and pause, the track, the time and the levels. */
.player { display: flex; align-items: center; gap: 10px; margin-left: auto; }
html:not([data-backdrop="live"]) .player { display: none; }
.lcd {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 7px 12px 6px;
  border: 1px solid var(--line);
  background: rgb(0 3 60 / 0.55);
  color: var(--volt);
  font: 400 0.66rem/1 var(--pixel);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.lcd [data-time] { font-variant-numeric: tabular-nums; }
.levels { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
.levels i { width: 3px; height: calc(2px + var(--level, 0.2) * 10px); background: currentColor; }
.play {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  background: var(--volt);
  color: var(--blue);
  box-shadow: 3px 3px 0 var(--night);
  cursor: pointer;
  transition: translate 0.15s, box-shadow 0.15s;
}
.play:hover { translate: -1px -1px; box-shadow: 4px 4px 0 var(--night); }
.play:active { translate: 2px 2px; box-shadow: 1px 1px 0 var(--night); }
.play svg { width: 14px; height: 14px; }
.play .pause, .play[aria-pressed="true"] .start { display: none; }
.play[aria-pressed="true"] .pause { display: block; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.links { display: flex; gap: 4px; }
html:not([data-backdrop="live"]) .links { margin-left: auto; }
.link {
  padding: 10px 12px;
  border: 0;
  background: none;
  color: var(--ink-soft);
  font: 500 0.88rem/1 var(--sans);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}
.link:hover { background: rgb(255 255 255 / 0.1); color: var(--ink); }

.hero { grid-area: hero; align-self: center; max-width: min(42rem, 100%); padding-block: 2vh; }
.hero > * { transition: opacity 0.8s var(--ease), translate 0.8s var(--ease); }
.hero > :nth-child(2) { transition-delay: 0.08s; }
.hero > :nth-child(3) { transition-delay: 0.16s; }
.hero > :nth-child(4) { transition-delay: 0.24s; }
@starting-style { .hero > * { opacity: 0; translate: 0 14px; } }
.eyebrow { margin: 0 0 clamp(16px, 2.6vh, 28px); color: var(--ink-soft); font: 400 0.72rem/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase; }
h1 {
  margin: 0;
  color: var(--ink);
  font: 650 clamp(2.3rem, min(5.4vw, 8.4vh), 5rem)/1 var(--sans);
  letter-spacing: -0.045em;
  text-wrap: balance;
}
.pitch { max-width: 32rem; margin: clamp(16px, 2.6vh, 28px) 0 0; color: var(--ink-soft); font-size: clamp(1rem, 0.92rem + 0.3vw, 1.16rem); line-height: 1.55; text-wrap: pretty; }
.pitch a { color: var(--ink); text-decoration-color: var(--volt); text-decoration-thickness: 2px; text-underline-offset: 4px; }
.pitch a:hover { color: var(--volt); }
.soon { margin: clamp(22px, 4vh, 42px) 0 0; color: var(--ink); font: 400 0.9rem/1.4 var(--mono); }

.get { margin-top: clamp(22px, 4.2vh, 44px); }
.primary {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 14px 24px 14px 18px;
  background: var(--volt);
  color: var(--blue);
  text-decoration: none;
  box-shadow: 5px 5px 0 var(--night);
  transition: translate 0.15s, box-shadow 0.15s;
}
.primary:hover { translate: -2px -2px; box-shadow: 7px 7px 0 var(--night); }
.primary:active { translate: 3px 3px; box-shadow: 2px 2px 0 var(--night); }
.primary svg { width: 22px; height: 22px; flex: none; }
.primary-title { display: block; font: 650 1.02rem/1.15 var(--sans); letter-spacing: -0.02em; }
.primary-meta { display: block; margin-top: 4px; font: 400 0.72rem/1.3 var(--mono); opacity: 0.8; }
.elsewhere { display: none; margin: 0; color: var(--ink); }
.also { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 20px; }
.also-label { margin-right: 4px; color: var(--dim); font: 400 0.68rem/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase; }
.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--line-strong);
  background: rgb(0 5 110 / 0.35);
  color: var(--ink);
  font-size: 0.86rem;
  text-decoration: none;
  transition: border-color 0.2s, background 0.2s;
}
.chip span { color: var(--dim); font: 400 0.72rem/1 var(--mono); }
.chip:hover { border-color: var(--volt); background: rgb(0 5 110 / 0.6); }
.caveat { max-width: 30rem; margin: 12px 0 0; color: var(--dim); font-size: 0.82rem; }
html[data-get="elsewhere"] .primary { display: none; }
html[data-get="elsewhere"] .elsewhere { display: block; }
html[data-get="elsewhere"] .also-label { display: none; }

/* Panels with a thin title bar, like a window from 1997 kept tidy. */
.notes-card, dialog { border: 1px solid var(--line-strong); background: var(--panel); }
.notes-card {
  grid-area: notes;
  align-self: end;
  width: 100%;
  padding: 0 16px 10px;
  backdrop-filter: blur(16px) saturate(1.3);
  box-shadow: 6px 6px 0 rgb(1 4 42 / 0.6);
}
.notes-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 -16px; padding: 7px 16px 6px; border-bottom: 1px solid var(--line); background: rgb(247 248 250 / 0.08); }
.notes-head h2 { margin: 0; color: var(--volt); font: 400 0.66rem/1 var(--pixel); letter-spacing: 0.04em; text-transform: uppercase; }
.excerpt { display: grid; gap: 8px; margin: 12px 0 6px; padding: 0; list-style: none; }
.excerpt li {
  position: relative;
  display: -webkit-box;
  padding-left: 16px;
  overflow: hidden;
  color: var(--ink-soft);
  font-size: 0.88rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.excerpt li::before { position: absolute; top: 0.55em; left: 0; width: 6px; height: 6px; background: var(--volt); content: ''; }
.more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 8px 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: 600 0.86rem/1 var(--sans);
  cursor: pointer;
}
.more span { transition: translate 0.25s var(--ease); }
.more:hover span { translate: 4px 0; }

.foot { grid-area: foot; align-self: end; display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--dim); font: 400 0.68rem/1.5 var(--mono); letter-spacing: 0.04em; }
.foot a { color: var(--ink-soft); text-decoration: none; border-bottom: 1px solid var(--line); }
.foot a:hover { color: var(--ink); }

/* How to play, along the right edge. */
.hint {
  position: fixed;
  top: 50%;
  right: calc(var(--gutter) * 0.45);
  z-index: 1;
  margin: 0;
  color: var(--dim);
  font: 400 0.62rem/1 var(--mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
  translate: 0 -50%;
  pointer-events: none;
}
.hint .touch { display: none; }
html:not([data-backdrop="live"]) .hint { display: none; }
@media (pointer: coarse) {
  .hint .fine { display: none; }
  .hint .touch { display: inline; }
}

dialog {
  width: min(42rem, calc(100vw - 32px));
  max-height: min(82dvh, 46rem);
  padding: 0;
  overflow: hidden;
  --panel: rgb(1 6 110 / 0.95);
  backdrop-filter: blur(24px) saturate(1.3);
  box-shadow: 10px 10px 0 rgb(1 4 42 / 0.7);
  color: var(--ink);
  opacity: 0;
  translate: 0 10px;
  transition: opacity 0.25s var(--ease), translate 0.25s var(--ease), overlay 0.25s allow-discrete, display 0.25s allow-discrete;
}
dialog[open] { display: flex; flex-direction: column; opacity: 1; translate: 0 0; }
@starting-style { dialog[open] { opacity: 0; translate: 0 10px; } }
dialog::backdrop { background: rgb(1 4 42 / 0.5); backdrop-filter: blur(4px); }
.dialog-head { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px 12px 20px; border-bottom: 1px solid var(--line); background: rgb(247 248 250 / 0.08); }
.dialog-head .mono { color: var(--volt); font-family: var(--pixel); font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.04em; }
.dialog-head h2 { margin: 6px 0 0; color: var(--ink); font: 650 1.25rem/1.2 var(--sans); letter-spacing: -0.03em; }
.close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-left: auto;
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--ink);
  cursor: pointer;
}
.close:hover { background: rgb(255 255 255 / 0.12); }
.close svg { width: 16px; height: 16px; }
.dialog-body { padding: 18px 20px 22px; overflow-y: auto; overscroll-behavior: contain; }
.notes-body { line-height: 1.6; }
.notes-body > :first-child { margin-top: 0; }
.notes-body p, .notes-body li { overflow-wrap: anywhere; }
.notes-body h3, .notes-body h4, .sums-title {
  margin: 22px 0 8px;
  color: var(--volt);
  font: 400 0.66rem/1.3 var(--pixel);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.notes-body a, .sums a { color: var(--ink); text-decoration-color: var(--volt); text-underline-offset: 3px; }
.notes-body code { font: 0.85em var(--mono); }
.sums { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.sums th, .sums td { padding: 10px 0; border-top: 1px solid var(--line); text-align: left; vertical-align: top; }
.sums th { width: 40%; padding-right: 16px; font-weight: 500; }
.sums th span { display: block; color: var(--dim); font: 400 0.72rem/1.4 var(--mono); }
.sums code { color: var(--ink-soft); font: 400 0.7rem/1.5 var(--mono); word-break: break-all; }
.sums-links { display: flex; gap: 18px; margin: 14px 0 0; font-size: 0.86rem; }

@media (max-height: 640px) and (min-width: 761px) {
  .excerpt li:nth-child(n + 2) { display: none; }
}
@media (max-width: 1100px) and (min-width: 761px) {
  .lcd [data-track] { display: none; }
}
@media (max-width: 760px) {
  body { grid-template: "top" auto "hero" 1fr "notes" auto / minmax(0, 1fr); row-gap: 14px; }
  .scrim { background: linear-gradient(180deg, rgb(0 5 110 / 0) 0%, rgb(0 5 110 / 0) 30%, rgb(0 5 110 / 0.55) 50%, rgb(1 4 60 / 0.9) 72%); }
  .lcd { gap: 10px; padding: 7px 9px 6px; }
  .lcd [data-track] { display: none; }
  .links .link-notes { display: none; }
  .hero { align-self: end; padding-block: 0; }
  h1 { font-size: clamp(2.1rem, 9.6vw, 3rem); }
  .pitch { margin-top: 14px; }
  .get { margin-top: 22px; }
  .primary { width: 100%; }
  .notes-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 10px 14px; }
  .notes-head { display: block; margin: 0; padding: 0; border: 0; background: none; }
  .notes-head .mono { display: block; margin-top: 4px; }
  .excerpt { display: none; }
  .more { margin: 0; white-space: nowrap; }
  .foot { display: none; }
  .hint { top: 72px; right: 0; left: 0; text-align: center; writing-mode: horizontal-tb; translate: none; letter-spacing: 0.14em; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .player, .hint { display: none; }
}
`;

function renderPage(manifest, notes) {
  const release = manifest ? renderRelease(manifest, notes) : null;
  const label = manifest ? CHANNEL_LABELS[manifest.channel] : null;
  const channel = label ? `<span class="channel">${label}</span>` : '';
  const notesLink = release
    ? '<button type="button" class="link link-notes" commandfor="notes" command="show-modal">Release notes</button>'
    : '';
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
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/silkscreen.woff2" as="font" type="font/woff2" crossorigin>
<style>${STYLES}</style>
</head>
<body>
<canvas class="backdrop" aria-hidden="true"></canvas>
<div class="still" aria-hidden="true"></div>
<div class="stage" aria-hidden="true"></div>
<div class="scrim" aria-hidden="true"></div>
<header class="top">
<a class="brand" href="/">${brandMark}<span>Brainstrike</span></a>
${channel}
<div class="player"><button type="button" class="play" data-sound aria-pressed="false" hidden><svg class="start" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg><svg class="pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zm6 0h3v11h-3z" fill="currentColor"/></svg><span class="sr-only" data-sound-label>Play the music</span></button><span class="lcd" aria-hidden="true"><span data-track>01 Daylight</span><span data-time>00:00</span><span class="levels"><i data-level></i><i data-level></i><i data-level></i><i data-level></i><i data-level></i><i data-level></i></span></span></div>
<nav class="links" aria-label="Site">${notesLink}<a class="link" href="${RELEASES_HUB_URL}">GitHub</a></nav>
</header>
<main class="hero">
<p class="eyebrow">${release ? release.eyebrow : 'Desktop agent workspace'}</p>
<h1>Agents that show their work.</h1>
<p class="pitch">Brainstrike runs agents inside your folders. They read and edit files, run commands and hand work to each other, and you see every step. Threads are saved on your computer, and it runs on the model keys you already have. It’s in beta: <a href="${ISSUES_URL}">report what breaks</a>.</p>
${release ? release.get : '<p class="soon">The first beta is on its way.</p>'}
</main>
${release ? release.card : ''}
${release ? release.footer : ''}
${release ? release.dialog : ''}
<p class="hint" aria-hidden="true"><span class="fine">Drag to orbit · Scroll to zoom · Click to start a pipe · Pull a pipe to bend it</span><span class="touch">Drag · Pinch · Tap a pipe</span></p>
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
  console.log(
    manifest
      ? `build.mjs: wrote dist/ for Brainstrike ${manifest.latest.version} (${manifest.latest.assets.length} downloads, ${notes ? 'with' : 'without'} release notes).`
      : `build.mjs: wrote dist/; no published release has ${MANIFEST_ASSET} yet, so the page says the first beta is coming soon.`
  );
} catch (error) {
  console.error(`build.mjs: ${error.message}`);
  process.exit(1);
}
