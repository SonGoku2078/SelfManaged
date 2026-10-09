import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { safeHtml } from '../safeHtml';
import type { Project } from '../types';
import { useStore } from '../store';
import { DescToolbar } from './DescToolbar';
import './TaskDetailPanel.css';
import './ProjectDetailPanel.css';

interface ProjectDetailPanelProps {
  project: Project;
  onClose: () => void;
}

// Render markdown to HTML. Links open in a new tab.
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) =>
  `<a href="${href ?? ''}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;
marked.setOptions({ renderer, breaks: false });

function renderMarkdown(text: string): string {
  return safeHtml(marked.parse(text) as string)
    .replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/g, '')
    .replace(/<li>\n?<p>([\s\S]*?)<\/p>\n?<\/li>/g, '<li>$1</li>');
}


export default function ProjectDetailPanel({ project, onClose }: ProjectDetailPanelProps) {
  const updateProject = useStore((s) => s.updateProject);
  const storedWidth = useStore((s) => s.settings.detailPanelWidth);
  const setDetailPanelWidth = useStore((s) => s.setDetailPanelWidth);
  const [width, setWidth] = useState(storedWidth ?? 420);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (storedWidth) setWidth(storedWidth);
  }, [storedWidth]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const clamp = (px: number) => Math.max(320, Math.min(720, px));
    const onMove = (ev: MouseEvent) => setWidth(clamp(window.innerWidth - ev.clientX));
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDetailPanelWidth(clamp(window.innerWidth - ev.clientX));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startEdit = () => {
    setDescDraft(project.description ?? '');
    setEditingDesc(true);
  };

  const commit = () => {
    // Read latest value from textarea (execCommand updates DOM but not React state).
    const val = taRef.current?.value ?? descDraft;
    updateProject(project.id, { description: val.trim() || undefined });
    setEditingDesc(false);
  };

  // Auto-grow textarea height.
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  return (
    <div className="task-detail-panel project-detail-panel" ref={panelRef} style={{ width }}>
      <div className="detail-resize" onMouseDown={startResize} />
      <div className="panel-header">
        <h3>
          <span className="project-detail-dot" style={{ background: project.color }} />
          {project.name}
        </h3>
        <div className="panel-header-actions">
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="panel-content">
        <div className="detail-field">
          <label className="detail-label">Beschreibung</label>

          {editingDesc ? (
            <div className="desc-editor-wrap">
              <DescToolbar taRef={taRef} onSave={commit} />
              <textarea
                ref={(el) => {
                  (taRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
                  autoGrow(el);
                }}
                className="detail-input detail-textarea project-desc-textarea"
                autoFocus
                value={descDraft}
                rows={6}
                style={{ overflow: 'hidden', resize: 'none' }}
                onChange={(e) => {
                  setDescDraft(e.target.value);
                  autoGrow(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); commit(); }
                  else if (e.key === 'Escape') setEditingDesc(false);
                }}
                placeholder="Beschreibung hinzufügen… (Markdown)"
              />
            </div>
          ) : project.description ? (
            <div
              className="detail-input detail-textarea detail-desc-view project-detail-desc markdown-body"
              onClick={startEdit}
              title="Zum Bearbeiten klicken"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(project.description) }}
            />
          ) : (
            <div
              className="detail-input detail-textarea detail-desc-view project-detail-desc project-detail-desc-empty"
              onClick={startEdit}
            >
              Beschreibung hinzufügen…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
