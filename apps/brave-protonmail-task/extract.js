// Injected into the Proton Mail tab to read the currently open e-mail.
// Selectors are Proton's own data-testids (ProtonMail/WebClients, checked
// 2026-10-09): ConversationHeader, HeaderExpanded (recipients:sender),
// RecipientItemLayout (recipient-label/-address), MessageView
// (message-view-N, data-expanded) and MessageBodyIframe (content-iframe —
// about:blank + allow-same-origin, so the page can read its document).
// Returns a plain object (must be JSON-serialisable).
//
// The mail body is converted to Markdown — links, bold/italic, headings,
// lists, quotes kept — never passed on as raw HTML: the app renders task
// descriptions as HTML, and mail HTML is attacker-controlled. Images become
// links (no tracking pixels loading whenever the task is opened).
function extractProtonMail() {
  const MAX_NOTE = 100000;
  const text = (el) => (el && (el.getAttribute('title') || el.textContent || '').trim()) || '';
  const clean = (s) => s.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // ── HTML → Markdown ────────────────────────────────────────────────────
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'SVG', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME', 'OBJECT']);
  const PARA = new Set(['P', 'TABLE', 'BLOCKQUOTE', 'UL', 'OL', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR']);
  const LINE = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'CENTER', 'TR', 'TD', 'TH', 'TBODY', 'THEAD', 'TFOOT', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION', 'ADDRESS']);
  const esc = (s) => s.replace(/([\\`*_[\]<>#|])/g, '\\$1');
  const safeUrl = (u) => {
    const v = (u || '').trim();
    return /^(https?:|mailto:)/i.test(v) ? v.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29') : '';
  };
  const wrap = (mark, inner) => {
    const t = inner.trim();
    return t ? `${mark}${t}${mark}` : '';
  };

  function conv(node, depth) {
    if (node.nodeType === 3) return esc(node.nodeValue.replace(/\s+/g, ' '));
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag)) return '';
    const kids = () => Array.from(node.childNodes).map((c) => conv(c, depth)).join('');
    switch (tag) {
      case 'BR':
        return '\n';
      case 'HR':
        return '\n\n---\n\n';
      case 'B':
      case 'STRONG':
        return wrap('**', kids());
      case 'I':
      case 'EM':
        return wrap('_', kids());
      case 'S':
      case 'STRIKE':
      case 'DEL':
        return wrap('~~', kids());
      case 'CODE':
        return node.closest('pre') ? node.textContent : wrap('`', node.textContent.replace(/`/g, "'"));
      case 'PRE':
        return '\n\n```\n' + node.textContent.replace(/```/g, "'''") + '\n```\n\n';
      case 'A': {
        const inner = kids().trim();
        const href = safeUrl(node.getAttribute('href'));
        if (!href) return inner;
        if (!inner || inner === esc(href)) return ` ${href} `;
        return `[${inner.replace(/\n+/g, ' ')}](${href})`;
      }
      case 'IMG': {
        const w = Number(node.getAttribute('width')) || 0;
        const h = Number(node.getAttribute('height')) || 0;
        if ((w && w <= 3) || (h && h <= 3)) return ''; // tracking pixel
        const alt = esc((node.getAttribute('alt') || '').trim());
        const src = safeUrl(node.getAttribute('src'));
        if (src) return `[🖼 ${alt || 'Bild'}](${src})`;
        return alt ? `[Bild: ${alt}]` : '';
      }
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return `\n\n${'#'.repeat(Number(tag[1]))} ${kids().replace(/\s+/g, ' ').trim()}\n\n`;
      case 'UL':
      case 'OL': {
        const items = Array.from(node.children).filter((c) => c.tagName.toUpperCase() === 'LI');
        const pad = '  '.repeat(depth);
        const lines = items.map((li, i) => {
          const body = Array.from(li.childNodes).map((c) => conv(c, depth + 1)).join('');
          const t = clean(body).replace(/\n/g, `\n${pad}  `);
          return `${pad}${tag === 'OL' ? `${i + 1}.` : '-'} ${t}`;
        });
        return `\n\n${lines.join('\n')}\n\n`;
      }
      case 'BLOCKQUOTE':
        return `\n\n${clean(kids()).split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
      default: {
        const inner = kids();
        if (PARA.has(tag)) return `\n\n${inner}\n\n`;
        if (LINE.has(tag)) return `\n${inner}\n`;
        return inner;
      }
    }
  }

  const toMarkdown = (root) =>
    clean(conv(root, 0))
      .split('\n')
      .map((l) => l.replace(/^ +(?![-\d>])/, '').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  // ── Open mail ──────────────────────────────────────────────────────────
  // The message the user is looking at: the last expanded one in the
  // conversation (Proton expands the newest by default).
  const expanded = Array.from(document.querySelectorAll('[data-testid^="message-view-"][data-expanded="true"]'));
  const message = expanded[expanded.length - 1] || document;

  const iframe = message.querySelector('iframe[data-testid="content-iframe"]');
  let frameDoc = null;
  try {
    frameDoc = iframe && iframe.contentDocument;
  } catch {
    frameDoc = null; // cross-origin — fall back to the outer markup
  }

  const subject =
    text(document.querySelector('[data-testid="conversation-header:subject"]')) ||
    (iframe && iframe.getAttribute('data-subject')) ||
    (document.title || '').replace(/\s*[|–-]\s*Proton Mail.*$/i, '').trim();

  const senderEl = message.querySelector('[data-testid="recipients:sender"]');
  const name = text(senderEl && senderEl.querySelector('[data-testid="recipient-label"]'));
  const address = text(senderEl && senderEl.querySelector('[data-testid="recipient-address"]')).replace(/^<|>$/g, '');
  const sender = name && address && name !== address ? `${name} <${address}>` : name || address;

  // A text selection wins: mark the part of the mail that is the task.
  const selected = clean(
    (frameDoc && frameDoc.getSelection && String(frameDoc.getSelection())) || String(window.getSelection() || '')
  );

  let body = '';
  const bodyRoot =
    (frameDoc && frameDoc.body && frameDoc.body.textContent.trim() && frameDoc.body) ||
    message.querySelector('[data-testid="message-content:body"]');
  if (bodyRoot) body = toMarkdown(bodyRoot);
  if (body.length > MAX_NOTE) body = body.slice(0, MAX_NOTE).trimEnd() + '\n\n…';

  // ── Mails ticked in the list ───────────────────────────────────────────
  // (Item.tsx: data-element-id, message-item:<Subject>, ItemCheckbox.) Each
  // becomes its own task; background.js opens each one to read its content.
  const segs = location.pathname.split('/').filter(Boolean);
  const folder = '/' + (segs[0] === 'u' ? segs.slice(0, 3) : segs.slice(0, 1)).join('/');
  const checked = Array.from(document.querySelectorAll('[data-element-id]'))
    .filter((item) => item.querySelector('input[type="checkbox"]:checked'))
    .map((item) => {
      const testid = item.getAttribute('data-testid') || '';
      const listSubject = testid.startsWith('message-item:') ? testid.slice('message-item:'.length).trim() : '';
      return {
        subject: listSubject || 'E-Mail ohne Betreff',
        sender: text(item.querySelector('[data-testid="message-column:sender-address"], [data-testid="message-row:sender-address"]')),
        url: `${location.origin}${folder}/${item.getAttribute('data-element-id')}`,
      };
    });

  return {
    hasOpenMail: expanded.length > 0 || !!document.querySelector('[data-testid="conversation-header:subject"]'),
    // Proton fills the body iframe only after decrypting — empty until then.
    bodyReady: !!body,
    checked,
    subject: subject || 'E-Mail ohne Betreff',
    sender,
    url: location.href,
    selected: selected.slice(0, MAX_NOTE),
    body,
  };
}

// The script's last expression is returned to chrome.scripting.executeScript.
extractProtonMail();
