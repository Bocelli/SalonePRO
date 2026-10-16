import { handle, fail, db, requireAdmin, withEnd, checkConfig, COLS, DEFAULT_CONFIG } from './_lib.js';

// Admin-only API. GET everything, PUT one item, DELETE one item, POST = restore a full backup.
export default handle(async (req, res) => {
  const sql = await db();
  await requireAdmin(req, sql);

  if (req.method === 'GET') {
    // shortcut: loads every appointment ever, fine for a few thousand rows; filter by date range when it grows.
    const rows = await sql`SELECT col, data FROM docs ORDER BY id`;
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
    if (!COLS.includes(col) || typeof item !== 'object' || !Number.isSafeInteger(item?.id)) fail(400, 'Dati non validi');
    const data = col === 'config' ? checkConfig({ ...DEFAULT_CONFIG, ...item, id: 1 }) : col === 'appointments' ? withEnd(item) : item;
    await sql`INSERT INTO docs (col, id, data) VALUES (${col}, ${data.id}, ${JSON.stringify(data)}::jsonb)
              ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data`;
    return res.json({ ok: true, item: data });
  }

  if (req.method === 'DELETE') {
    const { col, id } = req.query;
    if (!COLS.includes(col) || col === 'config' || !Number.isSafeInteger(Number(id))) fail(400, 'Dati non validi');
    await sql`DELETE FROM docs WHERE col = ${col} AND id = ${Number(id)}`;
    return res.json({ ok: true });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (typeof b.config !== 'object' || !b.config || COLS.slice(1).some((c) => b[c] !== undefined && !Array.isArray(b[c]))) {
      fail(400, 'Backup non valido');
    }
    const rows = [{ col: 'config', id: 1, data: checkConfig({ ...DEFAULT_CONFIG, ...b.config, id: 1 }) }];
    for (const col of COLS.slice(1)) {
      for (const item of b[col] || []) {
        if (!Number.isSafeInteger(item?.id)) fail(400, `Backup non valido: elemento senza id in "${col}"`);
        rows.push({ col, id: item.id, data: col === 'appointments' ? withEnd(item, b.services) : item });
      }
    }
    // One transaction: if any row is bad nothing is deleted. The session epoch ('auth') survives a restore.
    await sql.transaction([
      sql`DELETE FROM docs WHERE col <> 'auth'`,
      sql`INSERT INTO docs (col, id, data)
          SELECT r->>'col', (r->>'id')::bigint, r->'data' FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) r`,
    ]);
    return res.json({ ok: true, count: rows.length });
  }

  fail(405, 'Metodo non consentito');
});
