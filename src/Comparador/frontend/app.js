const API_BASE = localStorage.getItem('farma_api') || (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8000' : '');
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value || 0);
const COMMUNES_BY_REGION = {
  Tarapaca: ['Iquique'],
  'Arica y Parinacota': ['Arica'],
  Antofagasta: ['Antofagasta']
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
const signature = (value) => {
  const text=value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const doses=[...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|%)(?=\b)/g)].map(match=>`${match[1].replace(',','.')}|${match[2]==='ug'?'mcg':match[2]}`);
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
async function loadStaticCatalog() {
  staticManifestPromise ||= fetch('./data/manifest.json').then(response=>{
    if(!response.ok) throw new Error('Catalogo estatico no disponible');
    return response.json();
  });
  const manifest=await staticManifestPromise;
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

async function api(path, options={}) {
  if (!API_BASE) throw new Error('API no configurada');
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) throw new Error((await response.text()) || 'No se pudo consultar la API');
  return response.json();
}

function renderResults(products, source='api') {
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
    card.innerHTML=`${isBest?'<span class="best-badge"><i>✓</i> Mejor opción</span>':''}<span class="pharmacy">${product.pharmacy}</span><h3>${product.name}</h3><span>${product.brand||'Marca no informada'}</span>${product.active_ingredient?`<small><b>Principio activo:</b> ${product.active_ingredient}</small>`:''}<div><span class="price">${money(product.price)}</span> ${product.list_price?`<span class="old">${money(product.list_price)}</span>`:''}</div><div class="result-meta"><span class="stock-status ${product.available?'in-stock':'out-stock'}">${product.available?'●':'○'} ${stock}</span><span>${commune}, ${region}</span><span>Actualizado: ${formatDate(product.captured_at)}</span></div><small>${isBest?'Coincidencia exacta · Menor precio disponible':'Coincidencia exacta · Comparado'}</small>${action}`;
    container.appendChild(card);
  });
  if(source==='static') container.insertAdjacentHTML('beforebegin','<p id="demo-note" class="tool-output"><b>Datos del scraping:</b> catálogo completo de la última ejecución disponible.</p>');
}

function renderApiUnavailable(query) {
  $('#results').innerHTML='';
  document.querySelector('#demo-note')?.remove();
  const status=$('#search-status');
  status.hidden=false;
  status.innerHTML=`<div class="empty-icon">!</div><h3>No fue posible cargar el catálogo</h3><p>No se pudo consultar ni la API ni los archivos del scraping para “${query}”. Vuelve a desplegar el sitio para regenerar los datos.</p>`;
}

$('#search-form').addEventListener('submit', async (event)=>{
  event.preventDefault(); const q=$('#search-input').value.trim(); const {region,commune}=locationValue();
  $('#search-status').hidden=false; $('#search-status').innerHTML='<h3>Comparando farmacias…</h3>';
  try { const data=await api(`/api/search?q=${encodeURIComponent(q)}&region=${encodeURIComponent(region)}&commune=${encodeURIComponent(commune)}`); renderResults(data.results); }
  catch {
    try { renderResults(await searchStaticCatalog(q),'static'); }
    catch { renderApiUnavailable(q); }
  }
  document.querySelector('#comparar').scrollIntoView({behavior:'smooth'});
});

$('#treatment-form').addEventListener('submit', async (event)=>{
  event.preventDefault(); const {region,commune}=locationValue();
  const body={region,commune,days:+$('#treatment-days').value,items:[{query:$('#treatment-query').value,units_per_dose:+$('#units-dose').value,doses_per_day:+$('#doses-day').value,units_per_package:+$('#units-pack').value}]};
  let result; try { result=await api('/api/treatments/monthly-cost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
  catch { const packages=Math.ceil(body.items[0].units_per_dose*body.items[0].doses_per_day*body.days/body.items[0].units_per_package); result={total:packages*1290,items:[{packages,pharmacy:'Ahumada'}]}; }
  $('#treatment-result').innerHTML=`<span>Costo estimado para ${body.days} días</span><strong>${money(result.total)}</strong><p>${result.items[0]?.packages||0} envase(s) · mejor alternativa ${result.items[0]?.pharmacy||'sin coincidencia'}</p>`;
});

$('#recipe-file').addEventListener('change', async (event)=>{
  const file=event.target.files[0]; if(!file)return; const output=$('#recipe-output'); output.textContent='Procesando receta…';
  const form=new FormData(); form.append('file',file);
  try { const data=await api('/api/recipes/extract',{method:'POST',body:form}); output.innerHTML=`<b>${data.medicines.length} posibles medicamentos detectados</b><br>${data.medicines.map(m=>m.query).join('<br>')||'Revisa manualmente el texto extraído.'}`; }
  catch(error){ output.textContent=`Para procesar la receta conecta el backend Python. Archivo seleccionado: ${file.name}`; }
});

$('#demo-optimize').addEventListener('click', async ()=>{
  const {region,commune}=locationValue(); const body={region,commune,pickup:true,minimum_split_savings:1000,items:[{query:'paracetamol',quantity:2},{query:'ibuprofeno',quantity:1}]};
  const output=$('#recipe-output');
  try { const data=await api('/api/recipes/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const r=data.recommendation; output.innerHTML=`<b>Compra optimizada: ${money(r.total)}</b><br>${r.lines.map(x=>`${x.product} en ${x.pharmacy}: ${money(x.subtotal)}`).join('<br>')}<br>Ahorro: ${money(data.savings)}`; }
  catch { output.innerHTML='<b>Ejemplo de optimización</b><br>Paracetamol en Ahumada: $2.580<br>Ibuprofeno en Dr. Simi: $2.100<br><b>Total: $4.680</b>'; }
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
});
