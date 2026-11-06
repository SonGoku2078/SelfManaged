// App-Sync (Appwrite-Verbrauch, 2026-11; #86): Delta einmischen und wann
// gepullt wird.
// Run: npx tsx scripts/appsync.test.ts
import assert from 'node:assert';
import { applySync, mergeActivity, type SyncData, type SyncResult } from '../src/sync/merge';
import { backgroundPullDue, returnPullDue, FOCUSED_MS, RETURN_MIN_MS, UNFOCUSED_MS } from '../src/sync/cadence';
import type { ActivityEntry, Settings, Task } from '../src/types';

const defaults = { theme: 'light', calendarStartHour: 7 } as unknown as Settings;
const task = (id: string, title = id) => ({ id, title, number: 1 }) as unknown as Task;
const empty: SyncData = { tasks: [], projects: [], sections: [], blockers: [], categories: [], savedViews: [], members: [] };
const state = (tasks: Task[], settings: Partial<Settings> = {}) => ({ ...empty, tasks, settings: { ...defaults, ...settings } as Settings });
const delta = (r: Partial<SyncResult>): SyncResult => ({ serverTime: '2026-11-06T10:00:00.000Z', full: false, settings: {}, deleted: {}, ...r });

// ── Delta: geänderte ersetzen (Reihenfolge bleibt), neue anhängen, Tombstones entfernen ──
{
  const cur = state([task('a'), task('b'), task('c')]);
  const next = applySync(cur, delta({ tasks: [task('b', 'B neu'), task('d')], deleted: { tasks: ['c'] } }), defaults);
  assert.deepStrictEqual(next.tasks.map((t) => [t.id, t.title]), [['a', 'a'], ['b', 'B neu'], ['d', 'd']]);
  assert.strictEqual(next.projects, cur.projects, 'untouched tables keep their identity (no re-render)');
}

// ── Delta: angelegt und im selben Zeitraum gelöscht → bleibt weg ──
{
  const next = applySync(state([task('a')]), delta({ tasks: [task('x')], deleted: { tasks: ['x'] } }), defaults);
  assert.deepStrictEqual(next.tasks.map((t) => t.id), ['a']);
}

// ── Delta-Einstellungen: nur geänderte Schlüssel, Rest bleibt; Zahl aus Text repariert ──
{
  const next = applySync(state([], { theme: 'dark' } as Partial<Settings>), delta({ settings: { calendarStartHour: '9' as unknown as number, nextTaskNumber: 42 } }), defaults);
  assert.strictEqual((next.settings as unknown as Record<string, unknown>).theme, 'dark');
  assert.strictEqual(next.settings.calendarStartHour, 9);
  assert.strictEqual(next.nextTaskNumber, 42);
  assert.ok(!('nextTaskNumber' in next.settings), 'nextTaskNumber is not a setting');
}

// ── Voll: ersetzt alles, Einstellungen auf Vorgaben + Server ──
{
  const next = applySync(state([task('a'), task('b')], { theme: 'dark' } as Partial<Settings>), delta({ full: true, tasks: [task('z')], settings: {} }), defaults);
  assert.deepStrictEqual(next.tasks.map((t) => t.id), ['z']);
  assert.strictEqual((next.settings as unknown as Record<string, unknown>).theme, 'light');
  assert.deepStrictEqual(next.projects, [], 'missing table in a full result = empty');
}

// ── Aktivitätsprotokoll: Server + lokal, neueste zuerst, ohne Doppelte ──
{
  const e = (id: string, min: number) => ({ id, at: new Date(Date.UTC(2026, 10, 6, 10, min)), kind: 'created', actor: '', taskTitle: id }) as unknown as ActivityEntry;
  const merged = mergeActivity([e('local', 30), e('s1', 10)], [e('s1', 10), e('s2', 20)], 500);
  assert.deepStrictEqual(merged.map((x) => x.id), ['local', 's2', 's1']);
  assert.strictEqual(mergeActivity([], [e('a', 1), e('b', 2), e('c', 3)], 2).length, 2, 'capped');
}

// ── Takt ──
{
  const base = { now: 1_000_000_000, lastPullAt: 1_000_000_000, visible: true, focused: true, editing: false, dataLoaded: true };
  assert.strictEqual(backgroundPullDue(base), false, 'just pulled');
  assert.strictEqual(backgroundPullDue({ ...base, now: base.now + FOCUSED_MS }), true, 'focused: every 5 min');
  assert.strictEqual(backgroundPullDue({ ...base, now: base.now + FOCUSED_MS, focused: false }), false, 'unfocused: not yet');
  assert.strictEqual(backgroundPullDue({ ...base, now: base.now + UNFOCUSED_MS, focused: false }), true, 'unfocused: every 15 min');
  assert.strictEqual(backgroundPullDue({ ...base, now: base.now + 24 * 3600_000, visible: false }), false, 'hidden: never');
  assert.strictEqual(backgroundPullDue({ ...base, now: base.now + FOCUSED_MS, editing: true }), false, 'typing: wait');
  assert.strictEqual(backgroundPullDue({ ...base, now: base.now + FOCUSED_MS, dataLoaded: false }), false, 'first load is not the timer\'s job');
  assert.strictEqual(returnPullDue({ ...base, now: base.now + RETURN_MIN_MS - 1 }), false, 'alt-tab storm: no pull');
  assert.strictEqual(returnPullDue({ ...base, now: base.now + RETURN_MIN_MS }), true);
  assert.strictEqual(returnPullDue({ ...base, now: base.now + RETURN_MIN_MS, visible: false }), false);

  // Ein Tag mit sichtbarem, fokussiertem Fenster (14 h), Rückkehr alle 10 min:
  // vorher ~840 Takt-Loads + Fokus-Loads, jetzt höchstens ~170 Deltas.
  let pulls = 0;
  let last = 0;
  for (let t = 0; t < 14 * 3600_000; t += 30_000) {
    const ctx = { ...base, now: t, lastPullAt: last };
    if ((t % 600_000 === 0 && returnPullDue(ctx)) || backgroundPullDue(ctx)) { pulls++; last = t; }
  }
  assert.ok(pulls <= 170, `pulls per 14 h: ${pulls}`);
}

console.log('appsync tests passed');
