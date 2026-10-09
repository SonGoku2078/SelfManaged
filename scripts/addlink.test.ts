// "#/add?…" deep link used by the Proton Mail extension: one task (title/note)
// or several (tasks=[…], one per ticked mail), optional project and heute=1.
// Run: npx tsx scripts/addlink.test.ts
import assert from 'node:assert';
import { addTaskHash, parseAddTaskHash } from '../src/config';

const note = '**Von:** Anna <a@b.ch>  \n**Mail:** https://mail.proton.me/u/0/inbox/x?y=1&z\n\nText & mehr #1';
// One task, default = Inbox (no project), not today.
assert.deepStrictEqual(parseAddTaskHash(addTaskHash({ tasks: [{ title: 'Rechnung prüfen', note }], projectId: null, today: false })), {
  tasks: [{ title: 'Rechnung prüfen', note }], projectId: null, today: false,
});
// Old single-task links from extension 1.0/1.1 still work.
assert.deepStrictEqual(parseAddTaskHash('#/add?title=Alt&note=n&heute=1'), {
  tasks: [{ title: 'Alt', note: 'n' }], projectId: null, today: true,
});
// Batch into a project.
const batch = [{ title: 'Mail 1', note: 'a' }, { title: 'Mail & 2' }, { title: 'Mail 3', note: 'c' }];
const parsed = parseAddTaskHash(addTaskHash({ tasks: batch, projectId: 'p-single', today: false }));
assert.strictEqual(parsed?.tasks.length, 3);
assert.strictEqual(parsed?.tasks[1].title, 'Mail & 2');
assert.strictEqual(parsed?.projectId, 'p-single');
// Junk is dropped, never thrown.
assert.strictEqual(parseAddTaskHash('#/add?tasks=%5Bkaputt'), null);
assert.deepStrictEqual(parseAddTaskHash('#/add?tasks=' + encodeURIComponent('[{"title":"  "},{"title":"ok"},7,null]'))?.tasks, [{ title: 'ok', note: undefined }]);
assert.strictEqual(parseAddTaskHash('#/add?title=%20%20'), null, 'blank title is ignored');
assert.strictEqual(parseAddTaskHash('#/t/12'), null);

console.log('✅ PASS — add-task deep link: single/batch, Inbox default, project, heute=1, junk-safe.');

// Task numbers: never restart at 1 or reuse an existing number.
import { safeNextNumber } from '../src/taskNumber';
assert.strictEqual(safeNextNumber(undefined, [{ number: 1700 }, { number: 1760 }]), 1761, 'missing counter → max + 1');
assert.strictEqual(safeNextNumber(1706, [{ number: 1760 }]), 1761, 'stale counter → max + 1');
assert.strictEqual(safeNextNumber(1800, [{ number: 1760 }]), 1800, 'counter ahead stays');
assert.strictEqual(safeNextNumber('1800', []), 1800);
assert.strictEqual(safeNextNumber(null, []), 1);
console.log('✅ PASS — task numbers continue after the highest existing one.');
