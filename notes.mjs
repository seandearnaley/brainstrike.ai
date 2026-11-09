// The notes: Markdown files in notes/, one per post, built into /notes, one
// page per note and an Atom feed at /notes/feed.xml. build.mjs owns the page
// layout; this module parses, renders and validates.
//
// A note is notes/<YYYY-MM-DD>-<slug>.md and starts with front matter:
//
//   ---
//   title: Building Brainstrike in the open
//   date: 2026-11-08
//   summary: One or two sentences for the list and the feed.
//   ---
//
// title and date are required; summary is optional. The URL is /notes/<slug>/.
// The body is a Markdown subset: # to ### headings (they render one level
// down, under the page's title), paragraphs, - or 1. lists, > quotes, ```
// code blocks, --- rules, `code`, **bold**, *italic* or _italic_, [links](url)
// and ![images](url). Raw HTML is shown as text, and a link or image goes only
// to https:, a site path (/...), #anchor or mailto:. Anything malformed fails
// the build rather than publishing half a note.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FILE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/u;
const KEYS = new Set(['date', 'summary', 'title']);
const SAFE_URL = /^(?:https:\/\/|\/(?!\/)|#|mailto:)/u;

function fail(message) {
  throw new Error(message);
}

export const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// Inline Markdown. Code spans, images and links become placeholders first, so
// emphasis never reaches into a URL or a code span.
function inline(text, where) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  const url = (raw) => {
    if (!SAFE_URL.test(raw)) fail(`${where}: ${JSON.stringify(raw)} is not an https:, /, # or mailto: URL.`);
    return escapeHtml(raw);
  };
  let out = text
    .replace(/`([^`]+)`/gu, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/gu, (_, alt, src) => hold(`<img src="${url(src)}" alt="${escapeHtml(alt)}" loading="lazy">`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (_, label, href) => hold(`<a href="${url(href)}">${inline(label, where)}</a>`));
  out = escapeHtml(out)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/gu, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([\s\S]*?\S)\*(?![\w*])/gu, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/gu, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/gu, (_, index) => held[Number(index)]);
}

const BLANK = /^\s*$/u;
const FENCE = /^```\s*([\w-]*)\s*$/u;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/u;
const RULE = /^(?:-{3,}|\*{3,})\s*$/u;
const QUOTE = /^>\s?/u;
const ITEM = /^(?:([-*])|(\d+)\.)\s+(.*)$/u;
const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);

export function renderMarkdown(markdown, where = 'note') {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(line)) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const start = i + 1;
      i = start;
      while (i < lines.length && !/^```\s*$/u.test(lines[i])) i += 1;
      if (i === lines.length) fail(`${where}: the code block opened on line ${start} is never closed.`);
      const lang = fence[1] ? ` class="language-${fence[1]}"` : '';
      out.push(`<pre><code${lang}>${escapeHtml(lines.slice(start, i).join('\n'))}</code></pre>`);
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2], where)}</h${level}>`);
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(lines[i++].replace(QUOTE, ''));
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'), where)}</blockquote>`);
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const items = [];
      while (i < lines.length) {
        const next = ITEM.exec(lines[i]);
        if (next && (next[2] !== undefined) === ordered) {
          items.push([next[3]]);
        } else if (items.length > 0 && /^\s{2,}\S/u.test(lines[i])) {
          items.at(-1).push(lines[i].trim());
        } else {
          break;
        }
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && item[2] !== '1' ? ` start="${Number(item[2])}"` : '';
      out.push(`<${tag}${start}>${items.map((parts) => `<li>${inline(parts.join(' '), where)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && !BLANK.test(lines[i]) && !(paragraph.length > 0 && startsBlock(lines[i]))) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${inline(paragraph.join(' '), where)}</p>`);
  }
  return out.join('\n');
}

export function parseNote(text, file) {
  const name = FILE.exec(file);
  if (!name) fail(`notes/${file}: name it <YYYY-MM-DD>-<slug>.md, the slug in lowercase letters, digits and hyphens.`);
  const front = FRONT_MATTER.exec(text.replace(/\r\n?/gu, '\n'));
  if (!front) fail(`notes/${file}: it must start with front matter between --- lines.`);
  const fields = {};
  for (const line of front[1].split('\n')) {
    if (BLANK.test(line)) continue;
    const pair = /^([a-z]+):\s*(.*?)\s*$/u.exec(line);
    if (!pair || !KEYS.has(pair[1])) fail(`notes/${file}: front matter line ${JSON.stringify(line)} is not title, date or summary.`);
    fields[pair[1]] = pair[2];
  }
  if (!fields.title) fail(`notes/${file}: front matter needs a title.`);
  if (!fields.date || !DATE.test(fields.date) || Number.isNaN(Date.parse(`${fields.date}T00:00:00Z`))) {
    fail(`notes/${file}: front matter needs a date as YYYY-MM-DD.`);
  }
  if (new Date(`${fields.date}T00:00:00Z`).toISOString().slice(0, 10) !== fields.date) {
    fail(`notes/${file}: ${fields.date} is not a real date.`);
  }
  const where = `notes/${file}`;
  return {
    date: fields.date,
    html: renderMarkdown(text.replace(/\r\n?/gu, '\n').slice(front[0].length), where),
    slug: name[2],
    summary: fields.summary ? inline(fields.summary, where) : null,
    title: fields.title,
  };
}

// Every note in dir, newest first. A missing dir is no notes.
export function loadNotes(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.md'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const notes = files.map((file) => parseNote(readFileSync(path.join(dir, file), 'utf8'), file));
  const slugs = new Set();
  for (const note of notes) {
    if (slugs.has(note.slug)) fail(`notes: two notes share the slug ${JSON.stringify(note.slug)}.`);
    slugs.add(note.slug);
  }
  return notes.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

// The Atom feed. Site paths in each note become absolute, for feed readers.
export function renderFeed(notes, { author, siteUrl, subtitle, title }) {
  const home = `${siteUrl}/notes/`;
  const stamp = (date) => `${date}T00:00:00Z`;
  const absolute = (html) => html.replace(/\b(href|src)="\/(?!\/)/gu, `$1="${siteUrl}/`);
  const entries = notes
    .map(
      (note) => `<entry>
<title>${escapeHtml(note.title)}</title>
<link href="${home}${note.slug}/"/>
<id>${home}${note.slug}/</id>
<published>${stamp(note.date)}</published>
<updated>${stamp(note.date)}</updated>
${note.summary ? `<summary type="html">${escapeHtml(absolute(note.summary))}</summary>\n` : ''}<content type="html">${escapeHtml(absolute(note.html))}</content>
</entry>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${escapeHtml(title)}</title>
<subtitle>${escapeHtml(subtitle)}</subtitle>
<link href="${home}feed.xml" rel="self"/>
<link href="${home}"/>
<id>${home}</id>
<updated>${notes.length > 0 ? stamp(notes[0].date) : new Date().toISOString()}</updated>
<author><name>${escapeHtml(author)}</name></author>
${entries}
</feed>
`;
}
