const $ = (selector) => document.querySelector(selector);
const COMMUNES = { Tarapaca: ['Iquique'], 'Arica y Parinacota': ['Arica'], Antofagasta: ['Antofagasta'] };
let catalog = [];
let plannerSearchIndex = [];
let plannerSuggestions = [];
let plannerActiveSuggestion = -1;
let selectedPlannerProduct = null;
let plannerSearchTimer = 0;
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
const normalizeDecimal = (value) => Number(String(value).trim().replace(',', '.'));

function plannerMessage(message = '') {
  $('#planner-validation').textContent = message;
}

Object.entries(LIMITS).forEach(([id, limit]) => {
  const input = $(`#${id}`);
  input.addEventListener('keydown', (event) => {
    if (['e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
  });
  input.addEventListener('input', () => {
    const value = normalizeDecimal(input.value);
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
    const manifest = await fetch('./data/manifest.json',{cache:'no-store'}).then((response) => {
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
    plannerSearchIndex = catalog
      .filter((product) => product.price > 0)
      .map((product) => ({
        product,
        search: normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''} ${product.pharmacy || ''}`),
      }));
    selectedPlannerProduct = null;
    closePlannerSuggestions();
    $('#planner-result').innerHTML = '<span>Catálogo disponible</span><strong>—</strong><p>Selecciona una presentación y completa la frecuencia.</p>';
  } catch {
    catalog = [];
    plannerSearchIndex = [];
    selectedPlannerProduct = null;
    closePlannerSuggestions();
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

function unitLabels(unit) {
  const labels = {
    comprimidos: ['Comprimidos por dosis', 'Comprimidos por envase'],
    tabletas: ['Tabletas por dosis', 'Tabletas por envase'],
    cápsulas: ['Cápsulas por dosis', 'Cápsulas por envase'],
    sobres: ['Sobres por dosis', 'Sobres por envase'],
    mL: ['Mililitros por dosis', 'Mililitros por frasco'],
    dosis: ['Aplicaciones por dosis', 'Dosis disponibles por envase'],
    inhalaciones: ['Puff por dosis', 'Puff disponibles por inhalador'],
  };
  return labels[unit] || ['Cantidad utilizada por dosis', 'Contenido por envase'];
}

function showError(message) {
  $('#planner-result').innerHTML = `<span>Revisa los datos ingresados</span><strong>—</strong><p>${message}</p>`;
}

function closePlannerSuggestions() {
  const list = $('#planner-suggestions');
  if (!list) return;
  list.hidden = true;
  list.replaceChildren();
  plannerSuggestions = [];
  plannerActiveSuggestion = -1;
  $('#planner-query').setAttribute('aria-expanded', 'false');
}

function applyPlannerProduct(product) {
  selectedPlannerProduct = product;
  $('#planner-query').value = product.name;
  const units = packageUnits(product.name);
  const unit = presentationUnit(product.name);
  const labels = unitLabels(unit);
  $('#planner-dose-label').textContent = labels[0];
  $('#planner-pack-label').textContent = labels[1];
  if (units && units <= 10000) {
    $('#planner-units-pack').value = units;
    $('#planner-help').textContent = `${units.toLocaleString('es-CL')} ${unit} detectadas desde la presentación. Puedes corregirlo si el envase indica otra cantidad.`;
  } else {
    $('#planner-units-pack').value = '';
    $('#planner-help').textContent = 'No pudimos detectar el contenido. Ingrésalo manualmente según el envase.';
  }
  plannerMessage('');
  closePlannerSuggestions();
}

function createPlannerSuggestion(product, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-suggestion-option';
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', 'false');
  button.dataset.index = index;
  const media = document.createElement('span');
  media.className = 'tool-suggestion-image';
  if (/^https?:\/\//i.test(String(product.image || ''))) {
    const image = document.createElement('img');
    image.src = product.image;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => media.replaceChildren(document.createTextNode('Rx')), { once: true });
    media.append(image);
  } else {
    media.textContent = 'Rx';
  }
  const copy = document.createElement('span');
  copy.className = 'tool-suggestion-copy';
  const title = document.createElement('b');
  title.textContent = product.name;
  const detail = document.createElement('small');
  detail.textContent = [product.brand || product.active_ingredient || 'Marca no informada', product.pharmacy]
    .filter(Boolean).join(' · ');
  copy.append(title, detail);
  const price = document.createElement('strong');
  price.textContent = product.available === false ? 'Sin stock' : money(product.price);
  button.append(media, copy, price);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    applyPlannerProduct(product);
  });
  return button;
}

function refreshPlannerSuggestions(value) {
  const terms = normalize(value).split(' ').filter((term) => term.length > 1);
  const list = $('#planner-suggestions');
  list.replaceChildren();
  if (!terms.length) {
    closePlannerSuggestions();
    return;
  }
  plannerSuggestions = plannerSearchIndex
    .filter((entry) => terms.every((term) => entry.search.includes(term)))
    .sort((left, right) => (
      Number(right.product.available === true) - Number(left.product.available === true)
      || Number(left.product.price || Infinity) - Number(right.product.price || Infinity)
    ))
    .map((entry) => entry.product)
    .filter((product, index, values) => values.findIndex((candidate) => (
      normalize(`${candidate.name}|${candidate.pharmacy}`) === normalize(`${product.name}|${product.pharmacy}`)
    )) === index)
    .slice(0, 12);
  plannerActiveSuggestion = -1;
  if (!plannerSuggestions.length) {
    const empty = document.createElement('span');
    empty.className = 'cart-suggestion-empty';
    empty.textContent = 'Sin coincidencias. Prueba por nombre, marca o principio activo.';
    list.append(empty);
  } else {
    plannerSuggestions.forEach((product, index) => list.append(createPlannerSuggestion(product, index)));
  }
  list.hidden = false;
  $('#planner-query').setAttribute('aria-expanded', 'true');
}

function movePlannerSuggestion(direction) {
  if (!plannerSuggestions.length) return;
  plannerActiveSuggestion = (plannerActiveSuggestion + direction + plannerSuggestions.length) % plannerSuggestions.length;
  $('#planner-suggestions').querySelectorAll('[role="option"]').forEach((option, index) => {
    const active = index === plannerActiveSuggestion;
    option.classList.toggle('active', active);
    option.setAttribute('aria-selected', String(active));
    if (active) option.scrollIntoView({ block: 'nearest' });
  });
}

$('#planner-query').addEventListener('input', (event) => {
  if (!selectedPlannerProduct || normalize(event.target.value) !== normalize(selectedPlannerProduct.name)) selectedPlannerProduct = null;
  clearTimeout(plannerSearchTimer);
  plannerSearchTimer = setTimeout(() => refreshPlannerSuggestions(event.target.value), 160);
});

$('#planner-query').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); movePlannerSuggestion(1); }
  if (event.key === 'ArrowUp') { event.preventDefault(); movePlannerSuggestion(-1); }
  if (event.key === 'Enter' && plannerActiveSuggestion >= 0) {
    event.preventDefault();
    applyPlannerProduct(plannerSuggestions[plannerActiveSuggestion]);
  }
  if (event.key === 'Escape') closePlannerSuggestions();
});

$('#planner-query').addEventListener('autocomplete:clear', () => {
  selectedPlannerProduct = null;
  $('#planner-units-pack').value = '';
  $('#planner-help').textContent = 'Selecciona una sugerencia para completar este dato. Máximo 10.000.';
  closePlannerSuggestions();
});

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.tool-search-wrap')) closePlannerSuggestions();
});

$('#planner-query').addEventListener('change', () => {
  const product = selectedPlannerProduct
    && normalize(selectedPlannerProduct.name) === normalize($('#planner-query').value)
    ? selectedPlannerProduct
    : catalog.find((item) => normalize(item.name) === normalize($('#planner-query').value));
  selectedPlannerProduct = product || null;
  const units = product && packageUnits(product.name);
  const unit = product ? presentationUnit(product.name) : 'unidades';
  const labels = unitLabels(unit);
  $('#planner-dose-label').textContent = labels[0];
  $('#planner-pack-label').textContent = labels[1];
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
  const offer = selectedPlannerProduct && selectedPlannerProduct.available !== false && selectedPlannerProduct.price > 0
    ? selectedPlannerProduct
    : null;
  const unitsDose = normalizeDecimal($('#planner-units-dose').value);
  const dosesDay = normalizeDecimal($('#planner-doses-day').value);
  const pack = normalizeDecimal($('#planner-units-pack').value);
  const days = normalizeDecimal($('#planner-days').value);
  const valid = [unitsDose, dosesDay, pack, days].every(Number.isFinite)
    && unitsDose > 0 && unitsDose <= 100
    && dosesDay > 0 && dosesDay <= 24
    && pack > 0 && pack <= 10000
    && days >= 1 && days <= 366;
  if (!valid) { plannerMessage('Usa números como 0,5 o 1. Límites: 0,1–100 por dosis, 0,1–24 dosis diarias, 0,1–10.000 por envase y 1–366 días.'); showError('Revisa las cantidades indicadas en el formulario.'); return; }
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
      <div><small>Duración</small><b>${days} días</b></div>
      <div><small>Envases necesarios</small><b>${packages}</b></div>
      <div><small>Costo promedio diario</small><b>${money(dailyCost)}</b></div>
      <div><small>Costo mensual aproximado</small><b>${money(monthlyEquivalent)}</b></div>
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
