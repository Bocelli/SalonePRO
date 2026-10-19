// Admin app: web booking link, phone calendar, privacy, settings, guided setup, closures, backup, app install.

// ---------- Prenotazione web ----------
function renderWebLink() {
  const link = location.origin + '/prenota';
  $('public-link').value = link;
  $('share-wa').href = 'https://wa.me/?text=' + encodeURIComponent(`Prenota il tuo appuntamento da ${db.config.salonName}: ${link}`);
}

function copyLink(id = 'public-link') {
  navigator.clipboard.writeText($(id).value)
    .then(() => toast('Link copiato'))
    .catch(() => { $(id).select(); toast('Seleziona il link e copialo', 'error'); });
}

// ---------- Calendario del telefono ----------
// The link carries a secret token because calendar apps cannot log in; it is fetched only when Impostazioni opens.
async function loadCalendarLink() {
  if (!loaded) return; // opened straight on /impostazioni: reload() calls it after login
  try {
    const link = `${location.origin}/api/calendar?k=${(await api('GET', '/api/data?calendar')).token}`;
    $('cal-link').value = link;
    $('cal-google').href = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(link.replace('https:', 'webcal:'));
  } catch (e) {
    $('cal-link').value = isNetwork(e) ? 'Serve la connessione per vedere il link' : e.message;
  }
}

// ---------- Privacy ----------
function renderGdpr() {
  const sel = $('gdpr-select-client');
  const v = sel.value;
  sel.innerHTML = sortedClients().map((c) => `<option value="${c.id}">${esc(c.name)}${c.gdprConsent ? '' : ' (consenso mancante)'}</option>`).join('') || '<option value="">Nessuna cliente</option>';
  if (db.clients.some((c) => String(c.id) === v)) sel.value = v;
  $('legal-text-container').innerHTML = legalHtml(db.config);
}

function signClientGdprInSalon() {
  const c = db.clients.find((x) => x.id === Number($('gdpr-select-client').value));
  if (!c) return toast('Seleziona una cliente', 'error');
  c.gdprConsent = true;
  c.gdprDate = todayStr();
  persist('clients', c).then((r) => r && toast(`Consenso registrato per ${c.name}`));
  renderClients();
  renderGdpr();
}

function printPaperGdprForm() {
  const c = db.clients.find((x) => x.id === Number($('gdpr-select-client').value));
  const w = window.open('', '_blank');
  if (!w) return toast('Consenti i popup per stampare il modulo', 'error');
  w.document.write(`<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Modulo privacy</title>
    <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 20px;line-height:1.55;color:#18181b}h1{font-size:1.25rem}h4{margin:16px 0 4px}
    .opt{display:block;margin:14px 0}.sign{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:48px}.sign div{border-top:1px solid #18181b;padding-top:6px;font-size:.85rem}</style></head><body>
    <h1>Informativa privacy e consenso, ${esc(db.config.salonName)}</h1>
    <p>Cliente: <strong>${c ? esc(c.name) : '______________________________'}</strong></p>
    ${legalHtml(db.config)}
    <span class="opt">&#9744; Ho letto l'informativa e acconsento al trattamento dei dati per la gestione degli appuntamenti.</span>
    <span class="opt">&#9744; Acconsento all'annotazione di allergie e sensibilità della cute per la sicurezza dei trattamenti (art. 9 GDPR).</span>
    <div class="sign"><div>Data</div><div>Firma</div></div></body></html>`);
  w.document.close();
  w.print(); // from here: the popup inherits the CSP, so a script inside it would be blocked
}

// ---------- Impostazioni ----------
function loadConfigUI() {
  const c = db.config;
  $('cfg-name').value = c.salonName || '';
  $('cfg-owner').value = c.ownerName || '';
  $('cfg-address').value = c.address || '';
  $('cfg-vat').value = c.vat || '';
  $('cfg-email').value = c.email || '';
  $('cfg-phone').value = c.ownerPhone || '';
  $('cfg-open').value = c.openTime || '09:00';
  $('cfg-close').value = c.closeTime || '19:00';
  $('cfg-slot').value = String(c.slotMinutes || 30);
  $('cfg-recall').value = String(c.recallWeeks ?? 6);
  $('cfg-breaks').innerHTML = (c.breaks || []).map(rangeRow.breaks).join('');
  $('cfg-closures').innerHTML = (c.closures || []).filter((x) => x.to >= todayStr()).map(rangeRow.closures).join(''); // past closures drop out
  $('cfg-closed').innerHTML = DAYS.map(([d, l]) => `<label class="chip"><input type="checkbox" value="${d}" ${(c.closedDays || []).includes(d) ? 'checked' : ''}>${l}</label>`).join('');
  $('brand-salon').textContent = c.salonName || '';
}

function saveConfig() {
  const openTime = $('cfg-open').value || '09:00', closeTime = $('cfg-close').value || '19:00';
  if (openTime >= closeTime) return toast("La chiusura deve essere dopo l'apertura", 'error');
  Object.assign(db.config, {
    salonName: $('cfg-name').value.trim() || 'Il Mio Salone',
    ownerName: $('cfg-owner').value.trim() || 'Titolare',
    address: $('cfg-address').value.trim(),
    vat: $('cfg-vat').value.trim(),
    email: $('cfg-email').value.trim(),
    ownerPhone: $('cfg-phone').value.trim(),
    openTime, closeTime,
    slotMinutes: Number($('cfg-slot').value),
    recallWeeks: Number($('cfg-recall').value),
    closedDays: [...document.querySelectorAll('#cfg-closed input:checked')].map((i) => Number(i.value)),
  });
  persist('config', { ...db.config, id: 1 }).then((r) => r && toast('Impostazioni salvate'));
  loadConfigUI();
  renderAll();
}

// ---------- Configurazione guidata (prima installazione) ----------
// Shown once per salon (flag saved in config), while the salon still has the default name.
const needsOnboarding = () => !db.config.onboarded && db.config.salonName === 'Il Mio Salone';
const OB_LAST = 4;
let obStep = 0;

function openOnboarding() {
  const c = db.config;
  $('ob-name').value = c.salonName === 'Il Mio Salone' ? '' : c.salonName || '';
  $('ob-owner').value = c.ownerName === 'Titolare' ? '' : c.ownerName || '';
  $('ob-phone').value = c.ownerPhone || '';
  $('ob-address').value = c.address || '';
  $('ob-open').value = c.openTime || '09:00';
  $('ob-close').value = c.closeTime || '19:00';
  $('ob-slot').value = String(c.slotMinutes || 30);
  $('ob-break-from').value = c.breaks?.[0]?.from || '';
  $('ob-break-to').value = c.breaks?.[0]?.to || '';
  $('ob-closed').innerHTML = DAYS.map(([d, l]) => `<label class="chip"><input type="checkbox" value="${d}" ${(c.closedDays || []).includes(d) ? 'checked' : ''}>${l}</label>`).join('');
  obShow(0);
  openModal('ob-modal');
}

function obShow(n) {
  obStep = n;
  document.querySelectorAll('.ob-step').forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  document.querySelectorAll('#ob-steps span').forEach((s, i) => s.classList.toggle('on', i < n));
  $('ob-steps').hidden = !n;
  $('ob-count').textContent = n ? `Passo ${n} di ${OB_LAST}` : '';
  $('ob-back').hidden = !n;
  $('ob-skip').hidden = n === OB_LAST;
  $('ob-next').innerHTML = n === 0 ? 'Iniziamo' : n === OB_LAST ? '<i class="ph ph-check"></i>Vai all’agenda' : 'Avanti<i class="ph ph-caret-right"></i>';
  if (n === 3) {
    const list = folders();
    $('ob-srv-text').textContent = db.services.length
      ? `Abbiamo preparato un listino di partenza con ${db.services.length} servizi in ${list.length} cartelle. Controlla i prezzi quando vuoi.`
      : 'Il listino è vuoto: crea le cartelle (es. PIEGA) e aggiungi i servizi da Listino servizi.';
    $('ob-folders').innerHTML = list.map((f) => `<span class="badge badge-accent"><i class="ph ph-folder"></i>${esc(f)}, ${db.services.filter((s) => catOf(s) === f).length}</span>`).join('');
  }
  if (n === OB_LAST) {
    $('ob-link').value = $('public-link').value;
    $('ob-share').href = $('share-wa').href;
  }
  $('ob-modal').querySelector('.modal').scrollTop = 0;
}

function obGo(dir) {
  if (dir > 0 && obStep === 1 && !$('ob-name').value.trim()) return toast('Scrivi il nome del salone', 'error');
  if (dir > 0 && obStep === 2) {
    if (($('ob-open').value || '09:00') >= ($('ob-close').value || '19:00')) return toast("La chiusura deve essere dopo l'apertura", 'error');
    const bFrom = $('ob-break-from').value, bTo = $('ob-break-to').value;
    if ((bFrom || bTo) && !(bFrom && bTo && bFrom < bTo)) return toast('Pausa pranzo: indica inizio e fine, con la fine dopo l’inizio', 'error');
    db.config.breaks = bFrom ? [{ from: bFrom, to: bTo }, ...(db.config.breaks || []).slice(1)] : (db.config.breaks || []).slice(1);
    Object.assign(db.config, {
      salonName: $('ob-name').value.trim(),
      ownerName: $('ob-owner').value.trim() || 'Titolare',
      ownerPhone: $('ob-phone').value.trim(),
      address: $('ob-address').value.trim(),
      openTime: $('ob-open').value || '09:00',
      closeTime: $('ob-close').value || '19:00',
      slotMinutes: Number($('ob-slot').value),
      closedDays: [...document.querySelectorAll('#ob-closed input:checked')].map((i) => Number(i.value)),
    });
    persist('config', { ...db.config, id: 1 });
    loadConfigUI();
    renderAll();
  }
  if (dir > 0 && obStep === OB_LAST) return obFinish(false);
  obShow(obStep + dir);
}

function obFinish(skipped) {
  db.config.onboarded = true;
  persist('config', { ...db.config, id: 1 });
  try { localStorage.setItem('sp_news', NEWS[0].v); } catch {} // a new salon does not need the changelog
  closeModal('ob-modal');
  showTab('agenda');
  toast(skipped ? 'Puoi riprendere la configurazione guidata da Impostazioni' : 'Tutto pronto, buon lavoro!');
  if (!skipped) maybeInstallBanner();
}

// ---------- Ferie, festivi e pause ----------
// The rows on screen are the draft: "Aggiungi" adds a row, the bin removes it, "Salva" reads them all back.
const rangeRow = {
  breaks: (x = { from: '13:00', to: '15:00' }) => `
    <div class="range" data-kind="breaks">
      <input type="time" data-k="from" value="${esc(x.from)}" aria-label="Inizio pausa">
      <span class="muted">alle</span>
      <input type="time" data-k="to" value="${esc(x.to)}" aria-label="Fine pausa">
      <button class="btn-icon danger" data-click="removeRange" aria-label="Togli pausa"><i class="ph ph-trash"></i></button>
    </div>`,
  closures: (x = { from: todayStr(), to: todayStr(), note: '' }) => `
    <div class="range" data-kind="closures">
      <input type="date" data-k="from" value="${esc(x.from)}" aria-label="Chiuso dal">
      <span class="muted">al</span>
      <input type="date" data-k="to" value="${esc(x.to)}" aria-label="Chiuso fino al">
      <input type="text" data-k="note" value="${esc(x.note || '')}" placeholder="Es. Ferie estive" maxlength="60" aria-label="Nota">
      <button class="btn-icon danger" data-click="removeRange" aria-label="Togli chiusura"><i class="ph ph-trash"></i></button>
    </div>`,
};
const readRanges = (kind) => [...document.querySelectorAll(`#cfg-${kind} .range`)]
  .map((row) => Object.fromEntries([...row.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()])));
function addRange(kind) {
  $(`cfg-${kind}`).insertAdjacentHTML('beforeend', rangeRow[kind]());
}
function saveClosures() {
  const breaks = readRanges('breaks');
  const closures = readRanges('closures').map((x) => ({ from: x.from, to: x.to || x.from, ...(x.note && { note: x.note }) }));
  if (breaks.some((b) => !b.from || !b.to || b.from >= b.to)) return toast('Controlla le pause: la fine deve essere dopo l’inizio', 'error');
  if (closures.some((x) => !x.from || x.from > x.to)) return toast('Controlla le chiusure: la data di fine deve essere dopo quella di inizio', 'error');
  Object.assign(db.config, { breaks, closures: closures.sort((a, b) => a.from.localeCompare(b.from)) });
  persist('config', { ...db.config, id: 1 }).then((r) => r && toast('Ferie e pause salvate'));
  loadConfigUI();
  renderAll();
}
const closureOn = (ds) => (db.config.closures || []).find((x) => ds >= x.from && ds <= x.to);
const isClosedDay = (ds) => (db.config.closedDays || []).includes(new Date(ds + 'T12:00').getDay()) || !!closureOn(ds);

function exportBackup() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = `backup_salone_pro_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('Il ripristino SOSTITUISCE tutti i dati attuali (agenda, clienti, listino, magazzino, impostazioni). Continuare?')) return;
  if (outbox.length && !confirm(`Ci sono ${outbox.length} modifiche fatte offline non ancora inviate: il ripristino le annulla. Continuare?`)) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const r = await api('POST', '/api/data', JSON.parse(ev.target.result));
      outbox = [];
      forget('sp_outbox');
      loaded = false;
      await reload();
      toast(`Backup ripristinato (${r.count} elementi)`);
    } catch (err) {
      toast('Ripristino non riuscito: ' + (err instanceof SyntaxError ? 'file non valido' : isNetwork(err) ? 'serve la connessione a internet' : err.message), 'error');
    }
  };
  reader.readAsText(file);
}

// ---------- Installazione PWA ----------
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// iPadOS reports itself as a Mac: touch points tell them apart.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const deviceOs = isIOS ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop';
let installPrompt;

// Android/desktop Chrome and Edge offer a native prompt; iOS only allows Share > Add to Home Screen, so we explain it.
function maybeInstallBanner() {
  let off;
  try { off = localStorage.getItem('sp_install_off'); } catch {}
  if (isStandalone || off || (!installPrompt && !isIOS) || $('ob-modal').classList.contains('open')) return; // guided setup offers install at its last step
  $('ib-sub').innerHTML = installPrompt ? "Si apre a schermo intero, come un'app." : 'Tocca <i class="ph ph-export"></i> Condividi, poi "Aggiungi a Home".';
  $('ib-action').innerHTML = installPrompt ? '<i class="ph ph-download-simple"></i>Installa' : 'Come fare';
  $('install-banner').hidden = false;
}
function dismissInstall() {
  $('install-banner').hidden = true;
  try { localStorage.setItem('sp_install_off', '1'); } catch {}
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = false; });
  if (loaded) maybeInstallBanner();
});
window.addEventListener('appinstalled', () => {
  $('install-banner').hidden = true;
  toast('Salone PRO installata');
});
async function installApp() {
  if (!installPrompt) return openInstallGuide();
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = true; });
  if (outcome === 'accepted') $('install-banner').hidden = true;
}
function openInstallGuide() {
  document.querySelectorAll('#install-modal details').forEach((d) => { d.open = d.dataset.os === deviceOs; });
  openModal('install-modal');
}
if (isStandalone) $('install-status').textContent = "L'app è già installata su questo dispositivo.";

// ---------- Actions (data-click & co. in index.html and in the templates above, see common.js) ----------
Object.assign(actions.click, {
  signClientGdprInSalon, printPaperGdprForm, saveConfig, openOnboarding, saveClosures, exportBackup, installApp, openInstallGuide, dismissInstall,
  copyLink: (el) => copyLink(el.dataset.arg), // no data-arg: the booking page link
  addRange: (el) => addRange(el.dataset.arg),
  removeRange: (el) => el.closest('.range').remove(),
  obGo: (el) => obGo(Number(el.dataset.arg)),
  obSkip: () => obFinish(true),
});
actions.change.importBackup = (el, e) => importBackup(e);
