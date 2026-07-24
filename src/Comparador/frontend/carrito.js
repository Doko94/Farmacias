const $ = (selector) => document.querySelector(selector);
const COMMUNES = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta'],
};
const LOGOS = {
  Ahumada: 'https://www.farmaciasahumada.cl/on/demandware.static/Sites-ahumada-cl-Site/-/default/dw8f7ce49d/images/logo.svg',
  'Cruz Verde': 'https://www.cruzverde.cl/assets/favicon/favicon-32x32.png',
  Salcobrand: 'https://static.salcobrand.cl/assets/logo-73fe73eb9cf65adf981684077f38a616190d7759b74439763a45b9b985fc36e5.svg',
  'Dr. Simi': 'https://farmaciasdeldrsimicl.vtexassets.com/assets/vtex.file-manager-graphql/images/35ac1c04-2540-45f1-9996-346729464da8___7af9fc3d4ed0be2760b1bddf801da897.png',
  'Farmacia Municipal Iquique': 'https://prciquique.cl/wp-content/uploads/2021/09/iqq.png',
};
const money = (value) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(value || 0);
const normalize = (value = '') => value.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

let catalog = [];
let cart = [];
let suggestions = [];
let activeSuggestion = -1;

async function loadCatalog() {
  const manifest = await fetch('./data/manifest.json').then((response) => response.json());
  const entry = manifest.locations[`${$('#cart-region').value}|${$('#cart-commune').value}`];
  if (!entry) throw new Error('Sin catálogo');
  catalog = await fetch(`./data/${entry.file}`).then((response) => response.json());
  closeSuggestions();
}

async function updateCommunes() {
  const select = $('#cart-commune');
  select.innerHTML = '';
  (COMMUNES[$('#cart-region').value] || []).forEach((value) => select.add(new Option(value, value)));
  try { await loadCatalog(); } catch { showStatus('No fue posible cargar el catálogo para esta ubicación.'); }
}

function closeSuggestions() {
  const list = $('#cart-suggestions');
  list.hidden = true;
  list.innerHTML = '';
  suggestions = [];
  activeSuggestion = -1;
  $('#cart-query').setAttribute('aria-expanded', 'false');
}

function selectSuggestion(index) {
  const product = suggestions[index];
  if (!product) return;
  $('#cart-query').value = product.name;
  closeSuggestions();
  $('#cart-quantity').focus();
}

function refreshSuggestions(query) {
  const terms = normalize(query).split(' ').filter((term) => term.length > 1);
  const list = $('#cart-suggestions');
  if (!terms.length) { closeSuggestions(); return; }
  const found = catalog.filter((product) => terms.every((term) => (
    normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`).includes(term)
  ))).sort((left, right) => (
    Number(right.available === true) - Number(left.available === true)
    || Number(left.price || Infinity) - Number(right.price || Infinity)
  ));
  suggestions = [...new Map(found.map((product) => [
    normalize(`${product.name}|${product.brand || ''}|${product.active_ingredient || ''}`), product,
  ])).values()].slice(0, 10);
  activeSuggestion = -1;
  if (!suggestions.length) {
    list.innerHTML = '<span class="cart-suggestion-empty">Sin coincidencias. Puedes agregar igualmente esta búsqueda.</span>';
  } else {
    list.innerHTML = suggestions.map((product, index) => `
      <button type="button" role="option" data-index="${index}" aria-selected="false">
        <b>${escape(product.name)}</b>
        <span>${escape(product.brand || 'Marca no informada')}${product.active_ingredient ? ` · Principio activo: ${escape(product.active_ingredient)}` : ''}</span>
        <small>${product.available === false ? 'Sin stock' : product.available === true ? money(product.price) : 'Stock desconocido'} · ${escape(product.pharmacy)}</small>
      </button>`).join('');
    list.querySelectorAll('button').forEach((button) => button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectSuggestion(Number(button.dataset.index));
    }));
  }
  list.hidden = false;
  $('#cart-query').setAttribute('aria-expanded', 'true');
}

function moveSuggestion(direction) {
  if (!suggestions.length) return;
  activeSuggestion = (activeSuggestion + direction + suggestions.length) % suggestions.length;
  $('#cart-suggestions').querySelectorAll('button').forEach((button, index) => {
    const active = index === activeSuggestion;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
}

function showStatus(message) {
  const status = $('#cart-status');
  status.hidden = false;
  status.textContent = message;
}

function renderCart() {
  const container = $('#cart-items');
  container.innerHTML = '';
  if (!cart.length) container.innerHTML = '<div class="cart-empty"><span aria-hidden="true">🛒</span><b>Tu carrito está vacío</b><small>Busca un producto arriba y presiona “Agregar”.</small></div>';
  cart.forEach((item, index) => {
    const row = document.createElement('article');
    row.innerHTML = `<div><b>${escape(item.query)}</b><span>Cantidad: ${item.quantity}</span></div>
      <button type="button" aria-label="Eliminar ${escape(item.query)}">×</button>`;
    row.querySelector('button').addEventListener('click', () => {
      cart.splice(index, 1);
      renderCart();
    });
    container.appendChild(row);
  });
  $('#compare-cart').disabled = !cart.length;
  $('#cart-clear').disabled = !cart.length;
  $('#cart-results').hidden = true;
  document.querySelector('.cart-strategy-table')?.remove();
}

function cartSignature(value = '') {
  const text = normalize(value);
  const doses = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|%)/g)].map((match) => {
    let amount = Number(match[1].replace(',', '.'));
    let unit = match[2];
    if (unit === 'g') { amount *= 1000; unit = 'mg'; }
    if (unit === 'ug') unit = 'mcg';
    return `${amount}|${unit}`;
  });
  const aliases = {
    comprimidos: 'comprimido', comprimido: 'comprimido',
    tabletas: 'tableta', tableta: 'tableta',
    capsulas: 'capsula', capsula: 'capsula',
    sobres: 'sobre', sobre: 'sobre',
    jarabe: 'jarabe', gotas: 'gotas', crema: 'crema',
  };
  const forms = [...text.matchAll(/\b(comprimidos?|tabletas?|capsulas?|sobres?|jarabe|gotas|crema)\b/g)]
    .map((match) => aliases[match[1]] || match[1]);
  const packageMatch = text.match(/\b(\d+)\s*(comprimidos?|tabletas?|capsulas?|sobres?|dosis|unidades?)\b/);
  return {
    doses,
    forms,
    package: packageMatch ? `${packageMatch[1]}|${aliases[packageMatch[2]] || packageMatch[2]}` : null,
  };
}

function directMatches(query) {
  const structural = new Set([
    'mg', 'mcg', 'g', 'ml', 'comprimido', 'comprimidos', 'tableta', 'tabletas',
    'capsula', 'capsulas', 'jarabe', 'gotas', 'crema', 'sobre', 'sobres',
  ]);
  const terms = normalize(query).split(' ').filter((term) => (
    term.length > 1 && !/^\d/.test(term) && !structural.has(term)
  ));
  const requested = cartSignature(query);
  return catalog.filter((product) => product.available === true && Number(product.price) > 0)
    .filter((product) => {
      const searchable = normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`);
      const offered = cartSignature(product.name);
      return terms.every((term) => searchable.includes(term))
        && requested.doses.every((dose) => offered.doses.includes(dose))
        && (!requested.forms.length || requested.forms.some((form) => offered.forms.includes(form)))
        && (!requested.package || requested.package === offered.package);
    });
}

function eligibleOffers(item) {
  const direct = directMatches(item.query);
  if (!$('#cart-bio').checked) return direct;
  const ingredients = new Set(direct.map((product) => normalize(product.active_ingredient)).filter(Boolean));
  if (!ingredients.size) return direct;
  const requested = cartSignature(item.query);
  const alternatives = catalog.filter((product) => (
    product.available === true
    && product.bioequivalent
    && ingredients.has(normalize(product.active_ingredient))
  )).filter((product) => {
    const offered = cartSignature(product.name);
    return requested.doses.every((dose) => offered.doses.includes(dose))
      && (!requested.forms.length || requested.forms.some((form) => offered.forms.includes(form)));
  });
  return [...new Map([...direct, ...alternatives].map((product) => [
    `${product.pharmacy}|${product.sku || product.name}`, product,
  ])).values()];
}

function pharmacyHeader(pharmacy) {
  const logo = LOGOS[pharmacy];
  const logoOnly = ['Ahumada', 'Farmacia Municipal Iquique'].includes(pharmacy);
  return `<span class="cart-pharmacy${logoOnly ? ' logo-only' : ''}">
    ${logo ? `<img src="${logo}" alt="Logo ${escape(pharmacy)}" loading="lazy">` : ''}
    ${logoOnly ? '' : `<b>${escape(pharmacy)}</b>`}
  </span>`;
}

function compare() {
  const resolved = cart.map((item) => ({ item, offers: eligibleOffers(item) }));
  const unmatched = resolved.filter((entry) => !entry.offers.length);
  const shippingEnabled = $('#cart-shipping').checked;
  const shippingUnit = shippingEnabled ? Number($('#cart-shipping-cost').value) : 0;
  if (!Number.isFinite(shippingUnit) || shippingUnit < 0 || shippingUnit > 30000) {
    showStatus('El despacho estimado debe estar entre $0 y $30.000 por farmacia.');
    return;
  }
  const pharmacies = [...new Set(catalog.map((product) => product.pharmacy))];
  const totals = pharmacies.map((pharmacy) => {
    const lines = [];
    resolved.forEach((entry) => {
      const offer = entry.offers.filter((product) => product.pharmacy === pharmacy)
        .sort((left, right) => left.price - right.price)[0];
      if (offer) lines.push({
        item: entry.item, offer, subtotal: offer.price * entry.item.quantity,
      });
    });
    const medicines = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const shipping = lines.length ? shippingUnit : 0;
    return {
      pharmacy, lines, medicines, shipping,
      complete: lines.length === cart.length,
      total: medicines + shipping,
    };
  }).filter((result) => result.lines.length)
    .sort((left, right) => Number(right.complete) - Number(left.complete) || left.total - right.total);

  const splitLines = resolved.filter((entry) => entry.offers.length).map((entry) => {
    const offer = [...entry.offers].sort((left, right) => left.price - right.price)[0];
    return { item: entry.item, offer, subtotal: offer.price * entry.item.quantity };
  });
  const splitMedicines = splitLines.reduce((sum, line) => sum + line.subtotal, 0);
  const splitPharmacies = new Set(splitLines.map((line) => line.offer.pharmacy)).size;
  const splitShipping = shippingUnit * splitPharmacies;
  const splitTotal = splitMedicines + splitShipping;
  const single = totals.find((result) => result.complete);
  const saving = single ? single.total - splitTotal : 0;
  renderResults({
    unmatched, totals, splitLines, splitMedicines, splitShipping, splitTotal, single, saving,
  });
}

function linesHtml(lines) {
  return lines.map((line) => `<li><div><b>${escape(line.offer.name)}</b>
    <small>${line.item.quantity} × ${money(line.offer.price)}${line.offer.bioequivalent ? ' · Bioequivalente' : ''}</small>
    </div><strong>${money(line.subtotal)}</strong></li>`).join('');
}

function renderResults(data) {
  $('#cart-status').hidden = true;
  const section = $('#cart-results');
  const recommendations = $('#cart-recommendations');
  section.hidden = false;
  $('#cart-summary').textContent = data.single
    ? `Comparamos ${data.totals.length} farmacias para ${cart.length} productos.`
    : 'Ninguna farmacia reúne todavía todos los productos de la lista.';
  recommendations.innerHTML = '';
  document.querySelector('.cart-strategy-table')?.remove();

  if (data.single) {
    const card = document.createElement('article');
    card.className = 'recommendation-card best';
    card.innerHTML = `<span class="recommendation-label">MEJOR FARMACIA ÚNICA</span>
      ${pharmacyHeader(data.single.pharmacy)}<ul>${linesHtml(data.single.lines)}</ul>
      <div class="recommendation-total"><span>Total estimado</span><strong>${money(data.single.total)}</strong></div>`;
    recommendations.appendChild(card);
  }
  if (data.splitLines.length) {
    const pharmacies = new Set(data.splitLines.map((line) => line.offer.pharmacy));
    const card = document.createElement('article');
    card.className = 'recommendation-card';
    card.innerHTML = `<span class="recommendation-label">COMPRA DIVIDIDA</span>
      <h3>${pharmacies.size} farmacia${pharmacies.size === 1 ? '' : 's'}</h3>
      <ul>${linesHtml(data.splitLines)}</ul>
      <div class="recommendation-total"><span>Total estimado${data.saving > 0 ? ` · Ahorro ${money(data.saving)}` : data.saving < 0 ? ` · Cuesta ${money(Math.abs(data.saving))} más` : ''}</span>
      <strong>${money(data.splitTotal)}</strong></div>`;
    recommendations.appendChild(card);
  }

  const bestSingle = data.single || data.totals[0];
  const strategy = document.createElement('div');
  strategy.className = 'cart-strategy-table';
  strategy.innerHTML = `<p><b>Cómo leer esta comparación:</b> “Medicamentos” es el valor de los productos. El despacho es una estimación por farmacia y solo se suma cuando activas esa opción.</p>
    <div class="table-wrap"><table><thead><tr><th>Estrategia</th><th>Productos cubiertos</th><th>Medicamentos</th><th>Despacho</th><th>Total</th></tr></thead><tbody>
    ${bestSingle ? `<tr><td>Una farmacia${bestSingle.complete ? '' : ' (incompleta)'}</td><td>${bestSingle.lines.length}/${cart.length}</td><td>${money(bestSingle.medicines)}</td><td>${money(bestSingle.shipping)}</td><td><b>${money(bestSingle.total)}</b></td></tr>` : ''}
    <tr><td>Compra dividida</td><td>${data.splitLines.length}/${cart.length}</td><td>${money(data.splitMedicines)}</td><td>${money(data.splitShipping)}</td><td><b>${money(data.splitTotal)}</b></td></tr>
    </tbody></table></div>`;
  recommendations.after(strategy);

  const totals = $('#pharmacy-totals');
  totals.innerHTML = '';
  data.totals.forEach((result) => {
    const card = document.createElement('article');
    card.innerHTML = `${pharmacyHeader(result.pharmacy)}<strong>${money(result.total)}</strong>
      <span>${result.lines.length} de ${cart.length} productos encontrados</span>
      <i style="--coverage:${result.lines.length * 100 / cart.length}%"></i>
      ${result.complete ? '<b>Carrito completo</b>' : '<small>Carrito incompleto</small>'}`;
    totals.appendChild(card);
  });
  const warning = $('#unmatched-products');
  warning.hidden = !data.unmatched.length;
  if (data.unmatched.length) {
    warning.innerHTML = `<b>Productos sin coincidencia con stock confirmado:</b> ${data.unmatched.map((entry) => escape(entry.item.query)).join(', ')}. Prueba especificando concentración o presentación.`;
  }
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#cart-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = $('#cart-query').value.replace(/\s+/g, ' ').trim();
  const quantity = Number($('#cart-quantity').value);
  if (query.length < 2 || query.length > 120) {
    showStatus('Ingresa un producto válido de 2 a 120 caracteres.');
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    showStatus('La cantidad debe ser un número entero entre 1 y 50.');
    $('#cart-quantity').focus();
    return;
  }
  const existing = cart.find((item) => normalize(item.query) === normalize(query));
  if (existing) existing.quantity = Math.min(50, existing.quantity + quantity);
  else cart.push({ query, quantity });
  $('#cart-status').hidden = true;
  $('#cart-query').value = '';
  $('#cart-quantity').value = 1;
  closeSuggestions();
  renderCart();
  $('#cart-query').focus();
});

$('#cart-query').addEventListener('input', (event) => refreshSuggestions(event.target.value));
$('#cart-query').addEventListener('focus', (event) => refreshSuggestions(event.target.value));
$('#cart-query').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(-1); }
  else if (event.key === 'Enter' && activeSuggestion >= 0) { event.preventDefault(); selectSuggestion(activeSuggestion); }
  else if (event.key === 'Escape') closeSuggestions();
});
document.addEventListener('mousedown', (event) => {
  if (!event.target.closest('.cart-search-wrap')) closeSuggestions();
});
$('#cart-clear').addEventListener('click', () => {
  if (!cart.length) return;
  cart = [];
  renderCart();
});
$('#compare-cart').addEventListener('click', compare);
$('#cart-bio').addEventListener('change', () => {
  if (cart.length && !$('#cart-results').hidden) compare();
});
$('#cart-region').addEventListener('change', async () => {
  await updateCommunes();
  renderCart();
});
$('#cart-commune').addEventListener('change', async () => {
  try { await loadCatalog(); } catch { showStatus('No fue posible cargar el catálogo.'); }
  renderCart();
});

if (!$('#cart-shipping')) {
const shippingControls = document.createElement('div');
shippingControls.className = 'cart-shipping-controls';
shippingControls.innerHTML = `<label><input id="cart-shipping" type="checkbox"> Incluir despacho estimado</label>
  <label>Costo por farmacia <input id="cart-shipping-cost" type="number" min="0" max="30000" step="100" value="3990"></label>
  <small>En una compra dividida se suma un despacho por farmacia. Déjalo desactivado si retirarás presencialmente.</small>`;
document.querySelector('.cart-location').appendChild(shippingControls);
}
renderCart();
updateCommunes();
