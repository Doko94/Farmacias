const API_BASE = localStorage.getItem('farma_api') || (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8000' : '');
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value || 0);
const escapeHtml=(value='')=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const validateSearchQuery=(rawValue)=>{
  const value=String(rawValue||'').normalize('NFC').replace(/\s+/g,' ').trim();
  if(value.length<2)return {error:'Escribe al menos 2 caracteres.'};
  if(value.length>100)return {error:'La búsqueda permite un máximo de 100 caracteres.'};
  if(!/[\p{L}]/u.test(value))return {error:'Incluye el nombre, marca o principio activo; no uses solamente números.'};
  if((value.match(/[\p{L}]/gu)||[]).length<2)return {error:'Incluye al menos 2 letras del medicamento.'};
  if(/[^\p{L}\p{N}\s.,/%()+\-]/u.test(value))return {error:'Usa solo letras, números y símbolos habituales de dosis: . , / % ( ) + -'};
  if(/(.)\1{7,}/iu.test(value))return {error:'Evita repetir el mismo carácter más de 7 veces.'};
  if(value.split(' ').some(token=>token.length>40))return {error:'Una palabra no puede superar los 40 caracteres.'};
  return {value};
};
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
const freshness = (value) => {
  if (!value) return { level: 'unknown', label: 'Fecha desconocida' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { level: 'unknown', label: 'Fecha desconocida' };
  const hours = Math.max(0, (Date.now() - date.getTime()) / 36e5);
  const relative = hours < 1 ? `hace ${Math.max(1, Math.round(hours * 60))} min`
    : hours < 48 ? `hace ${Math.round(hours)} h` : `hace ${Math.round(hours / 24)} días`;
  return { level: hours < 6 ? 'fresh' : hours <= 24 ? 'warning' : 'stale', label: relative };
};
const safeUrl = (value) => {
  try {
    const url=new URL(value);
    return url.protocol==='https:' ? url.href : '';
  } catch { return ''; }
};
const normalizeText = (value='') => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9%]+/g,' ').trim().split(/\s+/).map(term=>term==='acetaminofen'?'paracetamol':term).join(' ');
const STRUCTURAL_WORDS = new Set(['mg','mcg','ug','g','ml','comprimido','comprimidos','tableta','tabletas','capsula','capsulas','sobre','sobres','ampolla','ampollas','unidad','unidades','dosis','parche','parches','ovulo','ovulos','oral','recubierto','recubiertos']);
const normalizeDoseNumber = (value) => /^\d{1,3}(?:[.\s]\d{3})+$/.test(value) ? value.replace(/[.\s]/g,'') : value.replace(',','.');
const signature = (value) => {
  const text=value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const doses=[...text.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui|iu|u|%)(?=\b)/g)].map(match=>{
    let amount=Number(normalizeDoseNumber(match[1])); let unit=match[2];
    if(unit==='g'){amount*=1000;unit='mg'} if(unit==='ug')unit='mcg'; if(['iu','u'].includes(unit))unit='ui';
    return `${amount}|${unit}`;
  });
  const packages=[...text.matchAll(/\b(\d+)\s*(comprimidos?|tabletas?|capsulas?|sobres?|ampollas?|unidades?|dosis|parches?|ovulos?)\b/g)].map(match=>`${match[1]}|${match[2].replace(/s$/,'')}`);
  const formAliases={comprimidos:'comprimido',comprimido:'comprimido',comp:'comprimido',tabletas:'tableta',tableta:'tableta',capsulas:'capsula',capsula:'capsula',jarabes:'jarabe',jarabe:'jarabe',solucion:'solucion',suspension:'suspension',gotas:'gotas',crema:'crema',gel:'gel',spray:'spray',inhalador:'inhalador',sobres:'sobre',sobre:'sobre'};
  const forms=[...text.matchAll(/\b(comprimidos?|comp|tabletas?|capsulas?|jarabes?|solucion|suspension|gotas|crema|gel|spray|inhalador|sobres?)\b/g)].map(match=>formAliases[match[1]]||match[1]);
  return {doses,packages,forms:[...new Set(forms)]};
};
const closeToken=(requested,offered)=>requested===offered||(requested.length>=5&&Math.abs(requested.length-offered.length)<=1&&levenshtein(requested,offered)<=1);
const levenshtein=(left,right)=>{
  const row=Array.from({length:right.length+1},(_,index)=>index);
  for(let i=1;i<=left.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=right.length;j++){const saved=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(left[i-1]===right[j-1]?0:1));previous=saved}}
  return row[right.length];
};
const strictProductMatch = (query, product) => {
  const requested=signature(query); const offered=signature(`${product.name} ${product.active_ingredient||''}`);
  const requestedTerms=normalizeText(query).split(' ').filter(term=>term.length>1&&!/^\d/.test(term)&&!STRUCTURAL_WORDS.has(term));
  const offeredTerms=new Set(normalizeText(`${product.name} ${product.brand||''} ${product.active_ingredient||''}`).split(' '));
  return requested.doses.every(value=>offered.doses.includes(value))
    && (!requested.doses.length || offered.doses.filter(value=>/\|(mg|mcg|ui|%)$/.test(value)).every(value=>requested.doses.includes(value)))
    && requested.packages.every(value=>offered.packages.includes(value))
    && (!requested.forms.length || requested.forms.some(form=>offered.forms.includes(form)))
    && requestedTerms.every(term=>[...offeredTerms].some(offeredTerm=>closeToken(term,offeredTerm)));
};

const staticCatalogCache = new Map();
let staticManifestPromise;
function loadStaticManifest() {
  staticManifestPromise ||= fetch('./data/manifest.json',{cache:'no-store'}).then(response=>{
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
    staticCatalogCache.set(entry.file,fetch(`./data/${entry.file}`,{cache:'force-cache'}).then(response=>{
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
  if (!products.length) {
    const error=new Error('Sin cobertura para esta ubicación');
    error.code='NO_COVERAGE';
    throw error;
  }
  return products.filter(product=>strictProductMatch(query,product))
    .map(product=>({product,score:localScore(query,product)}))
    .filter(item=>item.score>=0.5)
    .sort((a,b)=>b.score-a.score
      ||(a.product.available===true?0:a.product.available===false?2:1)-(b.product.available===true?0:b.product.available===false?2:1)
      ||a.product.price-b.product.price)
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
    $('#hero-metric-label').textContent='No pudimos consultar la cobertura';
    $('#hero-metric-value').textContent='—';
    $('#hero-metric-context').textContent='Revisa tu conexión e intenta nuevamente';
    $('#hero-metric-detail').textContent='Cobertura no disponible';
    $('#hero-metric-percent').textContent='—';
    $('#hero-metric-date').textContent='';
    $('#hero-chart').replaceChildren();
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
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  const response = await fetch(`${API_BASE}${path}`, {...options,signal:options.signal||controller.signal})
    .finally(()=>clearTimeout(timeout));
  if (!response.ok) throw new Error((await response.text()) || 'No se pudo consultar la API');
  return response.json();
}

function renderResults(products, source='api') {
  if ($('#exclude-external')?.checked) {
    const integrated=new Set(Object.keys(PHARMACY_LOGOS));
    products=products.filter(product=>integrated.has(product.pharmacy));
  }
  updateHeroSearch(products,$('#search-input').value.trim());
  $('#clear-results').hidden=false;
  $('#search-status').hidden = true;
  const container = $('#results'); container.innerHTML = '';
  document.querySelector('#demo-note')?.remove();
  if (!products.length) {
    $('#search-status').hidden=false;
    $('#search-status').innerHTML='<h3>Sin coincidencias</h3><p>Prueba con otro nombre o principio activo.</p>';
    $('#open-pharmacies-cta').hidden=true;
    return;
  }
  const pharmacyCta=$('#open-pharmacies-cta');
  const pharmacyLink=$('#open-pharmacies-link');
  const selectedLocation=locationValue();
  const turnosRegion=selectedLocation.region==='Tarapaca'?'Tarapacá':selectedLocation.region;
  const turnosParams=new URLSearchParams({region:turnosRegion,commune:selectedLocation.commune});
  pharmacyLink.href=`farmacias-turno.html?${turnosParams}`;
  pharmacyLink.textContent=`Ver farmacias abiertas en ${selectedLocation.commune}`;
  pharmacyCta.hidden=false;
  const availabilityRank=product=>product.available===true?0:product.available===false?2:1;
  products.sort((a,b)=>availabilityRank(a)-availabilityRank(b)||a.price-b.price);
  const availableBest=products.findIndex(product=>product.available===true);
  const bestIndex=availableBest>=0?availableBest:0;
  products.forEach((product,index)=>{
    const isBest=index===bestIndex;
    const card=document.createElement('article');
    card.className=`result-card${isBest?' result-card--best':''}`;
    const stock=product.stock_quantity!==null&&product.stock_quantity!==undefined
      ?`${product.stock_quantity} unidades informadas`
      :product.available===true?'Stock informado: disponible'
        :product.available===false?'Sin stock':'Stock desconocido';
    const {region,commune}=locationValue();
    const destination=safeUrl(product.url);
    const productImage=safeUrl(product.image);
    const action=destination?`<a href="${destination}" target="_blank" rel="noopener noreferrer">Ver en farmacia →</a>`:'<span class="unavailable-link">Enlace no informado por la farmacia</span>';
    const logo=PHARMACY_LOGOS[product.pharmacy];
    const pharmacyClass=product.pharmacy==='Ahumada'
      ?' pharmacy-title--ahumada'
      :product.pharmacy==='Farmacia Municipal Iquique'
        ?' pharmacy-title--municipal'
        :'';
    const logoOnlyPharmacies=new Set(['Ahumada','Farmacia Municipal Iquique']);
    const pharmacyName=logoOnlyPharmacies.has(product.pharmacy)?'':`<span>${escapeHtml(product.pharmacy)}</span>`;
    const pharmacyTitle=`<span class="pharmacy pharmacy-title${pharmacyClass}">${logo?`<img src="${logo}" alt="Logo ${escapeHtml(product.pharmacy)}" loading="lazy">`:''}${pharmacyName}</span>`;
    const pharmacyNotice=product.pharmacy==='Farmacia Municipal Iquique'?'<small class="municipal-notice">Beneficio para personas inscritas con domicilio acreditado en Iquique.</small>':'';
    const badges=`<div class="product-badges">${product.bioequivalent?'<span class="product-badge bioequivalent">B Bioequivalente</span>':''}${product.fonasa_price?'<span class="product-badge fonasa">Fonasa</span>':''}</div>`;
    const fonasaPrice=product.fonasa_price?`<div class="fonasa-price"><span>Precio Fonasa</span><strong>${money(product.fonasa_price)}</strong></div>`:'';
    const priceCondition=product.list_price>product.price
      ?'<small class="price-condition"><b>Oferta publicada</b> · Condiciones de oferta no identificadas · Despacho no incluido</small>'
      :'<small class="price-condition"><b>Precio público informado</b> · Despacho no incluido</small>';
    const stockWarning=product.available===false||Number(product.stock_quantity)===0
      ?'<div class="stock-warning" role="note"><span aria-hidden="true">⚠</span><p><b>Disponibilidad por confirmar</b>Revisa directamente con la farmacia antes de acudir.</p></div>'
      :'';
    const unknownStockWarning=product.available===null||product.available===undefined
      ?'<div class="stock-warning stock-warning--unknown" role="note"><span aria-hidden="true">?</span><p><b>Stock desconocido</b>La farmacia no publicó disponibilidad para esta oferta.</p></div>'
      :'';
    const age=freshness(product.captured_at);
    const productSignature=signature(product.name);
    const packageCount=productSignature.packages[0]?Number(productSignature.packages[0].split('|')[0]):null;
    const unitPrice=packageCount>1?`<small class="unit-price">Precio por unidad: ${money(product.price/packageCount)} · Envase de ${packageCount}</small>`:'';
    const requested=signature($('#search-input').value);
    const reasons=[
      product.active_ingredient&&`Principio activo: ${product.active_ingredient}`,
      requested.doses.length&&`Concentración: ${requested.doses.map(value=>value.replace('|',' ')).join(' + ')}`,
      requested.forms.length&&`Forma: ${requested.forms.join(', ')}`,
      requested.packages.length&&`Presentación: ${requested.packages.map(value=>value.replace('|',' ')).join(', ')}`,
    ].filter(Boolean);
    const matchExplanation=`<small class="match-explanation"><b>Por qué coincide:</b> ${escapeHtml(reasons.join(' · ')||'nombre o marca del producto')}</small>`;
    const stockClass=product.available===true?'in-stock':product.available===false?'out-stock':'unknown-stock';
    const stockIcon=product.available===true?'●':product.available===false?'○':'?';
    card.innerHTML=`${isBest?'<span class="best-badge"><i aria-hidden="true">✓</i> Mejor opción</span>':''}${pharmacyTitle}${pharmacyNotice}<h3>${escapeHtml(product.name)}</h3><span>${escapeHtml(product.brand||'Marca no informada')}</span>${product.active_ingredient?`<small><b>Principio activo:</b> ${escapeHtml(product.active_ingredient)}</small>`:''}${badges}${fonasaPrice}<div><span class="price">${money(product.price)}</span> ${product.list_price?`<span class="old">${money(product.list_price)}</span>`:''}</div>${priceCondition}${unitPrice}<div class="result-meta"><span class="stock-status ${stockClass}">${stockIcon} ${escapeHtml(stock)}</span><span>${escapeHtml(commune)}, ${escapeHtml(region)}</span><span class="freshness-badge ${age.level}" title="${escapeHtml(formatDate(product.captured_at))}">Última verificación: ${escapeHtml(age.label)}</span><span>Fuente: sitio web de ${escapeHtml(product.pharmacy)}</span></div>${stockWarning}${unknownStockWarning}${matchExplanation}<small>${isBest?'Coincidencia exacta · Menor precio disponible':'Coincidencia exacta · Comparado'}</small>${action}`;
    const productHeading=card.querySelector('h3');
    if(productHeading){
      const summary=document.createElement('div');
      summary.className='result-product-summary';
      const visual=document.createElement('div');
      visual.className='result-product-visual';
      if(productImage){
        const image=document.createElement('img');
        image.className='result-product-image';
        image.src=productImage;
        image.alt='';
        image.loading='lazy';
        image.referrerPolicy='no-referrer';
        image.addEventListener('error',()=>{visual.classList.add('image-error');image.remove()});
        visual.appendChild(image);
      }else{
        visual.innerHTML='<span class="result-product-placeholder" aria-hidden="true">✚</span>';
      }
      productHeading.parentNode.insertBefore(summary,productHeading);
      summary.appendChild(visual);
      const copy=document.createElement('div');
      summary.appendChild(copy);
      copy.appendChild(productHeading);
      while(summary.nextSibling&&summary.nextSibling.nodeType===1&&summary.nextSibling.matches('span,small')){
        copy.appendChild(summary.nextSibling);
      }
    }
    const trust=document.createElement('div');
    trust.className='result-trust';
    trust.innerHTML='<span>Datos públicos</span><span>Precio publicado por la farmacia</span>';
    const explanation=card.querySelector('.match-explanation');
    explanation?.after(trust);
    const details=document.createElement('details');
    details.className='result-details';
    details.innerHTML='<summary>Ver más detalles</summary>';
    const list=document.createElement('dl');
    [
      ['Presentación',product.name],
      ['Concentración solicitada',requested.doses.map(value=>value.replace('|',' ')).join(' + ')||'No especificada'],
      ['Forma solicitada',requested.forms.join(', ')||'No especificada'],
      ['SKU',product.sku||'No informado'],
      ['Última verificación',formatDate(product.captured_at)],
    ].forEach(([term,value])=>{
      const row=document.createElement('div');
      const dt=document.createElement('dt');dt.textContent=term;
      const dd=document.createElement('dd');dd.textContent=value;
      row.append(dt,dd);list.appendChild(row);
    });
    details.appendChild(list);
    trust.after(details);
    container.appendChild(card);
  });
  if(source==='static') {
    const latest=products.map(product=>product.captured_at).filter(Boolean).sort().at(-1);
    const age=freshness(latest);
    container.insertAdjacentHTML('beforebegin',`<p id="demo-note" class="tool-output"><b>Información de precios:</b> última verificación del catálogo ${escapeHtml(age.label)}${latest?` · ${escapeHtml(formatDate(latest))}`:''}.</p>`);
  }
}

function renderApiUnavailable(query) {
  $('#results').innerHTML='';
  $('#open-pharmacies-cta').hidden=true;
  document.querySelector('#demo-note')?.remove();
  const status=$('#search-status');
  status.hidden=false;
  status.innerHTML=`<div class="empty-icon">!</div><h3>No fue posible cargar el catálogo</h3><p>La información de precios no está disponible temporalmente para “${escapeHtml(query)}”. Intenta nuevamente más tarde.</p>`;
}

let searchSuggestionTimer;
let searchSuggestionItems = [];
let activeSearchSuggestion = -1;
let searchSuggestionRequest = 0;
let selectedSearchProduct = '';
let searchSubmitting = false;

function closeSearchSuggestions() {
  searchSuggestionRequest += 1;
  const box = $('#search-suggestions');
  box.hidden = true;
  box.innerHTML = '';
  searchSuggestionItems = [];
  activeSearchSuggestion = -1;
  $('#search-input').setAttribute('aria-expanded', 'false');
  $('#search-input').removeAttribute('aria-activedescendant');
}

function selectSearchSuggestion(index) {
  const product = searchSuggestionItems[index];
  if (!product) return;
  $('#search-input').value = product.name;
  selectedSearchProduct = normalizeText(product.name);
  closeSearchSuggestions();
  $('#search-input').focus();
}

function paintActiveSearchSuggestion() {
  const options = [...document.querySelectorAll('.search-suggestion-option')];
  options.forEach((option, index) => {
    const active = index === activeSearchSuggestion;
    option.classList.toggle('active', active);
    option.setAttribute('aria-selected', String(active));
  });
  const active = options[activeSearchSuggestion];
  if (active) {
    $('#search-input').setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  } else {
    $('#search-input').removeAttribute('aria-activedescendant');
  }
}

async function refreshSearchSuggestions(rawQuery) {
  const requestId = ++searchSuggestionRequest;
  const validation = validateSearchQuery(rawQuery);
  if (validation.error) {
    closeSearchSuggestions();
    return;
  }
  const autocompleteText = value => normalizeText(String(value).replace(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui|iu|%)/gi, '$1$2'));
  const queryTerms = autocompleteText(validation.value).split(' ').filter(Boolean);
  const products = await loadStaticCatalog();
  if (requestId !== searchSuggestionRequest || $('#search-input').value !== rawQuery) return;
  const grouped = new Map();
  products.filter(product => product.price > 0).forEach(product => {
    const searchable = autocompleteText(`${product.name} ${product.brand || ''} ${product.active_ingredient || ''}`);
    const terms = new Set(searchable.split(' '));
    const matched = queryTerms.filter(term => terms.has(term) || [...terms].some(candidate => (
      term.length >= 3 && (
        candidate.startsWith(term)
        || term.startsWith(candidate)
        || closeToken(term, candidate)
      )
    ))).length;
    if (matched !== queryTerms.length) return;
    const key = normalizeText(product.name);
    const previous = grouped.get(key);
    const score = matched * 20
      + (normalizeText(product.name).startsWith(queryTerms[0]) ? 8 : 0)
      + (product.available !== false ? 3 : 0);
    if (!previous || score > previous.score || (score === previous.score && product.price < previous.price)) {
      grouped.set(key, { ...product, score });
    }
  });
  searchSuggestionItems = [...grouped.values()]
    .sort((left, right) => right.score - left.score || left.price - right.price || left.name.localeCompare(right.name, 'es'))
    .slice(0, 8);
  const box = $('#search-suggestions');
  if (!searchSuggestionItems.length) {
    box.replaceChildren();
    const empty=document.createElement('div');
    empty.className='search-suggestion-empty';
    empty.setAttribute('role','status');
    empty.textContent=`No encontramos “${validation.value}”. Revisa la ortografía o busca por marca o principio activo.`;
    box.appendChild(empty);
    box.hidden=false;
    activeSearchSuggestion=-1;
    $('#search-input').setAttribute('aria-expanded','true');
    return;
  }
  box.innerHTML = searchSuggestionItems.map((product, index) => `
    <button id="search-suggestion-${index}" class="search-suggestion-option" type="button" role="option" aria-selected="false" data-index="${index}">
      <span><b>${escapeHtml(product.name)}</b><small>${escapeHtml([
        product.brand || product.active_ingredient,
        product.pharmacy,
      ].filter(Boolean).join(' · '))}</small></span>
      <span class="search-suggestion-meta">
        <strong>${money(product.price)}</strong>
        <small class="${product.available === true ? 'available' : product.available === false ? 'unavailable' : 'unknown'}">${
          product.available === true ? 'Con stock' : product.available === false ? 'Sin stock' : 'Stock por confirmar'
        }</small>
      </span>
    </button>`).join('');
  box.hidden = false;
  activeSearchSuggestion = -1;
  $('#search-input').setAttribute('aria-expanded', 'true');
  box.querySelectorAll('.search-suggestion-option').forEach(option => {
    option.addEventListener('mousedown', event => event.preventDefault());
    option.addEventListener('click', () => selectSearchSuggestion(Number(option.dataset.index)));
  });
}

$('#search-form').addEventListener('submit', async (event)=>{
  event.preventDefault();
  if(searchSubmitting)return;
  closeSearchSuggestions();
  const validation=validateSearchQuery($('#search-input').value); const validationMessage=$('#search-validation');
  if(validation.error){validationMessage.textContent=validation.error;$('#search-input').setAttribute('aria-invalid','true');$('#search-input').focus();return;}
  if(selectedSearchProduct!==normalizeText(validation.value)){
    validationMessage.textContent='Selecciona un producto de la lista de sugerencias para comparar una presentación real del catálogo.';
    $('#search-input').setAttribute('aria-invalid','true');
    $('#search-input').focus();
    refreshSearchSuggestions(validation.value).catch(closeSearchSuggestions);
    return;
  }
  validationMessage.textContent=''; $('#search-input').removeAttribute('aria-invalid'); $('#search-input').value=validation.value;
  const q=validation.value; const {region,commune}=locationValue();
  const submitButton=$('#search-form button[type="submit"]');
  searchSubmitting=true;
  submitButton.disabled=true;
  submitButton.textContent='Comparando…';
  document.querySelector('#comparar').scrollIntoView({behavior:'smooth',block:'start'});
  $('#clear-results').hidden=false;
  $('#search-status').hidden=false; $('#search-status').innerHTML='<h3>Comparando farmacias…</h3>';
  try { const data=await api(`/api/search?q=${encodeURIComponent(q)}&region=${encodeURIComponent(region)}&commune=${encodeURIComponent(commune)}`); renderResults(data.results); }
  catch {
    try { renderResults(await searchStaticCatalog(q),'static'); }
    catch { renderApiUnavailable(q); }
  }
  finally {
    searchSubmitting=false;
    submitButton.disabled=false;
    submitButton.textContent='Comparar precios';
  }
});

$('#search-input').addEventListener('input',()=>{
  const input=$('#search-input');
  selectedSearchProduct='';
  if(input.hasAttribute('aria-invalid')){
    input.removeAttribute('aria-invalid');
    $('#search-validation').textContent='';
  }
  clearTimeout(searchSuggestionTimer);
  searchSuggestionTimer = setTimeout(() => {
    refreshSearchSuggestions(input.value).catch(closeSearchSuggestions);
  }, 140);
});

$('#search-input').addEventListener('keydown', event => {
  if ($('#search-suggestions').hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    activeSearchSuggestion = (activeSearchSuggestion + direction + searchSuggestionItems.length) % searchSuggestionItems.length;
    paintActiveSearchSuggestion();
  } else if (event.key === 'Enter' && activeSearchSuggestion >= 0) {
    event.preventDefault();
    selectSearchSuggestion(activeSearchSuggestion);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeSearchSuggestions();
  }
});

$('#search-input').addEventListener('blur', () => setTimeout(closeSearchSuggestions, 120));

$('#clear-results').addEventListener('click',()=>{
  $('#results').innerHTML='';
  document.querySelector('#demo-note')?.remove();
  const status=$('#search-status');
  status.hidden=false;
  status.innerHTML='<div class="empty-icon">⌕</div><h3>Busca tu primer medicamento</h3><p>Escribe un nombre, marca o principio activo arriba.</p>';
  $('#search-input').value='';
  $('#search-validation').textContent='';
  $('#search-input').removeAttribute('aria-invalid');
  $('#clear-results').hidden=true;
  $('#open-pharmacies-cta').hidden=true;
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
const recipeEscape=escapeHtml;
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
async function prepareRecipeImage(file) {
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(4,Math.max(2,1600/bitmap.width));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const image=context.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;
  for(let index=0;index<pixels.length;index+=4){
    const gray=.299*pixels[index]+.587*pixels[index+1]+.114*pixels[index+2];
    const enhanced=gray>225?255:Math.max(0,Math.min(255,(gray-128)*1.55+128));
    pixels[index]=pixels[index+1]=pixels[index+2]=enhanced;
  }
  context.putImageData(image,0,0);return canvas;
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
    const preparedImage=await prepareRecipeImage(file);
    const result=await Tesseract.recognize(preparedImage,'spa',{tessedit_pageseg_mode:'6',preserve_interword_spaces:'1',logger:message=>{if(message.status==='recognizing text'){const progress=Math.round((message.progress||0)*100);const label=output.querySelector('.ocr-progress span'),bar=output.querySelector('.ocr-progress i');if(label)label.textContent=`Reconociendo texto mejorado… ${progress}%`;if(bar)bar.style.setProperty('--progress',`${progress}%`)}}});
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

let alertCatalogProducts=[];
let alertSuggestionItems=[];
let activeAlertSuggestion=-1;
let selectedAlertProduct='';
let alertSuggestionTimer;

const validAlertEmail=(value)=>{
  if(value.length<6||value.length>120||/[\r\n\s<>()[\]{}\\,;:\"\x00-\x1f\x7f]/.test(value))return false;
  const parts=value.split('@');
  if(parts.length!==2)return false;
  const [local,domain]=parts;
  if(!local||local.length>64||domain.length>63||!domain.includes('.')||domain.startsWith('.')||domain.endsWith('.'))return false;
  if(local.startsWith('.')||local.endsWith('.')||local.includes('..')||domain.includes('..'))return false;
  if(!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local))return false;
  const labels=domain.split('.');
  if(!labels.every(label=>/^[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i.test(label)))return false;
  const commonTlds=new Set(['cl','com','net','org','edu','gov','mil','io','co','me','info','app','dev','tech','health','pharmacy','online','store','cloud','ai','es','ar','pe','mx','br','us','uk','de','fr','it','ca','au','jp']);
  return commonTlds.has(labels.at(-1).toLowerCase());
};

const setAlertError=(input,message)=>{
  $('#alert-message').textContent=message;
  ['#alert-query','#alert-email'].forEach(selector=>$(selector).removeAttribute('aria-invalid'));
  if(input){input.setAttribute('aria-invalid','true');input.focus();}
};

const alertModes=()=>[...document.querySelectorAll('input[name="alert-mode"]:checked')].map(input=>input.value);
const syncAlertMode=()=>{
  const modes=alertModes();
  const replenishment=modes.includes('replenishment');
  const price=modes.includes('price');
  $('#botiquin-fields').hidden=!replenishment;
  $('#botiquin-quantity').required=replenishment;
  $('#botiquin-daily-use').required=replenishment;
  $('#alert-submit').textContent=price&&replenishment
    ?'Crear alerta y guardar en mi botiquín'
    :replenishment?'Guardar en mi botiquín':'Avisarme si baja de precio';
  $('#alert-message').textContent='';
};

document.querySelectorAll('input[name="alert-mode"]').forEach(input=>input.addEventListener('change',syncAlertMode));
syncAlertMode();

$('#alert-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const modes=alertModes();
  if(!modes.length){setAlertError(null,'Selecciona al menos una opción: baja de precio, reposición o ambas.');return;}
  const email=$('#alert-email').value.normalize('NFC').trim().toLowerCase();
  const query=$('#alert-query').value.normalize('NFC').replace(/\s+/g,' ').trim();
  if(query.length<2||query.length>120){setAlertError($('#alert-query'),'Selecciona un producto de entre 2 y 120 caracteres.');return;}
  if(!/[\p{L}]{2}/u.test(query)||/(.)\1{7,}/iu.test(query)||query.split(' ').some(token=>token.length>50)){setAlertError($('#alert-query'),'Selecciona una sugerencia válida del catálogo; evita caracteres o repeticiones inusuales.');return;}
  if(!validAlertEmail(email)){setAlertError($('#alert-email'),'Ingresa un correo válido de hasta 120 caracteres (por ejemplo, nombre@dominio.cl).');return;}
  const products=await loadStaticCatalog().catch(()=>[]);
  if(selectedAlertProduct!==normalizeText(query)||!products.some(item=>normalizeText(item.name)===normalizeText(query))){setAlertError($('#alert-query'),'Selecciona un producto desde las sugerencias reales del catálogo.');openAlertSuggestions(query);return;}
  $('#alert-query').value=query; $('#alert-email').value=email;
  ['#alert-query','#alert-email'].forEach(selector=>$(selector).removeAttribute('aria-invalid'));
  const {region,commune}=locationValue();
  const messages=[];
  if(modes.includes('replenishment')){
    const quantity=Number($('#botiquin-quantity').value);
    const dailyUse=Number($('#botiquin-daily-use').value);
    const expiry=$('#botiquin-expiry').value;
    if(!Number.isFinite(quantity)||quantity<=0||quantity>10000){setAlertError($('#botiquin-quantity'),'Ingresa una cantidad disponible mayor que 0 y menor o igual a 10.000.');return;}
    if(!Number.isFinite(dailyUse)||dailyUse<=0||dailyUse>100){setAlertError($('#botiquin-daily-use'),'Ingresa un consumo diario mayor que 0 y menor o igual a 100.');return;}
    const days=Math.max(1,Math.floor(quantity/dailyUse));
    const replenishmentDate=new Date();
    replenishmentDate.setDate(replenishmentDate.getDate()+days);
    const record={
      query,email,region,commune,quantity,daily_use:dailyUse,expiry:expiry||null,
      estimated_replenishment:replenishmentDate.toISOString(),created_at:new Date().toISOString(),
    };
    const stored=JSON.parse(localStorage.getItem('ahorramed_botiquin')||'[]');
    stored.push(record);
    localStorage.setItem('ahorramed_botiquin',JSON.stringify(stored.slice(-50)));
    messages.push(`Producto guardado en este dispositivo. Reposición estimada: ${new Intl.DateTimeFormat('es-CL',{dateStyle:'long'}).format(replenishmentDate)}.`);
    if(!modes.includes('price')){
      $('#alert-message').textContent=`${messages.join(' ')} El correo requiere habilitar el servicio de notificaciones.`;
      return;
    }
  }
  const body={email,query,target_price:null,region,commune};
  try {
    const response = await api('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    messages.push(response.delivery_configured
      ? 'Revisa tu correo para confirmar la alerta. Podrás cancelarla desde cada aviso.'
      : 'Solicitud registrada, pero el envío de correo aún no está habilitado. No recibirás avisos hasta conectar el proveedor de email.');
    $('#alert-message').textContent=messages.join(' ');
  }
  catch {
    messages.push('La alerta de precio quedó guardada solo en este dispositivo. No se enviarán correos hasta conectar el servicio de alertas.');
    $('#alert-message').textContent=messages.join(' ');
    localStorage.setItem('farma_demo_alert',JSON.stringify(body));
  }
});

['#alert-query','#alert-email'].forEach(selector=>$(selector).addEventListener('input',()=>{
  $(selector).removeAttribute('aria-invalid');
  $('#alert-message').textContent='';
}));

function closeAlertSuggestions(){
  const box=$('#alert-suggestions');
  box.hidden=true;
  box.replaceChildren();
  alertSuggestionItems=[];
  activeAlertSuggestion=-1;
  $('#alert-query').setAttribute('aria-expanded','false');
  $('#alert-query').removeAttribute('aria-activedescendant');
}

function paintActiveAlertSuggestion(){
  const options=[...$('#alert-suggestions').querySelectorAll('.alert-suggestion-option')];
  options.forEach((option,index)=>{
    const active=index===activeAlertSuggestion;
    option.classList.toggle('active',active);
    option.setAttribute('aria-selected',String(active));
  });
  const active=options[activeAlertSuggestion];
  if(active){
    $('#alert-query').setAttribute('aria-activedescendant',active.id);
    active.scrollIntoView({block:'nearest'});
  }else{
    $('#alert-query').removeAttribute('aria-activedescendant');
  }
}

function selectAlertSuggestion(index){
  const product=alertSuggestionItems[index];
  if(!product)return;
  $('#alert-query').value=product.name;
  selectedAlertProduct=normalizeText(product.name);
  const presentation=inferPresentation(product.name);
  const quantity=$('#botiquin-quantity');
  const quantityHelp=$('#botiquin-quantity-help');
  if(presentation){
    quantity.value=presentation.quantity;
    quantity.dataset.autodetected='true';
    quantityHelp.textContent=`Detectado automáticamente: ${presentation.quantity} ${presentation.label} por envase. Puedes corregirlo si la caja informa otra cantidad.`;
  }else{
    quantity.value='';
    delete quantity.dataset.autodetected;
    quantityHelp.textContent='No pudimos detectar el contenido. Revísalo directamente en el envase.';
  }
  $('#alert-query-clear').hidden=false;
  $('#alert-query').removeAttribute('aria-invalid');
  $('#alert-message').textContent='';
  closeAlertSuggestions();
  $('#alert-query').focus();
}

function renderAlertSuggestions(items,query){
  const box=$('#alert-suggestions');
  box.replaceChildren();
  alertSuggestionItems=items;
  activeAlertSuggestion=-1;
  if(!items.length){
    const empty=document.createElement('div');
    empty.className='alert-suggestion-empty';
    empty.setAttribute('role','status');
    empty.textContent=`No encontramos “${query}”. Prueba con una marca, otro nombre o el principio activo.`;
    box.appendChild(empty);
  }else{
    items.forEach((product,index)=>{
      const option=document.createElement('button');
      option.type='button';
      option.id=`alert-suggestion-${index}`;
      option.className='alert-suggestion-option';
      option.setAttribute('role','option');
      option.setAttribute('aria-selected','false');

      const visual=document.createElement('span');
      visual.className='alert-suggestion-image';
      const imageUrl=safeUrl(product.image||product.image_url||product.imagen||'');
      if(imageUrl){
        const image=document.createElement('img');
        image.src=imageUrl;
        image.alt='';
        image.loading='lazy';
        image.addEventListener('error',()=>{visual.textContent='+';});
        visual.appendChild(image);
      }else visual.textContent='+';

      const copy=document.createElement('span');
      copy.className='alert-suggestion-copy';
      const name=document.createElement('b');
      name.textContent=product.name;
      const detail=document.createElement('small');
      detail.textContent=[product.brand||product.active_ingredient,product.pharmacy].filter(Boolean).join(' · ')||'Producto del catálogo';
      copy.append(name,detail);

      const meta=document.createElement('span');
      meta.className='alert-suggestion-meta';
      const price=document.createElement('strong');
      price.textContent=money(product.price);
      const stock=document.createElement('small');
      stock.className=product.available===true?'available':product.available===false?'unavailable':'unknown';
      stock.textContent=product.available===true?'Con stock':product.available===false?'Sin stock':'Por confirmar';
      meta.append(price,stock);
      option.append(visual,copy,meta);
      option.addEventListener('mousedown',event=>event.preventDefault());
      option.addEventListener('click',()=>selectAlertSuggestion(index));
      box.appendChild(option);
    });
  }
  box.hidden=false;
  $('#alert-query').setAttribute('aria-expanded','true');
}

function openAlertSuggestions(rawQuery){
  const query=String(rawQuery||'').normalize('NFC').replace(/\s+/g,' ').trim();
  if(query.length<2){closeAlertSuggestions();return;}
  const normalized=normalizeText(query);
  const queryTerms=normalized.split(' ').filter(Boolean);
  const grouped=new Map();
  alertCatalogProducts.filter(product=>product.price>0).forEach(product=>{
    const searchable=normalizeText(`${product.name} ${product.brand||''} ${product.active_ingredient||''}`);
    const offeredTerms=searchable.split(' ').filter(Boolean);
    const matched=queryTerms.every(term=>offeredTerms.some(candidate=>
      candidate===term||candidate.startsWith(term)||term.startsWith(candidate)||closeToken(term,candidate)
    ));
    if(!matched)return;
    const key=normalizeText(product.name);
    const score=localScore(query,product)+(normalizeText(product.name).startsWith(queryTerms[0])?1:0)+(product.available===true?.2:0);
    const previous=grouped.get(key);
    if(!previous||score>previous.score||(score===previous.score&&product.price<previous.price))grouped.set(key,{...product,score});
  });
  const matches=[...grouped.values()]
    .sort((left,right)=>right.score-left.score||left.price-right.price||left.name.localeCompare(right.name,'es'))
    .slice(0,8);
  renderAlertSuggestions(matches,query);
}

async function refreshAlertProducts(){
  closeAlertSuggestions();
  selectedAlertProduct='';
  $('#alert-query-clear').hidden=!$('#alert-query').value;
  try{alertCatalogProducts=await loadStaticCatalog();}
  catch{alertCatalogProducts=[];}
}

$('#alert-query').addEventListener('input',event=>{
  selectedAlertProduct='';
  $('#alert-query-clear').hidden=!event.target.value;
  clearTimeout(alertSuggestionTimer);
  alertSuggestionTimer=setTimeout(()=>openAlertSuggestions(event.target.value),140);
});
$('#alert-query').addEventListener('keydown',event=>{
  if($('#alert-suggestions').hidden){
    if(event.key==='ArrowDown'){event.preventDefault();openAlertSuggestions(event.target.value);}
    return;
  }
  if(event.key==='ArrowDown'){event.preventDefault();activeAlertSuggestion=Math.min(activeAlertSuggestion+1,alertSuggestionItems.length-1);paintActiveAlertSuggestion();}
  else if(event.key==='ArrowUp'){event.preventDefault();activeAlertSuggestion=Math.max(activeAlertSuggestion-1,0);paintActiveAlertSuggestion();}
  else if(event.key==='Enter'&&activeAlertSuggestion>=0){event.preventDefault();selectAlertSuggestion(activeAlertSuggestion);}
  else if(event.key==='Escape'){event.preventDefault();closeAlertSuggestions();}
});
$('#alert-query').addEventListener('focus',event=>{if(event.target.value.trim().length>=2)openAlertSuggestions(event.target.value);});
$('#alert-query-clear').addEventListener('click',()=>{
  clearTimeout(alertSuggestionTimer);
  $('#alert-query').value='';
  $('#botiquin-quantity').value='';
  delete $('#botiquin-quantity').dataset.autodetected;
  $('#botiquin-quantity-help').textContent='Se completa desde la presentación cuando el producto informa su contenido.';
  selectedAlertProduct='';
  $('#alert-query-clear').hidden=true;
  $('#alert-query').removeAttribute('aria-invalid');
  $('#alert-message').textContent='';
  closeAlertSuggestions();
  $('#alert-query').focus();
});
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('.alert-autocomplete'))closeAlertSuggestions();
});

$('.menu-btn').addEventListener('click',()=>{ const links=$('.nav-links'); links.classList.toggle('open'); $('.menu-btn').setAttribute('aria-expanded',links.classList.contains('open')); });

$('#region-select').addEventListener('change',()=>{
  closeSearchSuggestions();
  const communeSelect=$('#commune-select');
  communeSelect.innerHTML='';
  (COMMUNES_BY_REGION[$('#region-select').value]||[]).forEach(commune=>{
    const option=document.createElement('option');
    option.value=commune; option.textContent=commune;
    communeSelect.appendChild(option);
  });
  updateHeroCoverage();
  refreshAlertProducts();
});

$('#commune-select').addEventListener('change',()=>{closeSearchSuggestions();updateHeroCoverage();refreshAlertProducts()});

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
refreshAlertProducts();

const toolsCarousel=$('#tools-carousel');
const toolsPrevious=$('#tools-prev');
const toolsNext=$('#tools-next');
const toolsProgress=$('#tools-progress');
if(toolsCarousel&&toolsPrevious&&toolsNext){
  let carouselPointer=null;
  let carouselStartX=0;
  let carouselStartScroll=0;
  let carouselDragged=false;
  const updateToolsCarousel=()=>{
    const max=Math.max(0,toolsCarousel.scrollWidth-toolsCarousel.clientWidth);
    const progress=max?Math.min(1,Math.max(0,toolsCarousel.scrollLeft/max)):0;
    toolsPrevious.disabled=toolsCarousel.scrollLeft<=2;
    toolsNext.disabled=toolsCarousel.scrollLeft>=max-2;
    if(toolsProgress)toolsProgress.style.transform=`translateX(${progress*455}%)`;
  };
  const carouselStep=()=>Math.max(245,Math.round(toolsCarousel.clientWidth*.72));
  toolsPrevious.addEventListener('click',()=>toolsCarousel.scrollBy({left:-carouselStep(),behavior:'smooth'}));
  toolsNext.addEventListener('click',()=>toolsCarousel.scrollBy({left:carouselStep(),behavior:'smooth'}));
  toolsCarousel.addEventListener('scroll',()=>requestAnimationFrame(updateToolsCarousel),{passive:true});
  toolsCarousel.addEventListener('keydown',event=>{
    if(event.key==='ArrowRight'){event.preventDefault();toolsCarousel.scrollBy({left:carouselStep(),behavior:'smooth'});}
    else if(event.key==='ArrowLeft'){event.preventDefault();toolsCarousel.scrollBy({left:-carouselStep(),behavior:'smooth'});}
  });
  toolsCarousel.addEventListener('pointerdown',event=>{
    if(event.pointerType==='touch')return;
    if(event.target.closest('a,button'))return;
    carouselPointer=event.pointerId;
    carouselStartX=event.clientX;
    carouselStartScroll=toolsCarousel.scrollLeft;
    carouselDragged=false;
    toolsCarousel.setPointerCapture(event.pointerId);
    toolsCarousel.classList.add('dragging');
  });
  toolsCarousel.addEventListener('pointermove',event=>{
    if(event.pointerId!==carouselPointer)return;
    const delta=event.clientX-carouselStartX;
    if(Math.abs(delta)>12)carouselDragged=true;
    toolsCarousel.scrollLeft=carouselStartScroll-delta;
  });
  const finishCarouselDrag=event=>{
    if(event.pointerId!==carouselPointer)return;
    carouselPointer=null;
    toolsCarousel.classList.remove('dragging');
  };
  toolsCarousel.addEventListener('pointerup',finishCarouselDrag);
  toolsCarousel.addEventListener('pointercancel',finishCarouselDrag);
  toolsCarousel.addEventListener('click',event=>{
    if(carouselDragged){event.preventDefault();event.stopPropagation();carouselDragged=false;}
  },true);
  window.addEventListener('resize',updateToolsCarousel,{passive:true});
  requestAnimationFrame(updateToolsCarousel);
}
