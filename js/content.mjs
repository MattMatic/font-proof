/**
 * content.mjs — turn the pasted source into a safe, font-neutral DOM fragment.
 *
 * Two jobs, and the second one matters more than it looks:
 *
 *   1. Safety. Pasted HTML goes through an allow-list, not innerHTML. Even on a
 *      local tool, arbitrary markup can pull in remote fonts and stylesheets,
 *      which quietly ruins the comparison you are trying to make.
 *   2. Neutrality. Any font-family, font-size, or @font-face the source brings
 *      with it is stripped, so both panes differ only by the dropped file.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'div', 'span', 'section', 'article', 'header', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small',
  'sub', 'sup', 'abbr', 'cite', 'q', 'blockquote', 'pre', 'code', 'kbd', 'samp',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr', 'figure', 'figcaption'
]);

// lang and dir are kept on purpose: they change shaping, script itemisation and
// glyph selection, and are exactly the sort of thing you want to proof.
const ALLOWED_ATTRS = new Set([
  'lang', 'dir', 'title', 'colspan', 'rowspan', 'span', 'start', 'reversed',
  'type', 'value', 'datetime', 'cite'
]);

const FONTY = /font|@import|url\s*\(|-webkit-text|text-rendering|letter-spacing|word-spacing|line-height/i;

/**
 * @param {string} source
 * @param {'text'|'markdown'|'html'} format
 * @returns {{ fragment: DocumentFragment, notes: string[] }}
 */
export function render(source, format) {
  const notes = [];
  let html;

  if (format === 'html') {
    html = source;
  } else if (format === 'markdown') {
    html = markdownToHtml(source);
  } else {
    return { fragment: plainToFragment(source), notes };
  }

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  sanitize(doc.body, notes);

  const fragment = document.createDocumentFragment();
  while (doc.body.firstChild) fragment.appendChild(doc.body.firstChild);
  return { fragment, notes };
}

/* --------------------------------------------------------------- sanitize */

function sanitize(root, notes) {
  const dropped = new Set();

  // Walk a static list: we mutate the tree as we go.
  const all = [...root.querySelectorAll('*')];

  for (const el of all) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      dropped.add(tag);
      // script/style/iframe and friends take their contents with them;
      // unknown-but-harmless wrappers are unwrapped so text survives.
      if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'template', 'noscript'].includes(tag)) {
        el.remove();
      } else {
        el.replaceWith(...el.childNodes);
      }
      continue;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();

      if (name === 'style') {
        const cleaned = attr.value.split(';').filter((d) => d && !FONTY.test(d)).join(';');
        if (cleaned !== attr.value) dropped.add('style:font-*');
        if (cleaned.trim()) el.setAttribute('style', cleaned); else el.removeAttribute('style');
        continue;
      }

      if (name === 'href' && tag === 'a') {
        // Keep links visible but inert: they are text to be proofed, not
        // navigation, and javascript: URLs have no business here.
        el.removeAttribute('href');
        continue;
      }

      if (!ALLOWED_ATTRS.has(name)) {
        if (name.startsWith('on')) dropped.add('event handlers');
        else dropped.add(`@${name}`);
        el.removeAttribute(attr.name);
      }
    }
  }

  if (dropped.size) {
    notes.push(`Removed for safety and neutrality: ${[...dropped].sort().join(', ')}.`);
  }
}

/* ------------------------------------------------------------------ plain */

function plainToFragment(text) {
  const fragment = document.createDocumentFragment();
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const p = document.createElement('p');
    const lines = block.split('\n');
    lines.forEach((line, i) => {
      if (i) p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode(line));
    });
    fragment.appendChild(p);
  }
  return fragment;
}

/* --------------------------------------------------------------- markdown */

/**
 * A deliberately small Markdown subset: headings, emphasis, code, links,
 * lists, blockquotes, rules, paragraphs. It is enough to lay out a specimen.
 *
 * If you need real CommonMark — tables, nested lists, reference links, HTML
 * blocks — replace this function with marked or markdown-it. The output still
 * goes through sanitize(), so swapping in a library does not widen the attack
 * surface.
 */
export function markdownToHtml(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;      // 'ul' | 'ol' | null
  let quote = false;
  let fence = false;
  let code = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join('\n'))}</p>`);
    para = [];
  };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushQuote = () => { if (quote) { out.push('</blockquote>'); quote = false; } };

  for (const raw of lines) {
    if (/^```/.test(raw)) {
      if (fence) { out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; fence = false; }
      else { flushPara(); flushList(); flushQuote(); fence = true; }
      continue;
    }
    if (fence) { code.push(raw); continue; }

    const line = raw.trimEnd();

    if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList(); flushQuote();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^([-*_])\1{2,}\s*$/.test(line)) {
      flushPara(); flushList(); flushQuote();
      out.push('<hr>');
      continue;
    }

    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) {
      flushPara(); flushList();
      if (!quote) { out.push('<blockquote>'); quote = true; }
      out.push(`<p>${inline(bq[1])}</p>`);
      continue;
    }
    flushQuote();

    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const want = item[1] ? 'ul' : 'ol';
      if (list !== want) { flushList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline(item[3])}</li>`);
      continue;
    }
    flushList();

    para.push(line);
  }

  if (fence) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushPara(); flushList(); flushQuote();
  return out.join('\n');
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/!?\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, label) => `<a>${label}</a>`);
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n/g, '<br>\n');
  return s;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
