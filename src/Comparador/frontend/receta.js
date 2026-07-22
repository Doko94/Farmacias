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

function searchable(product) {
  return normalize(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`);
}

function catalogMatches(query) {
  const terms = normalize(query).split(' ').filter((term) => term.length > 1 && !/^\d+$/.test(term));
  if (!terms.length) return [];
  return catalog
    .filter((product) => product.price > 0 && terms.every((term) => searchable(product).includes(term)))
    .sort((left, right) => Number(right.available) - Number(left.available) || left.price - right.price);
}

function looseCatalogMatch(query) {
  const terms = normalize(query).split(' ').filter((term) => term.length >= 4 && !/^\d+$/.test(term));
  if (!terms.length) return null;
  const leading = terms[0];
  return catalog
    .filter((product) => normalize(product.name).split(' ').some((term) => term === leading || term.startsWith(leading) || leading.startsWith(term)))
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
    .replace(/\s+/g, ' ')
    .trim();
  cleaned = cleaned.replace(/\s+(?:tomar|usar|aplicar|administrar)\b.*$/i, '').trim();
  return cleaned.slice(0, 180);
}

function detectedCandidates(text) {
  const seen = new Set();
  const output = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const candidate = cleanCandidate(rawLine);
    const normalized = normalize(candidate);
    if (candidate.length < 3 || ADMINISTRATIVE.test(candidate) || INSTRUCTION.test(candidate)) continue;
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
  </div><div id="recipe-results" aria-live="polite"></div>`;
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
  const lines = medicines.map((query) => {
    const offer = catalogMatches(query).filter((product) => product.available !== false)[0];
    if (offer) return `<li><b>${escapeHtml(query)}</b><span>${escapeHtml(offer.name)} · ${escapeHtml(offer.pharmacy)} · ${money(offer.price)}</span></li>`;
    return `<li class="unresolved"><b>${escapeHtml(query)}</b><span>No encontramos una coincidencia confiable. Corrige el nombre arriba o prueba con el principio activo.</span></li>`;
  });
  results.innerHTML = `<div class="recipe-comparison"><b>Resultado para los medicamentos revisados</b><ul>${lines.join('')}</ul><small>Confirma presentación, dosis, receta, stock y precio final directamente con cada farmacia.</small></div>`;
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
