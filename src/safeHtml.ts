import DOMPurify from 'dompurify';

// Every Markdown → HTML render (task/project descriptions, comments) goes
// through this before dangerouslySetInnerHTML. marked passes raw HTML through
// unchanged, and descriptions come from outside: mails (Proton extension),
// the AI API, Nozbe import, Android share. Scripts, event handlers and
// javascript: URLs are stripped; links keep their new-tab attributes.
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  });
}
