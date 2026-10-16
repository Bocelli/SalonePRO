import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COLS = ['config', 'services', 'clients', 'inventory', 'appointments'];

export const DEFAULT_CONFIG = {
  salonName: 'Il Mio Salone', ownerName: 'Titolare', address: '', vat: '', email: '', ownerPhone: '',
  openTime: '09:00', closeTime: '19:00', slotMinutes: 30, closedDays: [0, 1],
};

const DEFAULT_SERVICES = [
  { id: 1, name: 'Piega Classica', cat: 'Taglio & Piega', price: 18, duration: 30 },
  { id: 2, name: 'Taglio Donna', cat: 'Taglio & Piega', price: 22, duration: 30 },
  { id: 3, name: 'Taglio + Piega', cat: 'Taglio & Piega', price: 35, duration: 60 },
  { id: 4, name: 'Colore Ricrescita', cat: 'Colore & Tecnici', price: 30, duration: 45 },
  { id: 5, name: 'Balayage / Schiariture', cat: 'Colore & Tecnici', price: 65, duration: 90 },
  { id: 6, name: 'Tonalizzante / Gloss', cat: 'Colore & Tecnici', price: 20, duration: 30 },
  { id: 7, name: 'Trattamento Cheratina', cat: 'Trattamenti', price: 25, duration: 30 },
];

export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

// Wraps a Vercel handler: every thrown error becomes a JSON response, never an HTML crash page.
export const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    const status = e.status || (e.code === '23505' ? 400 : 500);
    res.status(status).json({ error: e.status ? e.message : e.code === '23505' ? 'Dati duplicati (ID già presenti)' : 'Errore del server, riprova' });
  }
};

let ready;
export async function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) fail(500, 'Database non collegato: aggiungi Neon dal tab Storage del progetto Vercel');
  const sql = neon(url);
  ready ??= sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS docs (col text NOT NULL, id bigint NOT NULL, data jsonb NOT NULL, PRIMARY KEY (col, id))`,
    sql`CREATE INDEX IF NOT EXISTS docs_appt_date ON docs ((data->>'date')) WHERE col = 'appointments'`,
    // First run only: seed the price list, then the config (services check runs before config exists).
    sql`INSERT INTO docs (col, id, data)
        SELECT 'services', (s->>'id')::bigint, s FROM jsonb_array_elements(${JSON.stringify(DEFAULT_SERVICES)}::jsonb) s
        WHERE NOT EXISTS (SELECT 1 FROM docs WHERE col = 'config')`,
    sql`INSERT INTO docs (col, id, data) VALUES ('config', 1, ${JSON.stringify(DEFAULT_CONFIG)}::jsonb) ON CONFLICT DO NOTHING`,
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

const sign = (v) => createHmac('sha256', process.env.ADMIN_PASSWORD).update(v).digest('base64url');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const COOKIE = 'sp_session';

// shortcut: no login rate limit, the password length requirement is the brute-force defence; add a limiter if the URL gets targeted.
export function checkPassword(pw) {
  if ((process.env.ADMIN_PASSWORD || '').length < 10) fail(500, 'Imposta ADMIN_PASSWORD (almeno 10 caratteri) nelle variabili d\'ambiente Vercel');
  return typeof pw === 'string' && same(sign('pw:' + pw), sign('pw:' + process.env.ADMIN_PASSWORD));
}

export function sessionCookie(maxAge = 30 * 86400) {
  const exp = String(Date.now() + maxAge * 1000);
  return `${COOKIE}=${maxAge ? `${exp}.${sign(exp)}` : ''}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function requireAdmin(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([\\w-]+)`).exec(req.headers.cookie || '');
  if (!process.env.ADMIN_PASSWORD || !m || Number(m[1]) < Date.now() || !same(m[2], sign(m[1]))) fail(401, 'Accesso richiesto');
}
