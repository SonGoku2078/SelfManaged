// Injected into the Proton Mail tab to read the currently open e-mail.
// Selectors are Proton's own data-testids (ProtonMail/WebClients, checked
// 2026-10-09): ConversationHeader, HeaderExpanded (recipients:sender),
// RecipientItemLayout (recipient-label/-address), MessageView
// (message-view-N, data-expanded) and MessageBodyIframe (content-iframe —
// about:blank + allow-same-origin, so the page can read its document).
// Returns a plain object (must be JSON-serialisable).
function extractProtonMail() {
  const MAX_NOTE = 6000;
  const text = (el) => (el && (el.getAttribute('title') || el.textContent || '').trim()) || '';
  const clean = (s) => s.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

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

  let subject =
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
  if (frameDoc && frameDoc.body) body = frameDoc.body.innerText || '';
  if (!body) {
    const el = message.querySelector('[data-testid="message-content:body"]');
    body = (el && el.innerText) || '';
  }
  body = clean(body);
  if (body.length > MAX_NOTE) body = body.slice(0, MAX_NOTE).trimEnd() + ' …';

  return {
    subject: subject || 'E-Mail ohne Betreff',
    sender,
    url: location.href,
    selected: selected.slice(0, MAX_NOTE),
    body,
  };
}

// The script's last expression is returned to chrome.scripting.executeScript.
extractProtonMail();
