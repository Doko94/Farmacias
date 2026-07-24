const $ = (selector) => document.querySelector(selector);
const COMMUNES = { Tarapaca: ['Iquique'], 'Arica y Parinacota': ['Arica'], Antofagasta: ['Antofagasta'] };
let catalog = [];
const normalize = (value = '') => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
const money = (value) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value || 0);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const LIMITS = {
  'planner-units-dose': { min: 0.1, max: 100, label: 'Unidades por dosis' },
  'planner-doses-day': { min: 0.1, max: 24, label: 'Dosis al día' },
  'planner-units-pack': { min: 0.1, max: 10000, label: 'Contenido por envase' },
  'planner-days': { min: 1, max: 366, label: 'Días' },
};

function plannerMessage(message = '') {
  $('#planner-validation').textContent = message;
}

Object.entries(LIMITS).forEach(([id, limit]) => {
  const input = $(`#${id}`);
  input.addEventListener('keydown', (event) => {
    if (['e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    input.removeAttribute('aria-invalid');
    if (input.value === '') { plannerMessage(''); return; }
    if (!Number.isFinite(value)) { input.value = ''; plannerMessage(`${limit.label}: ingresa solamente números.`); return; }
    if (value > limit.max) {
      input.value = limit.max;
      input.setAttribute('aria-invalid', 'true');
      plannerMessage(`${limit.label}: el máximo permitido es ${limit.max.toLocaleString('es-CL')}.`);
      return;
    }
    if (value < 0) {
      input.value = limit.min;
      input.setAttribute('aria-invalid', 'true');
      plannerMessage(`${limit.label}: no se permiten valores negativos.`);
      return;
    }
    plannerMessage('');
  });
});

async function load() {
  $('#planner-result').innerHTML = '<span>Consultando catálogo…</span><strong>—</strong><p>Preparando las presentaciones disponibles.</p>';
  try {
    const manifest = await fetch('./data/manifest.json').then((response) => {
      if (!response.ok) throw new Error('manifest');
      return response.json();
    });
    const entry = manifest.locations[`${$('#planner-region').value}|${$('#planner-commune').value}`];
    if (!entry) {
      catalog = [];
      $('#planner-result').innerHTML = '<span>No encontramos información</span><strong>—</strong><p>No existe catálogo para esta ubicación.</p>';
      return;
    }
    const response = await fetch(`./data/${entry.file}`);
    if (!response.ok) throw new Error('catalog');
    catalog = await response.json();
    const names = [...new Set(catalog.filter((product) => product.available !== false && product.price > 0).map((product) => product.name))].sort();
    $('#planner-products').innerHTML = names.map((name) => `<option value="${name.replace(/"/g, '&quot;')}"></option>`).join('');
    $('#planner-result').innerHTML = '<span>Catálogo disponible</span><strong>—</strong><p>Selecciona una presentación y completa la frecuencia.</p>';
  } catch {
    catalog = [];
    $('#planner-result').innerHTML = '<span>No pudimos conectarnos</span><strong>—</strong><p>Comprueba tu conexión.</p><button id="planner-retry" type="button">Reintentar</button>';
    $('#planner-retry')?.addEventListener('click', load);
  }
}

function communes() {
  const select = $('#planner-commune');
  select.innerHTML = '';
  (COMMUNES[$('#planner-region').value] || []).forEach((value) => select.add(new Option(value, value)));
  load();
}

function packageUnits(name) {
  const text = String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  // Una presentación explícita tiene prioridad sobre concentraciones como 80/4,5.
  const explicit = text.match(/(?:\bx\s*|\bpor\s+)(\d+(?:[.,]\d+)?)\s*(?:dosis|ds\b|inhalaciones?|puffs?|comprimidos?|comp\b|tabletas?|cápsulas?|caps\b|sobres?|ampollas?|unidades?|parches?|óvulos?)\b/i);
  if (explicit) return Number(explicit[1].replace(',', '.'));

  // Si no aparece "x", usa la última cantidad asociada a una unidad de envase.
  const unitPattern = /\b(\d+(?:[.,]\d+)?)\s*(?:dosis|ds\b|inhalaciones?|puffs?|comprimidos?|comp\b|tabletas?|cápsulas?|caps\b|sobres?|ampollas?|unidades?|parches?|óvulos?)\b/gi;
  const unitMatches = [...text.matchAll(unitPattern)];
  if (unitMatches.length) return Number(unitMatches.at(-1)[1].replace(',', '.'));

  // Para líquidos, toma el volumen final del envase y no la relación de concentración mg/5 ml.
  const volumeMatches = [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*ml\b/gi)];
  if (volumeMatches.length) return Number(volumeMatches.at(-1)[1].replace(',', '.'));
  return null;
}

function presentationUnit(name) {
  const text = normalize(name);
  const units = [
    ['dosis', 'dosis'], ['inhalacion', 'inhalaciones'], ['puff', 'inhalaciones'],
    ['comprimido', 'comprimidos'], ['tableta', 'tabletas'], ['capsula', 'cápsulas'],
    ['sobre', 'sobres'], ['ampolla', 'ampollas'], ['parche', 'parches'],
    ['ovulo', 'óvulos'], [' ml', 'mL'],
  ];
  return units.find(([token]) => text.includes(token))?.[1] || 'unidades';
}

function showError(message) {
  $('#planner-result').innerHTML = `<span>Revisa los datos ingresados</span><strong>—</strong><p>${message}</p>`;
}

$('#planner-query').addEventListener('change', () => {
  const product = catalog.find((item) => normalize(item.name) === normalize($('#planner-query').value));
  const units = product && packageUnits(product.name);
  if (units && units <= 10000) {
    $('#planner-units-pack').value = units;
    $('#planner-help').textContent = `${units.toLocaleString('es-CL')} unidades detectadas desde la presentación. Puedes corregirlo si el envase indica otra cantidad.`;
  } else {
    $('#planner-units-pack').value = '';
    $('#planner-help').textContent = 'No pudimos detectar el contenido. Ingrésalo manualmente según el envase.';
  }
});

$('#planner-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.currentTarget.checkValidity()) {
    const invalid = event.currentTarget.querySelector(':invalid');
    invalid?.setAttribute('aria-invalid', 'true');
    plannerMessage('Revisa los campos: hay valores vacíos o fuera del rango permitido.');
    invalid?.focus();
    return;
  }
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
  if (!valid) { plannerMessage('Usa valores razonables: máximo 100 unidades por dosis, 24 dosis diarias, 10.000 unidades por envase y 366 días.'); showError('Revisa las cantidades indicadas en el formulario.'); return; }
  if (!offer) { showError('Selecciona una presentación disponible desde las sugerencias del catálogo.'); return; }
  const required = unitsDose * dosesDay * days;
  const packages = Math.ceil(required / pack);
  const total = packages * offer.price;
  const purchased = packages * pack;
  const remainder = Math.max(0, purchased - required);
  const dailyCost = total / days;
  const monthlyEquivalent = dailyCost * 30;
  const unit = presentationUnit(offer.name);
  if (!Number.isSafeInteger(packages) || !Number.isSafeInteger(total) || packages > 10000) { showError('El cálculo excede un rango válido. Revisa las cantidades ingresadas.'); return; }
  const updated = offer.captured_at
    ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(offer.captured_at))
    : 'fecha desconocida';
  $('#planner-result').innerHTML = `
    <span>Costo total del tratamiento</span>
    <strong>${money(total)}</strong>
    <div class="planner-cost-grid">
      <div><small>Costo promedio diario</small><b>${money(dailyCost)}</b></div>
      <div><small>Equivalente para 30 días</small><b>${money(monthlyEquivalent)}</b></div>
    </div>
    <div class="planner-calculation">
      <b>Cálculo paso a paso</b>
      <p>${unitsDose.toLocaleString('es-CL')} ${unit} por dosis × ${dosesDay.toLocaleString('es-CL')} dosis al día × ${days} días = <strong>${required.toLocaleString('es-CL')} ${unit}</strong>.</p>
      <p>${required.toLocaleString('es-CL')} ÷ ${pack.toLocaleString('es-CL')} por envase = ${(required / pack).toLocaleString('es-CL', { maximumFractionDigits: 2 })}; se redondea hacia arriba a <strong>${packages} envase${packages === 1 ? '' : 's'}</strong>.</p>
      <p>Comprarás ${purchased.toLocaleString('es-CL')} ${unit}; sobrante estimado: <strong>${remainder.toLocaleString('es-CL')} ${unit}</strong>.</p>
    </div>
    <p class="planner-source"><b>${escapeHtml(offer.name)}</b><br>${escapeHtml(offer.pharmacy)} · ${money(offer.price)} por envase<br>Última verificación: ${escapeHtml(updated)}</p>`;
});

$('#planner-region').addEventListener('change', communes);
$('#planner-commune').addEventListener('change', load);
$('.menu-btn').addEventListener('click', () => $('.nav-links').classList.toggle('open'));
communes();
