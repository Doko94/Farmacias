const API_BASE = localStorage.getItem('farma_api') || (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8000' : '');
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value || 0);
const COMMUNES_BY_REGION = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta']
};
const PHARMACY_LOGOS = {
  Ahumada: 'https://www.farmaciasahumada.cl/on/demandware.static/Sites-ahumada-cl-Site/-/default/dw8f7ce49d/images/logo.svg',
  'Cruz Verde': 'https://www.cruzverde.cl/assets/favicon/favicon-32x32.png',
  Salcobrand: 'https://static.salcobrand.cl/assets/logo-73fe73eb9cf65adf981684077f38a616190d7759b74439763a45b9b985fc36e5.svg',
  'Dr. Simi': 'https://farmaciasdeldrsimicl.vtexassets.com/assets/vtex.file-manager-graphql/images/35ac1c04-2540-45f1-9996-346729464da8___7af9fc3d4ed0be2760b1bddf801da897.png',
  'Farmacia Municipal Iquique': 'https://prciquique.cl/wp-content/uploads/2021/09/iqq.png'
};
const locationValue = () => ({region:$('#region-select').value,commune:$('#commune-select').value});
const formatDate = (value) => {
  if (!value) return 'Fecha no informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(date);
};
const safeUrl = (value) => {
  try {
    const url=new URL(value);
    return url.protocol==='https:' ? url.href : '';
  } catch { return ''; }
};
const normalizeText = (value='') => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9%]+/g,' ').trim();
const STRUCTURAL_WORDS = new Set(['mg','mcg','ug','g','ml','comprimido','comprimidos','tableta','tabletas','capsula','capsulas','sobre','sobres','ampolla','ampollas','unidad','unidades','dosis','parche','parches','ovulo','ovulos','oral','recubierto','recubiertos']);
const normalizeDoseNumber = (value) => /^\d{1,3}(?:[.\s]\d{3})+$/.test(value) ? value.replace(/[.\s]/g,'') : value.replace(',','.');
const signature = (value) => {
  const text=value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const doses=[...text.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui|iu|u|%)(?=\b)/g)].map(match=>`${normalizeDoseNumber(match[1])}|${match[2]==='ug'?'mcg':['iu','u'].includes(match[2])?'ui':match[2]}`);
  const packages=[...text.matchAll(/\b(\d+)\s*(comprimidos?|tabletas?|capsulas?|sobres?|ampollas?|unidades?|dosis|parches?|ovulos?)\b/g)].map(match=>`${match[1]}|${match[2].replace(/s$/,'')}`);
  return {doses,packages};
};
const strictProductMatch = (query, product) => {
  const requested=signature(query); const offered=signature(`${product.name} ${product.active_ingredient||''}`);
  const requestedTerms=normalizeText(query).split(' ').filter(term=>term.length>1&&!/^\d/.test(term)&&!STRUCTURAL_WORDS.has(term));
  const offeredTerms=new Set(normalizeText(`${product.name} ${product.brand||''} ${product.active_ingredient||''}`).split(' '));
  return requested.doses.every(value=>offered.doses.includes(value))
    && requested.packages.every(value=>offered.packages.includes(value))
    && requestedTerms.every(term=>offeredTerms.has(term));
};

const staticCatalogCache = new Map();
let staticManifestPromise;
function loadStaticManifest() {
  staticManifestPromise ||= fetch('./data/manifest.json').then(response=>{
    if(!response.ok) throw new Error('Catalogo estatico no disponible');
    return response.json();
  });
  return staticManifestPromise;
}
async function loadStaticCatalog() {
  const manifest=await loadStaticManifest();
  const {region,commune}=locationValue();
  const entry=manifest.locations[`${region}|${commune}`];
  if(!entry) return [];
  if(!staticCatalogCache.has(entry.file)) {
    staticCatalogCache.set(entry.file,fetch(`./data/${entry.file}`).then(response=>{
      if(!response.ok) throw new Error('Datos de ubicacion no disponibles');
      return response.json();
    }));
  }
  return staticCatalogCache.get(entry.file);
}
function localScore(query, product) {
  const normalizedQuery=normalizeText(query);
  const name=normalizeText(product.name);
  const searchable=normalizeText(`${product.name} ${product.brand||''} ${product.active_ingredient||''}`);
  const searchableTerms=new Set(searchable.split(' '));
  const terms=normalizedQuery.split(' ').filter(Boolean);
  const coverage=terms.filter(term=>searchableTerms.has(term)).length/Math.max(terms.length,1);
  return coverage+(name===normalizedQuery?2:name.includes(normalizedQuery)?1:0);
}
async function searchStaticCatalog(query) {
  const products=await loadStaticCatalog();
  return products.filter(product=>strictProductMatch(query,product))
    .map(product=>({product,score:localScore(query,product)}))
    .filter(item=>item.score>=0.5)
    .sort((a,b)=>b.score-a.score||Number(b.product.available)-Number(a.product.available)||a.product.price-b.product.price)
    .slice(0,60).map(item=>item.product);
}

function renderHeroBars(items) {
  const chart=$('#hero-chart');
  chart.innerHTML='';
  const values=items.map(item=>item.value);
  const minimum=Math.min(...values); const maximum=Math.max(...values);
  items.forEach(item=>{
    const bar=document.createElement('i');
    const ratio=maximum===minimum?0.72:(item.value-minimum)/(maximum-minimum);
    bar.style.setProperty('--h',`${42+ratio*54}%`);
    bar.title=`${item.label}: ${money(item.value)}`;
    chart.appendChild(bar);
  });
}

async function updateHeroCoverage() {
  try {
    const manifest=await loadStaticManifest();
    const {region,commune}=locationValue();
    const entry=manifest.locations[`${region}|${commune}`];
    if(!entry) throw new Error('Ubicacion sin catalogo');
    $('#hero-metric-label').textContent=`Ofertas disponibles en ${commune}`;
    $('#hero-metric-value').textContent=new Intl.NumberFormat('es-CL').format(entry.offers);
    $('#hero-metric-context').textContent='precios consolidados desde las farmacias participantes';
    $('#hero-metric-detail').textContent=`${entry.pharmacies} farmacias integradas`;
    $('#hero-metric-percent').textContent='Catálogo real';
    $('#hero-metric-date').textContent=`Última captura: ${formatDate(entry.updated_at)}`;
    renderHeroBars(Array.from({length:entry.pharmacies},(_,index)=>({label:`Farmacia ${index+1}`,value:index+1})));
  } catch {
    $('#hero-metric-label').textContent='Cobertura del catálogo';
    $('#hero-metric-value').textContent='4 farmacias';
    $('#hero-metric-context').textContent='Selecciona una ubicación y busca un medicamento';
    $('#hero-metric-detail').textContent='Datos pendientes de cargar';
    $('#hero-metric-percent').textContent='—';
    $('#hero-metric-date').textContent='';
  }
}

function updateHeroSearch(products, query) {
  const bestByPharmacy=new Map();
  products.filter(product=>product.available!==false&&Number(product.price)>0).forEach(product=>{
    const previous=bestByPharmacy.get(product.pharmacy);
    if(!previous||product.price<previous.price) bestByPharmacy.set(product.pharmacy,product);
  });
  const comparable=[...bestByPharmacy.values()];
  if(!comparable.length) {
    $('#hero-metric-label').textContent='Sin ofertas comparables';
    $('#hero-metric-value').textContent='$0';
    $('#hero-metric-context').textContent=`No encontramos stock disponible para “${query}”`;
    $('#hero-metric-detail').textContent='0 farmacias comparadas';
    $('#hero-metric-percent').textContent='—';
    $('#hero-chart').innerHTML='';
    $('#hero-metric-date').textContent='';
    return;
  }
  const prices=comparable.map(product=>product.price);
  const lowest=Math.min(...prices); const highest=Math.max(...prices);
  const savings=highest-lowest;
  const percentage=highest>0?Math.round(savings*100/highest):0;
  const latest=comparable.map(product=>product.captured_at).filter(Boolean).sort().at(-1);
  $('#hero-metric-label').textContent=comparable.length>1?'Ahorro potencial':'Una sola farmacia disponible';
  $('#hero-metric-value').textContent=money(savings);
  $('#hero-metric-context').textContent=`comparando las ofertas que coinciden con “${query}”`;
  $('#hero-metric-detail').textContent=`${comparable.length} farmacia${comparable.length===1?'':'s'} comparada${comparable.length===1?'':'s'}`;
  $('#hero-metric-percent').textContent=comparable.length>1?`−${percentage}%`:'Sin comparación';
  $('#hero-metric-date').textContent=latest?`Última captura: ${formatDate(latest)}`:'';
  renderHeroBars(comparable.sort((a,b)=>a.price-b.price).map(product=>({label:product.pharmacy,value:product.price})));
}

async function api(path, options={}) {
  if (!API_BASE) throw new Error('API no configurada');
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) throw new Error((await response.text()) || 'No se pudo consultar la API');
  return response.json();
}

function renderResults(products, source='api') {
  updateHeroSearch(products,$('#search-input').value.trim());
  $('#clear-results').hidden=false;
  $('#search-status').hidden = true;
  const container = $('#results'); container.innerHTML = '';
  document.querySelector('#demo-note')?.remove();
  if (!products.length) { $('#search-status').hidden=false; $('#search-status').innerHTML='<h3>Sin coincidencias</h3><p>Prueba con otro nombre o principio activo.</p>'; return; }
  products.sort((a,b)=>Number(b.available)-Number(a.available)||a.price-b.price);
  const bestIndex=products.findIndex(product=>product.available!==false);
  products.forEach((product,index)=>{
    const isBest=index===bestIndex;
    const card=document.createElement('article');
    card.className=`result-card${isBest?' result-card--best':''}`;
    const stock=product.stock_quantity!==null&&product.stock_quantity!==undefined?`${product.stock_quantity} unidades informadas`:(product.available?'Stock disponible':'Sin stock');
    const {region,commune}=locationValue();
    const destination=safeUrl(product.url);
    const action=destination?`<a href="${destination}" target="_blank" rel="noopener noreferrer">Ver en farmacia →</a>`:'<span class="unavailable-link">Enlace no informado por la farmacia</span>';
    const logo=PHARMACY_LOGOS[product.pharmacy];
    const pharmacyClass=product.pharmacy==='Ahumada'
      ?' pharmacy-title--ahumada'
      :product.pharmacy==='Farmacia Municipal Iquique'
        ?' pharmacy-title--municipal'
        :'';
    const logoOnlyPharmacies=new Set(['Ahumada','Farmacia Municipal Iquique']);
    const pharmacyName=logoOnlyPharmacies.has(product.pharmacy)?'':`<span>${product.pharmacy}</span>`;
    const pharmacyTitle=`<span class="pharmacy pharmacy-title${pharmacyClass}">${logo?`<img src="${logo}" alt="Logo ${product.pharmacy}" loading="lazy">`:''}${pharmacyName}</span>`;
    const pharmacyNotice=product.pharmacy==='Farmacia Municipal Iquique'?'<small class="municipal-notice">Beneficio para personas inscritas con domicilio acreditado en Iquique.</small>':'';
    const badges=`<div class="product-badges">${product.bioequivalent?'<span class="product-badge bioequivalent">B Bioequivalente</span>':''}${product.fonasa_price?'<span class="product-badge fonasa">Fonasa</span>':''}</div>`;
    const fonasaPrice=product.fonasa_price?`<div class="fonasa-price"><span>Precio Fonasa</span><strong>${money(product.fonasa_price)}</strong></div>`:'';
    const stockWarning=product.available===false||Number(product.stock_quantity)===0
      ?'<div class="stock-warning" role="note"><span aria-hidden="true">⚠</span><p><b>Disponibilidad por confirmar</b>Revisa directamente con la farmacia antes de acudir.</p></div>'
      :'';
    card.innerHTML=`${isBest?'<span class="best-badge"><i>✓</i> Mejor opción</span>':''}${pharmacyTitle}${pharmacyNotice}<h3>${product.name}</h3><span>${product.brand||'Marca no informada'}</span>${product.active_ingredient?`<small><b>Principio activo:</b> ${product.active_ingredient}</small>`:''}${badges}${fonasaPrice}<div><span class="price">${money(product.price)}</span> ${product.list_price?`<span class="old">${money(product.list_price)}</span>`:''}</div><div class="result-meta"><span class="stock-status ${product.available?'in-stock':'out-stock'}">${product.available?'●':'○'} ${stock}</span><span>${commune}, ${region}</span><span>Actualizado: ${formatDate(product.captured_at)}</span></div>${stockWarning}<small>${isBest?'Coincidencia exacta · Menor precio disponible':'Coincidencia exacta · Comparado'}</small>${action}`;
    container.appendChild(card);
  });
  if(source==='static') container.insertAdjacentHTML('beforebegin','<p id="demo-note" class="tool-output"><b>Información de precios:</b> última actualización disponible para la ubicación seleccionada.</p>');
}

function renderApiUnavailable(query) {
  $('#results').innerHTML='';
  document.querySelector('#demo-note')?.remove();
  const status=$('#search-status');
  status.hidden=false;
  status.innerHTML=`<div class="empty-icon">!</div><h3>No fue posible cargar el catálogo</h3><p>La información de precios no está disponible temporalmente para “${query}”. Intenta nuevamente más tarde.</p>`;
}

$('#search-form').addEventListener('submit', async (event)=>{
  event.preventDefault(); const q=$('#search-input').value.trim(); const {region,commune}=locationValue();
  document.querySelector('#comparar').scrollIntoView({behavior:'smooth',block:'start'});
  $('#clear-results').hidden=false;
  $('#search-status').hidden=false; $('#search-status').innerHTML='<h3>Comparando farmacias…</h3>';
  try { const data=await api(`/api/search?q=${encodeURIComponent(q)}&region=${encodeURIComponent(region)}&commune=${encodeURIComponent(commune)}`); renderResults(data.results); }
  catch {
    try { renderResults(await searchStaticCatalog(q),'static'); }
    catch { renderApiUnavailable(q); }
  }
});

$('#clear-results').addEventListener('click',()=>{
  $('#results').innerHTML='';
  document.querySelector('#demo-note')?.remove();
  const status=$('#search-status');
  status.hidden=false;
  status.innerHTML='<div class="empty-icon">⌕</div><h3>Busca tu primer medicamento</h3><p>Escribe un nombre, marca o principio activo arriba.</p>';
  $('#search-input').value='';
  $('#clear-results').hidden=true;
  updateHeroCoverage();
  $('#search-input').focus({preventScroll:true});
});

const PRESENTATION_UNITS = {
  comprimido:'comprimidos', tableta:'tabletas', capsula:'cápsulas', sobre:'sobres',
  ampolla:'ampollas', unidad:'unidades', parche:'parches', ovulo:'óvulos',
  dosis:'dosis', ml:'mL', g:'gramos'
};
let treatmentSuggestions=[]; let treatmentTimer;
const normalizePlannerText = (value='') => normalizeText(value)
  .replace(/([a-z])(?=\d)|(?<=\d)([a-z])/g,'$1 $2')
  .replace(/\s+/g,' ')
  .trim();
function inferPresentation(name) {
  const text=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\bgr\b/g,'g');
  const solid=text.match(/\b(\d+(?:[.,]\d+)?)\s*(comprimidos?|tabletas?|capsulas?|sobres?|ampollas?|unidades?|parches?|ovulos?|dosis)\b/i);
  if(solid) {
    const token=solid[2];
    const raw=token.startsWith('comprimido')?'comprimido':token.startsWith('tableta')?'tableta':token.startsWith('capsula')?'capsula':token.startsWith('sobre')?'sobre':token.startsWith('ampolla')?'ampolla':token.startsWith('unidad')?'unidad':token.startsWith('parche')?'parche':token.startsWith('ovulo')?'ovulo':'dosis';
    return {quantity:Number(solid[1].replace(',','.')),unit:raw,label:PRESENTATION_UNITS[raw]||solid[2]};
  }
  for(const unit of ['ml','g']) {
    const matches=[...text.matchAll(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*${unit}\\b`,'gi'))];
    if(matches.length) {
      const match=matches.at(-1);
      return {quantity:Number(match[1].replace(',','.')),unit,label:PRESENTATION_UNITS[unit]};
    }
  }
  return null;
}
function applyPresentation(productName) {
  const presentation=inferPresentation(productName);
  $('#units-pack').dataset.product=normalizeText(productName);
  if(!presentation) {
    $('#units-pack').value='';
    $('#package-quantity-label').textContent='Contenido por envase';
    $('#dose-quantity-label').textContent='Cantidad por dosis';
    $('#presentation-help').textContent='No pudimos detectar el contenido. Revísalo en el envase o ficha del producto.';
    return false;
  }
  $('#units-pack').value=presentation.quantity;
  $('#package-quantity-label').textContent=`${presentation.label} por envase`;
  $('#dose-quantity-label').textContent=`${presentation.label} por dosis`;
  $('#presentation-help').textContent=`Detectado automáticamente: ${presentation.quantity} ${presentation.label}. Puedes corregirlo.`;
  return true;
}
async function suggestTreatmentProducts(query) {
  const normalized=normalizePlannerText(query);
  if(normalized.length<3) return [];
  const queryTerms=normalized.split(' ').filter(term=>term.length>1&&!['de','del','la','el','con','sin','y'].includes(term));
  if(!queryTerms.length) return [];
  const products=await loadStaticCatalog();
  const unique=new Map();
  products.forEach(product=>{
    const searchable=normalizePlannerText(`${product.name} ${product.brand||''} ${product.active_ingredient||''}`);
    const candidateTerms=searchable.split(' ').filter(Boolean);
    const matches=queryTerms.every(term=>/^\d/.test(term)?candidateTerms.includes(term):candidateTerms.some(candidate=>candidate.startsWith(term)));
    if(!matches) return;
    const key=normalizePlannerText(product.name);
    const current=unique.get(key);
    const nameTerms=normalizePlannerText(product.name).split(' ');
    const nameMatches=queryTerms.filter(term=>nameTerms.some(candidate=>candidate.startsWith(term))).length;
    const scored={...product,suggestion_score:nameMatches/queryTerms.length+(normalizeText(product.name).startsWith(queryTerms[0])?0.5:0)};
    if(!current||scored.suggestion_score>current.suggestion_score||(scored.suggestion_score===current.suggestion_score&&product.price<current.price)) unique.set(key,scored);
  });
  return [...unique.values()].sort((a,b)=>b.suggestion_score-a.suggestion_score||a.name.localeCompare(b.name,'es')||a.price-b.price).slice(0,30);
}
async function refreshTreatmentSuggestions() {
  const query=$('#treatment-query').value.trim();
  try { treatmentSuggestions=await suggestTreatmentProducts(query); }
  catch { treatmentSuggestions=[]; }
  const list=$('#treatment-products'); list.innerHTML='';
  treatmentSuggestions.forEach(product=>{
    const option=document.createElement('option');
    option.value=product.name; option.label=`${product.pharmacy} · ${money(product.price)}`;
    list.appendChild(option);
  });
  const selected=treatmentSuggestions.find(product=>normalizeText(product.name)===normalizeText(query));
  if(selected) applyPresentation(selected.name);
}
$('#treatment-query').addEventListener('input',()=>{
  clearTimeout(treatmentTimer);
  treatmentTimer=setTimeout(refreshTreatmentSuggestions,300);
});
$('#treatment-query').addEventListener('change',refreshTreatmentSuggestions);

$('#treatment-form').addEventListener('submit', async (event)=>{
  event.preventDefault(); const {region,commune}=locationValue();
  const query=$('#treatment-query').value.trim();
  let offers=[];
  try {
    const data=await api(`/api/search?q=${encodeURIComponent(query)}&region=${encodeURIComponent(region)}&commune=${encodeURIComponent(commune)}&limit=100`);
    offers=data.results;
  } catch {
    try { offers=await searchStaticCatalog(query); } catch { offers=[]; }
  }
  const exactOffers=offers.filter(product=>normalizeText(product.name)===normalizeText(query)&&product.available!==false);
  if(!exactOffers.length) {
    $('#treatment-result').innerHTML='<span>Selecciona una presentación</span><strong>—</strong><p>Elige un producto exacto de las sugerencias para calcular con su precio y contenido reales.</p>';
    return;
  }
  if($('#units-pack').dataset.product!==normalizeText(exactOffers[0].name)) {
    applyPresentation(exactOffers[0].name);
  }
  const unitsPerPackage=Number($('#units-pack').value);
  if(!Number.isFinite(unitsPerPackage)||unitsPerPackage<=0) {
    $('#treatment-result').innerHTML='<span>Contenido por confirmar</span><strong>—</strong><p>Indica el contenido señalado en el envase o en la ficha del medicamento.</p>';
    return;
  }
  const body={region,commune,days:+$('#treatment-days').value,items:[{query,units_per_dose:+$('#units-dose').value,doses_per_day:+$('#doses-day').value,units_per_package:unitsPerPackage}]};
  let result;
  try { result=await api('/api/treatments/monthly-cost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
  catch {
    const offer=exactOffers.sort((a,b)=>a.price-b.price)[0];
    const required=body.items[0].units_per_dose*body.items[0].doses_per_day*body.days;
    const packages=Math.ceil(required/unitsPerPackage);
    result={total:packages*offer.price,items:[{packages,pharmacy:offer.pharmacy,product:offer.name}]};
  }
  const item=result.items[0];
  $('#treatment-result').innerHTML=`<span>Costo estimado para ${body.days} días</span><strong>${money(result.total)}</strong><p>${item?.packages||0} envase(s) · ${item?.product||query}<br>Mejor alternativa disponible: ${item?.pharmacy||'sin coincidencia'}</p>`;
});

let recipeQueries=[];
const recipeEscape=(value='')=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function recipeSearchQuery(value='') {
  const cleaned=value.replace(/^\s*(?:rp\/?\s*)?(?:\d+\s*[.)-]?\s*)?/i,'').replace(/\s+/g,' ').trim();
  const dose=cleaned.match(/\b(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui|iu|u|%)\b/i);
  if(!dose)return cleaned.replace(/\s+(?:#|n[°º]?|x)?\s*\d+\s+(?:comprimidos?|tabletas?|capsulas?|sobres?|ampollas?|unidades?|dosis)\b.*$/i,'').trim();
  const beforeDose=cleaned.slice(0,dose.index).replace(/(?:\(\s*\d+\s*\)|#\s*\d+)\s*$/,'').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ -]+$/g,'').trim();
  const name=beforeDose.split(/\b(?:tomar|usar|aplicar|administrar)\b/i)[0].trim();
  const unit=['iu','u'].includes(dose[2].toLowerCase())?'UI':dose[2];
  return `${name} ${normalizeDoseNumber(dose[1])} ${unit}`.trim();
}
function medicineCandidates(text) {
  const ignored=/\b(nombre|apellido|edad|direccion|avenida|av|clinica|centro|telefono|tel|doctor|doctora|dra|dr|medico|diagnostico|hipertension|rut|firma|repetir|receta|paciente|fecha|fono|uso|usar|tomar|aplicar|administrar|cada|horas?|dias?|ocasional|lunes|martes|miercoles|jueves|viernes)\b/i;
  const seen=new Set();
  return text.split(/\r?\n/).map(line=>line.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9%#.,()\/-]+/g,' ').replace(/\s+/g,' ').trim())
    .filter(line=>line.length>=4&&line.length<=90&&!ignored.test(line)&&/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(line))
    .map(recipeSearchQuery).filter(line=>line.length>=3)
    .filter(line=>{const key=normalizeText(line);if(seen.has(key))return false;seen.add(key);return true}).slice(0,12);
}
const RECIPE_METADATA=/\b(nombre|apellido|edad|direccion|avenida|av|calle|clinica|centro|consulta|telefono|tel|fono|doctor|doctora|dra|dr|medico|general|especialidad|diagnostico|hipertension|otitis|diabetes|rut|firma|paciente|fecha|registro|correo|email)\b/i;
async function catalogMedicineCandidates(values) {
  const unique=[...new Set(values.map(recipeSearchQuery).map(value=>value.trim()).filter(value=>value.length>=3&&!RECIPE_METADATA.test(normalizeText(value))))];
  const accepted=[];
  for(const query of unique) {
    try {
      const matches=await searchStaticCatalog(query);
      if(matches.length||/\b(?:\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:mg|mcg|ug|g|ml|ui|iu|u|%)\b/i.test(query))accepted.push(query);
    } catch {
      // Si el catálogo está temporalmente inaccesible, mantenemos líneas con dosis para revisión manual.
      if(/\b(?:\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:mg|mcg|ug|g|ml|ui|iu|u|%)\b/i.test(query))accepted.push(query);
    }
  }
  return accepted;
}
function showRecipeReview(text,queries,method) {
  recipeQueries=queries;
  const output=$('#recipe-output');
  output.innerHTML=`<div class="recipe-review"><b>Revisa los medicamentos antes de comparar</b><small>${method}. El reconocimiento de escritura manuscrita puede contener errores.</small><label>Un medicamento por línea<textarea id="recipe-medicines" rows="5" placeholder="Ej: Salicort loción\nKelual DS crema">${recipeEscape(queries.join('\n'))}</textarea></label><details><summary>Ver texto completo detectado</summary><pre>${recipeEscape(text||'Sin texto legible')}</pre></details></div>`;
  if(!queries.length)output.insertAdjacentHTML('beforeend','<div class="recipe-warning">No pudimos identificar automáticamente un medicamento del catálogo. Revisa el texto detectado y escribe el nombre con su concentración en el campo anterior.</div>');
  $('#recipe-medicines').addEventListener('input',event=>{recipeQueries=event.target.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean)});
}
async function processRecipeFile(file) {
  const output=$('#recipe-output');
  if(!file)return;
  if(file.size>10*1024*1024){output.textContent='El archivo supera el máximo de 10 MB.';return;}
  output.innerHTML=`<div class="ocr-progress"><b>Procesando ${recipeEscape(file.name)}</b><span>Preparando lectura…</span><i style="--progress:3%"></i></div>`;
  const form=new FormData();form.append('file',file);
  try {
    const data=await api('/api/recipes/extract',{method:'POST',body:form});
    const medicines=await catalogMedicineCandidates(data.medicines.map(item=>item.query));
    showRecipeReview(data.text||'',medicines,'Lectura realizada por el backend');
    return;
  } catch {}
  if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')) {
    output.innerHTML='<div class="recipe-warning">El procesamiento local admite fotografías. Para leer este PDF debes conectar el backend desde la página API para desarrolladores.</div>';
    return;
  }
  if(!window.Tesseract){output.innerHTML='<div class="recipe-warning">No fue posible cargar el lector OCR. Revisa tu conexión o configura el backend.</div>';return;}
  try {
    const result=await Tesseract.recognize(file,'spa',{logger:message=>{if(message.status==='recognizing text'){const progress=Math.round((message.progress||0)*100);const label=output.querySelector('.ocr-progress span'),bar=output.querySelector('.ocr-progress i');if(label)label.textContent=`Reconociendo texto… ${progress}%`;if(bar)bar.style.setProperty('--progress',`${progress}%`)}}});
    const text=result.data?.text||'';
    const medicines=await catalogMedicineCandidates(medicineCandidates(text));
    showRecipeReview(text,medicines,'Lectura local y privada en tu navegador');
  } catch(error) {output.innerHTML=`<div class="recipe-warning">No pudimos leer la fotografía automáticamente. Puedes conectar el backend o intentar con una imagen más nítida. ${recipeEscape(error.message||'')}</div>`;}
}
$('#recipe-file').addEventListener('change',event=>processRecipeFile(event.target.files[0]));
const dropZone=$('#drop-zone');
['dragenter','dragover'].forEach(name=>dropZone.addEventListener(name,event=>{event.preventDefault();dropZone.classList.add('dragging')}));
['dragleave','drop'].forEach(name=>dropZone.addEventListener(name,event=>{event.preventDefault();dropZone.classList.remove('dragging')}));
dropZone.addEventListener('drop',event=>processRecipeFile(event.dataTransfer.files[0]));

$('#demo-optimize').addEventListener('click', async ()=>{
  const reviewed=$('#recipe-medicines');
  if(reviewed)recipeQueries=reviewed.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  const output=$('#recipe-output');
  if(!recipeQueries.length){output.insertAdjacentHTML('beforeend','<div class="recipe-warning">Sube una receta y escribe o confirma al menos un medicamento antes de optimizar.</div>');return;}
  const searchQueries=await catalogMedicineCandidates(recipeQueries);
  if(!searchQueries.length){output.insertAdjacentHTML('beforeend','<div class="recipe-warning">No encontramos medicamentos del catálogo en el texto revisado. Corrige el nombre o la concentración e inténtalo nuevamente.</div>');return;}
  const {region,commune}=locationValue(); const body={region,commune,pickup:true,minimum_split_savings:1000,items:searchQueries.map(query=>({query,quantity:1}))};
  try { const data=await api('/api/recipes/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const r=data.recommendation; output.innerHTML=`<b>Compra optimizada: ${money(r.total)}</b><br>${r.lines.map(x=>`${x.product} en ${x.pharmacy}: ${money(x.subtotal)}`).join('<br>')}<br>Ahorro: ${money(data.savings)}`; }
  catch {
    const lines=[];
    for(const query of searchQueries){const matches=await searchStaticCatalog(query);const offer=matches.filter(item=>item.available!==false).sort((a,b)=>a.price-b.price)[0];lines.push(offer?`${offer.name} en ${offer.pharmacy}: ${money(offer.price)}`:`Sin coincidencia disponible para “${query}”`)}
    output.innerHTML=`<b>Resultado para los medicamentos revisados</b><br>${lines.join('<br>')}<small class="recipe-result-note">Confirma presentación, dosis, receta, stock y precio final directamente con cada farmacia.</small>`;
  }
});

$('#alert-form').addEventListener('submit',async(event)=>{
  event.preventDefault(); const {region,commune}=locationValue(); const body={email:$('#alert-email').value,query:$('#alert-query').value,target_price:+$('#alert-price').value||null,region,commune};
  try { await api('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); $('#alert-message').textContent='Alerta creada correctamente.'; }
  catch { $('#alert-message').textContent='Demo guardada localmente. Conecta la API para activar notificaciones reales.'; localStorage.setItem('farma_demo_alert',JSON.stringify(body)); }
});

$('.menu-btn').addEventListener('click',()=>{ const links=$('.nav-links'); links.classList.toggle('open'); $('.menu-btn').setAttribute('aria-expanded',links.classList.contains('open')); });

$('#region-select').addEventListener('change',()=>{
  const communeSelect=$('#commune-select');
  communeSelect.innerHTML='';
  (COMMUNES_BY_REGION[$('#region-select').value]||[]).forEach(commune=>{
    const option=document.createElement('option');
    option.value=commune; option.textContent=commune;
    communeSelect.appendChild(option);
  });
  updateHeroCoverage();
});

$('#commune-select').addEventListener('change',updateHeroCoverage);

const mobileMetricQuery=window.matchMedia('(max-width: 600px)');
function placeCatalogMetricCard(event=mobileMetricQuery) {
  const card=$('#catalog-metric-card');
  const origin=$('#hero-card-origin');
  const mobileSlot=$('#mobile-metric-slot');
  if(event.matches) {
    if(card.parentElement!==mobileSlot) mobileSlot.appendChild(card);
  } else if(card.previousElementSibling!==origin) {
    origin.parentElement.insertBefore(card,origin.nextSibling);
  }
}
mobileMetricQuery.addEventListener?.('change',placeCatalogMetricCard);
placeCatalogMetricCard();
updateHeroCoverage();
