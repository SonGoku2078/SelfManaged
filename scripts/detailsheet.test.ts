// Task detail: docked right when the list keeps >= 480 px next to it,
// otherwise a bottom sheet (half-screen window).
// Run: npx tsx scripts/detailsheet.test.ts
import assert from 'node:assert';
import { shouldUseSheet, clampSheet, MIN_LIST_WIDTH } from '../src/detailSheet';

assert.strictEqual(MIN_LIST_WIDTH, 480);
// Half-screen window: 960 px, sidebar 220, panel 420 → list 320 → sheet.
assert.ok(shouldUseSheet(960, 220, 420), 'half screen → bottom sheet');
// Full HD: 1920 - 220 - 420 = 1280 → docked right.
assert.ok(!shouldUseSheet(1920, 220, 420), 'wide → docked right');
// Wide panel (user dragged it to 720) on a 1366 laptop: 1366-220-720 = 426 → sheet.
assert.ok(shouldUseSheet(1366, 220, 720), 'wide panel on laptop → sheet');
// Projects panel open widens mainLeft: 1600 - 520 - 420 = 660 → docked.
assert.ok(!shouldUseSheet(1600, 520, 420));
// Boundary: exactly 480 left for the list stays docked.
assert.ok(!shouldUseSheet(1120, 220, 420));
// Sheet height stays between 25 % and 85 %.
assert.strictEqual(clampSheet(0.1), 0.25);
assert.strictEqual(clampSheet(0.95), 0.85);
assert.strictEqual(clampSheet(0.5), 0.5);

console.log('✅ PASS — detail panel: right when there is room, bottom sheet otherwise.');
