import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { parseQuickAdd } from '../quickParse';
import { useSwipeDown } from '../gestures';
import { deriveShareFields } from '../shareFields';
import { dateKey } from '../selectors';
import type { SharedPayload } from '../shareTarget';
import { groupProjects } from '../projectGroups';
import type { Project, Task } from '../types';

// Quick-capture sheet shown when content is shared into the app. The link goes
// into the note; the project defaults to Inbox and can be searched/picked.
// ☀️ Heute / 🗓️ Next Week / ★ Next Action can be toggled like in the desktop.
// Saving is purely local (store + outbox) and closes at once; the caller then
// shows the new task in the list it landed in.
export default function ShareCapture({
  payload,
  onClose,
  onSaved,
}: {
  payload: SharedPayload;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const addTask = useStore((s) => s.addTask);

  const initial = useMemo(() => deriveShareFields(payload), [payload]);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [projectChoice, setProjectChoice] = useState<string>(''); // '' = Inbox / follow #tag
  const [projQuery, setProjQuery] = useState('');
  const [today, setToday] = useState(false);
  const [thisWeek, setThisWeek] = useState(false);
  const [starred, setStarred] = useState(false);
  const swipe = useSwipeDown(onClose);

  // Same groups/order/colors as the desktop "Projekte" panel. Someday projects
  // stay hidden like there, but a search still finds them.
  const searching = projQuery.trim() !== '';
  const groups = groupProjects(projects, projQuery);
  const someday = searching ? groups.someday : [];
  const noMatch = groups.projects.length + groups.areas.length + someday.length === 0;
  const chosen = projectChoice ? projects.find((p) => p.id === projectChoice) : undefined;

  const pick = (id: string) => {
    setProjectChoice(id);
    setProjQuery('');
    (document.activeElement as HTMLElement | null)?.blur?.(); // drop the keyboard
  };
  const projItem = (p: Project) => (
    <button
      key={p.id}
      className={`m-share-projitem ${projectChoice === p.id ? 'on' : ''}`}
      onClick={() => pick(p.id)}
    >
      <span className="m-dot" style={{ background: p.color ?? '#9ca3af' }} />
      <span className="m-share-projname">{p.kind === 'area' ? '∞ ' : ''}{p.name}</span>
    </button>
  );
  const canSave = !!title.trim() || !!description.trim();

  const save = () => {
    const parsed = parseQuickAdd(title);
    let projectId: string | null;
    if (projectChoice) projectId = projectChoice; // explicit dropdown wins
    else if (parsed.projectName) {
      const m = projects.find((p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase());
      projectId = m ? m.id : null; // unknown #tag → Inbox (default)
    } else projectId = null;

    const categoryIds = parsed.categoryNames
      .map((n) => categories.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
      .filter((x): x is string => !!x);

    const task = addTask({
      title: parsed.title || 'Geteilte Aufgabe',
      description,
      projectId,
      categoryIds,
      todayDate: today ? dateKey(new Date()) : null,
      thisWeek,
      // Heute / Next Week imply Next Action anyway (addTask).
      starred: starred || today || thisWeek,
    });
    onSaved(task);
  };

  return (
    <div className="m-modal-backdrop" onClick={onClose}>
      <div className="m-modal" onClick={(e) => e.stopPropagation()} style={swipe.style} {...swipe.handlers}>
        {/* Save sits in the sticky head — reachable while the keyboard is up. */}
        <div className="m-modal-head m-share-head">
          <button className="m-modal-x" onClick={onClose} aria-label="Abbrechen">✕</button>
          <span className="m-share-headtitle">Aufgabe erfassen</span>
          <button className="m-share-save" onClick={save} disabled={!canSave}>
            Speichern
          </button>
        </div>

        <label className="m-field">
          <span>Titel</span>
          <input
            value={title}
            placeholder="Titel… (#Projekt @Kategorie)"
            autoFocus
            enterKeyHint="done"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSave) save(); }}
          />
        </label>

        <div className="m-share-flags">
          <button
            type="button"
            className={`m-share-flag ${today ? 'on' : ''}`}
            aria-pressed={today}
            onClick={() => setToday((v) => !v)}
          >
            ☀️ Heute
          </button>
          <button
            type="button"
            className={`m-share-flag ${thisWeek ? 'on' : ''}`}
            aria-pressed={thisWeek}
            onClick={() => setThisWeek((v) => !v)}
          >
            🗓️ Next Week
          </button>
          <button
            type="button"
            className={`m-share-flag ${starred || today || thisWeek ? 'on' : ''}`}
            aria-pressed={starred || today || thisWeek}
            disabled={today || thisWeek}
            onClick={() => setStarred((v) => !v)}
          >
            ★ Next Action
          </button>
        </div>

        <div className="m-field">
          <span className="m-share-chosen">
            Projekt:{' '}
            {chosen && <span className="m-dot" style={{ background: chosen.color ?? '#9ca3af' }} />}
            <strong>{chosen ? `${chosen.kind === 'area' ? '∞ ' : ''}${chosen.name}` : 'Inbox'}</strong>
          </span>
          <input
            className="m-share-projsearch"
            placeholder="Projekt suchen… (leer = Inbox)"
            value={projQuery}
            onChange={(e) => setProjQuery(e.target.value)}
          />
          <div className="m-share-projlist">
            <button
              className={`m-share-projitem ${projectChoice === '' ? 'on' : ''}`}
              onClick={() => pick('')}
            >
              📥 Inbox (kein Projekt)
            </button>
            {groups.projects.map(projItem)}
            {groups.areas.length > 0 && (
              <>
                <div className="m-share-projgroup">📦 Areas</div>
                {groups.areas.map(projItem)}
              </>
            )}
            {someday.length > 0 && (
              <>
                <div className="m-share-projgroup">🌥️ Someday</div>
                {someday.map(projItem)}
              </>
            )}
            {noMatch && <p className="m-settings-hint">Kein Projekt gefunden.</p>}
          </div>
        </div>

        <label className="m-field">
          <span>Beschreibung</span>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
