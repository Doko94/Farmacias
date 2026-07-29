const $ = (selector) => document.querySelector(selector);
const COMMUNES = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta'],
};
const money = (value) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(value || 0);
const number = (value) => new Intl.NumberFormat('es-CL').format(value || 0);
const normalize = (value = '') => value.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
let catalog = [];

async function fetchJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function dashboardState(title, detail, retry = false) {
  const status = $('#dashboard-status');
  status.hidden = false;
  status.setAttribute('role', retry ? 'alert' : 'status');
  status.innerHTML = `<b>${escape(title)}</b><span>${escape(detail)}</span>${
    retry ? '<button id="dashboard-retry" type="button">Reintentar</button>' : ''
  }`;
  $('#dashboard-retry')?.addEventListener('click', loadCatalog);
}

async function loadCatalog() {
  const content = $('#dashboard-content');
  content.hidden = true;
  content.setAttribute('aria-busy', 'true');
  dashboardState('Cargando…', 'Consultando el catálogo disponible.');
  try {
    const manifest = await fetchJson(`./data/manifest.json?v=${Date.now()}`);
    const entry = manifest.locations[`${$('#dashboard-region').value}|${$('#dashboard-commune').value}`];
    if (!entry) {
      catalog = [];
      dashboardState('No encontramos información', 'No existe un catálogo para esta ubicación.');
      return;
    }
    catalog = await fetchJson(`./data/${entry.file}`);
    if (!catalog.length) {
      dashboardState('No encontramos información', 'El catálogo de esta ubicación está vacío.');
      return;
    }
    render();
    const latest = catalog.map((product) => product.captured_at).filter(Boolean).sort().at(-1);
    dashboardState(
      'Resultados disponibles',
      latest
        ? `Fecha de corte: ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(latest))}.`
        : 'Fecha de actualización desconocida.',
    );
    content.hidden = false;
    content.setAttribute('aria-busy', 'false');
  } catch {
    dashboardState('No pudimos conectarnos', 'Comprueba tu conexión e inténtalo nuevamente.', true);
  }
}

function updateCommunes() {
  const select = $('#dashboard-commune');
  select.innerHTML = '';
  (COMMUNES[$('#dashboard-region').value] || []).forEach((value) => select.add(new Option(value, value)));
  loadCatalog();
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function comparableKey(product) {
  const text = normalize(`${product.active_ingredient || ''} ${product.name}`);
  const doses = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|g|ml|%)/g)]
    .map((match) => `${match[1].replace(',', '.')} ${match[2]}`).join('|');
  const form = text.match(/\b(comprimidos?|capsulas?|tabletas?|jarabe|gotas|crema|gel|sobres?|dosis)\b/)?.[0] || '';
  const pack = text.match(/\b(\d+)\s*(comprimidos?|capsulas?|tabletas?|sobres?|dosis|unidades?)\b/)?.[0] || '';
  const ingredient = normalize(product.active_ingredient || product.name.split(/\d/)[0]);
  return `${ingredient}|${doses}|${form.replace(/s$/, '')}|${pack}`;
}

function comparableSavings(products) {
  const groups = new Map();
  products.filter((product) => product.available === true).forEach((product) => {
    const key = comparableKey(product);
    if (!groups.has(key)) groups.set(key, new Map());
    const byPharmacy = groups.get(key);
    const previous = byPharmacy.get(product.pharmacy);
    if (!previous || product.price < previous) byPharmacy.set(product.pharmacy, product.price);
  });
  const savings = [];
  groups.forEach((prices) => {
    const values = [...prices.values()];
    if (values.length > 1) savings.push(Math.max(...values) - Math.min(...values));
  });
  return savings;
}

function renderBars(target, items, valueFormatter = number) {
  const max = Math.max(1, ...items.map((item) => item.value));
  target.innerHTML = '';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'horizontal-row';
    row.innerHTML = `<span>${escape(item.label)}</span><div><i style="width:${Math.max(2, item.value * 100 / max)}%"></i></div><b>${valueFormatter(item.value)}</b>`;
    target.appendChild(row);
  });
}

function renderPriceBars(items) {
  const target = $('#price-chart-dashboard');
  const max = Math.max(1, ...items.map((item) => item.value));
  target.innerHTML = '';
  items.forEach((item) => {
    const column = document.createElement('div');
    column.className = 'vertical-column';
    column.innerHTML = `<b>${money(item.value)}</b><i style="height:${Math.max(8, item.value * 100 / max)}%"></i><span>${escape(item.label)}</span>`;
    target.appendChild(column);
  });
}

function render() {
  const valid = catalog.filter((product) => Number(product.price) > 0 && Number(product.price) <= 10_000_000);
  const available = valid.filter((product) => product.available === true);
  const unavailable = valid.filter((product) => product.available === false);
  const unknown = valid.filter((product) => product.available == null);
  const knownStock = available.length + unavailable.length;
  const stockPct = knownStock ? Math.round(available.length * 100 / knownStock) : 0;
  const unknownPct = valid.length ? Math.round(unknown.length * 100 / valid.length) : 0;
  const pharmacyGroups = new Map();
  valid.forEach((product) => {
    if (!pharmacyGroups.has(product.pharmacy)) pharmacyGroups.set(product.pharmacy, []);
    pharmacyGroups.get(product.pharmacy).push(product);
  });
  const coverage = [...pharmacyGroups].map(([label, products]) => ({
    label, value: products.length,
  })).sort((a, b) => b.value - a.value);
  const medians = [...pharmacyGroups].map(([label, products]) => ({
    label, value: Math.round(median(products.map((product) => Number(product.price)))),
  })).sort((a, b) => a.value - b.value);
  const savings = comparableSavings(valid);
  const averageSaving = savings.length
    ? Math.round(savings.reduce((total, value) => total + value, 0) / savings.length) : 0;
  const discounted = valid.filter((product) => (
    product.list_price > 0 && product.price < product.list_price
  )).map((product) => ({
    ...product,
    discount: Math.round((product.list_price - product.price) * 100 / product.list_price),
  })).filter((product) => product.discount > 0 && product.discount <= 100);
  const avgDiscount = discounted.length
    ? Math.round(discounted.reduce((total, product) => total + product.discount, 0) / discounted.length) : 0;

  let insights = $('#observatory-insights');
  if (!insights) {
    insights = document.createElement('div');
    insights.id = 'observatory-insights';
    insights.className = 'observatory-insights';
    insights.setAttribute('aria-label', 'Lecturas destacadas del observatorio');
    document.querySelector('.dashboard-grid').before(insights);
  }
  const now=Date.now();
  const fresh=valid.filter((product)=>{
    const captured=new Date(product.captured_at).getTime();
    return Number.isFinite(captured)&&now-captured<=6*60*60*1000;
  }).length;
  const dated=valid.filter((product)=>Number.isFinite(new Date(product.captured_at).getTime())).length;
  const topCoverage=coverage[0];
  const stockReading=knownStock
    ?`${stockPct}% de los productos con stock informado aparece disponible.`
    :'Las farmacias no informaron stock verificable para esta selección.';
  const freshnessReading=dated
    ?`${Math.round(fresh*100/dated)}% de los registros con fecha fue verificado durante las últimas 6 horas.`
    :'No hay fecha de verificación disponible para esta selección.';
  insights.replaceChildren();
  [
    ['Lectura de disponibilidad',stockReading],
    ['Frescura de los datos',freshnessReading],
    ['Mayor cobertura',topCoverage?`${topCoverage.label} reúne ${number(topCoverage.value)} precios publicados.`:'Sin cobertura disponible.'],
  ].forEach(([title,detail])=>{
    const article=document.createElement('article');
    const heading=document.createElement('b');heading.textContent=title;
    const copy=document.createElement('p');copy.textContent=detail;
    article.append(heading,copy);insights.appendChild(article);
  });

  $('#metric-offers').textContent = number(valid.length);
  $('#metric-pharmacies').textContent = `${pharmacyGroups.size} farmacias · ${number(catalog.length - valid.length)} valores descartados`;
  $('#metric-stock').textContent = `${stockPct}%`;
  $('#metric-stock-count').textContent = `${number(available.length)} con stock · ${unknownPct}% desconocido`;
  $('#metric-savings').textContent = money(averageSaving);
  $('#metric-comparables').textContent = `${number(savings.length)} presentaciones comparables`;
  $('#metric-discount').textContent = `${avgDiscount}%`;
  $('#coverage-total').textContent = `${number(valid.length)} observaciones`;
  renderBars($('#coverage-chart'), coverage);
  $('#stock-donut').style.setProperty('--stock', `${stockPct * 3.6}deg`);
  $('#stock-donut-value').textContent = `${stockPct}%`;
  $('#legend-available').textContent = number(available.length);
  $('#legend-unavailable').textContent = number(unavailable.length);
  $('#legend-unknown').textContent = number(unknown.length);
  renderPriceBars(medians);
  const latest = valid.map((product) => product.captured_at).filter(Boolean).sort().at(-1);
  $('#dashboard-updated').textContent = latest
    ? `Fecha de corte ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(latest))}` : '';
  const tbody = $('#discount-table');
  tbody.innerHTML = '';
  discounted.sort((a, b) => b.discount - a.discount || b.list_price - a.list_price).slice(0, 10).forEach((product) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escape(product.name)}</td><td>${escape(product.pharmacy)}</td><td>${money(product.price)}</td><td>${money(product.list_price)}</td><td><b>${product.discount}%</b></td>`;
    tbody.appendChild(row);
  });
}

$('#dashboard-region').addEventListener('change', updateCommunes);
$('#dashboard-commune').addEventListener('change', loadCatalog);
updateCommunes();
