import { handle, fail, db, sessionEpoch, checkCalendarToken, romeNow, addMin, DAY } from './_lib.js';

// Italian time since 1996: summer time from the last Sunday of March to the last Sunday of October.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Rome',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const text = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
const at = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
const fold = (line) => line.match(/.{1,74}/gu).join('\r\n '); // iCalendar lines stay short, longer ones continue after a space

// Read-only feed of the agenda for Google Calendar and other calendar apps: from 30 days ago onwards.
export default handle(async (req, res) => {
  const sql = await db();
  if (!checkCalendarToken(req.query.k, await sessionEpoch(sql))) fail(401, 'Link del calendario non valido: copialo di nuovo dalle Impostazioni');
  const d = new Date(romeNow().date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 30);
  const rows = await sql`SELECT col, data FROM docs
    WHERE col = 'config' OR (col = 'appointments' AND data->>'date' >= ${d.toISOString().slice(0, 10)})`;
  const config = rows.find((r) => r.col === 'config')?.data || {};
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const events = rows
    .filter((r) => r.col === 'appointments' && DAY.test(r.data.date) && /^\d\d:\d\d$/.test(r.data.time))
    .flatMap(({ data: a }) => [
      'BEGIN:VEVENT',
      `UID:${a.id}@salone-pro`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Rome:${at(a.date, a.time)}`,
      `DTEND;TZID=Europe/Rome:${at(a.date, a.end || addMin(a.time, a.duration || 30))}`,
      `SUMMARY:${text(a.clientName + (a.services?.length ? ': ' + a.services.join(' + ') : ''))}`,
      `DESCRIPTION:${text([a.phone && 'Tel. ' + a.phone, a.notes, a.source === 'web' && 'Prenotata online'].filter(Boolean).join('\n'))}`,
      'END:VEVENT',
    ]);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Salone PRO//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(config.salonName || 'Salone PRO')}`, 'X-WR-TIMEZONE:Europe/Rome', ...VTIMEZONE, ...events, 'END:VCALENDAR'];
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(ics.map(fold).join('\r\n') + '\r\n');
});
