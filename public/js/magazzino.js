// ---------- Magazzino ----------
function renderInventory() {
  const low = (p) => Number(p.qty) <= Number(p.min);
  const n = db.inventory.filter(low).length;
  $('inv-summary').textContent = n ? `${n} da riordinare` : 'Tutto sopra la soglia';
  $('inventory-list').innerHTML = [...db.inventory].sort((a, b) => low(b) - low(a)).map((p) => `
    <div class="row">
      <div class="row-main">
        <div class="row-title"><strong>${esc(p.name)}</strong>${low(p) ? '<span class="badge badge-danger">Da riordinare</span>' : ''}</div>
        <span class="row-sub">${esc(p.cat)}, soglia minima ${Number(p.min)}</span>
      </div>
      <div class="row-actions">
        <div class="stepper">
          <button class="btn-icon" data-click="changeQty" data-id="${p.id}" data-arg="-1" aria-label="Diminuisci"><i class="ph ph-minus"></i></button>
          <output class="num" aria-label="Quantità">${Number(p.qty)}</output>
          <button class="btn-icon" data-click="changeQty" data-id="${p.id}" data-arg="1" aria-label="Aumenta"><i class="ph ph-plus"></i></button>
        </div>
        <button class="btn-icon danger" data-click="deleteProduct" data-id="${p.id}" aria-label="Elimina ${esc(p.name)}"><i class="ph ph-trash"></i></button>
      </div>
    </div>`).join('') || empty('ph-package', 'Magazzino vuoto', 'Aggiungi tinte, ossigeni e prodotti: ti avviso quando scendono sotto la soglia.');
}

function addProduct() {
  const name = $('prd-name').value.trim();
  if (!name) return toast('Inserisci il nome del prodotto', 'error');
  const p = { id: newId(), name, cat: $('prd-cat').value, qty: Math.max(0, Number($('prd-qty').value || 0)), min: Math.max(0, Number($('prd-min').value || 1)) };
  db.inventory.push(p);
  persist('inventory', p).then((r) => r && toast('Prodotto aggiunto'));
  $('prd-name').value = '';
  renderInventory();
  renderAgenda();
}

function changeQty(id, delta) {
  const p = db.inventory.find((x) => x.id === id);
  if (!p) return;
  p.qty = Math.max(0, Number(p.qty) + delta);
  persist('inventory', p);
  renderInventory();
  renderAgenda();
}

function deleteProduct(id) {
  const p = db.inventory.find((x) => x.id === id);
  if (!p || !confirm(`Eliminare "${p.name}" dal magazzino?`)) return;
  db.inventory = db.inventory.filter((x) => x.id !== id);
  drop('inventory', id);
  renderInventory();
  renderAgenda();
}

// ---------- Actions (data-click & co. in index.html and in the templates above, see common.js) ----------
Object.assign(actions.click, {
  addProduct,
  changeQty: (el) => changeQty(Number(el.dataset.id), Number(el.dataset.arg)),
  deleteProduct: (el) => deleteProduct(Number(el.dataset.id)),
});
