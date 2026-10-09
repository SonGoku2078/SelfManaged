import { useEffect, useState } from 'react';
import { useStore, DEFAULT_NAV_ORDER } from '../store';
import type { ViewType } from '../types';
import { readTaskIds } from '../dnd';
import UsersIcon from './UsersIcon';
import { useWindowMenu } from './WindowMenu';
import { WINDOW_VIEWS } from '../windows';
import './Sidebar.css';

// Icon + label for every reorderable main menu (order comes from settings.navOrder).
const navMeta: Record<string, { icon: string; label: string }> = {
  priority: { icon: '📌', label: 'Nächste Aktion' },
  inbox: { icon: '📥', label: 'Inbox' },
  today: { icon: '⭐', label: 'Heute' },
  nextweek: { icon: '🗓️', label: 'Next Week' },
  someday: { icon: '🌥️', label: 'Someday' },
  projects: { icon: '📂', label: 'Projekte' },
  categories: { icon: '🏷️', label: 'Kategorien' },
  calendar: { icon: '📅', label: 'Kalender' },
  templates: { icon: '📋', label: 'Vorlagen' },
  members: { icon: '👤', label: 'Benutzer' },
};

const bottomItems: { id: ViewType; icon: string; label: string; devOnly?: boolean }[] = [
  { id: 'search', icon: '🔍', label: 'Suchen' },
  { id: 'completed', icon: '✅', label: 'Erledigt' },
  { id: 'recurring', icon: '🔁', label: 'Wiederkehrend' },
  { id: 'activity', icon: '📜', label: 'Aktivität' },
  { id: 'reports', icon: '📊', label: 'Berichte' },
  // Pre-deploy approval page — a DEV tool, hidden in production (#31).
  { id: 'testreport', icon: '🧪', label: 'Testreport', devOnly: true },
  { id: 'settings', icon: '⚙️', label: 'Einstellungen' },
];

export default function Sidebar() {
  const currentView = useStore((s) => s.ui.currentView);
  const sidePanel = useStore((s) => s.ui.sidePanel);
  const inboxPanel = useStore((s) => (s.settings.inboxProjectPanel ?? 1) === 1);
  const setView = useStore((s) => s.setView);
  const setSidePanel = useStore((s) => s.setSidePanel);
  const savedViews = useStore((s) => s.savedViews);
  const applySavedView = useStore((s) => s.applySavedView);
  const deleteSavedView = useStore((s) => s.deleteSavedView);
  const activeSavedViewId = useStore((s) => s.ui.activeSavedViewId);
  const navOrder = useStore((s) => s.settings.navOrder);
  const reorderNav = useStore((s) => s.reorderNav);
  const updateTask = useStore((s) => s.updateTask);
  const windowMenu = useWindowMenu();
  // Right-click → "In neuem Fenster öffnen" on views that stand on their own.
  const windowMenuFor = (id: ViewType) =>
    WINDOW_VIEWS.has(id) ? windowMenu.onContextMenu({ kind: 'view', view: id }) : undefined;

  // A task dragged from the list onto Next Week / Someday gets the matching flag.
  const taskDropFlag = (id: ViewType): Partial<{ thisWeek: boolean; someday: boolean }> | null =>
    id === 'nextweek' ? { thisWeek: true } : id === 'someday' ? { someday: true } : null;

  const [dragId, setDragId] = useState<ViewType | null>(null);
  const [overId, setOverId] = useState<ViewType | null>(null);

  // DEV detection for devOnly menu items (#31): the backend reports its port.
  const [isDev, setIsDev] = useState(false);
  useEffect(() => {
    let on = true;
    fetch('/api/lan')
      .then((r) => r.json())
      .then((d) => { if (on) setIsDev(d.port === 3002); })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  // Stored order, but tolerate added/removed menu ids across versions.
  const order = (navOrder ?? DEFAULT_NAV_ORDER).filter((id) => navMeta[id]);
  for (const id of DEFAULT_NAV_ORDER) if (!order.includes(id)) order.push(id);

  // Collapse to icons when a contextual panel takes the left space — including
  // the Inbox project-assign panel (#32).
  const collapsed = sidePanel !== 'none' || (currentView === 'inbox' && inboxPanel);

  const handleNav = (id: ViewType) => {
    if (id === 'projects' || id === 'calendar' || id === 'someday') {
      // Toggle the contextual panel: open it (collapse sidebar) or close it.
      if (sidePanel === id) {
        setSidePanel('none');
      } else {
        setView(id);
        setSidePanel(id);
      }
    } else {
      setSidePanel('none');
      setView(id);
    }
  };

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand" title="SelfManaged">
        <span className="sidebar-label">SelfManaged</span>
      </div>

      <div className="sidebar-items">
        {order.map((id) => {
          const item = navMeta[id];
          return (
            <button
              key={id}
              className={`sidebar-item ${currentView === id ? 'active' : ''} ${
                overId === id ? 'nav-drop' : ''
              } ${dragId === id ? 'nav-dragging' : ''}`}
              onClick={() => handleNav(id)}
              onContextMenu={windowMenuFor(id)}
              title={item.label}
              draggable
              onDragStart={() => setDragId(id)}
              onDragOver={(e) => {
                // Reordering a menu, or dropping a task onto Next Week / Someday.
                if (dragId || (taskDropFlag(id) && e.dataTransfer.types.includes('text/plain'))) {
                  e.preventDefault();
                  setOverId(id);
                }
              }}
              onDragLeave={() => setOverId((c) => (c === id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) {
                  reorderNav(dragId, id);
                } else {
                  const flag = taskDropFlag(id);
                  if (flag) readTaskIds(e).forEach((taskId) => updateTask(taskId, flag));
                }
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <span className="sidebar-icon">
                {id === 'members' ? <UsersIcon size={22} /> : item.icon}
              </span>
              <span className="sidebar-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      {savedViews.length > 0 && (
        <>
          <div className="sidebar-separator" />
          <div className="sidebar-items">
            {savedViews.map((v) => (
              <div
                key={v.id}
                className={`sidebar-item saved-view-item ${
                  activeSavedViewId === v.id ? 'active' : ''
                }`}
                onClick={() => {
                  setSidePanel('none');
                  applySavedView(v.id);
                }}
                title={v.name}
              >
                <span className="sidebar-icon">🔎</span>
                <span className="sidebar-label">{v.name}</span>
                <button
                  className="saved-view-del"
                  title="Ansicht löschen"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSavedView(v.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sidebar-spacer" />
      <div className="sidebar-separator" />

      <div className="sidebar-items">
        {bottomItems.filter((item) => !item.devOnly || isDev).map((item) => (
          <button
            key={item.id}
            className={`sidebar-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => handleNav(item.id)}
            onContextMenu={windowMenuFor(item.id)}
            title={item.label}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </div>
      {windowMenu.element}
    </div>
  );
}
