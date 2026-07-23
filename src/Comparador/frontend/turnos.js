const $ = (selector) => document.querySelector(selector);
const API_URL = '/.netlify/functions/farmacias-turno';
const REGION_NAMES = {1:'Tarapacá',2:'Antofagasta',3:'Atacama',4:'Coquimbo',5:'Valparaíso',6:"O'Higgins",7:'Maule',8:'Biobío',9:'La Araucanía',10:'Los Lagos',11:'Aysén',12:'Magallanes',13:'Metropolitana',14:'Los Ríos',15:'Arica y Parinacota',16:'Ñuble'};
const REGION_BOUNDS = {
  'Arica y Parinacota':{south:-19.3,north:-17.4,west:-70.7,east:-68.8},
  'Tarapacá':{south:-21.7,north:-18.8,west:-71.2,east:-68.3},
  'Antofagasta':{south:-26.2,north:-20.8,west:-71.3,east:-67.8},
  'Atacama':{south:-29.6,north:-25.2,west:-72,east:-68},
  'Coquimbo':{south:-32.3,north:-29,west:-72,east:-69.6},
  'Valparaíso':{south:-34.2,north:-31,west:-72.5,east:-69.9},
  'Metropolitana':{south:-34.4,north:-32.8,west:-71.8,east:-69.8},
  "O'Higgins":{south:-35.1,north:-33.7,west:-72.1,east:-69.8},
  'Maule':{south:-36.6,north:-34.7,west:-72.8,east:-70.2},
  'Ñuble':{south:-37.3,north:-36,west:-72.9,east:-71},
  'Biobío':{south:-38.5,north:-36.7,west:-74,east:-70.8},
  'La Araucanía':{south:-39.7,north:-37.5,west:-73.8,east:-70.8},
  'Los Ríos':{south:-40.8,north:-39.2,west:-74,east:-71.4},
  'Los Lagos':{south:-44.1,north:-40.2,west:-75,east:-71.3},
  'Aysén':{south:-49.3,north:-43.5,west:-76,east:-71.5},
  'Magallanes':{south:-56,north:-48.5,west:-76,east:-66}
};
const KNOWN_COMMUNES = {
  Metropolitana: ['Santiago','Cerrillos','Cerro Navia','Conchalí','El Bosque','Estación Central','Huechuraba','Independencia','La Cisterna','La Florida','La Granja','La Pintana','La Reina','Las Condes','Lo Barnechea','Lo Espejo','Lo Prado','Macul','Maipú','Ñuñoa','Pedro Aguirre Cerda','Peñalolén','Providencia','Pudahuel','Quilicura','Quinta Normal','Recoleta','Renca','San Joaquín','San Miguel','San Ramón','Vitacura','Puente Alto','San Bernardo']
};
let pharmacies=[]; let filtered=[]; let userPosition=null; let userMarker=null; let markers=[]; let typeFilter='turno'; let loadedMode='duty';

const map=L.map('turno-map',{zoomControl:true}).setView([-33.45,-70.66],5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,
  attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const normalize=(value='')=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const regionName=(item)=>REGION_NAMES[item.region_id]||item.region||'Región no informada';
const validCoordinates=(item)=>Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)&&item.latitude>=-57&&item.latitude<=-17&&item.longitude>=-77&&item.longitude<=-66;
const timeText=(value)=>value?value.slice(0,5):'No informado';
const scheduleText=(item)=>item.duty_schedule||item.schedule||(item.opens_at||item.closes_at?`${timeText(item.opens_at)}–${timeText(item.closes_at)}`:'Horario no informado');
const toMinutes=(value)=>{const [hour,minute]=String(value||'').split(':').map(Number);return Number.isFinite(hour)&&Number.isFinite(minute)?hour*60+minute:null;};
function isOpen(item) {
  if(typeof item.open_now==='boolean') return item.open_now;
  const open=toMinutes(item.opens_at); const close=toMinutes(item.closes_at);
  if(open===null||close===null) return null;
  const parts=new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const now=Number(parts.find(part=>part.type==='hour')?.value)*60+Number(parts.find(part=>part.type==='minute')?.value);
  return close<=open?now>=open||now<=close:now>=open&&now<=close;
}
function distanceKm(a,b) {
  const rad=(value)=>value*Math.PI/180; const earth=6371;
  const dLat=rad(b.latitude-a.latitude); const dLng=rad(b.longitude-a.longitude);
  const value=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLng/2)**2;
  return earth*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));
}
const isUrgency=(item)=>normalize(item.type).includes('urgencia');
function directoryType(item) {
  const value=normalize(`${item.type||''} ${item.category||''} ${item.name||''}`);
  if(value.includes('urgencia')||value.includes('24 horas')||value.includes('24hrs'))return 'urgencia';
  if(value.includes('movil'))return 'movil';
  if(value.includes('municipal')||value.includes('comunal')||value.includes('popular'))return 'municipal';
  if(value.includes('almacen farmaceutico')||value.startsWith('almacen ')||value.includes('botiquin'))return 'almacen';
  if(value.includes('turno'))return 'turno';
  return 'privada';
}
const TYPE_LABELS={
  turno:'Farmacia de turno',
  urgencia:'Urgencia 24 horas',
  movil:'Farmacia móvil',
  municipal:'Farmacia municipal',
  privada:'Farmacia privada',
  almacen:'Almacén farmacéutico',
  todas:'Farmacia'
};
const matchesType=(item,type)=>type==='todas'||directoryType(item)===type;
function markerIcon(open,item) {
  const colors={urgencia:'#e5484d',movil:'#7051d8',municipal:'#e76f19',privada:'#2876c8',almacen:'#d92f78',turno:'#087f68'};
  const color=open===false?'#a94b4b':colors[directoryType(item)]||'#087f68';
  return L.divIcon({className:'',html:`<span style="display:grid;place-items:center;width:30px;height:30px;border:3px solid white;border-radius:50% 50% 50% 0;background:${color};color:white;font-weight:800;box-shadow:0 4px 14px #0004;transform:rotate(-45deg)"><i style="transform:rotate(45deg);font-style:normal">+</i></span>`,iconSize:[30,30],iconAnchor:[15,30]});
}
function setOptions(select,values,placeholder) {
  const current=select.value; select.innerHTML='';
  const first=document.createElement('option'); first.value=''; first.textContent=placeholder; select.appendChild(first);
  [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')).forEach(value=>{
    const option=document.createElement('option'); option.value=value; option.textContent=value; select.appendChild(option);
  });
  if([...select.options].some(option=>option.value===current)) select.value=current;
}
function updateCommunes() {
  const region=$('#turno-region').value;
  const informed=pharmacies.filter(item=>!region||regionName(item)===region).map(item=>item.commune);
  setOptions($('#turno-commune'),[...(KNOWN_COMMUNES[region]||[]),...informed],'Todas las comunas');
}
function clearMarkers() { markers.forEach(marker=>map.removeLayer(marker)); markers=[]; }
function fitVisibleMarkers() {
  const points=filtered.filter(validCoordinates).map(item=>[item.latitude,item.longitude]);
  if(userPosition) points.push([userPosition.latitude,userPosition.longitude]);
  if(points.length===1) map.setView(points[0],14);
  else if(points.length>1) map.fitBounds(points,{padding:[35,35],maxZoom:15});
}
function createCard(item) {
  const card=document.createElement('article'); card.className='turno-card';
  const opened=isOpen(item); const category=directoryType(item); const distance=userPosition&&validCoordinates(item)?distanceKm(userPosition,item):null;
  const header=document.createElement('div'); header.className='turno-card-header';
  const title=document.createElement('h3'); title.textContent=item.name;
  const badge=document.createElement('span'); badge.className=`turno-badge${opened===false?' closed':''}`;
  if(category==='urgencia'){badge.classList.add('urgency');badge.textContent=opened===false?'Urgencia · por confirmar':'Urgencia 24 horas'}
  else if(loadedMode==='all'){badge.classList.add(category==='movil'?'mobile':category==='municipal'?'municipal':category==='almacen'?'warehouse':'private');badge.textContent=TYPE_LABELS[category]}
  else badge.textContent=item.on_duty&&opened===true?'De turno · abierta':item.on_duty?'De turno':opened===true?'Abierta ahora':opened===false?'Fuera de horario':'Horario informado';
  header.append(title,badge); card.appendChild(header);
  const address=document.createElement('span'); address.className='turno-address'; address.textContent=`${item.address}${item.commune?`, ${item.commune}`:''}`; card.appendChild(address);
  const hours=document.createElement('span'); hours.className='turno-hours';
  hours.textContent=`Horario informado: ${scheduleText(item)}${item.weekday?` · ${item.weekday}`:''}`; card.appendChild(hours);
  if(distance!==null){const line=document.createElement('span');line.className='turno-distance';line.textContent=`A ${distance<10?distance.toFixed(1):Math.round(distance)} km de tu ubicación`;card.appendChild(line);}
  const actions=document.createElement('div'); actions.className='turno-actions';
  if(item.phone){const call=document.createElement('a');call.href=`tel:${item.phone.replace(/[^+\d]/g,'')}`;call.textContent='Llamar';actions.appendChild(call);}
  if(validCoordinates(item)) {
    const route=document.createElement('a');route.className='primary';route.href=`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`;route.target='_blank';route.rel='noopener';route.textContent='Cómo llegar';actions.appendChild(route);
    const locate=document.createElement('button');locate.type='button';locate.textContent='Ver en mapa';locate.addEventListener('click',()=>map.setView([item.latitude,item.longitude],16));actions.appendChild(locate);
  }
  card.appendChild(actions); return card;
}
function render() {
  const region=$('#turno-region').value; const commune=$('#turno-commune').value; const search=normalize($('#turno-search').value);
  filtered=pharmacies.filter(item=>matchesType(item,typeFilter)&&(!region||regionName(item)===region)&&(!commune||normalize(item.commune)===normalize(commune))&&(!search||normalize(`${item.name} ${item.address} ${item.commune} ${regionName(item)}`).includes(search)));
  if(userPosition) filtered.sort((a,b)=>(validCoordinates(a)?distanceKm(userPosition,a):Infinity)-(validCoordinates(b)?distanceKm(userPosition,b):Infinity));
  $('#turno-count').textContent=new Intl.NumberFormat('es-CL').format(filtered.length);
  const container=$('#turno-results'); container.innerHTML=''; clearMarkers();
  filtered.forEach(item=>{
    container.appendChild(createCard(item));
    if(validCoordinates(item)) {
      const marker=L.marker([item.latitude,item.longitude],{icon:markerIcon(isOpen(item),item)}).addTo(map);
      marker.bindPopup(`<b>${item.name.replace(/[<>&]/g,'')}</b><br>${item.address.replace(/[<>&]/g,'')}<br>${scheduleText(item).replace(/[<>&]/g,'')}`); markers.push(marker);
    }
  });
  $('#turno-status').hidden=filtered.length>0;
  if(!filtered.length){
    $('#turno-status').hidden=false;
    const place=commune||$('#turno-search').value.trim();
    if(typeFilter!=='todas'&&place){
      const safePlace=String(place).replace(/[<>&]/g,'');
      $('#turno-status').innerHTML=`No hay establecimientos de tipo <b>${TYPE_LABELS[typeFilter]}</b> informados para <b>${safePlace}</b>. Prueba con el directorio completo. <button id="show-all-from-empty" type="button">Ver todas las farmacias</button>`;
      $('#show-all-from-empty').addEventListener('click',()=>document.querySelector('.turno-type-filter button[data-type="todas"]').click());
    }else $('#turno-status').textContent='No hay farmacias que coincidan con los filtros seleccionados.';
  }
  fitVisibleMarkers();
}
async function loadRegion(region='Tarapacá',mode=['turno','urgencia'].includes(typeFilter)?'duty':'all') {
  const bounds=REGION_BOUNDS[region]||REGION_BOUNDS.Tarapacá;
  const params=new URLSearchParams({...bounds,region,mode});
  $('#turno-status').hidden=false;
  $('#turno-status').textContent='Consultando farmacias de la región…';
  try {
    const response=await fetch(`${API_URL}?${params}`); const payload=await response.json();
    if(!response.ok) throw new Error(payload.error||'No fue posible consultar las farmacias');
    pharmacies=payload.pharmacies.map(item=>({...item,region:regionName(item)}));
    loadedMode=mode;
    $('#turno-region').value=region;
    updateCommunes();
    if(region==='Tarapacá') {
      const item=pharmacies.find(item=>normalize(item.commune)==='iquique');
      if(item) $('#turno-commune').value=item.commune;
    }
    const dates=pharmacies.map(item=>item.date).filter(Boolean).sort(); $('#turno-date').textContent=dates.at(-1)||'Hoy';
    $('#turno-source').textContent=`Fuente: ${payload.source}${payload.indirect?' · fuente de respaldo':''}${payload.stale?' · última copia disponible':''} · consultado ${new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(payload.fetched_at))}`;
    render();
  } catch(error) {
    pharmacies=[]; clearMarkers(); $('#turno-count').textContent='0'; updateCommunes();
    $('#turno-status').hidden=false; $('#turno-status').innerHTML='No fue posible actualizar la información en este momento. <a href="https://seremienlinea.minsal.cl/asdigital/index.php?mfarmacias" target="_blank" rel="noopener">Consultar el mapa oficial MINSAL</a>.';
    $('#turno-source').textContent=error.message;
  }
}
setOptions($('#turno-region'),Object.keys(REGION_BOUNDS),'Selecciona una región');
$('#turno-region').value='Tarapacá';
$('#turno-region').addEventListener('change',event=>loadRegion(event.target.value||'Tarapacá'));
$('#turno-commune').addEventListener('change',render); $('#turno-search').addEventListener('input',render); $('#fit-map').addEventListener('click',fitVisibleMarkers);
document.querySelectorAll('.turno-type-filter button').forEach(button=>button.addEventListener('click',async()=>{typeFilter=button.dataset.type;document.querySelectorAll('.turno-type-filter button').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});const requiredMode=['turno','urgencia'].includes(typeFilter)?'duty':'all';if(loadedMode!==requiredMode)await loadRegion($('#turno-region').value||'Tarapacá',requiredMode);else render()}));
$('#use-location').addEventListener('click',()=>{
  if(!navigator.geolocation){$('#turno-status').hidden=false;$('#turno-status').textContent='Tu navegador no permite obtener la ubicación.';return;}
  const button=$('#use-location'); button.disabled=true; button.textContent='Obteniendo ubicación…';
  navigator.geolocation.getCurrentPosition(position=>{
    userPosition={latitude:position.coords.latitude,longitude:position.coords.longitude};
    if(userMarker) map.removeLayer(userMarker);
    userMarker=L.marker([userPosition.latitude,userPosition.longitude],{icon:L.divIcon({className:'',html:'<span class="user-location-marker"></span>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map).bindPopup('Tu ubicación aproximada');
    button.disabled=false;button.textContent='⌖ Mi ubicación activa';render();
  },()=>{button.disabled=false;button.textContent='⌖ Usar mi ubicación';$('#turno-status').hidden=false;$('#turno-status').textContent='No pudimos acceder a tu ubicación. Revisa el permiso del navegador.';},{enableHighAccuracy:true,timeout:10000,maximumAge:300000});
});
$('.menu-btn').addEventListener('click',()=>{const links=$('.nav-links');links.classList.toggle('open');$('.menu-btn').setAttribute('aria-expanded',links.classList.contains('open'));});
loadRegion();
