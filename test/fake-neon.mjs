// Test double for @neondatabase/serverless: same `sql` tagged-template + `transaction` API, backed by in-memory PGlite.
import { PGlite } from '@electric-sql/pglite';

const pg = new PGlite();

export function neon() {
  const sql = (strings, ...values) => {
    let text = strings[0];
    values.forEach((_, i) => { text += '$' + (i + 1) + strings[i + 1]; });
    return { text, values, then: (ok, ko) => pg.query(text, values).then((r) => r.rows).then(ok, ko) };
  };
  sql.transaction = (queries) => pg.transaction(async (tx) => {
    const out = [];
    for (const q of queries) out.push((await tx.query(q.text, q.values)).rows);
    return out;
  });
  return sql;
}
