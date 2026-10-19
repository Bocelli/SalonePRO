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

test('clientsFromCsv: our export round trip, Nome + Cognome, duplicates, missing names', () => {
  const ours = { name: '=Anna Bianchi', phone: '333 111 2222', allergy: 'Nichel', formula: '6.0 + 6.35', notes: 'ok', gdprConsent: true, gdprDate: '2026-03-02', healthConsent: true };
  const back = clientsFromCsv(toCsv([CLIENT_CSV_HEAD, clientCsvRow(ours)]), []).clients[0];
  same({ ...back, source: undefined }, { ...ours, source: undefined }); // apostrophe removed again on import

  const excel = 'Nome;Cognome;Cellulare\nMaria;Rossi;333-444 5555\nLuca;Verdi;\n;;333\nMaria;Rossi;3334445555\nElena;Rizzo;3331122334';
  const r = clientsFromCsv(excel, [{ name: 'Elena Rizzo', phone: '+39 333 112 2334' }]);
  same(r.clients.map((c) => `${c.name}|${c.phone}`), ['Maria Rossi|333444 5555', 'Luca Verdi|']);
  assert.equal(r.dup, 2); // Maria twice in the file, Elena already in the archive
  assert.equal(r.noName, 1);
  assert.throws(() => clientsFromCsv('Telefono\n333', []), /Nome/);
});
