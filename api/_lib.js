import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COLS = ['config', 'services', 'clients', 'inventory', 'appointments'];

export const DEFAULT_CONFIG = {
  salonName: 'Il Mio Salone', ownerName: 'Titolare', address: '', vat: '', email: '', ownerPhone: '',
  openTime: '09:00', closeTime: '19:00', slotMinutes: 30, closedDays: [0, 1],
  breaks: [], closures: [], recallWeeks: 6,
};

// Starting price list for a new salon (same folders as salone_pro_v9).
const DEFAULT_FOLDERS = ['PIEGA', 'TAGLIO', 'COLORE & TECNICI', 'TRATTAMENTI'];
const DEFAULT_SERVICES = [
  { id: 1, name: 'Piega Classica', cat: 'PIEGA', price: 18, duration: 30 },
  { id: 2, name: 'Piega Onde / Glamour', cat: 'PIEGA', price: 22, duration: 40 },
  { id: 3, name: 'Taglio Donna', cat: 'TAGLIO', price: 22, duration: 30 },
  { id: 4, name: 'Taglio + Piega', cat: 'TAGLIO', price: 35, duration: 60 },
  { id: 5, name: 'Colore Ricrescita', cat: 'COLORE & TECNICI', price: 30, duration: 45 },
  { id: 6, name: 'Balayage / Schiariture', cat: 'COLORE & TECNICI', price: 65, duration: 90 },
  { id: 7, name: 'Tonalizzante / Gloss', cat: 'COLORE & TECNICI', price: 20, duration: 30 },
  { id: 8, name: 'Trattamento Cheratina', cat: 'TRATTAMENTI', price: 25, duration: 30 },
];

// `setup` ('database' | 'password') tells the pages that Vercel is not configured yet, so they can explain how to fix it.
export function fail(status, message, setup) {
  throw Object.assign(new Error(message), { status, setup });
}

// Wraps a Vercel handler: every thrown error becomes a JSON response, never an HTML crash page.
export const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    const status = e.status || (e.code === '23505' ? 400 : 500);
    res.status(status).json({ error: e.status ? e.message : e.code === '23505' ? 'Dati duplicati (ID già presenti)' : 'Errore del server, riprova', setup: e.setup });
  }
};

let ready;
export async function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) fail(503, 'Database non collegato: aggiungi Neon dal tab Storage del progetto Vercel', 'database');
  const sql = neon(url);
  ready ??= sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS docs (col text NOT NULL, id bigint NOT NULL, data jsonb NOT NULL, PRIMARY KEY (col, id))`,
    sql`CREATE INDEX IF NOT EXISTS docs_appt_date ON docs ((data->>'date')) WHERE col = 'appointments'`,
    sql`CREATE TABLE IF NOT EXISTS hits (key text NOT NULL, at timestamptz NOT NULL DEFAULT now())`,
    sql`CREATE INDEX IF NOT EXISTS hits_key_at ON hits (key, at)`,
    // First run only: seed the price list, then the config (services check runs before config exists).
    sql`INSERT INTO docs (col, id, data)
        SELECT 'services', (s->>'id')::bigint, s FROM jsonb_array_elements(${JSON.stringify(DEFAULT_SERVICES)}::jsonb) s
        WHERE NOT EXISTS (SELECT 1 FROM docs WHERE col = 'config')`,
    sql`INSERT INTO docs (col, id, data) VALUES ('config', 1, ${JSON.stringify({ ...DEFAULT_CONFIG, serviceFolders: DEFAULT_FOLDERS })}::jsonb) ON CONFLICT DO NOTHING`,
  ]).catch((e) => { ready = undefined; throw e; });
  await ready;
  return sql;
}

export const addMin = (t, m) => {
  const x = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + Number(m);
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

// Salon clock: Vercel runs in UTC, the salon lives in Italy.
export function romeNow() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' });
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

// Every stored appointment carries duration + end so overlap checks are plain string compares ("HH:MM").
export function withEnd(a, services = []) {
  if (!Number(a.duration)) {
    a.duration = (a.services || []).reduce((s, n) => s + (Number(services.find((x) => x.name === n)?.duration) || 0), 0) || 30;
  }
  if (/^\d\d:\d\d$/.test(a.time)) a.end = addMin(a.time, a.duration);
  return a;
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Booking length: sum of the chosen services, or one slot.
export const durationOf = (chosen, config) => chosen.reduce((s, x) => s + (Number(x.duration) || 0), 0) || Number(config.slotMinutes) || 30;

// iCalendar file for calendar apps (iPhone, Google, Outlook), in Italian time.
// events: [{ uid, date, time, end, summary, description?, location? }]
const VTIMEZONE = [ // summer time from the last Sunday of March to the last Sunday of October
  'BEGIN:VTIMEZONE', 'TZID:Europe/Rome',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const icsText = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
const icsAt = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
export function icsFile(name, events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Salone PRO//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...(name ? [`X-WR-CALNAME:${icsText(name)}`, 'X-WR-TIMEZONE:Europe/Rome'] : []), ...VTIMEZONE,
    ...events.flatMap((e) => [
      'BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Rome:${icsAt(e.date, e.time)}`, `DTEND;TZID=Europe/Rome:${icsAt(e.date, e.end)}`,
      `SUMMARY:${icsText(e.summary)}`, e.description && `DESCRIPTION:${icsText(e.description)}`, e.location && `LOCATION:${icsText(e.location)}`,
      'END:VEVENT',
    ].filter(Boolean)),
    'END:VCALENDAR',
  ];
  return lines.map((l) => l.match(/.{1,74}/gu).join('\r\n ')).join('\r\n') + '\r\n'; // long lines continue after a space
}
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Closure covering a YYYY-MM-DD date, if any (string compare works on ISO dates).
export const closureOn = (config, date) => (config.closures || []).find((x) => date >= x.from && date <= x.to);
// Config reaches the public page, so it is validated here (it can also arrive from a restored backup file).
export function checkConfig(c) {
  if (!HHMM.test(c.openTime) || !HHMM.test(c.closeTime) || c.openTime >= c.closeTime
    || ![15, 20, 30, 45, 60].includes(Number(c.slotMinutes))
    || !Array.isArray(c.closedDays) || c.closedDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    || (c.serviceFolders !== undefined && (!Array.isArray(c.serviceFolders) || c.serviceFolders.length > 100
      || c.serviceFolders.some((f) => typeof f !== 'string' || !f.trim() || f.length > 60)))) {
    fail(400, 'Impostazioni non valide (orari, intervallo, giorni di chiusura o cartelle)');
  }
  // Daily breaks (e.g. lunch) and closures (holidays) block online bookings; recallWeeks drives the "Da richiamare" list.
  const list = (v, max) => v === undefined || (Array.isArray(v) && v.length <= max);
  if (!list(c.breaks, 5) || (c.breaks || []).some((b) => !HHMM.test(b?.from) || !HHMM.test(b?.to) || b.from >= b.to)
    || !list(c.closures, 100) || (c.closures || []).some((x) => !DAY.test(x?.from) || !DAY.test(x?.to) || x.from > x.to
      || (x.note !== undefined && (typeof x.note !== 'string' || x.note.length > 60)))
    || (c.recallWeeks !== undefined && (!Number.isInteger(c.recallWeeks) || c.recallWeeks < 0 || c.recallWeeks > 52))) {
    fail(400, 'Impostazioni non valide (pause, chiusure o richiami)');
  }
  return c;
}

// Vercel's edge sets these headers itself, clients cannot spoof them.
export const clientIp = (req) => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();

// Fails with 429 once `max` hits for `key` fall inside the last `minutes`.
export async function limit(sql, key, max, minutes) {
  const [r] = await sql`SELECT count(*)::int AS n FROM hits WHERE key = ${key} AND at > now() - make_interval(mins => ${minutes})`;
  if (r.n >= max) fail(429, `Troppi tentativi, riprova tra ${minutes} minuti`);
}
export const hit = (sql, key) => sql.transaction([
  sql`INSERT INTO hits (key) VALUES (${key})`,
  sql`DELETE FROM hits WHERE at < now() - interval '1 day'`,
]);

const sign = (v) => createHmac('sha256', process.env.ADMIN_PASSWORD).update(v).digest('base64url');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const COOKIE = 'sp_session';
const MAX_AGE = 30 * 86400;
export const CLEAR_COOKIE = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

const requirePasswordSet = () => {
  if ((process.env.ADMIN_PASSWORD || '').length < 10) fail(503, 'Imposta ADMIN_PASSWORD (almeno 10 caratteri) nelle variabili d\'ambiente Vercel', 'password');
};

export function checkPassword(pw) {
  requirePasswordSet();
  return typeof pw === 'string' && same(sign('pw:' + pw), sign('pw:' + process.env.ADMIN_PASSWORD));
}

// The session epoch lives in the DB: bumping it ("Esci da tutti i dispositivi") invalidates every issued cookie.
export const sessionEpoch = async (sql) => Number((await sql`SELECT data->>'epoch' AS e FROM docs WHERE col = 'auth' AND id = 1`)[0]?.e || 0);
export const bumpEpoch = (sql) => sql`INSERT INTO docs (col, id, data) VALUES ('auth', 1, '{"epoch":1}')
  ON CONFLICT (col, id) DO UPDATE SET data = jsonb_build_object('epoch', (docs.data->>'epoch')::int + 1)`;

// Secret link for calendar apps, which cannot log in. "Esci da tutti i dispositivi" (new epoch) changes it too.
export const calendarToken = (epoch) => { requirePasswordSet(); return sign('ics:' + epoch); };
export const checkCalendarToken = (k, epoch) => typeof k === 'string' && same(k, calendarToken(epoch));

export function sessionCookie(epoch) {
  const payload = `${Date.now() + MAX_AGE * 1000}.${epoch}`;
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export async function requireAdmin(req, sql) {
  requirePasswordSet();
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.(\\d+)\\.([\\w-]+)`).exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now() || !same(m[3], sign(`${m[1]}.${m[2]}`))
    || Number(m[2]) !== await sessionEpoch(sql)) fail(401, 'Accesso richiesto');
}
