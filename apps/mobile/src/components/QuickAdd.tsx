import { useState } from 'react';
import { useStore } from '../store';
import { parseQuickAdd } from '../quickParse';
import { dateKey } from '../selectors';
import { listenOnce } from '../voice';
import type { MobileTab } from './Navigation';

// Quick-add for the flat list tabs. Mirrors the desktop: the active view seeds
// the new task's GTD flag (Heute → todayDate, Woche → thisWeek, Aktion →
// starred), and #Projekt / @Kategorie tokens file it (matched against existing
// projects/categories).
export default function QuickAdd({ tab }: { tab: MobileTab }) {
  const addTask = useStore((s) => s.addTask);
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const [title, setTitle] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');

  const submit = () => {
    const raw = title.trim();
    if (!raw) return;
    const parsed = parseQuickAdd(raw);
    const projectId = parsed.projectName
      ? projects.find((p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase())?.id ?? null
      : null;
    const categoryIds = parsed.categoryNames
      .map((n) => categories.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
      .filter((x): x is string => !!x);
    addTask({
      title: parsed.title || raw,
      projectId,
      categoryIds,
      todayDate: tab === 'today' ? dateKey(new Date()) : null,
      thisWeek: tab === 'nextweek',
      starred: tab === 'nextaction',
    });
    setTitle('');
  };

  // Diktat füllt nur das Feld (AC-3: Sichtkontrolle vor dem Anlegen) —
  // "Task anlegen" läuft danach unverändert über submit().
  const dictate = async () => {
    setVoiceError('');
    setListening(true);
    const result = await listenOnce();
    setListening(false);
    if (result.ok) {
      setTitle(result.text);
    } else {
      setVoiceError(result.error);
    }
  };

  return (
    <div className="m-quickadd-wrap">
      <div className="m-quickadd">
        <input
          className="m-quickadd-input"
          placeholder="+ Neue Aufgabe…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          className={`m-quickadd-mic${listening ? ' listening' : ''}`}
          onClick={dictate}
          disabled={listening}
          title="Diktieren"
        >
          {listening ? '●' : '🎤'}
        </button>
        <button className="m-quickadd-add" onClick={submit} disabled={!title.trim()}>
          +
        </button>
      </div>
      {voiceError && <div className="m-quickadd-voice-error">{voiceError}</div>}
    </div>
  );
}
