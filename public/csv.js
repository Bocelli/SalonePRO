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

// Our own export, Excel lists (Nome + Cognome) and Google Contacts exports are recognised by their headers.
const CLIENT_CSV_COLS = {
  full: /^(nome e cognome|nominativo|cliente|name|full name)$/, first: /^(nome|first name|given name)$/,
  last: /^(cognome|last name|family name|surname)$/, phone: /telefono|cellulare|phone|mobile|^tel/,
  allergy: /^allergi/, formula: /formula/, notes: /^note/, gdpr: /consenso privacy|gdpr/, gdprDate: /data consenso/, health: /consenso allergie/,
};

// New clients from a CSV, without ids. Rows without a name, or already in `existing` (same phone, or same name
// when there is no phone), are skipped and counted.
function clientsFromCsv(text, existing) {
  const [head = [], ...rows] = parseCsv(text);
  const h = head.map((x) => x.trim().toLowerCase());
  const at = Object.fromEntries(Object.entries(CLIENT_CSV_COLS).map(([k, re]) => [k, h.findIndex((x) => re.test(x))]));
  if (at.full < 0 && at.first < 0) throw new Error('Nel file manca la colonna "Nome" (o "Nome e cognome") nella prima riga');
  const get = (r, k) => (at[k] < 0 ? '' : (r[at[k]] || '').trim().replace(/^'(?=[=+\-@])/, ''));
  const yes = (v) => /^(s[iì]|yes|true|1|x)$/i.test(v);
  const day = (v) => { const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; };
  const key = (c) => (c.phone || '').replace(/\D/g, '').slice(-10) || c.name.toLowerCase();
  const seen = new Set(existing.map(key));
  const clients = [];
  let dup = 0, noName = 0;
  for (const r of rows) {
    const name = (get(r, 'full') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ')).slice(0, 80);
    if (!name) { noName++; continue; }
    const c = {
      name, phone: get(r, 'phone').replace(/[^\d+ ]/g, '').trim().slice(0, 20), allergy: get(r, 'allergy') || 'Nessuna',
      formula: get(r, 'formula'), notes: get(r, 'notes'), gdprConsent: yes(get(r, 'gdpr')), gdprDate: day(get(r, 'gdprDate')),
      healthConsent: yes(get(r, 'health')), source: 'csv',
    };
    if (seen.has(key(c))) { dup++; continue; }
    seen.add(key(c));
    clients.push(c);
  }
  return { clients, dup, noName };
}
