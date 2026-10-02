// #81: "Gilt als heute" (Anzeige) vs. "manuell markiert" (umschaltbar).
import { countsAsToday, isImplicitToday, isTodayFlagActive, dateKey } from '../src/selectors';
import type { Task } from '../src/types';

const day = (offset: number, hour = 12): Date => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d;
};

let n = 0;
const task = (over: Partial<Task> = {}): Task =>
  ({
    id: `t${++n}`,
    number: n,
    title: `T${n}`,
    description: '',
    projectId: null,
    categoryIds: [],
    priority: 'medium',
    dueDate: null,
    completed: false,
    starred: false,
    recurrence: 'none',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as Task;

let fails = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`✅ ${name}`);
  else { console.log(`❌ ${name} ${extra}`); fails++; }
};

const today = dateKey(new Date());

// --- Faellig heute: implizit markiert ---
const dueToday = task({ dueDate: day(0) });
check('faellig heute gilt als heute', countsAsToday(dueToday));
check('faellig heute ist IMPLIZIT (Knopf gesperrt)', isImplicitToday(dueToday));
check('faellig heute hat KEIN manuelles Flag', !isTodayFlagActive(dueToday));

// --- Manuell markiert, kein Datum ---
const flagged = task({ todayDate: today });
check('manuell markiert gilt als heute', countsAsToday(flagged));
check('manuell markiert ist NICHT implizit (Knopf bedienbar)', !isImplicitToday(flagged));

// --- Beides ---
const both = task({ dueDate: day(0), todayDate: today });
check('beides gilt als heute', countsAsToday(both));
check('beides: manuelles Flag hat Vorrang -> nicht implizit', !isImplicitToday(both));

// --- Grenzfaelle ---
const dueTomorrow = task({ dueDate: day(1) });
check('morgen faellig gilt NICHT als heute', !countsAsToday(dueTomorrow));
const dueYesterday = task({ dueDate: day(-1) });
check('gestern faellig gilt NICHT als heute', !countsAsToday(dueYesterday));
const olderFlag = task({ todayDate: dateKey(day(-1)) });
check('Flag von gestern bleibt bestehen und gilt als heute (#112)', countsAsToday(olderFlag) && !isImplicitToday(olderFlag));
const futureFlag = task({ todayDate: dateKey(day(1)) });
check('Flag fuer morgen gilt noch NICHT als heute', !countsAsToday(futureFlag));
const dueTodayEarly = task({ dueDate: day(0, 1) });
check('heute frueh faellig gilt als heute', countsAsToday(dueTodayEarly));
const dueTodayLate = task({ dueDate: day(0, 23) });
check('heute spaet faellig gilt als heute', countsAsToday(dueTodayLate));
const nothing = task();
check('ohne Datum und Flag: nicht heute', !countsAsToday(nothing) && !isImplicitToday(nothing));

// --- AC3/AC5: die Funktionen sind rein, sie veraendern den Task nicht ---
const before = JSON.stringify(dueToday);
countsAsToday(dueToday);
isImplicitToday(dueToday);
check('AC3 Task wird durch die Pruefung nicht veraendert (kein Schreiben)',
  JSON.stringify(dueToday) === before);

// --- AC5: morgen faellt die Markierung weg ---
const tomorrow = day(1);
check('AC5 heute faelliger Task gilt morgen nicht mehr als heute',
  !countsAsToday(dueToday, tomorrow));

if (fails) { console.log(`\n${fails} FEHLER`); process.exit(1); }
console.log('\n✅ PASS — Heute-Markierung: implizit vs. manuell sauber getrennt.');
