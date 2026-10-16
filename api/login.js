import { handle, fail, checkPassword, sessionCookie } from './_lib.js';

export default handle(async (req, res) => {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie(0));
    return res.json({ ok: true });
  }
  if (req.method !== 'POST') fail(405, 'Metodo non consentito');
  if (!checkPassword(req.body?.password)) fail(401, 'Password errata');
  res.setHeader('Set-Cookie', sessionCookie());
  res.json({ ok: true });
});
