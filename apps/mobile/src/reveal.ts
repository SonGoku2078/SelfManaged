// Scroll a freshly created task into view and flash it, so a capture is
// visible right away. The row may only render after a tab
// switch, so poll a few frames for it. Rows carry data-flip-id (TaskRow).
export function revealTask(taskId: string): void {
  let tries = 0;
  const attempt = () => {
    const row = document.querySelector<HTMLElement>(`.m-row[data-flip-id="${CSS.escape(taskId)}"]`);
    if (!row) {
      if (++tries < 30) requestAnimationFrame(attempt);
      return;
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('m-row-new');
    void row.offsetWidth; // restart the animation if it is already running
    row.classList.add('m-row-new');
    window.setTimeout(() => row.classList.remove('m-row-new'), 1800);
  };
  requestAnimationFrame(attempt);
}
