// Extra windows: right-click → "In neuem Fenster öffnen" boots the app from
// ?fenster=<view> or ?fenster=project&id=<id>.
// Run: npx tsx scripts/windows.test.ts
import assert from 'node:assert';
import { windowQuery, parseWindowQuery, WINDOW_VIEWS } from '../src/windows';

// Round trip for views and projects.
for (const view of WINDOW_VIEWS) {
  assert.deepStrictEqual(parseWindowQuery(windowQuery({ kind: 'view', view })), { kind: 'view', view });
}
const proj = { kind: 'project', projectId: 'proj_a b&c' } as const;
assert.deepStrictEqual(parseWindowQuery(windowQuery(proj)), proj, 'project id survives URL encoding');
assert.strictEqual(windowQuery({ kind: 'view', view: 'today' }), '?fenster=today');

// Normal start, tools and garbage stay a normal main window.
assert.strictEqual(parseWindowQuery(''), null);
assert.strictEqual(parseWindowQuery('?fenster=settings'), null, 'settings is no list view');
assert.strictEqual(parseWindowQuery('?fenster=quatsch'), null);
assert.strictEqual(parseWindowQuery('?fenster=project'), null, 'project without id');
assert.ok(!WINDOW_VIEWS.has('settings') && WINDOW_VIEWS.has('nextweek'));

console.log('✅ PASS — extra windows: view/project URL round trip, invalid targets ignored.');
