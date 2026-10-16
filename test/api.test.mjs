// Runs the real API handlers against an in-memory Postgres (PGlite). `npm test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const fake = new URL('./fake-neon.mjs', import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (s === '@neondatabase/serverless' ? { url: fake, shortCircuit: true } : next(s, c)) });
process.env.DATABASE_URL = 'pglite://memory';
process.env.ADMIN_PASSWORD = 'password-di-prova-123';

const { default: login } = await import('../api/login.js');
const { default: data } = await import('../api/data.js');
const { default: pub } = await import('../api/public.js');
const { romeNow } = await import('../api/_lib.js');

function call(handler, { method = 'GET', query = {}, body, cookie } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    handler({ method, query, body, headers: { cookie } }, res);
  });
}

function nextWeekday(day) {
  const d = new Date(romeNow().date + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== day);
  return d.toISOString().slice(0, 10);
}

let cookie;
const wed = nextWeekday(3);
const book = (o) => call(pub, { method: 'POST', body: { name: 'Mario Lanza', phone: '333 111 2222', serviceIds: [1], date: wed, privacy: true, ...o } });

test('admin API needs login', async () => {
  assert.equal((await call(data)).status, 401);
  assert.equal((await call(login, { method: 'POST', body: { password: 'sbagliata' } })).status, 401);
  const ok = await call(login, { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(ok.status, 200);
  cookie = ok.headers['set-cookie'].split(';')[0];
  assert.equal((await call(data, { cookie: 'sp_session=9999999999999.forged' })).status, 401);
});

test('first run seeds config and price list', async () => {
  const r = await call(data, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.services.length, 7);
  assert.deepEqual(r.body.config.closedDays, [0, 1]);
});

test('public booking: overlaps, hours, closed days', async () => {
  assert.equal((await book({ time: '10:00', serviceIds: [5] })).status, 200); // 90 min -> 11:30
  assert.equal((await book({ time: '11:00' })).status, 409);
  assert.equal((await book({ time: '09:30', serviceIds: [3] })).status, 409); // 09:30-10:30 overlaps
  assert.equal((await book({ time: '11:30' })).status, 200); // touching is fine
  assert.equal((await book({ time: '18:30', serviceIds: [3] })).status, 400); // ends after 19:00
  assert.equal((await book({ time: '10:00', date: nextWeekday(0) })).status, 400); // Sunday closed
  assert.equal((await book({ time: '10:00', date: '2020-01-01' })).status, 400);
  assert.equal((await book({ time: '15:00', privacy: false })).status, 400);
  assert.equal((await book({ time: '15:00', website: 'spam' })).status, 200); // honeypot: fake success

  const r = await call(pub, { query: { date: wed } });
  assert.deepEqual(r.body.busy.map((b) => b.time + '-' + b.end).sort(), ['10:00-11:30', '11:30-12:00']);
  assert.ok(!JSON.stringify(r.body).includes('Lanza'), 'public API must not leak names');

  const all = (await call(data, { cookie })).body;
  assert.equal(all.appointments.length, 2);
  assert.equal(all.clients.filter((c) => c.name === 'Mario Lanza').length, 1, 'same phone = same client');
  assert.equal(all.appointments[0].price, 65);
});

test('restore: bad backup changes nothing, v6 backup gets durations', async () => {
  assert.equal((await call(data, { method: 'POST', cookie, body: { config: {}, clients: [{ name: 'no id' }] } })).status, 400);
  assert.equal((await call(data, { cookie })).body.appointments.length, 2);

  const v6 = {
    config: { salonName: 'Salone Donna & Style', openTime: '09:00', closeTime: '19:00' },
    services: [{ id: 4, name: 'Colore Ricrescita', price: 30, duration: 45 }],
    clients: [{ id: 101, name: 'Elena Rizzo', phone: '3331122334' }],
    inventory: [],
    appointments: [{ id: 301, clientId: 101, clientName: 'Elena Rizzo', date: wed, time: '15:00', services: ['Colore Ricrescita'], price: 30 }],
  };
  assert.equal((await call(data, { method: 'POST', cookie, body: v6 })).status, 200);
  const all = (await call(data, { cookie })).body;
  assert.equal(all.config.salonName, 'Salone Donna & Style');
  assert.equal(all.config.slotMinutes, 30); // missing fields fall back to defaults
  assert.equal(all.appointments[0].end, '15:45');
  assert.equal((await book({ time: '15:30', serviceIds: [4] })).status, 409);
});

test('admin PUT and DELETE', async () => {
  const item = { id: 999, clientName: 'Test', date: wed, time: '17:00', duration: 60, services: [], price: 10 };
  const put = await call(data, { method: 'PUT', cookie, body: { col: 'appointments', item } });
  assert.equal(put.body.item.end, '18:00');
  assert.equal((await call(data, { method: 'PUT', cookie, body: { col: 'hack', item } })).status, 400);
  assert.equal((await call(data, { method: 'DELETE', cookie, query: { col: 'appointments', id: '999' } })).status, 200);
  assert.ok(!(await call(data, { cookie })).body.appointments.some((a) => a.id === 999));
});
