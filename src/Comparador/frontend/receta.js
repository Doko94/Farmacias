const $ = (selector) => document.querySelector(selector);
const isMobileViewport = () => window.matchMedia('(max-width: 600px)').matches;
const COMMUNES = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta'],
};

let catalog = [];
let reviewedMedicines = [];
let activeOcrWorker = null;
let ocrCancelled = false;

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

function doseSignature(value = '') {
  return [...canonicalSearch(value).matchAll(/(\d+(?:[.,]\d+)?)(mg|mcg|ug|g|ml|ui|iu)\b/g)]
    .map((match) => {
      let amount = Number(match[1].replace(',', '.'));
      let unit = match[2];
      if (unit === 'g') { amount *= 1000; unit = 'mg'; }
      if (unit === 'ug') unit = 'mcg';
      if (unit === 'iu') unit = 'ui';
      return `${amount}${unit}`;
    });
}

function packageSignature(value = '') {
  const match = canonicalSearch(value).match(/\b(?:x\s*)?(\d{1,4})\s*(comprimidos?|comp|capsulas?|caps|sobres?|dosis|unidades?|und)\b/);
  return match ? Number(match[1]) : null;
}

function catalogMatchScore(query, product) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length || !(product.price > 0)) return 0;
  const productTokens = searchTokens(searchable(product));
  const matched = queryTokens.filter((term) => tokenMatches(term, productTokens));
  const doseTokens = queryTokens.filter((term) => /\d(?:mg|mcg|ug|ml|g|ui|iu|%)$/.test(term));
  if (doseTokens.some((term) => !tokenMatches(term, productTokens))) return 0;
  const requestedDoses = doseSignature(query);
  const productDoses = doseSignature(`${product.name} ${product.active_ingredient || ''}`);
  if (requestedDoses.length && requestedDoses.some((dose) => !productDoses.includes(dose))) return 0;
  if (requestedDoses.length && productDoses.filter((dose) => /(mg|mcg|ui)$/.test(dose)).some((dose) => !requestedDoses.includes(dose))) return 0;
  const requestedPackage = packageSignature(query);
  const productPackage = packageSignature(product.name);
  if (requestedPackage && productPackage && requestedPackage !== productPackage) return 0;
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

function recipeGuidance() {
  let guidance=$('#recipe-next-step');
  if(!guidance) {
    guidance=document.createElement('div');
    guidance.id='recipe-next-step';
    guidance.className='recipe-next-step';
    guidance.setAttribute('role','status');
    guidance.setAttribute('aria-live','polite');
    $('#recipe-optimize')?.before(guidance);
  }
  return guidance;
}

function setRecipeActionState(state='idle') {
  const button=$('#recipe-optimize');
  const guidance=recipeGuidance();
  if(!button||!guidance)return;
  if(state==='processing') {
    button.disabled=true;
    button.textContent='Espera mientras analizamos la receta';
    guidance.hidden=false;
    guidance.className='recipe-next-step processing';
    guidance.innerHTML='<b>Lectura en proceso</b><span>Al llegar a 100% todavía debemos ordenar y validar el texto. No cierres esta página.</span>';
    return;
  }
  const ready=reviewedMedicines.some(Boolean);
  button.disabled=!ready;
  button.textContent='Comparar receta revisada';
  guidance.hidden=!ready;
  guidance.className='recipe-next-step ready';
  if(ready)guidance.innerHTML='<b>Lectura terminada: revisa los medicamentos</b><span>Corrige o elimina cualquier resultado incorrecto. Cuando estés conforme, presiona <strong>Comparar receta revisada</strong>.</span>';
}

function renderReview(text = '', detected = [], notice = '', completed = false) {
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
  // Evita que Safari abra el teclado y mantenga el viewport ampliado.
  if (!reviewedMedicines.length && !isMobileViewport()) $('#recipe-manual').focus();
  setRecipeActionState(completed&&reviewedMedicines.length?'ready':'idle');
  if(completed) {
    window.setTimeout(()=>{
      document.querySelector('.recipe-review')?.scrollIntoView({behavior:'smooth',block:'center'});
    },120);
  }
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
  setRecipeActionState('idle');
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
  if (!isMobileViewport()) input.focus();
}

function buildPharmacyPlans(medicines) {
  const reviewed = medicines.map((query) => {
    const matches = catalogMatches(query);
    return {
      query,
      offers: matches.filter((product) => product.available !== false),
      unavailableOffers: matches.filter((product) => product.available === false),
    };
  });
  const pharmacies = [...new Set(reviewed.flatMap((item) => item.offers.map((offer) => offer.pharmacy)).filter(Boolean))];
  const plans = pharmacies.map((pharmacy) => {
    const lines = reviewed.map((item) => {
      const offers = item.offers
        .filter((offer) => offer.pharmacy === pharmacy)
        .sort((left, right) => left.price - right.price);
      return {
        query: item.query,
        offer: offers[0] || null,
        alternatives: item.offers,
        unavailableAlternatives: item.unavailableOffers,
      };
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
    const unavailable = (line.unavailableAlternatives || [])
      .sort((left, right) => left.price - right.price);
    if (unavailable.length) {
      const product = unavailable[0];
      const pharmacies = [...new Set(unavailable.map((offer) => offer.pharmacy).filter(Boolean))];
      const productUrl = safeExternalUrl(product.url);
      return `<li class="recipe-purchase-line unresolved stock-warning">
        <span class="recipe-line-state" aria-hidden="true">!</span>
        <div>
          <b>${escapeHtml(line.query)}</b>
          <span>${escapeHtml(product.name)} · ${escapeHtml(product.pharmacy || 'Farmacia no informada')}${unavailable.length > 1 ? ` · ${unavailable.length} registros sin stock` : ''}</span>
          <div class="recipe-stock-warning"><strong>Disponibilidad por confirmar</strong><small>Revisa directamente con ${pharmacies.length === 1 ? 'la farmacia' : 'las farmacias'} antes de acudir.</small></div>
          ${productUrl ? `<a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener">Consultar en farmacia</a>` : ''}
        </div>
        <strong>${money(product.price)} · Sin stock</strong>
      </li>`;
    }
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
  const verified = offer.captured_at
    ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(offer.captured_at))
    : 'fecha desconocida';
  const productUrl = safeExternalUrl(offer.url);
  const link = productUrl
    ? `<a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener">Ver producto</a>`
    : '';
  return `<li class="recipe-purchase-line">
    <span class="recipe-line-state matched" aria-hidden="true">✓</span>
    <div>
      <b>${escapeHtml(line.query)}</b>
      <span>${escapeHtml(offer.name)}</span>
      <small>${offer.available === false ? 'Disponibilidad por confirmar' : 'Stock informado: disponible'}${offer.brand ? ` · ${escapeHtml(offer.brand)}` : ''}</small>
      <small>Última verificación: ${escapeHtml(verified)} · Fuente: sitio web de ${escapeHtml(offer.pharmacy || 'la farmacia')}</small>
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
    return {
      query: item.query,
      offer: eligible[0] || null,
      alternatives: item.offers,
      unavailableAlternatives: item.unavailableOffers,
    };
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
  if (bitmap.width * bitmap.height > 25_000_000) {
    bitmap.close();
    throw new Error('La imagen supera el límite de 25 megapíxeles.');
  }
  // No dupliques fotos grandes: en móvil eso podía convertir 12 MP en 48 MP
  // y bloquear temporalmente Safari durante el OCR.
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const detailScale = Math.min(1.5, 2200 / longestSide);
  const memoryScale = Math.sqrt(4_000_000 / (bitmap.width * bitmap.height));
  const scale = Math.min(detailScale, memoryScale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
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
  if (!$('#recipe-consent')?.checked) {
    renderReview('', [], 'Debes aceptar el procesamiento local antes de seleccionar una receta.');
    $('#recipe-consent')?.focus();
    return;
  }
  const deleteButton = $('#recipe-delete');
  if (deleteButton) deleteButton.hidden = false;
  if (file.size === 0) {
    renderReview('', [], 'El archivo está vacío.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    renderReview('', [], 'El archivo supera el máximo de 10 MB. Puedes agregar los medicamentos manualmente.');
    return;
  }
  const name = file.name.toLowerCase();
  const extensions = name.match(/\.[a-z0-9]+/g) || [];
  if (extensions.length !== 1 || !/\.(pdf|png|jpe?g|webp)$/.test(name)) {
    renderReview('', [], 'Nombre o extensión no permitidos. Usa un archivo PDF, PNG, JPG o WEBP sin extensiones dobles.');
    return;
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const signatureMatches = name.endsWith('.pdf') ? isPdf
    : /\.jpe?g$/.test(name) ? isJpeg
      : name.endsWith('.png') ? isPng : isWebp;
  if (!signatureMatches) {
    renderReview('', [], 'El contenido real del archivo no coincide con su extensión.');
    return;
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    renderReview('', [], 'La lectura local de PDF no está disponible. Escribe los medicamentos manualmente o convierte la página en una imagen.');
    return;
  }
  output.innerHTML = '<div class="ocr-progress"><b>Procesando receta…</b><span>Preparando archivo…</span><i style="--progress:5%"></i><button id="recipe-cancel-ocr" type="button">Cancelar análisis</button></div>';
  setRecipeActionState('processing');
  if (!window.Tesseract) {
    renderReview('', [], 'No se pudo cargar el lector automático. Aún puedes ingresar los medicamentos manualmente.');
    return;
  }
  let image;
  try {
    ocrCancelled = false;
    $('#recipe-cancel-ocr')?.addEventListener('click', async () => {
      ocrCancelled = true;
      await activeOcrWorker?.terminate();
      activeOcrWorker = null;
      renderReview('', [], 'Análisis cancelado. Puedes seleccionar otra imagen o agregar los medicamentos manualmente.');
    }, { once: true });
    image = await prepareImage(file);
    activeOcrWorker = await Tesseract.createWorker('spa', 1, {
      logger: (message) => {
        const label = output.querySelector('span');
        const progress = output.querySelector('i');
        const percentage = Math.round((message.progress || 0) * 100);
        if (label) {
          if (message.status === 'recognizing text') label.textContent = percentage >= 100
            ? 'Lectura al 100%. Buscando medicamentos en el catálogo…'
            : `Reconociendo texto… ${percentage}%`;
          else label.textContent = 'Preparando el lector local…';
        }
        if (progress && message.progress) progress.style.setProperty('--progress', `${message.progress * 100}%`);
      },
    });
    await activeOcrWorker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('El análisis superó el tiempo máximo de 90 segundos.')), 90000));
    const result = await Promise.race([activeOcrWorker.recognize(image), timeout]);
    if (ocrCancelled) return;
    const text = result.data?.text || '';
    const detected = detectedCandidates(text);
    renderReview(
      text,
      detected,
      detected.length ? '' : 'No identificamos medicamentos con suficiente confianza. Agrégalos manualmente usando el catálogo.',
      true
    );
  } catch (error) {
    if (ocrCancelled) return;
    renderReview('', [], `No pudimos leer la imagen automáticamente. Puedes continuar manualmente. ${error.message || ''}`);
  } finally {
    await activeOcrWorker?.terminate().catch(() => {});
    activeOcrWorker = null;
    // Safari conserva por más tiempo los buffers gráficos; liberarlos evita
    // presión de memoria después de procesar una fotografía grande.
    if (image instanceof HTMLCanvasElement) {
      image.width = 1;
      image.height = 1;
    }
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
    if (!isMobileViewport()) $('#recipe-manual')?.focus();
    return;
  }
  const { reviewed, plans } = buildPharmacyPlans(medicines);
  if (!plans.length) {
    const unresolved = reviewed.map((item) => recipeLineHtml({
      query: item.query,
      offer: null,
      alternatives: item.offers,
      unavailableAlternatives: item.unavailableOffers,
    }));
    results.innerHTML = `<section class="recipe-purchase-result">
      <div class="recipe-result-heading">
        <div><span class="kicker">RESULTADO DE LA RECETA</span><h3>Disponibilidad pendiente de confirmación</h3><p>Encontramos referencias del catálogo, pero ninguna tiene stock confirmado en este momento.</p></div>
        <div class="recipe-result-summary"><strong>0 de ${medicines.length}</strong><span>productos con stock confirmado</span><small>Puedes consultar directamente con cada farmacia</small></div>
      </div>
      <div class="recipe-plan-alert">Los precios mostrados son informativos y no garantizan disponibilidad. Revisa directamente con la farmacia antes de acudir.</div>
      <ul class="recipe-purchase-list">${unresolved.join('')}</ul>
    </section>`;
    results.scrollIntoView({ behavior: isMobileViewport() ? 'auto' : 'smooth', block: 'start' });
    return;
  }
  const bestCoverage = plans[0].coverage;
  const completeCount = plans.filter((plan) => plan.coverage === medicines.length).length;
  const allPharmacies = [...new Set(
    reviewed.flatMap((item) => [...item.offers, ...item.unavailableOffers].map((offer) => offer.pharmacy)).filter(Boolean),
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
  results.scrollIntoView({ behavior: isMobileViewport() ? 'auto' : 'smooth', block: 'start' });
}

$('#recipe-file-page').addEventListener('change', (event) => processRecipe(event.target.files[0]));
const dropZone = $('#recipe-drop-zone');
dropZone?.querySelector('.upload-icon')?.setAttribute('aria-hidden','true');
if (dropZone && !dropZone.querySelector('.recipe-file-button')) {
  const permissionHint = document.createElement('span');
  permissionHint.id = 'recipe-upload-permission';
  permissionHint.className = 'recipe-upload-permission';
  permissionHint.setAttribute('role', 'status');
  permissionHint.setAttribute('aria-live', 'polite');
  const fileButton = document.createElement('span');
  fileButton.className = 'recipe-file-button';
  fileButton.textContent = 'Seleccionar archivo desde mi equipo';
  fileButton.setAttribute('aria-hidden', 'true');
  const formatHint = dropZone.querySelector('small');
  dropZone.insertBefore(permissionHint, formatHint);
  dropZone.insertBefore(fileButton, formatHint);
}
dropZone.addEventListener('click', (event) => {
  if ($('#recipe-consent')?.checked) return;
  event.preventDefault();
  const hint=$('#recipe-upload-permission');
  if(hint)hint.textContent='Primero debes marcar la autorización de privacidad para habilitar la selección del archivo.';
  $('#recipe-consent')?.focus();
});
dropZone.addEventListener('dragover', (event) => event.preventDefault());
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  if (!$('#recipe-consent')?.checked) {
    $('#recipe-upload-permission').textContent = 'Primero debes aceptar la autorización de procesamiento indicada arriba.';
    $('#recipe-consent')?.focus();
    return;
  }
  processRecipe(event.dataTransfer.files[0]);
});
$('#recipe-optimize').addEventListener('click', optimizeReviewedMedicines);
const recipeFile = $('#recipe-file-page');
const privacyNotice = document.querySelector('.recipe-privacy-notice');
if (privacyNotice) {
  privacyNotice.innerHTML = `<strong>Tu receta y tu privacidad</strong>
    <p><b>JPG, PNG y WEBP:</b> el reconocimiento se ejecuta localmente en este navegador. La imagen no se envía a AhorraMed ni se almacena.</p>
    <p><b>PDF:</b> actualmente no se envía a un servicio externo; escribe los medicamentos manualmente o convierte la página en imagen.</p>
    <p>Al eliminar la receta se limpian el archivo seleccionado, el texto detectado y los resultados de esta sesión. Oculta nombre, RUT, dirección, diagnóstico y datos del profesional cuando no sean necesarios.</p>
    <p class="recipe-consent-requirement"><b>Paso 1 obligatorio:</b> lee esta información y marca la autorización antes de seleccionar, arrastrar o procesar una receta.</p>
    <label class="recipe-consent"><input id="recipe-consent" type="checkbox"> He leído esta información y autorizo el procesamiento local para identificar medicamentos.</label>
    <div class="recipe-privacy-actions"><a href="/privacidad">Política de privacidad</a><a href="/terminos">Términos de uso</a><button id="recipe-delete" type="button">Eliminar mi receta</button></div>`;
}
const activeRecipeConsent = $('#recipe-consent');
const activeRecipeDelete = $('#recipe-delete');
if (activeRecipeDelete) activeRecipeDelete.hidden = true;
function updateUploadPermission() {
  const authorized=Boolean(activeRecipeConsent?.checked);
  if(recipeFile)recipeFile.disabled=!authorized;
  dropZone?.classList.toggle('is-disabled',!authorized);
  dropZone?.setAttribute('aria-disabled',String(!authorized));
  const hint=$('#recipe-upload-permission');
  if(hint) {
    hint.className=`recipe-upload-permission ${authorized?'authorized':'required'}`;
    hint.textContent=authorized
      ? 'Paso 1 completado. Ya puedes seleccionar o arrastrar tu receta.'
      : 'Antes de continuar, marca la autorización de privacidad ubicada arriba.';
  }
}
updateUploadPermission();
activeRecipeConsent?.addEventListener('change',updateUploadPermission);
$('#recipe-delete')?.addEventListener('click', () => {
  const file = $('#recipe-file-page');
  if (file) file.value = '';
  if (activeRecipeConsent) activeRecipeConsent.checked = false;
  updateUploadPermission();
  reviewedMedicines = [];
  $('#recipe-results').innerHTML = '';
  activeRecipeDelete.hidden = true;
  renderReview('', [], 'Receta eliminada de esta sesión. El archivo, el texto detectado y los resultados fueron borrados.');
});
$('#recipe-region').addEventListener('change', refreshCommunes);
$('#recipe-commune').addEventListener('change', loadCatalog);
$('.menu-btn').addEventListener('click', () => $('.nav-links').classList.toggle('open'));

refreshCommunes();
renderReview('', [], 'Puedes comenzar subiendo una receta o agregando los medicamentos manualmente.');
