// Admin app: agenda (day, week, month), welcome bar, reminders, messages to clients, appointment dialog.

// ---------- Agenda ----------
let view = 'day', showNotified = true;
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const revenue = (list) => list.reduce((s, a) => s + Number(a.price || 0), 0);
const apptsOn = (ds) => db.appointments.filter((a) => a.date === ds).sort((a, b) => a.time.localeCompare(b.time));

// ---------- Benvenuto: always about today, whatever day the agenda shows ----------
const GREETINGS = [[13, 'Buongiorno', 'ph-sun'], [18, 'Buon pomeriggio', 'ph-sun-horizon'], [24, 'Buonasera', 'ph-moon']];
const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const inMin = (m) => (m < 60 ? `tra ${m} min` : `tra ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
function renderWelcome() {
  const now = new Date(), today = todayStr(), hhmm = nowHHMM();
  const [, hello, icon] = GREETINGS.find(([h]) => now.getHours() < h);
  const owner = db.config.ownerName && db.config.ownerName !== 'Titolare' ? `, ${db.config.ownerName.trim().split(' ')[0]}` : '';
  $('wl-icon').className = 'ph ' + icon;
  $('wl-hello').textContent = hello + owner;

  const list = apptsOn(today), done = list.filter((a) => endOf(a) <= hhmm).length, closure = closureOn(today);
  $('wl-today').textContent = !list.length
    ? (isClosedDay(today) ? `Oggi il salone è chiuso${closure?.note ? ` (${closure.note})` : ''}.` : 'Oggi nessun appuntamento in agenda.')
    : `Oggi ${list.length === 1 ? '1 appuntamento' : `${list.length} appuntamenti`}${done && done < list.length ? `, ${done} già ${done === 1 ? 'fatto' : 'fatti'}` : ''}, ${euro(revenue(list))} di incasso.`;

  const who = (a) => { const c = findClient(a); return c ? `<button class="link" data-click="openClientCard" data-id="${c.id}">${esc(a.clientName)}</button>` : `<strong>${esc(a.clientName)}</strong>`; };
  const what = (a) => (a.services?.length ? `, <span class="muted">${esc(a.services.join(' + '))}</span>` : '');
  const cur = list.find((a) => a.time <= hhmm && hhmm < endOf(a)), next = list.find((a) => a.time > hhmm);
  const later = db.appointments.filter((a) => a.date > today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const lines = [];
  if (cur) lines.push(`<span class="badge badge-ok">In corso</span> ${who(cur)} fino alle ${esc(endOf(cur))}`);
  if (next) lines.push(`<span class="badge badge-accent">${inMin(toMin(next.time) - toMin(hhmm))}</span> ${who(next)} alle ${esc(next.time)}${what(next)}`);
  else if (!cur && later) lines.push(`${list.length ? 'Per oggi hai finito. ' : ''}Il prossimo appuntamento è ${later.date === todayStr(1) ? 'domani' : esc(dayLabel(later.date))} alle ${esc(later.time)} con ${who(later)}`);
  else if (!cur && list.length) lines.push('Per oggi hai finito.');
  $('wl-next').innerHTML = lines.map((l) => `<p class="wl-line">${l}</p>`).join('');

  const low = db.inventory.filter((p) => Number(p.qty) <= Number(p.min)).length;
  const toRecall = recallList(db.clients, db.appointments, today, Number(db.config.recallWeeks ?? 6)).length;
  $('wl-chips').innerHTML = [
    toRecall && `<a class="btn btn-outline btn-sm" href="/clienti" data-tab="clienti"><i class="ph ph-clock-counter-clockwise" aria-hidden="true"></i>${toRecall} da richiamare</a>`,
    low && `<a class="btn btn-outline btn-sm" href="/magazzino" data-tab="magazzino"><i class="ph ph-package" aria-hidden="true"></i>${low} da riordinare</a>`,
  ].filter(Boolean).join('');
}
setInterval(() => { if (loaded) { renderWelcome(); renderReminders(); } }, 60000); // keeps "tra 25 min" and the reminders current, no network

function setQuickDate(offset) { $('agenda-date').value = todayStr(offset); renderAgenda(); }
function setView(v) {
  view = v;
  document.querySelectorAll('.seg [data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === v);
    b.setAttribute('aria-pressed', b.dataset.view === v);
  });
  renderAgenda();
}
function openDay(ds) { $('agenda-date').value = ds; setView('day'); }
function shiftPeriod(n) {
  const d = new Date(($('agenda-date').value || todayStr()) + 'T12:00');
  if (view === 'month') d.setMonth(d.getMonth() + n, 1); // day 1 avoids 31 Jan + 1 month = 3 Mar
  else d.setDate(d.getDate() + n * (view === 'week' ? 7 : 1));
  $('agenda-date').value = localDate(d);
  renderAgenda();
}
// Monday-to-Sunday dates of the week containing ds
function weekDays(ds) {
  const d = new Date(ds + 'T12:00');
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return localDate(x); });
}

function findClient(a) {
  return db.clients.find((c) => c.id === a.clientId) || db.clients.find((c) => c.name.toLowerCase() === (a.clientName || '').toLowerCase());
}

function renderAgenda() {
  const sel = $('agenda-date').value || todayStr();
  const days = view === 'day' ? [sel] : view === 'week' ? weekDays(sel) : null;
  const period = db.appointments.filter((a) => (days ? days.includes(a.date) : (a.date || '').startsWith(sel.slice(0, 7))));
  const closure = closureOn(sel), closed = isClosedDay(sel);
  const closedText = closure ? `chiuso${closure.note ? ` (${closure.note})` : ''}` : 'giorno di chiusura';
  if (view === 'day') {
    $('agenda-day').textContent = cap(dayLabel(sel));
    $('agenda-sub').textContent = ({ [todayStr()]: 'Oggi', [todayStr(1)]: 'Domani', [todayStr(-1)]: 'Ieri' }[sel] || dayLabel(sel, { year: 'numeric' })) + (closed ? ` · ${closedText}` : '');
  } else if (view === 'week') {
    $('agenda-day').textContent = `${dayLabel(days[0], { day: 'numeric', month: 'short' })} - ${dayLabel(days[6], { day: 'numeric', month: 'short' })}`;
    $('agenda-sub').textContent = `Settimana, ${days[0].slice(0, 4)}`;
  } else {
    $('agenda-day').textContent = cap(dayLabel(sel, { month: 'long', year: 'numeric' }));
    $('agenda-sub').textContent = 'Tocca un giorno per aprirlo';
  }
  $('agenda-list-title').textContent = { day: 'Appuntamenti del giorno', week: 'Appuntamenti della settimana', month: 'Appuntamenti del mese' }[view];
  $('stat-rev-lbl').textContent = { day: 'incasso previsto', week: 'incasso settimana', month: 'incasso mese' }[view];

  $('metrics').hidden = view === 'day' && sel === todayStr(); // the welcome bar already sums up today
  $('stat-count').textContent = period.length;
  $('stat-count-lbl').textContent = period.length === 1 ? 'appuntamento' : 'appuntamenti';
  $('stat-revenue').textContent = euro(revenue(period));
  renderReminders();
  renderWelcome();
  if (view === 'week') return renderWeek(days);
  if (view === 'month') return renderMonth(sel);

  const list = apptsOn(sel);
  if (!list.length) {
    $('agenda-list').innerHTML = empty('ph-calendar-blank', 'Nessun appuntamento', closed ? `Il salone è ${closedText} in questo giorno.` : 'La giornata è libera. Aggiungi un appuntamento o condividi il link di prenotazione.',
      '<button class="btn btn-primary btn-sm" data-click="openApptModal"><i class="ph ph-plus" aria-hidden="true"></i>Nuovo appuntamento</button>');
    return;
  }

  // Daily breaks sit between the appointments, in time order.
  const breaks = closed ? [] : (db.config.breaks || []).map((b) => ({ brk: true, time: b.from, end: b.to }));
  $('agenda-list').innerHTML = [...list, ...breaks].sort((a, b) => a.time.localeCompare(b.time)).map((a) => {
    if (a.brk) return `
    <div class="appt brk">
      <div class="appt-time num"><strong>${esc(a.time)}</strong><span>${esc(a.end)}</span></div>
      <p class="brk-label"><i class="ph ph-coffee" aria-hidden="true"></i>Pausa</p>
    </div>`;
    const c = findClient(a);
    const allergy = c && c.allergy && c.allergy.toLowerCase() !== 'nessuna' ? `<span class="badge badge-danger"><i class="ph ph-warning" aria-hidden="true"></i>${esc(c.allergy)}</span>` : '';
    const msg = encodeURIComponent(`Ciao ${a.clientName}! Ti confermiamo l'appuntamento presso ${db.config.salonName} per ${dayLabel(a.date)} alle ore ${a.time} (${(a.services || []).join(', ')}). A presto!`);
    const contact = a.phone ? `
        <a class="btn-icon" href="https://wa.me/${waNumber(a.phone)}?text=${msg}" target="_blank" rel="noopener" data-click="markAttempt" data-id="${a.id}" data-arg="WhatsApp" aria-label="Conferma su WhatsApp" title="WhatsApp"><i class="ph ph-whatsapp-logo" aria-hidden="true"></i></a>
        <button class="btn-icon" data-click="contactAppt" data-id="${a.id}" aria-label="Avvisa o scrivi alla cliente" title="Avvisa / Scrivi"><i class="ph ph-megaphone" aria-hidden="true"></i></button>` : '';
    return `
    <article class="appt">
      <div class="appt-time num"><strong>${esc(a.time)}</strong><span>${addMin(a.time, a.duration || 30)}</span></div>
      <div class="appt-body">
        <div class="appt-head">
          <h3>${c ? `<button class="link" data-click="openClientCard" data-id="${c.id}">${esc(a.clientName)}</button>` : esc(a.clientName)}</h3>
          ${a.source === 'web' ? '<span class="badge badge-accent"><i class="ph ph-globe-simple" aria-hidden="true"></i>Web</span>' : ''}
          ${a.reminderSent ? '<span class="badge badge-ok"><i class="ph ph-bell" aria-hidden="true"></i>Avvisata</span>' : ''}
          ${clashes(list, a).length ? '<span class="badge badge-danger"><i class="ph ph-warning-octagon" aria-hidden="true"></i>Sovrapposto</span>' : ''}
          ${allergy}
        </div>
        <p class="appt-services">${esc((a.services || []).join(' + '))}, ${Number(a.duration) || 30} min</p>
        ${a.notes ? `<p class="note"><i class="ph ph-note" aria-hidden="true"></i><span>${esc(a.notes)}</span></p>` : ''}
        ${c && c.formula ? `<p class="note formula"><i class="ph ph-palette" aria-hidden="true"></i><span>${esc(c.formula)}</span></p>` : ''}
      </div>
      <div class="appt-side">
        <strong class="num">${euro(a.price)}</strong>
        <div class="actions">
          <button class="btn-icon" data-click="openApptModal" data-id="${a.id}" aria-label="Modifica" title="Modifica"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
          ${contact}
          <button class="btn-icon danger" data-click="deleteAppt" data-id="${a.id}" aria-label="Elimina" title="Elimina"><i class="ph ph-trash" aria-hidden="true"></i></button>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderWeek(days) {
  $('agenda-list').innerHTML = `<div class="week">${days.map((ds, i) => {
    const list = apptsOn(ds), closed = isClosedDay(ds);
    return `
    <div class="week-day${ds === todayStr() ? ' today' : ''}${closed ? ' closed' : ''}">
      <button class="week-head" data-click="openDay" data-arg="${ds}" aria-label="Apri ${dayLabel(ds)}">
        <strong>${WEEKDAYS[i]} ${Number(ds.slice(8))}</strong>
        <span class="muted small num">${list.length ? `${list.length} app. · ${euro(revenue(list))}` : closed ? esc(closureOn(ds)?.note || 'Chiuso') : 'Libero'}</span>
      </button>
      ${list.map((a) => `
        <button class="mini${clashes(list, a).length ? ' clash' : ''}" data-click="openApptModal" data-id="${a.id}">
          <span class="num">${esc(a.time)}${a.reminderSent ? ' <i class="ph ph-bell" role="img" aria-label="avvisata"></i>' : ''}${clashes(list, a).length ? ' <i class="ph ph-warning-octagon" role="img" aria-label="sovrapposto"></i>' : ''}</span>
          <strong>${esc(a.clientName)}</strong>
          <small>${esc((a.services || []).join(', '))}</small>
        </button>`).join('')}
    </div>`;
  }).join('')}</div>`;
}

function renderMonth(sel) {
  const y = Number(sel.slice(0, 4)), m = Number(sel.slice(5, 7)) - 1;
  let html = WEEKDAYS.map((l) => `<span class="m-lbl">${l}</span>`).join('') + '<span></span>'.repeat((new Date(y, m, 1).getDay() + 6) % 7);
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`, list = apptsOn(ds);
    html += `
    <button class="m-cell${ds === todayStr() ? ' today' : ''}${isClosedDay(ds) ? ' closed' : ''}" data-click="openDay" data-arg="${ds}" aria-label="${dayLabel(ds)}, ${list.length} appuntamenti">
      <span class="m-num"><span>${d}</span>${list.length ? `<span class="badge badge-accent">${list.length}</span>` : ''}</span>
      ${closureOn(ds) && !list.length ? `<span class="m-pill">${esc(closureOn(ds).note || 'Chiuso')}</span>` : ''}
      ${list.slice(0, 3).map((a) => `<span class="m-pill">${esc(a.time)} ${esc(a.clientName)}</span>`).join('')}
      ${list.length > 3 ? `<span class="m-more">+${list.length - 3} altri</span>` : ''}
    </button>`;
  }
  $('agenda-list').innerHTML = `<div class="month">${html}</div>`;
}

// ---------- Promemoria (oggi, domani, dopodomani) ----------
const reminderText = (a) => `Ciao ${a.clientName}! Ti ricordiamo il tuo appuntamento presso ${db.config.salonName} per ${dayLabel(a.date)} alle ore ${a.time} (${(a.services || []).join(', ')}). A presto!`;

function renderReminders() {
  const days = [todayStr(), todayStr(1), todayStr(2)], now = nowHHMM();
  const all = db.appointments.filter((a) => days.includes(a.date) && (a.date !== days[0] || a.time > now)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const todo = all.filter((a) => !a.reminderSent).length;
  $('reminders').hidden = !all.length;
  $('rem-count').textContent = todo ? `${todo} da avvisare` : 'Tutte avvisate';
  $('rem-count').className = 'badge ' + (todo ? 'badge-warn' : 'badge-ok');
  $('rem-toggle').textContent = showNotified ? 'Nascondi avvisate' : 'Mostra tutte';
  const list = showNotified ? all : all.filter((a) => !a.reminderSent);
  $('rem-list').innerHTML = list.map((a) => {
    const msg = encodeURIComponent(reminderText(a)), wa = waNumber(a.phone);
    const status = a.reminderSent ? 'avvisata' : a.lastAttemptChannel ? `messaggio aperto su ${esc(a.lastAttemptChannel)}, conferma quando inviato` : 'da avvisare';
    return `
    <div class="row rem${a.reminderSent ? ' done' : ''}">
      <div class="row-main">
        <div class="row-title">
          <span class="badge ${a.date === days[0] ? 'badge-accent' : 'badge-warn'}">${['Oggi', 'Domani', 'Dopodomani'][days.indexOf(a.date)]} ${esc(a.time)}</span>
          <strong>${esc(a.clientName)}</strong>
        </div>
        <span class="row-sub">${esc((a.services || []).join(' + '))}, ${status}</span>
      </div>
      <div class="row-actions">
        ${a.phone ? `
        <a class="btn-icon" href="https://wa.me/${wa}?text=${msg}" target="_blank" rel="noopener" data-click="markAttempt" data-id="${a.id}" data-arg="WhatsApp" aria-label="Promemoria su WhatsApp a ${esc(a.clientName)}"><i class="ph ph-whatsapp-logo" aria-hidden="true"></i></a>
        <a class="btn-icon" href="sms:+${wa}?body=${msg}" data-click="markAttempt" data-id="${a.id}" data-arg="SMS" aria-label="Promemoria via SMS a ${esc(a.clientName)}"><i class="ph ph-chat-text" aria-hidden="true"></i></a>` : '<span class="muted small">Senza numero</span>'}
        <button class="btn btn-sm ${a.reminderSent ? 'btn-ghost' : 'btn-outline'}" data-click="toggleReminder" data-id="${a.id}">${a.reminderSent ? 'Da riavvisare' : '<i class="ph ph-check" aria-hidden="true"></i>Avvisata'}</button>
      </div>
    </div>`;
  }).join('') || '<p class="muted small rem-empty">Tutte le clienti dei prossimi 2 giorni sono avvisate. Tocca "Mostra tutte" per rivederle.</p>';
}

// Opening WhatsApp/SMS does not prove the message was sent, so the salon confirms it with "Avvisata".
function markAttempt(id, channel) {
  const a = db.appointments.find((x) => x.id === id);
  if (!a) return;
  a.lastAttemptChannel = channel;
  persist('appointments', a);
  setTimeout(renderReminders); // after the link has opened
}
function toggleReminder(id) {
  const a = db.appointments.find((x) => x.id === id);
  if (!a) return;
  a.reminderSent = !a.reminderSent;
  persist('appointments', a);
  renderAgenda();
}
function toggleNotified() { showNotified = !showNotified; renderReminders(); }

// ---------- Avvisa / Scrivi alla cliente ----------
let contactPhone = '', contactApptId = null, contactRecallId = null;
function openContact(clientId, apptId, recall = false) {
  const a = db.appointments.find((x) => x.id === apptId);
  const c = db.clients.find((x) => x.id === clientId);
  const name = a ? a.clientName : c?.name, phone = a ? a.phone : c?.phone;
  if (!phone) return toast('Questa cliente non ha un numero di telefono salvato', 'error');
  contactPhone = waNumber(phone);
  contactApptId = a ? a.id : null;
  contactRecallId = recall ? clientId : null;
  $('contact-who').textContent = `${name}, ${phone}`;
  $('contact-msg').value = a ? reminderText(a) : recall ? recallText(c) : `Ciao ${name}! Ti scriviamo da ${db.config.salonName}: `;
  openModal('contact-modal');
}
function sendContact(channel) {
  const msg = encodeURIComponent($('contact-msg').value.trim());
  if (contactApptId) markAttempt(contactApptId, channel === 'wa' ? 'WhatsApp' : 'SMS');
  if (contactRecallId) markRecalled(contactRecallId);
  if (channel === 'wa') window.open(`https://wa.me/${contactPhone}?text=${msg}`, '_blank', 'noopener');
  else location.href = `sms:+${contactPhone}?body=${msg}`;
  closeModal('contact-modal');
}

function openApptModal(id) {
  const a = db.appointments.find((x) => x.id === id);
  const client = a && findClient(a);
  const cur = a ? a.services || [] : [];
  $('appt-modal-title').textContent = a ? 'Modifica appuntamento' : 'Nuovo appuntamento';
  $('modal-edit-id').value = a ? a.id : '';
  $('modal-client').innerHTML = '<option value="">Seleziona una cliente</option>' + sortedClients().map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('modal-client').value = client ? client.id : '';
  $('modal-new-client').value = a && !client ? a.clientName : '';
  $('modal-phone').value = a ? a.phone || '' : '';
  $('modal-date').value = a ? a.date : $('agenda-date').value || todayStr();
  $('modal-time').value = a ? a.time : '09:30';
  $('modal-duration').value = a ? a.duration || 30 : 30;
  $('modal-price').value = a ? Number(a.price || 0) : 0;
  $('modal-notes').value = a ? a.notes || '' : '';
  // Folders start closed, except those holding a service already on this appointment
  $('modal-services-picker').innerHTML = folders().map((f) => {
    const items = db.services.filter((s) => catOf(s) === f);
    if (!items.length) return '';
    return `
    <details class="pick-group" ${items.some((s) => cur.includes(s.name)) ? 'open' : ''}>
      <summary><i class="ph ph-caret-right folder-caret" aria-hidden="true"></i><i class="ph ph-folder" aria-hidden="true"></i>${esc(f)}<span class="badge badge-accent">${items.length}</span></summary>
      <div class="chips">${items.map((s) => `
        <label class="chip"><input type="checkbox" value="${esc(s.name)}" data-price="${Number(s.price) || 0}" data-dur="${Number(s.duration) || 0}" ${cur.includes(s.name) ? 'checked' : ''} data-change="recalcModal">
          <span>${esc(s.name)}</span><small>${euro(s.price)}</small></label>`).join('')}</div>
    </details>`;
  }).join('') || '<p class="muted small">Il listino è vuoto.</p>';
  openModal('appt-modal');
}

function fillClientPhone() {
  const c = db.clients.find((x) => x.id === Number($('modal-client').value));
  if (c) { $('modal-phone').value = c.phone || ''; $('modal-new-client').value = ''; }
}

function recalcModal() {
  let price = 0, dur = 0;
  document.querySelectorAll('#modal-services-picker input:checked').forEach((cb) => { price += Number(cb.dataset.price); dur += Number(cb.dataset.dur); });
  $('modal-price').value = price;
  $('modal-duration').value = dur || 30;
}

function saveAppointment() {
  const editId = Number($('modal-edit-id').value);
  const newName = $('modal-new-client').value.trim();
  const phone = $('modal-phone').value.trim();
  const date = $('modal-date').value, time = $('modal-time').value;
  if (!date || !time) return toast('Inserisci data e ora', 'error');
  const services = [...document.querySelectorAll('#modal-services-picker input:checked')].map((cb) => cb.value);
  if (!services.length) services.push('Servizio generico');

  let client = newName
    ? db.clients.find((c) => c.name.toLowerCase() === newName.toLowerCase())
    : db.clients.find((c) => c.id === Number($('modal-client').value));
  if (!client && !newName) return toast('Seleziona una cliente o scrivi un nome', 'error');
  if (!client) {
    client = { id: newId(), name: newName, phone, allergy: 'Nessuna', formula: '', gdprConsent: true, gdprDate: todayStr() };
    db.clients.push(client);
    persist('clients', client);
  }

  const old = db.appointments.find((a) => a.id === editId);
  const appt = {
    ...old, id: old ? old.id : newId(), clientId: client.id, clientName: client.name, phone, date, time, services,
    price: Number($('modal-price').value || 0), duration: Number($('modal-duration').value) || 30, notes: $('modal-notes').value.trim(),
  };
  if (old) Object.assign(old, appt); else db.appointments.push(appt);
  persist('appointments', appt).then((r) => r && toast(old ? 'Appuntamento aggiornato' : 'Appuntamento salvato'));
  $('agenda-date').value = date;
  closeModal('appt-modal');
  renderAll();
}

function deleteAppt(id) {
  const a = db.appointments.find((x) => x.id === id);
  if (!a || !confirm(`Eliminare l'appuntamento di ${a.clientName} alle ${a.time}?`)) return;
  db.appointments = db.appointments.filter((x) => x.id !== id);
  drop('appointments', id);
  renderAgenda();
}

function parseBookingString() {
  const raw = $('import-text').value.trim();
  if (!raw) return toast('Incolla prima il messaggio', 'error');
  const get = (label) => (raw.match(new RegExp('^\\s*' + label + '\\s*:\\s*(.+)$', 'im')) || [])[1]?.trim() || '';
  let date = get('Data');
  const dm = date.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dm) date = `${dm[3]}-${pad(dm[2])}-${pad(dm[1])}`;
  const time = get('Ora').replace('.', ':').padStart(5, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return toast('Nel messaggio non trovo "Data:" e "Ora:" validi', 'error');

  const name = get('Cliente') || 'Cliente Web';
  const phone = get('Tel');
  const services = (get('Servizi') || 'Servizio prenotato').split(',').map((s) => s.trim()).filter(Boolean);
  const duration = services.reduce((s, n) => s + (Number(db.services.find((x) => x.name === n)?.duration) || 0), 0) || 30;
  let client = db.clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!client) {
    client = { id: newId(), name, phone, allergy: 'Nessuna', formula: '', gdprConsent: /GDPR\s*:\s*Accettato/i.test(raw), gdprDate: todayStr() };
    db.clients.push(client);
    persist('clients', client);
  }
  const appt = {
    id: newId(), clientId: client.id, clientName: client.name, phone, date, time, services, duration,
    price: Number(get('Totale').replace(',', '.').replace(/[^\d.]/g, '')) || 0, notes: 'Prenotazione ricevuta via messaggio',
  };
  db.appointments.push(appt);
  persist('appointments', appt).then((r) => r && toast('Prenotazione inserita in agenda'));
  $('import-text').value = '';
  closeModal('import-modal');
  $('agenda-date').value = date;
  showTab('agenda');
  renderAll();
}

// ---------- Actions (data-click & co. in index.html and in the templates above, see common.js) ----------
Object.assign(actions.click, {
  toggleNotified, saveAppointment, parseBookingString,
  openApptModal: (el) => openApptModal(Number(el.dataset.id) || undefined), // no data-id: new appointment
  deleteAppt: (el) => deleteAppt(Number(el.dataset.id)),
  setView: (el) => setView(el.dataset.arg),
  shiftPeriod: (el) => shiftPeriod(Number(el.dataset.arg)),
  setQuickDate: (el) => setQuickDate(Number(el.dataset.arg)),
  openDay: (el) => openDay(el.dataset.arg),
  toggleReminder: (el) => toggleReminder(Number(el.dataset.id)),
  markAttempt: (el) => markAttempt(Number(el.dataset.id), el.dataset.arg),
  contactAppt: (el) => openContact(null, Number(el.dataset.id)),
  sendContact: (el) => sendContact(el.dataset.arg),
});
Object.assign(actions.change, { renderAgenda, fillClientPhone, recalcModal });
