// Offline mode helpers for the admin app. Pure functions, covered by test/offline.test.mjs. Needs addMin from common.js.

// End time from start + duration: a stored `end` can be stale after a local edit, the server recomputes it on save.
const endOf = (a) => addMin(a.time, Number(a.duration) || 30);

// Appointments of `list` overlapping `a` on the same day; back-to-back (one ends when the next starts) is fine.
const clashes = (list, a) => list.filter((b) => b.id !== a.id && b.date === a.date && a.time < endOf(b) && b.time < endOf(a));

// Re-applies a queued change to a fresh data snapshot, so changes still waiting to be sent stay visible.
// A change holds one `item`/`id` or many `items`/`ids` (CSV import, bulk delete).
function applyOp(data, op) {
  if (op.col === 'config') {
    if (op.method === 'PUT') data.config = { ...data.config, ...op.item };
    return data;
  }
  const list = data[op.col];
  if (!list) return data;
  if (op.method === 'DELETE') {
    const gone = new Set(op.ids || [op.id]);
    data[op.col] = list.filter((x) => !gone.has(x.id));
    return data;
  }
  for (const item of op.items || [op.item]) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
  }
  return data;
}
