const $ = (selector) => document.querySelector(selector);
const COMMUNES = { Tarapaca: ['Iquique'], 'Arica y Parinacota': ['Arica'], Antofagasta: ['Antofagasta'] };
let catalog = [];
const normalize = (value = '') => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
const money = (value) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value || 0);

async function load() {
  const manifest = await fetch('./data/manifest.json').then((response) => response.json());
  const entry = manifest.locations[`${$('#planner-region').value}|${$('#planner-commune').value}`];
  catalog = entry ? await fetch(`./data/${entry.file}`).then((response) => response.json()) : [];
  const names = [...new Set(catalog.filter((product) => product.available !== false && product.price > 0).map((product) => product.name))].sort();
  $('#planner-products').innerHTML = names.map((name) => `<option value="${name.replace(/"/g, '&quot;')}"></option>`).join('');
}

function communes() {
  const select = $('#planner-commune');
  select.innerHTML = '';
  (COMMUNES[$('#planner-region').value] || []).forEach((value) => select.add(new Option(value, value)));
  load();
}

function packageUnits(name) {
  const patterns = [
    /\b(\d+)\s*(?:comprimidos?|tabletas?|c[aá]psulas?|sobres?|ampollas?|unidades?|dosis|parches?|[oó]vulos?)\b/i,
    /\b(?:frasco|jarabe|soluci[oó]n|suspensi[oó]n)[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*ml\b/i,
    /\b(\d+(?:[.,]\d+)?)\s*ml\b/i,
  ];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) return Number(match[1].replace(',', '.'));
  }
  return null;
}

function showError(message) {
  $('#planner-result').innerHTML = `<span>Revisa los datos ingresados</span><strong>—</strong><p>${message}</p>`;
}

$('#planner-query').addEventListener('change', () => {
  const product = catalog.find((item) => normalize(item.name) === normalize($('#planner-query').value));
  const units = product && packageUnits(product.name);
  if (units && units <= 10000) {
    $('#planner-units-pack').value = units;
    $('#planner-help').textContent = `Detectado desde: ${product.name}. Puedes corregirlo si el envase indica otra cantidad.`;
  } else {
    $('#planner-units-pack').value = '';
    $('#planner-help').textContent = 'No pudimos detectar el contenido. Ingrésalo manualmente según el envase.';
  }
});

$('#planner-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const query = normalize($('#planner-query').value);
  const terms = query.split(' ').filter(Boolean);
  const offers = catalog
    .filter((product) => product.available !== false && product.price > 0 && terms.every((term) => normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`).includes(term)))
    .sort((left, right) => left.price - right.price);
  const offer = offers[0];
  const unitsDose = Number($('#planner-units-dose').value);
  const dosesDay = Number($('#planner-doses-day').value);
  const pack = Number($('#planner-units-pack').value);
  const days = Number($('#planner-days').value);
  const valid = [unitsDose, dosesDay, pack, days].every(Number.isFinite)
    && unitsDose > 0 && unitsDose <= 100
    && dosesDay > 0 && dosesDay <= 24
    && pack > 0 && pack <= 10000
    && days >= 1 && days <= 366;
  if (!valid) { showError('Usa valores razonables: máximo 100 unidades por dosis, 24 dosis diarias, 10.000 unidades por envase y 366 días.'); return; }
  if (!offer) { showError('Selecciona una presentación disponible desde las sugerencias del catálogo.'); return; }
  const required = unitsDose * dosesDay * days;
  const packages = Math.ceil(required / pack);
  const total = packages * offer.price;
  if (!Number.isSafeInteger(packages) || !Number.isSafeInteger(total) || packages > 10000) { showError('El cálculo excede un rango válido. Revisa las cantidades ingresadas.'); return; }
  $('#planner-result').innerHTML = `<span>Costo estimado para ${days} días</span><strong>${money(total)}</strong><p>${packages} envase(s) · ${offer.name}<br>Mejor precio disponible: ${offer.pharmacy}</p>`;
});

$('#planner-region').addEventListener('change', communes);
$('#planner-commune').addEventListener('change', load);
$('.menu-btn').addEventListener('click', () => $('.nav-links').classList.toggle('open'));
communes();
