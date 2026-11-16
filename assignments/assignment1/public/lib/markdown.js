/**
 * Zero-dependency XSS-safe Markdown renderer & LCS unified diff helper.
 * Follows Modern Web Guidance (`sanitize-untrusted-html`): uses native Element.setHTML
 * when supported and falls back to DOM allowlist sanitization (never raw innerHTML).
 */

const SAFE_URL_RE = /^(https?:|mailto:|\/|\.\.?\/|#)/i;

const ALLOWED_ELEMENTS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'em',
  'del',
  'a',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'div',
  'span',
  'br',
];

const ALLOWED_ATTRIBUTES = ['href', 'rel', 'target', 'class', 'data-lang'];

/**
 * Escape HTML special characters so untrusted raw text cannot inject tags or attributes.
 */
export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Validate URL protocols against an allowlist to block `javascript:` or `data:` payloads.
 */
export function sanitizeUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || !SAFE_URL_RE.test(trimmed)) return '#';
  return trimmed;
}

function formatInlineMarkdown(escapedLine) {
  const codeTokens = [];
  let text = escapedLine.replace(/`([^`]+)`/g, (_m, code) => {
    const token = `\u0000ICODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  // Links: [label](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const safeHref = escapeHtml(sanitizeUrl(url.replaceAll('&amp;', '&')));
    if (safeHref === '#') return label;
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold, italic, strikethrough
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return text.replace(/\u0000ICODE(\d+)\u0000/g, (_m, idx) => codeTokens[Number(idx)] || '');
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

/**
 * Convert Markdown prose into escaped, structured HTML.
 */
export function renderMarkdownToHtml(markdown) {
  const source = String(markdown || '').replace(/\r\n?/g, '\n');
  if (!source.trim()) return '';

  // 1. Extract fenced code blocks before escaping inline blocks
  const fencedBlocks = [];
  const withPlaceholders = source.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_m, lang, body) => {
    const token = `\u0000FENCE${fencedBlocks.length}\u0000`;
    const safeLang = escapeHtml(lang || 'text');
    const safeBody = escapeHtml(body.replace(/\n$/, ''));
    fencedBlocks.push(
      `<div class="md-codeblock"><div class="md-codeblock-lang">${safeLang}</div><pre><code data-lang="${safeLang}">${safeBody}</code></pre></div>`
    );
    return `\n${token}\n`;
  });

  const lines = withPlaceholders.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^\u0000FENCE(\d+)\u0000$/);
    if (fenceMatch) {
      out.push(fencedBlocks[Number(fenceMatch[1])] || '');
      i += 1;
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    const headingMatch = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level}>${formatInlineMarkdown(escapeHtml(headingMatch[2]))}</h${level}>`);
      i += 1;
      continue;
    }

    // Table block
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      const thHtml = headers.map((h) => `<th>${formatInlineMarkdown(escapeHtml(h))}</th>`).join('');
      const bodyHtml = rows
        .map((row) => `<tr>${row.map((c) => `<td>${formatInlineMarkdown(escapeHtml(c))}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(formatInlineMarkdown(escapeHtml(lines[i].trim().replace(/^>\s?/, ''))));
        i += 1;
      }
      out.push(`<blockquote><p>${quoteLines.join('<br>')}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInlineMarkdown(escapeHtml(lines[i].trim().replace(/^[-*+]\s+/, '')))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInlineMarkdown(escapeHtml(lines[i].trim().replace(/^\d+\.\s+/, '')))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Paragraph: collect contiguous plain lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^\u0000FENCE\d+\u0000$/.test(lines[i].trim())
    ) {
      paraLines.push(formatInlineMarkdown(escapeHtml(lines[i])));
      i += 1;
    }
    out.push(`<p>${paraLines.join('<br>')}</p>`);
  }

  return out.join('\n');
}

function sanitizeNodeTree(root, targetDoc) {
  const allowedSet = new Set(ALLOWED_ELEMENTS);
  const attrSet = new Set(ALLOWED_ATTRIBUTES);
  const fragment = targetDoc.createDocumentFragment();

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      fragment.appendChild(targetDoc.createTextNode(child.textContent || ''));
      continue;
    }
    if (child.nodeType !== 1) continue;

    const tag = child.tagName.toLowerCase();
    if (!allowedSet.has(tag)) continue;

    const cleanEl = targetDoc.createElement(tag);
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (!attrSet.has(name)) continue;
      if (name === 'href') {
        cleanEl.setAttribute('href', sanitizeUrl(attr.value));
      } else {
        cleanEl.setAttribute(name, attr.value);
      }
    }
    cleanEl.appendChild(sanitizeNodeTree(child, targetDoc));
    fragment.appendChild(cleanEl);
  }
  return fragment;
}

/**
 * Safely mount rendered Markdown HTML into a DOM element using the native Sanitizer API
 * (`Element.prototype.setHTML`) when present, with a strict DOMParser allowlist fallback.
 */
export function safeSetMarkdownHtml(el, markdownText) {
  const html = renderMarkdownToHtml(markdownText);
  if (typeof Element !== 'undefined' && 'setHTML' in Element.prototype) {
    el.setHTML(html, {
      sanitizer: {
        elements: ALLOWED_ELEMENTS,
        attributes: ALLOWED_ATTRIBUTES,
      },
    });
    return;
  }

  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const cleanFragment = sanitizeNodeTree(parsed.body, el.ownerDocument);
    el.replaceChildren(cleanFragment);
    return;
  }

  el.textContent = markdownText;
}

/**
 * Compute line-level unified diff between two strings for inline Edit visualization.
 */
export function computeUnifiedDiff(oldText, newText) {
  const a = String(oldText ?? '').split(/\r?\n/);
  const b = String(newText ?? '').split(/\r?\n/);

  // Guard against quadratic blowup on massive files
  if (a.length * b.length > 40000) {
    return [
      ...a.map((text, idx) => ({ type: 'del', oldLine: idx + 1, newLine: null, text })),
      ...b.map((text, idx) => ({ type: 'add', oldLine: null, newLine: idx + 1, text })),
    ];
  }

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      diff.push({ type: 'ctx', oldLine: i + 1, newLine: j + 1, text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'del', oldLine: i + 1, newLine: null, text: a[i] });
      i += 1;
    } else {
      diff.push({ type: 'add', oldLine: null, newLine: j + 1, text: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    diff.push({ type: 'del', oldLine: i + 1, newLine: null, text: a[i] });
    i += 1;
  }
  while (j < n) {
    diff.push({ type: 'add', oldLine: null, newLine: j + 1, text: b[j] });
    j += 1;
  }

  return diff;
}
