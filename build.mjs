// Writes dist/index.html, the Brainstrike desktop download page.
//
// The page is built from the newest published release (prereleases included)
// of seandearnaley/brainstrike-releases that carries a release-manifest.json
// asset. Releases come from the public Atom feed, newest first, so the build
// makes no GitHub API calls. A manifest download that returns 404 means that
// release is still publishing, and the next entry is tried. The manifest is
// validated against schema v2, the shape written by
// scripts/generate-release-manifest.mjs in the brainstrike monorepo. With no
// release carrying a manifest the page says the first beta is coming soon. A
// manifest that fails validation, any other HTTP error or a network error
// fails the build.
//
// Environment:
//   RELEASE_MANIFEST_FILE  optional; render this local manifest file instead of
//                          reading GitHub, to preview the download state.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIST = path.join(import.meta.dirname, 'dist');

const MANIFEST_ASSET = 'release-manifest.json';
const ARTIFACT_BASE_URL =
  'https://github.com/seandearnaley/brainstrike-releases/releases/download/';
const RELEASES_HUB_URL = 'https://github.com/seandearnaley/brainstrike-releases/releases';
const RELEASES_FEED = `${RELEASES_HUB_URL}.atom`;
const FEED_RELEASE_LINK =
  /<link\b[^>]*\bhref="https:\/\/github\.com\/seandearnaley\/brainstrike-releases\/releases\/tag\/([^"]+)"/gu;

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

// Returns the newest published manifest, or null when no release carries one.
async function loadPublishedManifest() {
  const feed = await get(RELEASES_FEED);
  if (!/<feed\b/u.test(feed)) {
    fail(`${RELEASES_FEED} did not return an Atom feed.`);
  }
  for (const [, encodedTag] of feed.matchAll(FEED_RELEASE_LINK)) {
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
    return manifest;
  }
  return null;
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const formatSize = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function renderDownloads(manifest) {
  const { assets, publishedAt, tag, version } = manifest.latest;
  const releasePage = `${manifest.distribution.releasesHubUrl}/tag/${encodeURIComponent(tag)}`;
  const label = CHANNEL_LABELS[manifest.channel];
  const badge = label ? ` <span class="badge">${label}</span>` : '';
  const sections = PLATFORMS.map(({ id, label }) => {
    const items = assets
      .filter((asset) => asset.platform === id)
      .map((asset) => {
        const name = `${label} ${ARCHITECTURE_LABELS[id][asset.architecture]} (${PACKAGE_LABELS[asset.package]})`;
        return `<li><a href="${escapeHtml(asset.url)}">${escapeHtml(name)}</a><br>
<small>${formatSize(asset.sizeBytes)} · SHA-256 <code>${DIGEST.exec(asset.digest)[1]}</code></small></li>`;
      });
    if (items.length === 0) {
      return '';
    }
    const note =
      id === 'windows'
        ? '\n<p class="note">Windows builds are not code-signed yet, so Microsoft SmartScreen will warn before the installer runs.</p>'
        : '';
    return `<section>
<h2>${label}</h2>
<ul>
${items.join('\n')}
</ul>${note}
</section>`;
  });
  return `<p>Version ${escapeHtml(version)}${badge} · Released <time datetime="${publishedAt}">${publishedAt.slice(0, 10)}</time></p>
<p><a href="${escapeHtml(releasePage)}">Release notes on GitHub</a></p>
${sections.filter(Boolean).join('\n')}`;
}

function renderPage(manifest) {
  const body = manifest
    ? renderDownloads(manifest)
    : '<p>The first beta of the Brainstrike desktop app is coming soon.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brainstrike</title>
<meta name="description" content="Download the Brainstrike desktop app.">
<link rel="icon" href="/favicon.ico">
<style>
:root { color-scheme: light dark; --bg: #fff; --fg: #1b1b1b; --muted: #5f5f5f; --link: #0b57d0; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #141414; --fg: #e8e8e8; --muted: #a3a3a3; --link: #8ab4f8; }
}
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 40rem; margin: 0 auto; padding: 2rem 16px; }
a { color: var(--link); }
ul { padding-left: 1.25rem; }
li { margin-bottom: 0.75rem; }
small, .note { color: var(--muted); }
code { font-size: 0.8em; overflow-wrap: anywhere; }
.badge { border: 1px solid currentColor; border-radius: 4px; padding: 0 0.3em; font-size: 0.8em; }
</style>
</head>
<body>
<main>
<h1>Brainstrike</h1>
${body}
</main>
</body>
</html>
`;
}

try {
  const localFile = process.env.RELEASE_MANIFEST_FILE;
  const manifest = localFile
    ? validateManifest(parseJson(readFileSync(localFile, 'utf8'), localFile), localFile)
    : await loadPublishedManifest();
  rmSync(DIST, { force: true, recursive: true });
  mkdirSync(DIST);
  writeFileSync(path.join(DIST, 'index.html'), renderPage(manifest));
  copyFileSync(path.join(import.meta.dirname, 'public', 'favicon.ico'), path.join(DIST, 'favicon.ico'));
  console.log(
    manifest
      ? `build.mjs: wrote dist/index.html for Brainstrike ${manifest.latest.version} (${manifest.latest.assets.length} downloads).`
      : `build.mjs: wrote dist/index.html; no published release has ${MANIFEST_ASSET} yet, so the page says the first beta is coming soon.`
  );
} catch (error) {
  console.error(`build.mjs: ${error.message}`);
  process.exit(1);
}
