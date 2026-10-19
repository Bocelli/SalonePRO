// Client CSV helpers from public/csv.js, run in a sandbox like the browser does. `npm test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/csv.js', import.meta.url), 'utf8'), ctx);
const { parseCsv, toCsv, clientsFromCsv, clientCsvRow, CLIENT_CSV_HEAD } = vm.runInContext('({ parseCsv, toCsv, clientsFromCsv, clientCsvRow, CLIENT_CSV_HEAD })', ctx);
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b)); // sandbox objects: compare by value

test('parseCsv: separators, quotes, line breaks, BOM', () => {
  same(parseCsv('﻿Nome;Note\r\nAnna;"dice ""ciao""; poi va"\r\nBea;"riga 1\nriga 2"\r\n\r\n'), [['Nome', 'Note'], ['Anna', 'dice "ciao"; poi va'], ['Bea', 'riga 1\nriga 2']]);
  same(parseCsv('Name,Phone 1 - Value\nAnna Bianchi,+39 333 1'), [['Name', 'Phone 1 - Value'], ['Anna Bianchi', '+39 333 1']]);
});

test('toCsv: Excel formulas neutralised, phones kept, round trip', () => {
  const rows = [['=HYPERLINK("http://x")', '+39 333 1234567', '-2+3', 'a;b']];
  const csv = toCsv(rows);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")";+39 333 1234567;'-2+3;"a;b"`));
  same(parseCsv(csv), [[`'=HYPERLINK("http://x")`, '+39 333 1234567', "'-2+3", 'a;b']]);
});

test('clientsFromCsv: our export round trip, Nome + Cognome, no phone left out, twins in the file', () => {
  const ours = { name: '=Anna Bianchi', phone: '333 111 2222', allergy: 'Nichel', formula: '6.0 + 6.35', notes: 'ok', gdprConsent: true, gdprDate: '2026-03-02', healthConsent: true };
  const back = clientsFromCsv(toCsv([CLIENT_CSV_HEAD, clientCsvRow(ours)]), []).added[0];
  const fields = (o) => Object.entries(o).filter(([k]) => k !== 'source').sort();
  same(fields(back), fields(ours)); // apostrophe removed again on import

  const excel = 'Nome;Cognome;Cellulare;Note\nMaria;Rossi;333-444 5555;\nLuca;Verdi;;\n;;333 1234567;\nMaria;Rossi;3334445555;preferisce il sabato';
  const r = clientsFromCsv(excel, []);
  same(r.added.map((c) => `${c.name}|${c.phone}|${c.notes}`), ['Maria Rossi|3334445555|preferisce il sabato']); // second row completes the first
  assert.equal(r.noPhone, 1); // Luca
  assert.equal(r.noName, 1);
  assert.equal(r.added[0].gdprConsent, false, 'a file never invents a privacy consent');
  assert.throws(() => clientsFromCsv('Telefono;Note\n333 1234567;x', []), /Nome/);
});

test('clientsFromCsv: updates clients already in the archive, keeps family members apart', () => {
  const existing = [
    { id: 1, name: 'Elena Rizzo', phone: '+39 333 112 2334', formula: '5.0', notes: 'vecchia nota', gdprConsent: true },
    { id: 2, name: 'Maria Bianchi', phone: '', formula: '' },
    { id: 3, name: 'Paola Neri', phone: '347 000 1111' },
  ];
  const csv = 'Nome;Telefono;Formula;Note;Consenso GDPR\nelena  rizzo;3331122334;6.0;;\nMaria Bianchi;333 888 9999;;;SI\nGiulia Neri;347 000 1111;;;';
  const r = clientsFromCsv(csv, existing);
  same(r.updated.map((c) => `${c.id}|${c.name}|${c.phone}|${c.formula}|${c.notes}|${c.gdprConsent}`), [
    '1|Elena Rizzo|3331122334|6.0|vecchia nota|true', // empty cells keep what was there, the name keeps its spelling
    '2|Maria Bianchi|333 888 9999||undefined|true', // had no phone: same person, now with a number
  ]);
  same(r.added.map((c) => c.name), ['Giulia Neri']); // same phone as Paola, different person
});

test('clientsFromCsv: file without a header row, in the order of our export', () => {
  const r = clientsFromCsv('Anna Bianchi;333 1234567;Nichel\nBea Verdi;347 7654321', []);
  same(r.added.map((c) => `${c.name}|${c.phone}|${c.allergy}`), ['Anna Bianchi|333 1234567|Nichel', 'Bea Verdi|347 7654321|Nessuna']);
});
