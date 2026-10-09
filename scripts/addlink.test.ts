// "#/add?…" deep link used by the Proton Mail extension: title, note and the
// optional heute=1 (plan for today).
// Run: npx tsx scripts/addlink.test.ts
import assert from 'node:assert';
import { addTaskHash, parseAddTaskHash } from '../src/config';

const note = '**Von:** Anna <a@b.ch>  \n**Mail:** https://mail.proton.me/u/0/inbox/x?y=1&z\n\nText & mehr #1';
assert.deepStrictEqual(parseAddTaskHash(addTaskHash({ title: 'Rechnung prüfen', note })), {
  title: 'Rechnung prüfen', note, today: false,
});
assert.strictEqual(parseAddTaskHash(addTaskHash({ title: 'Heute!', today: true }))?.today, true);
assert.strictEqual(parseAddTaskHash('#/add?title=x&heute=0')?.today, false);
assert.strictEqual(parseAddTaskHash('#/add?title=%20%20'), null, 'blank title is ignored');
assert.strictEqual(parseAddTaskHash('#/t/12'), null);

console.log('✅ PASS — add-task deep link: note survives encoding, heute=1 plans for today.');
