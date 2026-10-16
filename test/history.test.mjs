// Client history helpers from public/history.js, run in a sandbox like the browser does. `npm test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/history.js', import.meta.url), 'utf8'), ctx);
const { visitsByClient, recallList } = vm.runInContext('({ visitsByClient, recallList })', ctx);

const clients = [
  { id: 1, name: 'Anna Bianchi' }, // last visit 8 weeks ago: due
  { id: 2, name: 'Bea Neri' }, // 8 weeks ago, but booked again: not due
  { id: 3, name: 'Carla Verdi' }, // 3 weeks ago: not yet
  { id: 4, name: 'Dora Gialli', recalledAt: '2026-10-10' }, // due, but recalled last week
  { id: 5, name: 'Elsa Rossi', recalledAt: '2026-07-01' }, // recalled long ago: due again
  { id: 6, name: 'Fede Blu' }, // never came
];
const appts = [
  { id: 10, clientId: 1, date: '2026-08-21', time: '10:00' },
  { id: 11, clientId: 1, date: '2026-06-01', time: '10:00' },
  { id: 12, clientId: 2, date: '2026-08-21', time: '11:00' },
  { id: 13, clientId: 2, date: '2026-10-16', time: '18:00' }, // today, later on
  { id: 14, clientId: 3, date: '2026-09-25', time: '10:00' },
  { id: 15, clientId: 4, date: '2026-08-01', time: '10:00' },
  { id: 16, clientName: 'elsa rossi', date: '2026-07-15', time: '09:00' }, // v6 data: no clientId
];

test('visitsByClient groups by id, falls back to the name, newest first', () => {
  const v = visitsByClient(appts, clients);
  assert.equal(JSON.stringify(v.get(1).map((a) => a.id)), JSON.stringify([10, 11]));
  assert.equal(JSON.stringify(v.get(5).map((a) => a.id)), JSON.stringify([16]));
  assert.equal(v.get(6), undefined);
});

test('recallList: due, not booked, not recalled lately', () => {
  const r = recallList(clients, appts, '2026-10-16', 6);
  assert.equal(JSON.stringify(r.map((x) => x.client.id)), JSON.stringify([1, 5]));
  assert.equal(r[0].last.id, 10);
  assert.equal(recallList(clients, appts, '2026-10-16', 0).length, 0); // "Mai": list switched off
});
