// Run with: npm test
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadNotes, parseNote, renderFeed, renderMarkdown } from '../notes.mjs';

const note = (front, body = 'Hello.') => `---\n${front}\n---\n\n${body}\n`;
const GOOD = note('title: A note\ndate: 2026-11-08\nsummary: Short **and** sweet.');

describe('parseNote', () => {
  it('reads the front matter, the slug and the body', () => {
    const parsed = parseNote(GOOD, '2026-11-08-a-note.md');
    assert.equal(parsed.slug, 'a-note');
    assert.equal(parsed.title, 'A note');
    assert.equal(parsed.date, '2026-11-08');
    assert.equal(parsed.summary, 'Short <strong>and</strong> sweet.');
    assert.equal(parsed.html, '<p>Hello.</p>');
  });

  it('fails a note it cannot publish whole', () => {
    assert.throws(() => parseNote(GOOD, 'a-note.md'), /YYYY-MM-DD/);
    assert.throws(() => parseNote('Hello.', '2026-11-08-a.md'), /front matter/);
    assert.throws(() => parseNote(note('date: 2026-11-08'), '2026-11-08-a.md'), /needs a title/);
    assert.throws(() => parseNote(note('title: A\ndate: 11/08/2026'), '2026-11-08-a.md'), /YYYY-MM-DD/);
    assert.throws(() => parseNote(note('title: A\ndate: 2026-02-30'), '2026-11-08-a.md'), /not a real date/);
    assert.throws(() => parseNote(note('title: A\ndate: 2026-11-08\nauthor: me'), '2026-11-08-a.md'), /title, date or summary/);
  });
});

describe('renderMarkdown', () => {
  it('renders the supported blocks', () => {
    const html = renderMarkdown(
      [
        '# Heading',
        '',
        'A paragraph',
        'over two lines.',
        '',
        '- one',
        '- two',
        '  continued',
        '',
        '3. three',
        '4. four',
        '',
        '> quoted *words*',
        '',
        '```js',
        'const a = 1 < 2;',
        '```',
        '',
        '---',
      ].join('\n')
    );
    assert.equal(
      html,
      [
        '<h2>Heading</h2>',
        '<p>A paragraph over two lines.</p>',
        '<ul><li>one</li><li>two continued</li></ul>',
        '<ol start="3"><li>three</li><li>four</li></ol>',
        '<blockquote><p>quoted <em>words</em></p></blockquote>',
        '<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>',
        '<hr>',
      ].join('\n')
    );
  });

  it('renders inline code, emphasis, links and images', () => {
    assert.equal(
      renderMarkdown('Run `a*b*c` with **care**, _not_ snake_case, see [the docs](https://example.com/a_b_c) ![shot](/notes/media/a.png).'),
      '<p>Run <code>a*b*c</code> with <strong>care</strong>, <em>not</em> snake_case, see <a href="https://example.com/a_b_c">the docs</a> <img src="/notes/media/a.png" alt="shot" loading="lazy">.</p>'
    );
  });

  it('shows raw HTML as text', () => {
    assert.equal(renderMarkdown('<script>alert(1)</script> & "quotes"'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>');
  });

  it('refuses a link that is not https, a site path, an anchor or mailto', () => {
    assert.throws(() => renderMarkdown('[x](javascript:alert(1))'), /not an https/);
    assert.throws(() => renderMarkdown('[x](http://example.com)'), /not an https/);
    assert.throws(() => renderMarkdown('[x](//evil.example)'), /not an https/);
    assert.match(renderMarkdown('[x](mailto:a@b.c) [y](#top)'), /href="mailto:a@b.c".*href="#top"/);
  });

  it('fails a code block that is never closed', () => {
    assert.throws(() => renderMarkdown('```\ncode'), /never closed/);
  });
});

describe('loadNotes', () => {
  it('lists the notes newest first and refuses two with one slug', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notes-'));
    writeFileSync(path.join(dir, '2026-11-01-older.md'), note('title: Older\ndate: 2026-11-01'));
    writeFileSync(path.join(dir, '2026-11-08-newer.md'), note('title: Newer\ndate: 2026-11-08'));
    writeFileSync(path.join(dir, 'README.txt'), 'not a note');
    assert.deepEqual(
      loadNotes(dir).map((n) => n.slug),
      ['newer', 'older']
    );
    writeFileSync(path.join(dir, '2026-11-09-newer.md'), note('title: Again\ndate: 2026-11-09'));
    assert.throws(() => loadNotes(dir), /share the slug "newer"/);
  });

  it('reads a missing folder as no notes', () => {
    assert.deepEqual(loadNotes(path.join(tmpdir(), 'no-such-notes-folder')), []);
  });
});

describe('renderFeed', () => {
  it('writes an Atom feed with absolute links and escaped content', () => {
    const notes = [parseNote(note('title: Tom & Jerry\ndate: 2026-11-08', 'See [home](/).'), '2026-11-08-tom.md')];
    const feed = renderFeed(notes, { author: 'Ada', siteUrl: 'https://brainstrike.ai', subtitle: 'Sub', title: 'Notes' });
    assert.match(feed, /<title>Tom &amp; Jerry<\/title>/);
    assert.match(feed, /<id>https:\/\/brainstrike.ai\/notes\/tom\/<\/id>/);
    assert.match(feed, /<updated>2026-11-08T00:00:00Z<\/updated>/);
    assert.match(feed, /<content type="html">&lt;p&gt;See &lt;a href=&quot;https:\/\/brainstrike.ai\/&quot;&gt;home&lt;\/a&gt;.&lt;\/p&gt;<\/content>/);
  });
});
