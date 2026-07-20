const API_BASE = localStorage.getItem('farma_api') || 'http://localhost:8000';
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value || 0);
const locationValue = () => { const [region, commune] = $('#location-select').value.split('|'); return {region, commune}; };

const demoProducts = [
  {pharmacy:'Ahumada',sku:'A-101',name:'Paracetamol 500 mg 16 comprimidos',brand:'Genérico',price:1290,list_price:1990,available:true,url:'#'},
  {pharmacy:'Dr. Simi',sku:'D-102',name:'Paracetamol 500 mg 20 comprimidos',brand:'Dr. Simi',price:1480,list_price:1960,available:true,url:'#'},
  {pharmacy:'Salcobrand',sku:'S-103',name:'Paracetamol 500 mg 16 comprimidos',brand:'Kitadol',price:1790,list_price:2490,available:true,url:'#'},
  {pharmacy:'Cruz Verde',sku:'C-104',name:'Paracetamol 500 mg 20 comprimidos',brand:'Genérico',price:1990,list_price:2990,available:true,url:'#'}
];

async function api(path, options={}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) throw new Error((await response.text()) || 'No se pudo consultar la API');
  return response.json();
}

function renderResults(products, demo=false) {
  $('#search-status').hidden = true;
  const container = $('#results'); container.innerHTML = '';
  if (!products.length) { $('#search-status').hidden=false; $('#search-status').innerHTML='<h3>Sin coincidencias</h3><p>Prueba con otro nombre o principio activo.</p>'; return; }
  products.sort((a,b)=>a.price-b.price).forEach((product,index)=>{
    const card=document.createElement('article'); card.className='result-card';
    card.innerHTML=`<span class="pharmacy">${product.pharmacy}</span><h3>${product.name}</h3><span>${product.brand||'Marca no informada'}</span><div><span class="price">${money(product.price)}</span> ${product.list_price?`<span class="old">${money(product.list_price)}</span>`:''}</div><small>${product.available?'Disponible':'Confirma disponibilidad'} · ${index===0?'Mejor precio':'Comparado'}</small><a href="${product.url||'#'}" target="_blank" rel="noopener">Ver en farmacia →</a>`;
    container.appendChild(card);
  });
  if(demo) container.insertAdjacentHTML('beforebegin','<p id="demo-note" class="tool-output">Vista demostrativa. Despliega el backend para consultar tus CSV reales.</p>');
}

$('#search-form').addEventListener('submit', async (event)=>{
  event.preventDefault(); const q=$('#search-input').value.trim(); const {region,commune}=locationValue();
  $('#search-status').hidden=false; $('#search-status').innerHTML='<h3>Comparando farmacias…</h3>';
  try { const data=await api(`/api/search?q=${encodeURIComponent(q)}&region=${encodeURIComponent(region)}&commune=${encodeURIComponent(commune)}`); renderResults(data.results); }
  catch { renderResults(demoProducts.filter(p=>p.name.toLowerCase().includes(q.split(' ')[0].toLowerCase())||q.length>1),true); }
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
