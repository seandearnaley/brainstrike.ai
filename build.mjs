// Writes dist/index.html, the Brainstrike desktop download page.
//
// The page is built from the newest published release (prereleases included)
// of seandearnaley/brainstrike-releases that carries a release-manifest.json
// asset. The manifest is validated against schema v2, the shape written by
// scripts/generate-release-manifest.mjs in the brainstrike monorepo. With no
// such release the page says the first beta is coming soon. A manifest that
// fails validation, or any network or API error, fails the build.
//
// Environment:
//   GITHUB_TOKEN           optional; sent to the GitHub API when set.
//   RELEASE_MANIFEST_FILE  optional; render this local manifest file instead of
//                          querying GitHub, to preview the download state.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIST = path.join(import.meta.dirname, 'dist');

const RELEASES_API =
  'https://api.github.com/repos/seandearnaley/brainstrike-releases/releases?per_page=20';
const MANIFEST_ASSET = 'release-manifest.json';
const ARTIFACT_BASE_URL =
  'https://github.com/seandearnaley/brainstrike-releases/releases/download/';
const RELEASES_HUB_URL = 'https://github.com/seandearnaley/brainstrike-releases/releases';

const PLATFORM_BY_PACKAGE = { appimage: 'linux', dmg: 'macos', nsis: 'windows' };
const ARCHITECTURES = new Set(['arm64', 'universal', 'x64']);
// v<major>.<minor>.<patch>, plus an optional prerelease part (v0.1.0-beta.1).
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/u;
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
  expectEqual(manifest.channel, 'stable', where('channel'));
  expectKeys(manifest.distribution, ['artifactBaseUrl', 'releasesHubUrl'], where('distribution'));
  expectEqual(manifest.distribution.artifactBaseUrl, ARTIFACT_BASE_URL, where('distribution.artifactBaseUrl'));
  expectEqual(manifest.distribution.releasesHubUrl, RELEASES_HUB_URL, where('distribution.releasesHubUrl'));

  const { latest } = manifest;
  expectKeys(latest, ['assets', 'publishedAt', 'sourceCommit', 'tag', 'version'], where('latest'));
  const { tag, version } = latest;
  if (typeof tag !== 'string' || !TAG.test(tag)) {
    fail(`${where('latest.tag')} ${JSON.stringify(tag)} is not v<major>.<minor>.<patch>[-prerelease].`);
  }
  expectEqual(version, tag.slice(1), where('latest.version'));
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

async function get(url, headers) {
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    fail(`GET ${url} failed: ${error.cause?.message ?? error.message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    fail(`GET ${url} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return body;
}

// Returns the newest published manifest, or null when no release carries one.
async function loadPublishedManifest() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'brainstrike.ai-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const releases = parseJson(await get(RELEASES_API, headers), RELEASES_API);
  if (!Array.isArray(releases)) {
    fail(`${RELEASES_API} did not return an array of releases.`);
  }
  const release = releases
    .filter((candidate) => !candidate.draft && candidate.assets.some((a) => a.name === MANIFEST_ASSET))
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))[0];
  if (!release) {
    return null;
  }
  const asset = release.assets.find((a) => a.name === MANIFEST_ASSET);
  const source = `${release.tag_name}/${MANIFEST_ASSET}`;
  const manifest = validateManifest(
    parseJson(await get(asset.browser_download_url, { 'User-Agent': headers['User-Agent'] }), source),
    source
  );
  expectEqual(manifest.latest.tag, release.tag_name, `${source}: latest.tag`);
  return manifest;
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
  const beta = version.includes('-') ? ' <span class="badge">Beta</span>' : '';
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
  return `<p>Version ${escapeHtml(version)}${beta} · Released <time datetime="${publishedAt}">${publishedAt.slice(0, 10)}</time></p>
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
