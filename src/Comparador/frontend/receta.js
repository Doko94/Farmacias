const $ = (selector) => document.querySelector(selector);
const COMMUNES = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta'],
};

let catalog = [];
let reviewedMedicines = [];

const normalize = (value = '') => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9%]+/g, ' ')
  .trim();
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const money = (value) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(value || 0);
const safeExternalUrl = (value = '') => {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const ADMINISTRATIVE = /\b(nombre|apellido|edad|direcci[oó]n|avenida|calle|cl[ií]nica|centro|consulta|tel[eé]fono|fono|m[eé]dico|m[eé]dica|doctor|doctora|diagn[oó]stico|rut|firma|fecha|paciente|previsi[oó]n|correo|email|boleta|caja|cajero|vendedor|total|neto|iva|forma de pago)\b/i;
const INSTRUCTION = /\b(tomar|aplicar|administrar|usar|cada|durante|horas?|d[ií]as?|sos|seg[uú]n indicaci[oó]n|v[ií]a oral)\b/i;

async function loadCatalog() {
  const manifest = await fetch('./data/manifest.json').then((response) => response.json());
  const entry = manifest.locations[`${$('#recipe-region').value}|${$('#recipe-commune').value}`];
  catalog = entry ? await fetch(`./data/${entry.file}`).then((response) => response.json()) : [];
  refreshCatalogOptions();
}

function refreshCommunes() {
  const select = $('#recipe-commune');
  select.innerHTML = '';
  (COMMUNES[$('#recipe-region').value] || []).forEach((value) => select.add(new Option(value, value)));
  loadCatalog();
}

const EXTRA_ADMINISTRATIVE = /\b(ahorro|descuento|art[i\u00ed]culo|cantidad|precio|monto|timbre|electr[o\u00f3]nico)\b/i;
const SEARCH_STOP_WORDS = new Set(['para', 'por', 'con', 'del', 'las', 'los', 'una', 'uno', 'caja', 'frasco', 'envase', 'unidad', 'unidades', 'und', 'uds']);

function canonicalSearch(value = '') {
  return normalize(String(value)
    .replace(/\bx\s*(?=\d)/gi, '')
    .replace(/\b(\d+(?:[.,]\d+)?)\s*m\b/gi, '$1 ml')
    .replace(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|ml|g|ui|iu)\b/gi, '$1$2'));
}

function searchTokens(value) {
  return canonicalSearch(value).split(' ').filter((term) => (
    (term.length >= 3 || /^\d+(?:[.,]\d+)?(?:mg|mcg|ug|ml|g|ui|iu|%)$/.test(term))
    && !SEARCH_STOP_WORDS.has(term)
    && !/^\d+$/.test(term)
  ));
}

function searchable(product) {
  return canonicalSearch(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`);
}

const tokenMatches = (queryToken, productTokens) => productTokens.some((productToken) => (
  productToken === queryToken
  || queryToken.length >= 5 && productToken.startsWith(queryToken)
  || productToken.length >= 5 && queryToken.startsWith(productToken)
));

function catalogMatchScore(query, product) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length || !(product.price > 0)) return 0;
  const productTokens = searchTokens(searchable(product));
  const matched = queryTokens.filter((term) => tokenMatches(term, productTokens));
  const doseTokens = queryTokens.filter((term) => /\d(?:mg|mcg|ug|ml|g|ui|iu|%)$/.test(term));
  if (doseTokens.some((term) => !tokenMatches(term, productTokens))) return 0;
  if (!tokenMatches(queryTokens[0], productTokens)) return 0;
  const required = queryTokens.length === 1 ? 1 : Math.max(2, Math.ceil(queryTokens.length * .6));
  if (matched.length < required) return 0;
  const phraseBonus = searchable(product).includes(canonicalSearch(query)) ? 30 : 0;
  return matched.length * 20 + Math.round(matched.length * 40 / queryTokens.length) + phraseBonus;
}

function catalogMatches(query) {
  return catalog
    .map((product) => ({ product, score: catalogMatchScore(query, product) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => Number(right.product.available) - Number(left.product.available) || right.score - left.score || left.product.price - right.product.price)
    .map((entry) => entry.product);
}

function differsByAtMostOne(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let edits = 0;
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  return true;
}

function looseCatalogMatch(query) {
  const leading = searchTokens(query)[0];
  if (!leading || leading.length < 5) return null;
  return catalog
    .filter((product) => product.price > 0 && searchTokens(product.name).some((term) => term.length >= 5 && differsByAtMostOne(term, leading)))
    .sort((left, right) => Number(right.available) - Number(left.available) || left.price - right.price)[0] || null;
}

function refreshCatalogOptions() {
  let datalist = $('#recipe-products');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'recipe-products';
    document.body.appendChild(datalist);
  }
  const names = [...new Set(catalog.filter((product) => product.price > 0).map((product) => product.name))]
    .sort((left, right) => left.localeCompare(right, 'es'));
  datalist.innerHTML = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
}

function cleanCandidate(value) {
  let cleaned = value
    .replace(/^\s*(?:rp\/?\s*)?(?:\d+\s*[.)-]?\s*)?/i, '')
    .replace(/^[•*\-–—]+\s*/, '')
    .replace(/[^\p{L}\p{N}%+.,/()\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  cleaned = cleaned.replace(/\s+(?:tomar|usar|aplicar|administrar)\b.*$/i, '').trim();
  return cleaned.slice(0, 180);
}

function plausibleCandidate(candidate) {
  if (candidate.length < 3 || ADMINISTRATIVE.test(candidate) || EXTRA_ADMINISTRATIVE.test(candidate) || INSTRUCTION.test(candidate)) return false;
  const words = candidate.match(/\p{L}+/gu) || [];
  if (!words.length) return false;
  const meaningful = words.filter((word) => word.length >= 3);
  const shortFragments = words.filter((word) => word.length <= 2);
  if (!meaningful.length || shortFragments.length > meaningful.length + 1) return false;
  return true;
}

function detectedCandidates(text) {
  const seen = new Set();
  const output = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const candidate = cleanCandidate(rawLine);
    const normalized = normalize(candidate);
    if (!plausibleCandidate(candidate)) continue;
    if (seen.has(normalized)) continue;
    const matched = catalogMatches(candidate).length > 0;
    const looseMatch = matched ? null : looseCatalogMatch(candidate);
    const medicationShape = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|ui|iu|%|gotas?|dosis)\b/i.test(candidate);
    if (matched || looseMatch || medicationShape) {
      seen.add(normalized);
      output.push(looseMatch ? looseMatch.name : candidate);
    }
  }
  return output.slice(0, 16);
}

function medicineRow(value, index) {
  const matches = catalogMatches(value);
  const status = value
    ? matches.length ? `${matches.length} coincidencia${matches.length === 1 ? '' : 's'} en el catálogo` : 'Sin coincidencia exacta: corrige el nombre o agrégalo igualmente'
    : 'Escribe el medicamento o selecciónalo desde el catálogo';
  return `<div class="recipe-medicine-row" data-index="${index}">
    <div><input class="recipe-medicine-input" list="recipe-products" maxlength="180" value="${escapeHtml(value)}" placeholder="Ej.: Perenteryl sobres" aria-label="Medicamento ${index + 1}"><small>${escapeHtml(status)}</small></div>
    <button class="recipe-remove" type="button" aria-label="Eliminar medicamento">×</button>
  </div>`;
}

function renderReview(text = '', detected = [], notice = '') {
  reviewedMedicines = detected.map(cleanCandidate).filter(Boolean);
  const output = $('#recipe-page-output');
  output.innerHTML = `<div class="recipe-review">
    <b>Revisa y completa los medicamentos</b>
    <small>La lectura es una ayuda. Corrige los nombres o agrega manualmente cualquier producto que no haya sido reconocido.</small>
    <div id="recipe-medicine-list"></div>
    <div class="recipe-manual-add">
      <input id="recipe-manual" list="recipe-products" maxlength="180" placeholder="Buscar o escribir otro medicamento">
      <button id="recipe-add-manual" type="button">+ Agregar medicamento</button>
    </div>
    ${notice ? `<div class="recipe-warning">${escapeHtml(notice)}</div>` : ''}
    <details><summary>Ver texto completo detectado</summary><pre>${escapeHtml(text || 'No se obtuvo texto legible.')}</pre></details>
  </div>`;
  const results = $('#recipe-results');
  if (results) results.innerHTML = '';
  renderMedicineRows();
  $('#recipe-add-manual').addEventListener('click', addManualMedicine);
  $('#recipe-manual').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addManualMedicine(); }
  });
  if (!reviewedMedicines.length) $('#recipe-manual').focus();
}

function renderMedicineRows() {
  const list = $('#recipe-medicine-list');
  if (!list) return;
  list.innerHTML = reviewedMedicines.length
    ? reviewedMedicines.map(medicineRow).join('')
    : '<div class="recipe-empty">No hubo una detección confiable. Agrega los medicamentos manualmente abajo.</div>';
  list.querySelectorAll('.recipe-medicine-input').forEach((input) => {
    input.addEventListener('change', (event) => {
      reviewedMedicines[Number(event.target.closest('.recipe-medicine-row').dataset.index)] = cleanCandidate(event.target.value);
      renderMedicineRows();
    });
  });
  list.querySelectorAll('.recipe-remove').forEach((button) => {
    button.addEventListener('click', (event) => {
      reviewedMedicines.splice(Number(event.target.closest('.recipe-medicine-row').dataset.index), 1);
      renderMedicineRows();
    });
  });
}

function addManualMedicine() {
  const input = $('#recipe-manual');
  const value = cleanCandidate(input.value);
  if (!value) {
    input.setCustomValidity('Escribe o selecciona un medicamento.');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  if (!reviewedMedicines.some((item) => normalize(item) === normalize(value))) reviewedMedicines.push(value);
  input.value = '';
  renderMedicineRows();
  input.focus();
}

function buildPharmacyPlans(medicines) {
  const reviewed = medicines.map((query) => ({
    query,
    offers: catalogMatches(query).filter((product) => product.available !== false),
  }));
  const pharmacies = [...new Set(reviewed.flatMap((item) => item.offers.map((offer) => offer.pharmacy)).filter(Boolean))];
  const plans = pharmacies.map((pharmacy) => {
    const lines = reviewed.map((item) => {
      const offers = item.offers
        .filter((offer) => offer.pharmacy === pharmacy)
        .sort((left, right) => left.price - right.price);
      return { query: item.query, offer: offers[0] || null, alternatives: item.offers };
    });
    const matched = lines.filter((line) => line.offer);
    return {
      pharmacy,
      lines,
      coverage: matched.length,
      total: matched.reduce((sum, line) => sum + Number(line.offer.price || 0), 0),
    };
  }).filter((plan) => plan.coverage > 0);
  plans.sort((left, right) => right.coverage - left.coverage || left.total - right.total || left.pharmacy.localeCompare(right.pharmacy, 'es'));
  return { reviewed, plans };
}

function recipeLineHtml(line) {
  if (!line.offer) {
    const alternativePharmacies = [...new Set((line.alternatives || []).map((offer) => offer.pharmacy).filter(Boolean))];
    const alternativeText = alternativePharmacies.length
      ? `Sí existe en el catálogo. Disponible en: ${alternativePharmacies.slice(0, 3).join(', ')}${alternativePharmacies.length > 3 ? ` y ${alternativePharmacies.length - 3} más` : ''}.`
      : 'No encontramos una coincidencia confiable en el catálogo para esta ubicación.';
    return `<li class="recipe-purchase-line unresolved">
      <span class="recipe-line-state" aria-hidden="true">!</span>
      <div><b>${escapeHtml(line.query)}</b><small>${escapeHtml(alternativeText)}</small></div>
      <strong>${alternativePharmacies.length ? 'En otra farmacia' : 'Sin coincidencia'}</strong>
    </li>`;
  }
  const offer = line.offer;
  const productUrl = safeExternalUrl(offer.url);
  const link = productUrl
    ? `<a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener">Ver producto</a>`
    : '';
  return `<li class="recipe-purchase-line">
    <span class="recipe-line-state matched" aria-hidden="true">✓</span>
    <div>
      <b>${escapeHtml(line.query)}</b>
      <span>${escapeHtml(offer.name)}</span>
      <small>${offer.available === false ? 'Disponibilidad por confirmar' : 'Disponible según la última actualización'}${offer.brand ? ` · ${escapeHtml(offer.brand)}` : ''}</small>
      ${link}
    </div>
    <strong>${money(offer.price)}</strong>
  </li>`;
}

function renderSelectedPharmacyPlan(plans, medicineCount, selectedPharmacy) {
  const plan = plans.find((item) => item.pharmacy === selectedPharmacy) || plans[0];
  const detail = $('#recipe-plan-detail');
  if (!plan || !detail) return;
  const missing = medicineCount - plan.coverage;
  detail.innerHTML = `<div class="recipe-plan-metrics">
      <div><span>${missing ? 'Subtotal encontrado' : 'Total estimado'}</span><strong>${money(plan.total)}</strong></div>
      <div><span>Cobertura de la receta</span><strong>${plan.coverage} de ${medicineCount}</strong><small>${missing ? `${missing} medicamento${missing === 1 ? '' : 's'} sin coincidencia` : 'Receta completa en esta farmacia'}</small></div>
    </div>
    ${missing ? '<div class="recipe-plan-alert">El valor mostrado no incluye los medicamentos sin coincidencia en esta farmacia.</div>' : ''}
    <ul class="recipe-purchase-list">${plan.lines.map(recipeLineHtml).join('')}</ul>
    <p class="recipe-plan-disclaimer">Total informativo para una unidad de cada producto. Confirma presentación, receta, stock y precio final directamente con la farmacia.</p>`;
}

function buildMultiPharmacyPlan(reviewed, selectedPharmacies) {
  const selected = new Set(selectedPharmacies);
  const lines = reviewed.map((item) => {
    const eligible = item.offers
      .filter((offer) => selected.has(offer.pharmacy))
      .sort((left, right) => left.price - right.price);
    return { query: item.query, offer: eligible[0] || null, alternatives: item.offers };
  });
  const matched = lines.filter((line) => line.offer);
  const groups = new Map();
  matched.forEach((line) => {
    if (!groups.has(line.offer.pharmacy)) groups.set(line.offer.pharmacy, []);
    groups.get(line.offer.pharmacy).push(line);
  });
  return {
    lines,
    groups,
    coverage: matched.length,
    total: matched.reduce((sum, line) => sum + Number(line.offer.price || 0), 0),
  };
}

function renderMultiPharmacyPlan(reviewed, selectedPharmacies) {
  const detail = $('#recipe-plan-detail');
  if (!detail) return;
  if (!selectedPharmacies.length) {
    detail.innerHTML = '<div class="recipe-plan-alert">Selecciona al menos una farmacia para calcular la compra combinada.</div>';
    return;
  }
  const plan = buildMultiPharmacyPlan(reviewed, selectedPharmacies);
  const missing = reviewed.length - plan.coverage;
  const pharmacyCount = plan.groups.size;
  const groupsHtml = [...plan.groups.entries()].map(([pharmacy, lines]) => {
    const subtotal = lines.reduce((sum, line) => sum + Number(line.offer.price || 0), 0);
    return `<section class="recipe-pharmacy-group">
      <header><div><span>Comprar en</span><h4>${escapeHtml(pharmacy)}</h4></div><div><span>Subtotal</span><strong>${money(subtotal)}</strong></div></header>
      <ul class="recipe-purchase-list">${lines.map(recipeLineHtml).join('')}</ul>
    </section>`;
  }).join('');
  const unresolved = plan.lines.filter((line) => !line.offer);
  detail.innerHTML = `<div class="recipe-plan-metrics">
      <div><span>${missing ? 'Subtotal combinado' : 'Total mínimo estimado'}</span><strong>${money(plan.total)}</strong></div>
      <div><span>Cobertura y recorrido</span><strong>${plan.coverage} de ${reviewed.length}</strong><small>${pharmacyCount} farmacia${pharmacyCount === 1 ? '' : 's'} para completar esta selección</small></div>
    </div>
    ${missing ? `<div class="recipe-plan-alert">La selección no cubre ${missing} producto${missing === 1 ? '' : 's'}. Activa otra farmacia o corrige los productos sin coincidencia.</div>` : '<div class="recipe-plan-success">Compra completa: cada producto fue asignado a la alternativa de menor precio entre las farmacias activadas.</div>'}
    <div class="recipe-pharmacy-groups">${groupsHtml}</div>
    ${unresolved.length ? `<section class="recipe-unresolved-group"><h4>Productos pendientes</h4><ul class="recipe-purchase-list">${unresolved.map(recipeLineHtml).join('')}</ul></section>` : ''}
    <p class="recipe-plan-disclaimer">La optimización considera una unidad de cada producto y no incluye costo de traslado o despacho. Confirma stock, receta y precio final antes de comprar.</p>`;
}

function activeMultiPharmacies() {
  return [...document.querySelectorAll('.recipe-pharmacy-check:checked')].map((input) => input.value);
}

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(4, Math.max(2, 1800 / bitmap.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = .299 * image.data[index] + .587 * image.data[index + 1] + .114 * image.data[index + 2];
    const value = gray > 230 ? 255 : Math.max(0, Math.min(255, (gray - 120) * 1.7 + 120));
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

async function processRecipe(file) {
  const output = $('#recipe-page-output');
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    renderReview('', [], 'El archivo supera el máximo de 10 MB. Puedes agregar los medicamentos manualmente.');
    return;
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    renderReview('', [], 'La lectura local de PDF no está disponible. Escribe los medicamentos manualmente o convierte la página en una imagen.');
    return;
  }
  output.innerHTML = '<div class="ocr-progress"><b>Procesando receta…</b><span>Preparando lectura</span><i style="--progress:5%"></i></div>';
  if (!window.Tesseract) {
    renderReview('', [], 'No se pudo cargar el lector automático. Aún puedes ingresar los medicamentos manualmente.');
    return;
  }
  try {
    const image = await prepareImage(file);
    const result = await Tesseract.recognize(image, 'spa', {
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      logger: (message) => {
        if (message.status !== 'recognizing text') return;
        const label = output.querySelector('span');
        const progress = output.querySelector('i');
        if (label) label.textContent = `Reconociendo texto… ${Math.round(message.progress * 100)}%`;
        if (progress) progress.style.setProperty('--progress', `${message.progress * 100}%`);
      },
    });
    const text = result.data?.text || '';
    const detected = detectedCandidates(text);
    renderReview(text, detected, detected.length ? '' : 'No identificamos medicamentos con suficiente confianza. Agrégalos manualmente usando el catálogo.');
  } catch (error) {
    renderReview('', [], `No pudimos leer la imagen automáticamente. Puedes continuar manualmente. ${error.message || ''}`);
  }
}

function optimizeReviewedMedicines() {
  const results = $('#recipe-results');
  if (!results) {
    renderReview('', []);
    return;
  }
  const medicines = reviewedMedicines.map(cleanCandidate).filter(Boolean);
  if (!medicines.length) {
    results.innerHTML = '<div class="recipe-warning">Agrega al menos un medicamento antes de comparar.</div>';
    $('#recipe-manual')?.focus();
    return;
  }
  const { reviewed, plans } = buildPharmacyPlans(medicines);
  if (!plans.length) {
    const unresolved = reviewed.map((item) => `<li class="unresolved"><b>${escapeHtml(item.query)}</b><span>No encontramos una coincidencia disponible. Corrige el nombre o prueba con el principio activo.</span></li>`);
    results.innerHTML = `<div class="recipe-comparison"><h3>Sin coincidencias disponibles</h3><ul>${unresolved.join('')}</ul></div>`;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const bestCoverage = plans[0].coverage;
  const completeCount = plans.filter((plan) => plan.coverage === medicines.length).length;
  const allPharmacies = [...new Set(
    reviewed.flatMap((item) => item.offers.map((offer) => offer.pharmacy)).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'es'));
  results.innerHTML = `<section class="recipe-purchase-result">
    <div class="recipe-result-heading">
      <div><span class="kicker">RESULTADO DE LA RECETA</span><h3>Elige dónde quieres comprar</h3><p>Las farmacias están ordenadas por cantidad de coincidencias y luego por precio.</p></div>
      <div class="recipe-result-summary"><strong>${bestCoverage} de ${medicines.length}</strong><span>mayor cobertura encontrada</span>${completeCount ? `<small>${completeCount} farmacia${completeCount === 1 ? '' : 's'} cubren la receta completa</small>` : '<small>Ninguna farmacia cubre todavía toda la receta</small>'}</div>
    </div>
    <div class="recipe-buy-modes" role="group" aria-label="Modalidad de compra">
      <button class="recipe-mode active" type="button" data-mode="single" aria-pressed="true">
        <span aria-hidden="true">1</span>
        <div><b>Comprar en una farmacia</b><small>Reduce traslados. Priorizamos la farmacia con mayor cobertura y luego el menor subtotal.</small></div>
      </button>
      <button class="recipe-mode" type="button" data-mode="multi" aria-pressed="false">
        <span aria-hidden="true">+</span>
        <div><b>Combinar varias farmacias</b><small>Asigna cada producto a la alternativa de menor precio para completar la receta gastando menos.</small></div>
      </button>
    </div>
    <div id="recipe-single-controls">
      <label class="recipe-pharmacy-picker">Farmacia seleccionada
        <select id="recipe-pharmacy-select">${plans.map((plan, index) => `<option value="${escapeHtml(plan.pharmacy)}">${index === 0 ? 'Recomendada · ' : ''}${escapeHtml(plan.pharmacy)} · ${plan.coverage}/${medicines.length} coincidencias · ${money(plan.total)}</option>`).join('')}</select>
        <small>El resultado incluye los productos disponibles en la farmacia elegida. Los faltantes se muestran para que puedas corregirlos o agregarlos manualmente.</small>
      </label>
    </div>
    <div id="recipe-multi-controls" class="recipe-multi-controls" hidden>
      <div class="recipe-multi-description">
        <b>Farmacias incluidas en la optimización</b>
        <small>Selecciona las farmacias que estás dispuesto a visitar. Para cada medicamento elegiremos el menor precio disponible entre las seleccionadas y siempre mostraremos cualquier producto pendiente.</small>
      </div>
      <div class="recipe-pharmacy-checks">
        ${allPharmacies.map((pharmacy) => `<label><input class="recipe-pharmacy-check" type="checkbox" value="${escapeHtml(pharmacy)}" checked><span>${escapeHtml(pharmacy)}</span></label>`).join('')}
      </div>
    </div>
    <div id="recipe-plan-detail"></div>
  </section>`;
  const select = $('#recipe-pharmacy-select');
  renderSelectedPharmacyPlan(plans, medicines.length, select.value);
  select.addEventListener('change', () => renderSelectedPharmacyPlan(plans, medicines.length, select.value));
  document.querySelectorAll('.recipe-mode').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      document.querySelectorAll('.recipe-mode').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      $('#recipe-single-controls').hidden = mode !== 'single';
      $('#recipe-multi-controls').hidden = mode !== 'multi';
      if (mode === 'multi') {
        renderMultiPharmacyPlan(reviewed, activeMultiPharmacies());
      } else {
        renderSelectedPharmacyPlan(plans, medicines.length, select.value);
      }
    });
  });
  document.querySelectorAll('.recipe-pharmacy-check').forEach((input) => {
    input.addEventListener('change', () => renderMultiPharmacyPlan(reviewed, activeMultiPharmacies()));
  });
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#recipe-file-page').addEventListener('change', (event) => processRecipe(event.target.files[0]));
const dropZone = $('#recipe-drop-zone');
dropZone.addEventListener('dragover', (event) => event.preventDefault());
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  processRecipe(event.dataTransfer.files[0]);
});
$('#recipe-optimize').addEventListener('click', optimizeReviewedMedicines);
$('#recipe-region').addEventListener('change', refreshCommunes);
$('#recipe-commune').addEventListener('change', loadCatalog);
$('.menu-btn').addEventListener('click', () => $('.nav-links').classList.toggle('open'));

refreshCommunes();
renderReview('', [], 'Puedes comenzar subiendo una receta o agregando los medicamentos manualmente.');
