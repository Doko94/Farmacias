const $ = (selector) => document.querySelector(selector);
const API_BASE = localStorage.getItem('farma_api')
  || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8000' : '');
const COMMUNES = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta'],
};
const money = (value) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(value || 0);
const normalize = (value = '') => value.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
};
const debounce = (callback, delay = 180) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
};

let catalog = [];
let searchIndex = [];
let offers = [];
let suggestions = [];
let selectedProduct = null;
let activeSuggestion = -1;

function imageUrl(product) {
  return safeUrl(product.image || product.image_url || product.imagen || '');
}

function closeSuggestions() {
  const list = $('#history-suggestions');
  list.hidden = true;
  list.replaceChildren();
  suggestions = [];
  activeSuggestion = -1;
  $('#history-query').setAttribute('aria-expanded', 'false');
}

function chooseSuggestion(index) {
  const product = suggestions[index];
  if (!product) return;
  selectedProduct = product;
  $('#history-query').value = product.name;
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
  const list = $('#history-suggestions');
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
      const visual = document.createElement('span');
      visual.className = 'tool-suggestion-image';
      const source = imageUrl(product);
      if (source) {
        const image = document.createElement('img');
        image.src = source;
        image.alt = '';
        image.loading = 'lazy';
        visual.appendChild(image);
      } else visual.textContent = 'Rx';
      const copy = document.createElement('span');
      copy.className = 'tool-suggestion-copy';
      const title = document.createElement('b');
      title.textContent = product.name;
      const detail = document.createElement('small');
      detail.textContent = `${product.pharmacy} · ${product.brand || product.active_ingredient || 'Información no disponible'}`;
      copy.append(title, detail);
      const price = document.createElement('strong');
      price.textContent = money(product.price);
      button.append(visual, copy, price);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        chooseSuggestion(index);
      });
      list.appendChild(button);
    });
  }
  list.hidden = false;
  $('#history-query').setAttribute('aria-expanded', 'true');
}
const debouncedSuggestions = debounce(refreshSuggestions);

function moveSuggestion(direction) {
  if (!suggestions.length) return;
  activeSuggestion = (activeSuggestion + direction + suggestions.length) % suggestions.length;
  $('#history-suggestions').querySelectorAll('button').forEach((button, index) => {
    const active = index === activeSuggestion;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
}

async function loadCatalog() {
  const manifest = await fetch('./data/manifest.json',{cache:'no-store'}).then((response) => response.json());
  const region = $('#history-region').value;
  const commune = $('#history-commune').value;
  const entry = manifest.locations[`${region}|${commune}`];
  if (!entry) throw new Error('No hay catálogo para esta ubicación');
  catalog = await fetch(`./data/${entry.file}`).then((response) => response.json());
  searchIndex = catalog.map((product) => ({
    product,
    text: normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`),
  }));
  selectedProduct = null;
  closeSuggestions();
}

function updateCommunes() {
  const select = $('#history-commune');
  select.replaceChildren();
  (COMMUNES[$('#history-region').value] || []).forEach((value) => select.add(new Option(value, value)));
  return loadCatalog();
}

function findOffers(product) {
  const exactName = normalize(product.name);
  return catalog.filter((candidate) => normalize(candidate.name) === exactName)
    .sort((left, right) => Number(right.available) - Number(left.available) || left.price - right.price)
    .slice(0, 60);
}

async function getPoints(offer) {
  if (API_BASE) {
    try {
      const url = `${API_BASE}/api/history/${encodeURIComponent(offer.pharmacy)}/${encodeURIComponent(offer.sku)}?region=${encodeURIComponent($('#history-region').value)}&commune=${encodeURIComponent($('#history-commune').value)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (data.points?.length) return data.points;
    } catch {}
  }
  return [{ price: offer.price, captured_at: offer.captured_at || new Date().toISOString() }];
}

function draw(points) {
  const svg = $('#price-chart');
  const width = 760;
  const height = 320;
  const pad = { x: 58, y: 42 };
  const prices = points.map((point) => Number(point.price));
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (min === max) { min *= .92; max *= 1.08; }
  const x = (index) => points.length === 1 ? width / 2 : pad.x + index * (width - pad.x * 2) / (points.length - 1);
  const y = (value) => height - pad.y - (value - min) * (height - pad.y * 2) / (max - min);
  const coords = points.map((point, index) => `${x(index)},${y(Number(point.price))}`).join(' ');
  const area = points.length > 1 ? `${pad.x},${height - pad.y} ${coords} ${width - pad.x},${height - pad.y}` : '';
  const grid = [0, .5, 1].map((ratio) => {
    const yy = pad.y + ratio * (height - pad.y * 2);
    return `<line class="chart-axis" x1="${pad.x}" y1="${yy}" x2="${width - pad.x}" y2="${yy}"/><text x="8" y="${yy + 4}" fill="#466b77" font-size="11">${money(max - ratio * (max - min))}</text>`;
  }).join('');
  const dots = points.map((point, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(Number(point.price))}" r="6"><title>${money(point.price)} · ${new Date(point.captured_at).toLocaleDateString('es-CL')}</title></circle>`).join('');
  const firstDate = new Date(points[0].captured_at).toLocaleDateString('es-CL');
  const lastDate = new Date(points.at(-1).captured_at).toLocaleDateString('es-CL');
  const dates = points.length === 1
    ? `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" fill="#466b77" font-size="11">${firstDate}</text>`
    : `<text x="${pad.x}" y="${height - 10}" fill="#466b77" font-size="11">${firstDate}</text><text x="${width - pad.x}" y="${height - 10}" text-anchor="end" fill="#466b77" font-size="11">${lastDate}</text>`;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13A797" stop-opacity=".28"/><stop offset="1" stop-color="#13A797" stop-opacity=".02"/></linearGradient></defs>${grid}${area ? `<polygon class="chart-area" points="${area}"/>` : ''}${points.length > 1 ? `<polyline class="chart-line" points="${coords}"/>` : ''}${dots}${dates}`;
}

function renderRecords(points, offer) {
  const body = $('#history-records');
  body.replaceChildren();
  const labels = ['Fecha y hora', 'Farmacia', 'Precio', 'Oferta', 'Stock'];
  [...points].reverse().forEach((point) => {
    const row = document.createElement('tr');
    [
      new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(point.captured_at)),
      offer.pharmacy,
      money(point.price),
      offer.list_price > offer.price ? 'Sí' : 'No identificado',
      offer.available === true ? 'Disponible' : offer.available === false ? 'Sin stock' : 'Desconocido',
    ].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.dataset.label = labels[index];
      cell.textContent = value;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

async function renderOffer(index) {
  const offer = offers[index];
  const points = (await getPoints(offer)).sort((left, right) => String(left.captured_at).localeCompare(String(right.captured_at)));
  draw(points);
  const prices = points.map((point) => Number(point.price));
  const previous = prices.length > 1 ? prices.at(-2) : null;
  const last = prices.at(-1);
  const change = previous ? Math.round((last - previous) * 1000 / previous) / 10 : 0;
  $('#history-title').textContent = `${offer.name} · ${offer.pharmacy}`;
  $('#history-current').textContent = money(last);
  $('#history-min').textContent = money(Math.min(...prices));
  $('#history-max').textContent = money(Math.max(...prices));
  $('#history-change').textContent = previous ? `${change > 0 ? '+' : ''}${change}%` : '—';
  $('#history-count').textContent = points.length;
  const verified = points.at(-1)?.captured_at
    ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(points.at(-1).captured_at))
    : 'fecha desconocida';
  $('#history-note').textContent = `Última verificación: ${verified}. ${points.length < 2 ? 'Sólo existe una captura; se incorporarán tendencias con nuevas actualizaciones.' : 'Se compara el precio más reciente con el inmediatamente anterior.'}`;
  renderRecords(points, offer);
}

$('#history-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedProduct || normalize(selectedProduct.name) !== normalize($('#history-query').value)) {
    $('#history-content').hidden = true;
    $('#history-status').hidden = false;
    $('#history-status').textContent = 'Selecciona una sugerencia real del catálogo para consultar su historial.';
    $('#history-query').focus();
    return;
  }
  offers = findOffers(selectedProduct);
  if (!offers.length) {
    $('#history-content').hidden = true;
    $('#history-status').hidden = false;
    $('#history-status').textContent = 'No encontramos registros para el producto seleccionado en esta ubicación.';
    return;
  }
  const select = $('#history-offer');
  select.replaceChildren();
  offers.forEach((offer, index) => select.add(new Option(`${offer.pharmacy} · ${offer.name} · ${money(offer.price)}`, index)));
  $('#history-status').hidden = true;
  $('#history-content').hidden = false;
  closeSuggestions();
  await renderOffer(0);
});
$('#history-offer').addEventListener('change', (event) => renderOffer(Number(event.target.value)));
$('#history-region').addEventListener('change', updateCommunes);
$('#history-commune').addEventListener('change', loadCatalog);
$('#history-query').addEventListener('input', (event) => debouncedSuggestions(event.target.value));
$('#history-query').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(-1); }
  else if (event.key === 'Enter' && activeSuggestion >= 0) { event.preventDefault(); chooseSuggestion(activeSuggestion); }
  else if (event.key === 'Escape') closeSuggestions();
});
document.addEventListener('mousedown', (event) => {
  if (!event.target.closest('.tool-search-wrap')) closeSuggestions();
});
updateCommunes().catch(() => {
  $('#history-status').textContent = 'No fue posible cargar el catálogo.';
});
