// Client CSV import and export for the admin app. Pure functions, covered by test/csv.test.mjs.

// Splits CSV text into rows of cells: quotes, line breaks inside quotes, BOM; separator ; , or tab (whichever the header uses most).
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const head = text.slice(0, text.search(/\r?\n|$/));
  const sep = [';', ',', '\t'].reduce((a, b) => (head.split(b).length > head.split(a).length ? b : a));
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Semicolons and a BOM, so Excel in Italian opens it in columns with accents intact. A cell Excel would run as a
// formula (=, +, -, @) gets a leading apostrophe; plain phone numbers like +39 333 stay as they are.
function toCsv(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^\+?[\d ]+$/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const CLIENT_CSV_HEAD = ['Nome e cognome', 'Telefono', 'Allergie', 'Formula colore', 'Note', 'Consenso privacy', 'Data consenso', 'Consenso allergie'];
const clientCsvRow = (c) => [c.name, c.phone, c.allergy === 'Nessuna' ? '' : c.allergy, c.formula, c.notes,
  c.gdprConsent ? 'Sì' : 'No', (c.gdprDate || '').split('-').reverse().join('/'), c.healthConsent ? 'Sì' : 'No'];

// Our own export, Excel lists (Nome + Cognome), Google Contacts and other apps' exports are recognised by their headers.
const CLIENT_CSV_COLS = {
  full: /^(nome e cognome|nominativo|cliente|name|full name)$/, first: /^(nome|first name|firstname|given name)$/,
  last: /^(cognome|last name|lastname|family name|surname)$/, phone: /telefono|cellulare|phone|mobile|^tel|^numero/,
  allergy: /^allergi|cute|sensibil/, formula: /formula|colore|scheda tecnica/, notes: /^note|notes|annotazioni|comment/,
  gdpr: /consenso privacy|gdpr|^privacy/, gdprDate: /data consenso|data gdpr|registrat/, health: /consenso allergie|salute|art\. ?9/,
};
// No recognisable header (e.g. just "Maria Rossi;333 123 4567"): columns in the order of our export.
const CLIENT_CSV_ORDER = { full: 0, first: -1, last: -1, phone: 1, allergy: 2, formula: 3, notes: 4, gdpr: 5, gdprDate: 6, health: 7 };

// Clients from a CSV: `added` are new (without ids), `updated` are clients of `existing` with the file's data on top.
// Rows without a phone number are left out, like the booking page: a client nobody can call or message.
// Same person = same name and same phone (or one of the two has none). Same phone with another name is somebody else:
// mother and daughter often share a number. Empty cells never wipe data that is already there.
function clientsFromCsv(text, existing) {
  const [head = [], ...rest] = parseCsv(text);
  const h = head.map((x) => x.trim().toLowerCase());
  let at = Object.fromEntries(Object.entries(CLIENT_CSV_COLS).map(([k, re]) => [k, h.findIndex((x) => re.test(x))]));
  let rows = rest;
  if (at.full < 0 && at.first < 0 && at.phone < 0) { at = CLIENT_CSV_ORDER; rows = [head, ...rest]; }
  if (at.full < 0 && at.first < 0) throw new Error('Nel file manca la colonna "Nome" (o "Nome e cognome") nella prima riga');
  const get = (r, k) => (at[k] < 0 ? '' : (r[at[k]] || '').trim().replace(/^'(?=[=+\-@])/, ''));
  const yes = (v) => /^(s[iì]|yes|true|1|x|ok|accettato)$/i.test(v);
  const day = (v) => { const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : ''; };
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const digits = (p) => (p || '').replace(/\D/g, '').slice(-10);
  const same = (a, b) => norm(a.name) === norm(b.name) && (!digits(a.phone) || !digits(b.phone) || digits(a.phone) === digits(b.phone));
  const byName = new Map();
  for (const c of existing) byName.set(norm(c.name), [...(byName.get(norm(c.name)) || []), c]);
  const added = [], updated = new Map();
  let noPhone = 0, noName = 0;
  for (const r of rows) {
    const first = get(r, 'first'), last = get(r, 'last');
    const both = first && last && !norm(first).includes(norm(last)) ? `${first} ${last}` : first || last; // "Nome" may already hold the surname
    const name = (get(r, 'full') || both).replace(/\s+/g, ' ').slice(0, 80);
    if (!name) { noName++; continue; }
    const c = { name, phone: get(r, 'phone').replace(/[^\d+ ]/g, '').trim().slice(0, 20) };
    if (digits(c.phone).length < 6) { noPhone++; continue; }
    for (const k of ['allergy', 'formula', 'notes']) if (get(r, k)) c[k] = get(r, k);
    if (day(get(r, 'gdprDate'))) c.gdprDate = day(get(r, 'gdprDate'));
    if (get(r, 'gdpr')) c.gdprConsent = yes(get(r, 'gdpr'));
    if (get(r, 'health')) c.healthConsent = yes(get(r, 'health'));
    const twin = added.find((x) => same(x, c));
    if (twin) { Object.assign(twin, c); continue; }
    const old = (byName.get(norm(name)) || []).find((x) => same(x, c));
    if (old) { const { name: _sameName, ...changes } = c; updated.set(old.id, { ...(updated.get(old.id) || old), ...changes }); continue; }
    added.push({ allergy: 'Nessuna', formula: '', notes: '', gdprConsent: false, gdprDate: '', healthConsent: false, ...c, source: 'csv' });
  }
  return { added, updated: [...updated.values()], noPhone, noName };
}
