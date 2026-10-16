// Client history and the "Da richiamare" list for the admin app. Pure functions, covered by test/history.test.mjs.

// Appointments grouped by client id, newest first. Old v6 appointments have no clientId: matched by name, like findClient.
function visitsByClient(appts, clients) {
  const ids = new Set(clients.map((c) => c.id));
  const byName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));
  const out = new Map();
  for (const a of appts) {
    const id = ids.has(a.clientId) ? a.clientId : byName.get((a.clientName || '').toLowerCase());
    if (id === undefined) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(a);
  }
  for (const list of out.values()) list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  return out;
}

// Clients whose last visit is at least `weeks` weeks before `today`, with nothing booked from today on.
// "Richiamata" (recalledAt) hides a client for another `weeks` weeks.
function recallList(clients, appts, today, weeks) {
  if (!weeks) return [];
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  const due = d.toISOString().slice(0, 10);
  const visits = visitsByClient(appts, clients);
  return clients
    .map((client) => ({ client, list: visits.get(client.id) || [] }))
    .filter(({ client, list }) => !list.some((a) => a.date >= today) && !(client.recalledAt > due))
    .map(({ client, list }) => ({ client, last: list[0] }))
    .filter(({ last }) => last && last.date <= due)
    .sort((a, b) => b.last.date.localeCompare(a.last.date)); // just became due first: the likeliest to come back
}
