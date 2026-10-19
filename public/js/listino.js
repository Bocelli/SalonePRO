// ---------- Listino ----------
// Folders (e.g. PIEGA) = the saved list in config plus any category still used by a service, so none gets lost.
const catOf = (s) => s.cat || 'ALTRO';
const folders = () => [...new Set([...(db.config.serviceFolders || []), ...db.services.map(catOf)])];
const openFolders = {};
const folderOptions = () => folders().map((f) => `<option>${esc(f)}</option>`).join('');

function renderServices() {
  const list = folders(), sel = $('srv-cat'), keep = sel.value;
  sel.innerHTML = folderOptions();
  if (list.includes(keep)) sel.value = keep;
  $('services-list').innerHTML = list.map((f, i) => {
    const items = db.services.filter((s) => catOf(s) === f);
    return `
    <div class="folder">
    <span class="folder-actions">
      <button class="btn-icon" data-click="renameFolder" data-id="${i}" aria-label="Rinomina cartella ${esc(f)}"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
      <button class="btn-icon danger" data-click="deleteFolder" data-id="${i}" aria-label="Elimina cartella ${esc(f)}"><i class="ph ph-trash" aria-hidden="true"></i></button>
    </span>
    <details data-f="${esc(f)}" ${openFolders[f] ?? true ? 'open' : ''} data-toggle="rememberFolder">
      <summary>
        <i class="ph ph-caret-right folder-caret" aria-hidden="true"></i><i class="ph ph-folder" aria-hidden="true"></i><strong>${esc(f)}</strong>
        <span class="badge badge-accent">${items.length}</span>
      </summary>
      ${items.map((s) => `
        <div class="row">
          <div class="row-main"><strong>${esc(s.name)}</strong><span class="row-sub"><i class="ph ph-clock" aria-hidden="true"></i>${Number(s.duration) || 0} min</span></div>
          <strong class="num">${euro(s.price)}</strong>
          <button class="btn-icon" data-click="editService" data-id="${s.id}" aria-label="Modifica ${esc(s.name)}"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
          <button class="btn-icon danger" data-click="deleteService" data-id="${s.id}" aria-label="Elimina ${esc(s.name)}"><i class="ph ph-trash" aria-hidden="true"></i></button>
        </div>`).join('') || '<p class="muted small folder-empty">Cartella vuota: aggiungi un servizio con il modulo qui sopra.</p>'}
    </details>
    </div>`;
  }).join('') || empty('ph-folder-plus', 'Listino vuoto', 'Crea una cartella (es. PIEGA) e aggiungi i servizi: compariranno subito nella pagina di prenotazione.');
}

function toggleFolders(open) {
  folders().forEach((f) => { openFolders[f] = open; });
  renderServices();
}

function saveFolders(list) {
  db.config.serviceFolders = [...new Set(list)];
  persist('config', { ...db.config, id: 1 });
}

function addFolder() {
  const name = (prompt('Nome della nuova cartella (es. PIEGA, SPOSA):') || '').trim().toUpperCase().slice(0, 60);
  if (!name) return;
  if (folders().some((f) => f.toUpperCase() === name)) return toast('Questa cartella esiste già', 'error');
  saveFolders([...folders(), name]);
  openFolders[name] = true;
  renderServices();
  $('srv-cat').value = name;
  toast(`Cartella ${name} creata`);
}

function renameFolder(i) {
  const old = folders()[i];
  const name = (prompt(`Nuovo nome per la cartella "${old}":`, old) || '').trim().toUpperCase().slice(0, 60);
  if (!name || name === old) return;
  if (folders().some((f, j) => j !== i && f.toUpperCase() === name)) return toast('Esiste già una cartella con questo nome', 'error');
  db.services.filter((s) => catOf(s) === old).forEach((s) => { s.cat = name; persist('services', s); });
  saveFolders(folders().map((f) => (f === old ? name : f)).filter((f) => f !== old));
  renderAll();
}

function deleteFolder(i) {
  const f = folders()[i];
  const items = db.services.filter((s) => catOf(s) === f);
  if (!confirm(items.length ? `La cartella "${f}" contiene ${items.length} servizi. Eliminare la cartella e tutti i suoi servizi?` : `Eliminare la cartella vuota "${f}"?`)) return;
  items.forEach((s) => drop('services', s.id));
  db.services = db.services.filter((s) => catOf(s) !== f);
  saveFolders(folders().filter((x) => x !== f));
  renderServices();
}

function addService() {
  const name = $('srv-name').value.trim();
  const price = Number($('srv-price').value || 0);
  const duration = Number($('srv-duration').value || 30);
  if (!name) return toast('Inserisci il nome del servizio', 'error');
  if (price < 0 || duration < 5) return toast('Controlla prezzo e durata', 'error');
  const s = { id: newId(), name, cat: $('srv-cat').value || 'ALTRO', price, duration };
  db.services.push(s);
  openFolders[s.cat] = true;
  persist('services', s).then((r) => r && toast(`Servizio aggiunto in ${s.cat}`));
  $('srv-name').value = $('srv-price').value = $('srv-duration').value = '';
  renderServices();
}

function editService(id) {
  const s = db.services.find((x) => x.id === id);
  if (!s) return;
  $('srv-edit-id').value = id;
  $('srv-edit-name').value = s.name;
  $('srv-edit-cat').innerHTML = folderOptions();
  $('srv-edit-cat').value = catOf(s);
  $('srv-edit-price').value = s.price;
  $('srv-edit-duration').value = s.duration;
  openModal('srv-modal');
}

function saveServiceEdit() {
  const s = db.services.find((x) => x.id === Number($('srv-edit-id').value));
  if (!s) return;
  const name = $('srv-edit-name').value.trim(), price = Number($('srv-edit-price').value || 0), duration = Number($('srv-edit-duration').value || 0);
  if (!name) return toast('Inserisci il nome del servizio', 'error');
  if (price < 0 || duration < 5) return toast('Controlla prezzo e durata', 'error');
  Object.assign(s, { name, cat: $('srv-edit-cat').value, price, duration });
  persist('services', s).then((r) => r && toast('Servizio aggiornato'));
  closeModal('srv-modal');
  renderServices();
}

function deleteService(id) {
  const s = db.services.find((x) => x.id === id);
  if (!s || !confirm(`Eliminare "${s.name}" dal listino?`)) return;
  db.services = db.services.filter((x) => x.id !== id);
  drop('services', id);
  renderServices();
}

// ---------- Actions (data-click & co. in index.html and in the templates above, see common.js) ----------
Object.assign(actions.click, {
  addService, addFolder, saveServiceEdit,
  toggleFolders: (el) => toggleFolders(el.dataset.arg === 'open'),
  renameFolder: (el) => renameFolder(Number(el.dataset.id)),
  deleteFolder: (el) => deleteFolder(Number(el.dataset.id)),
  editService: (el) => editService(Number(el.dataset.id)),
  deleteService: (el) => deleteService(Number(el.dataset.id)),
});
actions.toggle.rememberFolder = (el) => { openFolders[el.dataset.f] = el.open; };
