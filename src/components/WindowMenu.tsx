import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { openInNewWindow, type WindowTarget } from '../windows';
import './WindowMenu.css';

interface MenuState {
  x: number;
  y: number;
  target: WindowTarget;
}

// Right-click menu with "In neuem Fenster öffnen" for sidebar views and
// projects. Returns a handler factory for onContextMenu plus the menu element.
export function useWindowMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const onContextMenu = (target: WindowTarget) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Keep the menu inside the window.
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - 50);
    setMenu({ x, y, target });
  };

  const element = menu ? (
    <div
      className="window-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="window-menu-item"
        onClick={() => {
          openInNewWindow(menu.target);
          setMenu(null);
        }}
      >
        🗗 In neuem Fenster öffnen
      </button>
    </div>
  ) : null;

  return { onContextMenu, element };
}
