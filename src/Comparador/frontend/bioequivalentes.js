const $ = (selector) => document.querySelector(selector);
const COMMUNES = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta'],
};
const PHARMACY_LOGOS = {
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
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
};

let catalog = [];
let searchIndex = [];
let suggestions = [];
let activeSuggestion = -1;
let selectedProduct = null;

function imageUrl(product) {
  return safeUrl(product.image || product.image_url || product.imagen || '');
}

function closeSuggestions() {
  const list = $('#bio-suggestions');
  list.hidden = true;
  list.replaceChildren();
  suggestions = [];
  activeSuggestion = -1;
  $('#bio-query').setAttribute('aria-expanded', 'false');
}

function chooseSuggestion(index) {
  const product = suggestions[index];
  if (!product) return;
  selectedProduct = product;
  $('#bio-query').value = product.name;
  closeSuggestions();
}

function refreshSuggestions(query) {
  if (!selectedProduct || normalize(selectedProduct.name) !== normalize(query)) selectedProduct = null;
  const terms = normalize(query).split(' ').filter((term) => term.length > 1);
  if (!terms.length) { closeSuggestions(); return; }
  const seen = new Set();
  suggestions = searchIndex.filter((entry) => terms.every((term) => entry.text.includes(term)))
    .map((entry) => entry.product)
    .filter((product) => {
      const key = normalize(`${product.name}|${product.brand || ''}|${product.active_ingredient || ''}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  const list = $('#bio-suggestions');
  list.replaceChildren();
  if (!suggestions.length) {
    const empty = document.createElement('span');
    empty.className = 'tool-suggestion-empty';
    empty.textContent = 'Sin coincidencias. Prueba con una marca o principio activo.';
    list.appendChild(empty);
  } else {
    suggestions.forEach((product, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'option';
      button.className = 'tool-suggestion-option';
      button.dataset.index = index;
      const image = document.createElement('span');
      image.className = 'tool-suggestion-image';
      const source = imageUrl(product);
      if (source) {
        const img = document.createElement('img');
        img.src = source;
        img.alt = '';
        img.loading = 'lazy';
        image.appendChild(img);
      } else image.textContent = 'Rx';
      const copy = document.createElement('span');
      copy.className = 'tool-suggestion-copy';
      const title = document.createElement('b');
      title.textContent = product.name;
      const detail = document.createElement('small');
      detail.textContent = [product.brand, product.active_ingredient].filter(Boolean).join(' · ') || 'Información no disponible';
      copy.append(title, detail);
      const price = document.createElement('strong');
      price.textContent = money(product.price);
      button.append(image, copy, price);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        chooseSuggestion(index);
      });
      list.appendChild(button);
    });
  }
  list.hidden = false;
  $('#bio-query').setAttribute('aria-expanded', 'true');
}

function moveSuggestion(direction) {
  if (!suggestions.length) return;
  activeSuggestion = (activeSuggestion + direction + suggestions.length) % suggestions.length;
  $('#bio-suggestions').querySelectorAll('button').forEach((button, index) => {
    const active = index === activeSuggestion;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
}

async function loadCatalog() {
  const manifest = await fetch('./data/manifest.json',{cache:'no-store'}).then((response) => response.json());
  const entry = manifest.locations[`${$('#bio-region').value}|${$('#bio-commune').value}`];
  if (!entry) throw new Error('No hay catálogo');
  catalog = await fetch(`./data/${entry.file}`).then((response) => response.json());
  searchIndex = catalog.map((product) => ({
    product,
    text: normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`),
  }));
  selectedProduct = null;
  closeSuggestions();
}

function updateCommunes() {
  const select = $('#bio-commune');
  select.replaceChildren();
  (COMMUNES[$('#bio-region').value] || []).forEach((value) => select.add(new Option(value, value)));
  return loadCatalog();
}

function render(query) {
  const terms = normalize(query).split(' ').filter((term) => term.length > 1);
  const matches = catalog.filter((product) => product.available !== false
    && terms.every((term) => normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`).includes(term)));
  const baseline = Math.max(0, ...matches.map((product) => Number(product.price) || 0));
  const seen = new Set();
  const bio = matches.filter((product) => product.bioequivalent).filter((product) => {
    const key = `${product.pharmacy}|${product.sku || product.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.price - right.price).slice(0, 80);
  const status = $('#bio-status');
  const content = $('#bio-content');
  const container = $('#bio-results');
  if (!bio.length) {
    content.hidden = true;
    status.hidden = false;
    status.textContent = 'No encontramos alternativas informadas como bioequivalentes para esta presentación y ubicación.';
    return;
  }
  status.hidden = true;
  content.hidden = false;
  $('#bio-title').textContent = `Alternativas para “${query}”`;
  $('#bio-count').textContent = `${bio.length} producto${bio.length === 1 ? '' : 's'} con bioequivalencia informada`;
  container.replaceChildren();
  bio.forEach((product, index) => {
    const saving = Math.max(0, baseline - product.price);
    const url = safeUrl(product.url);
    const logo = PHARMACY_LOGOS[product.pharmacy];
    const logoOnly = ['Ahumada', 'Farmacia Municipal Iquique'].includes(product.pharmacy);
    const card = document.createElement('article');
    card.className = `bio-card${index === 0 ? ' best' : ''}`;
    card.innerHTML = `<span class="bio-pharmacy${logoOnly ? ' logo-only' : ''}">${logo ? `<img src="${logo}" alt="Logo ${escapeHtml(product.pharmacy)}" loading="lazy">` : ''}${logoOnly ? '' : `<b>${escapeHtml(product.pharmacy)}</b>`}</span>
      ${index === 0 ? '<span class="saving">Mejor precio informado</span>' : ''}
      <h3>${escapeHtml(product.name)}</h3>
      <small><b>Principio activo:</b> ${escapeHtml(product.active_ingredient || 'No informado')}<br><b>Marca:</b> ${escapeHtml(product.brand || 'No informada')}</small>
      <span class="product-badge bioequivalent">B Bioequivalencia informada</span>
      <span class="price">${money(product.price)}</span>
      ${saving ? `<span class="saving">Ahorro potencial ${money(saving)}</span>` : ''}
      <small>${product.stock_quantity != null ? `${product.stock_quantity} unidades informadas` : product.available ? 'Stock informado como disponible' : 'Disponibilidad por confirmar'} · Actualizado ${product.captured_at ? new Date(product.captured_at).toLocaleDateString('es-CL') : 'en fecha desconocida'}</small>
      ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">Ver en farmacia →</a>` : ''}`;
    container.appendChild(card);
  });
}

$('#bio-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = $('#bio-query').value.trim();
  if (!selectedProduct || normalize(selectedProduct.name) !== normalize(query)) {
    $('#bio-status').hidden = false;
    $('#bio-status').textContent = 'Selecciona una sugerencia real del catálogo antes de comparar.';
    $('#bio-query').focus();
    return;
  }
  closeSuggestions();
  render(query);
});
$('#bio-query').addEventListener('input', (event) => refreshSuggestions(event.target.value));
$('#bio-query').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(-1); }
  else if (event.key === 'Enter' && activeSuggestion >= 0) { event.preventDefault(); chooseSuggestion(activeSuggestion); }
  else if (event.key === 'Escape') closeSuggestions();
});
document.addEventListener('mousedown', (event) => {
  if (!event.target.closest('.tool-search-wrap')) closeSuggestions();
});
$('#bio-region').addEventListener('change', () => updateCommunes().catch(() => {}));
$('#bio-commune').addEventListener('change', () => loadCatalog().catch(() => {}));
updateCommunes().catch(() => { $('#bio-status').textContent = 'No fue posible cargar el catálogo.'; });
