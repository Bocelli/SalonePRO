import { handle, fail, db, requireAdmin, withEnd, checkConfig, COLS, DAY, DEFAULT_CONFIG } from './_lib.js';

// Client photos are shrunk to 480p JPEG in the browser; they live in their own collection, outside the main load and the backup.
const PHOTO_MAX_CHARS = 220_000; // about 160 KB of JPEG: a 480p photo is usually 40-80 KB
const PHOTOS_PER_CLIENT = 40;
function checkPhoto(p) {
  if (!Number.isSafeInteger(p.clientId) || typeof p.img !== 'string' || p.img.length > PHOTO_MAX_CHARS
    || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p.img) || !DAY.test(p.date)
    || (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > 120))) {
    fail(400, 'Foto non valida: solo JPEG ridotte, massimo 160 KB');
  }
  return { id: p.id, clientId: p.clientId, date: p.date, note: p.note || '', img: p.img };
}

// Admin-only API. GET everything, PUT one item, DELETE one item, POST = restore a full backup.
export default handle(async (req, res) => {
  const sql = await db();
  await requireAdmin(req, sql);

  // Cheap check the open app runs every few seconds: web bookings newer than the last one it has (ids grow with time).
  if (req.method === 'GET' && req.query.newweb !== undefined) {
    const after = Number(req.query.newweb);
    if (!Number.isSafeInteger(after)) fail(400, 'Dati non validi');
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM docs WHERE col = 'appointments' AND id > ${after} AND data->>'source' = 'web'`;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ n });
  }

  if (req.method === 'GET' && req.query.photos) {
    const rows = await sql`SELECT data FROM docs WHERE col = 'photos' AND data->>'clientId' = ${String(Number(req.query.photos))} ORDER BY id DESC`;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ photos: rows.map((r) => r.data) });
  }

  if (req.method === 'GET') {
    // shortcut: loads every appointment ever, fine for a few thousand rows; filter by date range when it grows.
    const rows = await sql`SELECT col, data FROM docs WHERE col <> 'photos' ORDER BY id`;
    const out = { config: { ...DEFAULT_CONFIG }, services: [], clients: [], inventory: [], appointments: [] };
    for (const r of rows) {
      if (r.col === 'config') Object.assign(out.config, r.data);
      else out[r.col]?.push(r.data);
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json(out);
  }

  if (req.method === 'PUT') {
    const { col, item } = req.body || {};
    if (![...COLS, 'photos'].includes(col) || typeof item !== 'object' || !Number.isSafeInteger(item?.id)) fail(400, 'Dati non validi');
    if (col === 'photos') {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM docs WHERE col = 'photos' AND data->>'clientId' = ${String(item.clientId)} AND id <> ${item.id}`;
      if (n >= PHOTOS_PER_CLIENT) fail(400, `Massimo ${PHOTOS_PER_CLIENT} foto per cliente: eliminane qualcuna`);
    }
    const data = col === 'config' ? checkConfig({ ...DEFAULT_CONFIG, ...item, id: 1 })
      : col === 'appointments' ? withEnd(item) : col === 'photos' ? checkPhoto(item) : item;
    await sql`INSERT INTO docs (col, id, data) VALUES (${col}, ${data.id}, ${JSON.stringify(data)}::jsonb)
              ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data`;
    return res.json({ ok: true, item: data });
  }

  if (req.method === 'DELETE') {
    const { col, id } = req.query;
    if (![...COLS, 'photos'].includes(col) || col === 'config' || !Number.isSafeInteger(Number(id))) fail(400, 'Dati non validi');
    // Deleting a client card also deletes their photos (this also works for deletes queued offline).
    await sql.transaction([
      sql`DELETE FROM docs WHERE col = ${col} AND id = ${Number(id)}`,
      sql`DELETE FROM docs WHERE ${col === 'clients'} AND col = 'photos' AND data->>'clientId' = ${String(Number(id))}`,
    ]);
    return res.json({ ok: true });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (typeof b.config !== 'object' || !b.config || COLS.slice(1).some((c) => b[c] !== undefined && !Array.isArray(b[c]))) {
      fail(400, 'Backup non valido');
    }
    // v9 backups keep the folder list next to config, not inside it
    const rows = [{ col: 'config', id: 1, data: checkConfig({ serviceFolders: b.serviceFolders, ...DEFAULT_CONFIG, ...b.config, id: 1 }) }];
    for (const col of COLS.slice(1)) {
      for (const item of b[col] || []) {
        if (!Number.isSafeInteger(item?.id)) fail(400, `Backup non valido: elemento senza id in "${col}"`);
        rows.push({ col, id: item.id, data: col === 'appointments' ? withEnd(item, b.services) : item });
      }
    }
    // One transaction: if any row is bad nothing is deleted. The session epoch ('auth') and the photos survive a restore.
    await sql.transaction([
      sql`DELETE FROM docs WHERE col <> 'auth' AND col <> 'photos'`,
      sql`INSERT INTO docs (col, id, data)
          SELECT r->>'col', (r->>'id')::bigint, r->'data' FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) r`,
    ]);
    return res.json({ ok: true, count: rows.length });
  }

  fail(405, 'Metodo non consentito');
});
