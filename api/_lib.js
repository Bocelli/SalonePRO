import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COLS = ['config', 'services', 'clients', 'inventory', 'appointments'];

export const DEFAULT_CONFIG = {
  salonName: 'Il Mio Salone', ownerName: 'Titolare', address: '', vat: '', email: '', ownerPhone: '',
  openTime: '09:00', closeTime: '19:00', slotMinutes: 30, closedDays: [0, 1],
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

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Config reaches the public page, so it is validated here (it can also arrive from a restored backup file).
export function checkConfig(c) {
  if (!HHMM.test(c.openTime) || !HHMM.test(c.closeTime) || c.openTime >= c.closeTime
    || ![15, 20, 30, 45, 60].includes(Number(c.slotMinutes))
    || !Array.isArray(c.closedDays) || c.closedDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    || (c.serviceFolders !== undefined && (!Array.isArray(c.serviceFolders) || c.serviceFolders.length > 100
      || c.serviceFolders.some((f) => typeof f !== 'string' || !f.trim() || f.length > 60)))) {
    fail(400, 'Impostazioni non valide (orari, intervallo, giorni di chiusura o cartelle)');
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

export function checkPassword(pw) {
  if ((process.env.ADMIN_PASSWORD || '').length < 10) fail(500, 'Imposta ADMIN_PASSWORD (almeno 10 caratteri) nelle variabili d\'ambiente Vercel');
  return typeof pw === 'string' && same(sign('pw:' + pw), sign('pw:' + process.env.ADMIN_PASSWORD));
}

// The session epoch lives in the DB: bumping it ("Esci da tutti i dispositivi") invalidates every issued cookie.
export const sessionEpoch = async (sql) => Number((await sql`SELECT data->>'epoch' AS e FROM docs WHERE col = 'auth' AND id = 1`)[0]?.e || 0);
export const bumpEpoch = (sql) => sql`INSERT INTO docs (col, id, data) VALUES ('auth', 1, '{"epoch":1}')
  ON CONFLICT (col, id) DO UPDATE SET data = jsonb_build_object('epoch', (docs.data->>'epoch')::int + 1)`;

export function sessionCookie(epoch) {
  const payload = `${Date.now() + MAX_AGE * 1000}.${epoch}`;
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export async function requireAdmin(req, sql) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.(\\d+)\\.([\\w-]+)`).exec(req.headers.cookie || '');
  if (!process.env.ADMIN_PASSWORD || !m || Number(m[1]) < Date.now() || !same(m[3], sign(`${m[1]}.${m[2]}`))
    || Number(m[2]) !== await sessionEpoch(sql)) fail(401, 'Accesso richiesto');
}
