import { handle, fail, db, checkPassword, sessionCookie, sessionEpoch, bumpEpoch, requireAdmin, limit, hit, clientIp, CLEAR_COOKIE } from './_lib.js';

export default handle(async (req, res) => {
  const sql = await db();
  if (req.method === 'DELETE') {
    // ?all=1 logs out every device (lost or stolen tablet): old cookies stop matching the epoch.
    if (req.query.all) {
      await requireAdmin(req, sql);
      await bumpEpoch(sql);
    }
    res.setHeader('Set-Cookie', CLEAR_COOKIE);
    return res.json({ ok: true });
  }
  if (req.method !== 'POST') fail(405, 'Metodo non consentito');
  const key = 'login:' + clientIp(req);
  await limit(sql, key, 5, 15); // 5 wrong passwords per IP every 15 minutes
  if (!checkPassword(req.body?.password)) {
    await hit(sql, key);
    fail(401, 'Password errata');
  }
  res.setHeader('Set-Cookie', sessionCookie(await sessionEpoch(sql)));
  res.json({ ok: true });
});
