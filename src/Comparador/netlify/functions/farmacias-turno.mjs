import { getStore } from '@netlify/blobs';

const SEREMI_ENDPOINT = 'https://seremienlinea.minsal.cl/asdigital/mfarmacias/mapa.php';
export const MINSAL_REGIONS = ['Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso','Metropolitana',"O'Higgins",'Maule','Ñuble','Biobío','La Araucanía','Los Ríos','Los Lagos','Aysén','Magallanes'];
const OFFICIAL_ENDPOINTS = [
  'https://farmanet.minsal.cl/maps/index.php/ws/getLocalesTurnos',
  'https://farmanet.minsal.cl/index.php/ws/getLocalesTurnos',
  'http://farmanet.minsal.cl/maps/index.php/ws/getLocalesTurnos',
  'http://farmanet.minsal.cl/index.php/ws/getLocalesTurnos'
];

const memoryCache = new Map();
const CACHE_MS = 30 * 60 * 1000;

const text = (value) => {
  let result=String(value ?? '').trim();
  if(/[ÃÂ]/.test(result)&&[...result].every(character=>character.charCodeAt(0)<=255)) {
    try {
      result=decodeURIComponent([...result].map(character=>
        `%${character.charCodeAt(0).toString(16).padStart(2,'0')}`
      ).join(''));
    } catch {}
  }
  return result;
};
const number = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};
const comparable = (value='') => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const slug = (value='') => comparable(value).replace(/\s+/g,'-');
const chileParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
const chileNow = () => { const parts=chileParts(); return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}:${parts.second}`}; };
const cleanHtml = (value='') => text(value).replace(/<br\s*\/?\s*>/gi,' · ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

async function postSeremi(body, timeoutMs=8000) {
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(SEREMI_ENDPOINT,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':'AhorraMed/1.0'},body:new URLSearchParams(body),signal:controller.signal});
    if(!response.ok)throw new Error(`SEREMI HTTP ${response.status}`);
    const payload=await response.json(); if(!payload?.correcto)throw new Error(payload?.info||'Respuesta SEREMI inválida'); return payload.respuesta;
  } finally { clearTimeout(timeout); }
}

async function mapLimit(items, limit, mapper) {
  const output=new Array(items.length); let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const index=cursor++;output[index]=await mapper(items[index],index)}}));
  return output;
}

async function withRetry(task, attempts=3) {
  let lastError;
  for(let attempt=0;attempt<attempts;attempt+=1) {
    try { return await task(); }
    catch(error) { lastError=error; }
  }
  throw lastError;
}

function regionMatch(regions, requested) {
  const wanted=comparable(requested);
  return regions.find(item=>{const name=comparable(item.nombre);return name===wanted||name.includes(wanted)||wanted.includes(name)||wanted==="o higgins"&&name.includes('higgins')});
}

export async function fetchSeremiRegion(requestedRegion) {
  const [regions,dates]=await Promise.all([postSeremi({func:'regiones'}),postSeremi({func:'fechas'})]);
  const region=regionMatch(regions,requestedRegion); if(!region)throw new Error('Región no disponible en SEREMI');
  const now=chileNow(); const available=Object.keys(dates||{}).sort(); const date=dates?.[now.date]?now.date:available.find(value=>value>=now.date)||available[0];
  if(!date)throw new Error('SEREMI no informó fechas de turno');
  const [communes,response]=await Promise.all([postSeremi({func:'comunas',region:region.id}),postSeremi({func:'region',filtro:'turnos',fecha:date,region:region.id,hora:now.time})]);
  const communeNames=new Map((communes||[]).map(item=>[String(item.id),text(item.nombre)])); const locals=response?.locales||[];
  const detailed=await mapLimit(locals,4,async local=>{
    try { return await withRetry(()=>postSeremi({func:'local',im:local.im,lt:local.lt||'',lg:local.lg||'',tp:local.tp||'',fecha:date}),2); }
    catch { return null; }
  });
  const pharmacies=locals.map((marker,index)=>{
    const detail=detailed[index]||{},local=detail.local||{},schedule=detail.horario||{};
    const duty=cleanHtml(schedule.turno),times=duty.match(/(?:De\s+)?(\d{1,2}:\d{2})\s+a\s+(\d{1,2}:\d{2})/i);
    return {id:text(marker.im),date,name:text(local.nm)||`Farmacia ${marker.im}`,region:text(region.nombre),region_id:text(region.id),commune:communeNames.get(String(local.cm))||'',locality:'',address:text(local.dr),phone:text(local.tl),latitude:number(marker.lt),longitude:number(marker.lg),opens_at:times?.[1]||'',closes_at:times?.[2]||'',weekday:'',type:String(marker.tp)==='3'?'Farmacia de urgencia':'Farmacia de turno',open_now:null,on_duty:true,schedule:cleanHtml(schedule.semana),duty_schedule:duty};
  }).filter(item=>item.name&&item.commune&&item.latitude!==null&&item.longitude!==null);
  if(!pharmacies.length)throw new Error('SEREMI no devolvió farmacias de turno con detalle');
  return {endpoint:SEREMI_ENDPOINT,date,communes:(communes||[]).map(item=>text(item.nombre)).filter(Boolean),pharmacies};
}

async function fetchSeremiCommuneDirectory(requestedRegion, requestedCommune) {
  const regions=await postSeremi({func:'regiones'});
  const region=regionMatch(regions,requestedRegion);
  if(!region)throw new Error('Región no disponible en SEREMI');
  const communes=await postSeremi({func:'comunas',region:region.id});
  const wanted=comparable(requestedCommune);
  const commune=(communes||[]).find(item=>comparable(item.nombre)===wanted);
  if(!commune)throw new Error('Comuna no disponible en SEREMI');
  const latitude=number(commune.lat),longitude=number(commune.lng);
  if(latitude===null||longitude===null)throw new Error('Comuna sin coordenadas oficiales');
  const response=await postSeremi({
    func:'sector',filtro:'todos',fecha:'',region:region.id,
    lat:latitude,lng:longitude,
    latMin:latitude-.32,latMax:latitude+.32,
    lngMin:longitude-.38,lngMax:longitude+.38,
    hora:chileNow().time
  });
  const locals=response?.locales||[];
  const detailed=await mapLimit(locals,4,async marker=>{
    try {
      return await withRetry(()=>postSeremi({
        func:'local',im:marker.im,lt:marker.lt||'',lg:marker.lg||'',
        tp:marker.tp||'',fecha:''
      }),3);
    } catch { return null; }
  });
  const typeLabels=['Farmacia privada','Farmacia de turno','Farmacia privada',
    'Farmacia de urgencia','Farmacia de turno','Farmacia privada',
    'Farmacia municipal','Farmacia móvil','Almacén farmacéutico','Antígenos'];
  const pharmacies=locals.map((marker,index)=>{
    const detail=detailed[index]||{},local=detail.local||{},schedule=detail.horario||{};
    const communeName=text((communes||[]).find(item=>String(item.id)===String(local.cm))?.nombre)
      || text(commune.nombre);
    return {
      id:text(marker.im),date:'',name:text(local.nm),
      region:text(region.nombre),region_id:text(region.id),commune:communeName,
      locality:'',address:text(local.dr),phone:text(local.tl),
      latitude:number(marker.lt),longitude:number(marker.lg),
      opens_at:'',closes_at:'',weekday:'',
      type:typeLabels[Number(marker.tp)]||'Farmacia autorizada',
      open_now:null,on_duty:[1,3,4].includes(Number(marker.tp)),
      schedule:cleanHtml(schedule.semana),duty_schedule:cleanHtml(schedule.turno)
    };
  }).filter(item=>
    item.name&&item.address&&item.latitude!==null&&item.longitude!==null&&
    comparable(item.commune)===wanted
  );
  return {
    endpoint:SEREMI_ENDPOINT,
    communes:(communes||[]).map(item=>text(item.nombre)).filter(Boolean),
    pharmacies
  };
}

async function fetchSeremiCommuneNames(requestedRegion) {
  const regions=await postSeremi({func:'regiones'});
  const region=regionMatch(regions,requestedRegion);
  if(!region)return [];
  const communes=await postSeremi({func:'comunas',region:region.id});
  return (communes||[]).map(item=>text(item.nombre)).filter(Boolean);
}

async function fetchCommuneDirectory(requestedRegion, requestedCommune) {
  const regions=await postSeremi({func:'regiones'});
  const region=regionMatch(regions,requestedRegion);
  if(!region)throw new Error('Región no disponible en SEREMI');
  const communes=await postSeremi({func:'comunas',region:region.id});
  const wanted=comparable(requestedCommune);
  const commune=(communes||[]).find(item=>comparable(item.nombre)===wanted);
  if(!commune)throw new Error('Comuna no disponible en SEREMI');
  const latitude=number(commune.lat),longitude=number(commune.lng);
  if(latitude===null||longitude===null)throw new Error('Comuna sin coordenadas oficiales');

  // El directorio regional puede quedar truncado en exactamente 1.000 filas.
  // Consultar un área centrada en la comuna evita depender de ese primer bloque.
  // Si la comuna es extensa, ampliamos progresivamente el radio.
  const radii=[
    {latitude:.08,longitude:.10},
    {latitude:.16,longitude:.20},
    {latitude:.32,longitude:.38}
  ];
  const unique=new Map();
  let endpoint='';
  for(let index=0;index<radii.length;index+=1) {
    const radius=radii[index];
    const bounds={
      south:latitude-radius.latitude,north:latitude+radius.latitude,
      west:longitude-radius.longitude,east:longitude+radius.longitude
    };
    try {
      // Una consulta comunal no necesita recorrer nuevamente las 16 celdas
      // regionales. Eso podía generar hasta 48 peticiones y agotar el tiempo
      // de una función de Netlify. Consultamos cada radio una sola vez y sólo
      // subdividimos si el proveedor informa su límite de 1.000 registros.
      let parts;
      try {
        parts=await fetchBuscaFarmaCell(bounds,requestedRegion);
      } catch {
        parts=[await fetchBuscaFarmaViaReader(bounds,requestedRegion)];
      }
      const result={
        endpoint:parts[0]?.endpoint||'https://buscafarma.cl/api/farmacias',
        pharmacies:parts.flatMap(part=>part.pharmacies)
      };
      endpoint=result.endpoint||endpoint;
      const before=unique.size;
      result.pharmacies
        .filter(item=>comparable(item.commune)===wanted)
        .forEach(item=>{
          const key=item.id||`${comparable(item.name)}|${comparable(item.address)}|${item.latitude}|${item.longitude}`;
          if(!unique.has(key))unique.set(key,item);
        });
      // Siempre verificamos al menos un radio mayor. Si la ampliación no
      // aporta locales nuevos, la cobertura comunal ya se estabilizó.
      if(index>0&&unique.size>0&&unique.size===before)break;
    } catch {}
  }
  if(unique.size) {
    return {
      endpoint,
      communes:(communes||[]).map(item=>text(item.nombre)).filter(Boolean),
      pharmacies:[...unique.values()]
    };
  }

  // Último respaldo: consulta directa al mapa oficial y detalle de sus locales.
  const official=await fetchSeremiCommuneDirectory(requestedRegion,requestedCommune);
  official.communes=(communes||[]).map(item=>text(item.nombre)).filter(Boolean);
  return official;
}

function blobStore() { try { return getStore({name:'farmacias-turno',consistency:'strong'}); } catch { return null; } }
async function readBlob(key) { try { return await blobStore()?.get(key,{type:'json'})||null; } catch { return null; } }
async function writeBlob(key,value) { try { await blobStore()?.setJSON(key,value); } catch {} }
export async function persistSeremiRegion(region) {
  const result=await fetchSeremiRegion(region); const body={source:'SEREMI en Línea · Ministerio de Salud de Chile',source_url:result.endpoint,fetched_at:new Date().toISOString(),effective_date:result.date,indirect:false,communes:result.communes||[],pharmacies:result.pharmacies};
  await Promise.all([writeBlob(`${result.date}:${slug(region)}`,body),writeBlob(`latest:${slug(region)}`,body)]); return body;
}

function normalize(item, region='') {
  return {
    id: text(item.local_id || item.id),
    date: text(item.fecha || item.date),
    name: text(item.local_nombre || item.nombre || item.name),
    region: text(item.region_nombre || item.region || region || item.fk_region),
    region_id: text(item.fk_region || item.region_id),
    commune: text(item.comuna_nombre || item.comuna || item.commune),
    locality: text(item.localidad_nombre || item.localidad),
    address: text(item.local_direccion || item.direccion || item.address),
    phone: text(item.local_telefono || item.telefono || item.phone),
    latitude: number(item.local_lat || item.latitud || item.latitude || item.lat),
    longitude: number(item.local_lng || item.longitud || item.longitude || item.lng),
    opens_at: text(item.funcionamiento_hora_apertura || item.hora_apertura || item.opens_at),
    closes_at: text(item.funcionamiento_hora_cierre || item.hora_cierre || item.closes_at),
    weekday: text(item.funcionamiento_dia || item.dia || item.weekday),
    type: text(item.tipo_turno || item.tipo || 'Farmacia de turno'),
    open_now: typeof item.open === 'boolean' ? item.open : null,
    on_duty: typeof item.turno === 'boolean' ? item.turno : true,
    schedule: text(item.horario),
    duty_schedule: text(item.turno_horario)
  };
}

async function fetchOfficial() {
  const attempts = OFFICIAL_ENDPOINTS.map(async (endpoint) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(endpoint, {
        headers: {Accept: 'application/json', 'User-Agent': 'AhorraMed/1.0'},
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.data || payload.locales || [];
      if (!Array.isArray(rows) || !rows.length) throw new Error('Respuesta sin locales');
      return {endpoint, pharmacies: rows.map(normalize).filter(item=>item.name && item.commune)};
    } finally {
      clearTimeout(timeout);
    }
  });
  return Promise.any(attempts);
}

async function fetchBuscaFarma(bounds, region) {
  const url = new URL('https://buscafarma.cl/api/farmacias');
  Object.entries(bounds).forEach(([key,value])=>url.searchParams.set(key,String(value)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  let response;
  try {
    response = await fetch(url, {
      headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 (compatible; AhorraMed/1.0)'},
      signal:controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if(!response.ok) throw new Error(`BuscaFarma HTTP ${response.status}`);
  const rows = await response.json();
  if(!Array.isArray(rows)) throw new Error('Respuesta de respaldo inválida');
  return normalizeBuscaFarmaRows(rows,url.toString(),region);
}

function splitBounds(bounds) {
  const middleLat=(bounds.south+bounds.north)/2;
  const middleLng=(bounds.west+bounds.east)/2;
  return [
    {south:bounds.south,north:middleLat,west:bounds.west,east:middleLng},
    {south:bounds.south,north:middleLat,west:middleLng,east:bounds.east},
    {south:middleLat,north:bounds.north,west:bounds.west,east:middleLng},
    {south:middleLat,north:bounds.north,west:middleLng,east:bounds.east}
  ];
}

async function fetchBuscaFarmaCell(bounds, region, depth=0) {
  let result;
  try {
    result=await fetchBuscaFarma(bounds,region);
  } catch {
    result=await fetchBuscaFarmaViaReader(bounds,region);
  }
  if(result.pharmacies.length<950||depth>=2)return [result];

  // Cada rama conserva su propio recorrido. El contador global anterior
  // podía agotarse en las zonas densas y dejar comunas completas sin pedir.
  const settled=await Promise.allSettled(
    splitBounds(bounds).map(cell=>fetchBuscaFarmaCell(cell,region,depth+1))
  );
  const successful=settled.filter(item=>item.status==='fulfilled');
  const children=successful.flatMap(item=>item.value);
  return successful.length===4?children:[result];
}

async function fetchBuscaFarmaComplete(bounds, region) {
  // Consultamos siempre todas las celdas. Así la cobertura no depende del
  // orden en que el proveedor responda ni de un máximo compartido.
  const settled=await Promise.allSettled(
    gridBounds(bounds,4).map(cell=>fetchBuscaFarmaCell(cell,region))
  );
  const successful=settled.filter(item=>item.status==='fulfilled');
  const parts=successful.flatMap(item=>item.value);
  if(successful.length<16)throw new Error(`Cobertura regional incompleta (${successful.length}/16 zonas)`);
  const rows=parts.flatMap(result=>result.pharmacies);
  const unique=new Map();
  rows.forEach(item=>{
    const key=item.id||`${item.name}|${item.address}|${item.latitude}|${item.longitude}`;
    if(!unique.has(key))unique.set(key,item);
  });
  return {
    endpoint:parts[0]?.endpoint||'https://buscafarma.cl/api/farmacias',
    pharmacies:[...unique.values()].filter(item=>inside(item,bounds))
  };
}

function normalizeBuscaFarmaRows(rows, endpoint, region) {
  return {endpoint,pharmacies:rows.map(item=>normalize({
    ...item,
    local_id:item.im,
    local_nombre:item.nombre,
    local_direccion:item.direccion,
    local_telefono:item.telefono,
    local_lat:item.lat,
    local_lng:item.lng,
    comuna_nombre:item.comuna,
    tipo:item.tipo || item.tipo_establecimiento || item.categoria || item.clase || 'Farmacia autorizada',
    turno:false
  },region)).filter(item=>item.name&&item.commune)};
}

async function fetchBuscaFarmaViaReader(bounds, region) {
  const query = new URLSearchParams(bounds).toString();
  const endpoint = `https://buscafarma.cl/api/farmacias?${query}`;
  const readerUrl = `https://r.jina.ai/http://buscafarma.cl/api/farmacias?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  let response;
  try {
    response = await fetch(readerUrl,{headers:{Accept:'text/plain'},signal:controller.signal});
  } finally {
    clearTimeout(timeout);
  }
  if(!response.ok) throw new Error(`Lector HTTP ${response.status}`);
  const content=await response.text();
  const marker='Markdown Content:';
  const jsonText=(content.includes(marker)?content.slice(content.indexOf(marker)+marker.length):content).trim();
  const rows=JSON.parse(jsonText);
  if(!Array.isArray(rows)) throw new Error('Respuesta del lector inválida');
  return normalizeBuscaFarmaRows(rows,endpoint,region);
}

function gridBounds(bounds, divisions=4) {
  const cells=[];
  const latitudeStep=(bounds.north-bounds.south)/divisions;
  const longitudeStep=(bounds.east-bounds.west)/divisions;
  for(let row=0;row<divisions;row+=1) {
    for(let column=0;column<divisions;column+=1) {
      cells.push({
        south:bounds.south+latitudeStep*row,
        north:row===divisions-1?bounds.north:bounds.south+latitudeStep*(row+1),
        west:bounds.west+longitudeStep*column,
        east:column===divisions-1?bounds.east:bounds.west+longitudeStep*(column+1)
      });
    }
  }
  return cells;
}

async function fetchBuscaFarmaCompleteViaReader(bounds, region) {
  // El lector de respaldo también limita una respuesta regional a 1.000
  // locales. Consultamos una cuadrícula para que ninguna zona quede fuera
  // del primer bloque y luego eliminamos establecimientos repetidos.
  const settled=await Promise.allSettled(
    gridBounds(bounds,4).map(cell=>fetchBuscaFarmaViaReader(cell,region))
  );
  const fulfilled=settled
    .filter(item=>item.status==='fulfilled')
    .map(item=>item.value);
  if(!fulfilled.length)throw new Error('El servicio de respaldo no devolvió celdas regionales');
  const unique=new Map();
  fulfilled.flatMap(result=>result.pharmacies).forEach(item=>{
    const key=item.id||`${comparable(item.name)}|${comparable(item.address)}|${item.latitude}|${item.longitude}`;
    if(!unique.has(key))unique.set(key,item);
  });
  return {
    endpoint:fulfilled[0].endpoint,
    pharmacies:[...unique.values()].filter(item=>inside(item,bounds)),
    partial:fulfilled.length<16,
    cells_loaded:fulfilled.length
  };
}

function requestBounds(url) {
  const defaults={south:-21,north:-19.5,west:-71.5,east:-69};
  const bounds={};
  for(const [key,fallback] of Object.entries(defaults)) {
    const value=Number(url.searchParams.get(key));
    bounds[key]=Number.isFinite(value)?value:fallback;
  }
  if(bounds.south>=bounds.north||bounds.west>=bounds.east) return defaults;
  return bounds;
}

const inside=(item,bounds)=>item.latitude>=bounds.south&&item.latitude<=bounds.north&&item.longitude>=bounds.west&&item.longitude<=bounds.east;

export default async (request) => {
  const now = Date.now();
  const url=new URL(request.url); const bounds=requestBounds(url); const region=text(url.searchParams.get('region')); const commune=text(url.searchParams.get('commune')); const mode=url.searchParams.get('mode')==='all'?'all':'duty';
  if(url.searchParams.get('communes_only')==='1') {
    try {
      const communes=await fetchSeremiCommuneNames(region);
      return Response.json({
        source:'SEREMI en Línea · comunas oficiales',
        fetched_at:new Date().toISOString(),
        communes,
        pharmacies:[]
      },{headers:{'Cache-Control':'public, max-age=3600, s-maxage=86400'}});
    } catch {
      return Response.json({error:'No fue posible consultar las comunas oficiales.'},{
        status:503,
        headers:{'Cache-Control':'no-store'}
      });
    }
  }
  const forceRefresh=url.searchParams.has('refresh');
  const cacheKey=`coverage-v5|${mode}|${region}|${comparable(commune)}|${Object.values(bounds).map(value=>value.toFixed(2)).join('|')}`;
  const cached=memoryCache.get(cacheKey);
  if (!forceRefresh && cached && now - cached.timestamp < CACHE_MS) {
    return Response.json(cached.body, {headers:{'Cache-Control':'public, max-age=300, s-maxage=1800'}});
  }
  if(mode==='all') {
    try {
      let result; let source;
      if(commune) {
        try {
          result=await fetchCommuneDirectory(region,commune);
          source='Directorio general por comuna · información pública consolidada';
        } catch {
          try { result=await fetchBuscaFarma(bounds,region); source='Directorio general de farmacias · información pública consolidada'; }
          catch { result=await fetchBuscaFarmaViaReader(bounds,region); source='Directorio general de farmacias · servicio de respaldo'; }
          result.pharmacies=result.pharmacies.filter(item=>comparable(item.commune)===comparable(commune));
          try { result.communes=await fetchSeremiCommuneNames(region); } catch {}
        }
      } else {
        try { result=await fetchBuscaFarmaComplete(bounds,region); source='Directorio general de farmacias · información pública consolidada'; }
        catch {
          result=await fetchBuscaFarmaCompleteViaReader(bounds,region);
          source=result.partial
            ? `Directorio general de farmacias · respaldo parcial (${result.cells_loaded}/16 zonas)`
            : 'Directorio general de farmacias · respaldo regional completo';
        }
        try { result.communes=await fetchSeremiCommuneNames(region); } catch {}
      }
      const body={source,source_url:result.endpoint,fetched_at:new Date().toISOString(),indirect:!source.startsWith('SEREMI'),directory:true,communes:result.communes||[],pharmacies:result.pharmacies};
      memoryCache.set(cacheKey,{timestamp:now,body}); return Response.json(body,{headers:{'Cache-Control':forceRefresh?'no-store':'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'}});
    } catch(error) {
      if(cached)return Response.json({...cached.body,stale:true},{headers:{'Cache-Control':'no-cache'}});
      return Response.json({error:'El directorio general de farmacias no está disponible temporalmente.'},{status:503,headers:{'Cache-Control':'no-store'}});
    }
  }
  try {
    let result; let source; let indirect=false;
    try {
      const stored=await readBlob(`latest:${slug(region)}`); const today=chileNow().date;
      if(stored?.effective_date===today&&now-new Date(stored.fetched_at).getTime()<CACHE_MS) {
        const body={...stored,pharmacies:stored.pharmacies.filter(item=>inside(item,bounds))}; memoryCache.set(cacheKey,{timestamp:now,body}); return Response.json(body,{headers:{'Cache-Control':'public, max-age=300, s-maxage=1800'}});
      }
      const body=await persistSeremiRegion(region); body.pharmacies=body.pharmacies.filter(item=>inside(item,bounds)); memoryCache.set(cacheKey,{timestamp:now,body}); return Response.json(body,{headers:{'Cache-Control':'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'}});
    } catch {
      try {
        result=await fetchOfficial(); result.pharmacies=result.pharmacies.filter(item=>inside(item,bounds)); source='FARMANET · Ministerio de Salud de Chile';
      } catch {
        try { result=await fetchBuscaFarma(bounds,region); source='BuscaFarma · información pública consolidada'; indirect=true; }
        catch { result=await fetchBuscaFarmaViaReader(bounds,region); source='BuscaFarma · información pública consolidada mediante servicio de respaldo'; indirect=true; }
      }
    }
    const body = {
      source,
      source_url: result.endpoint,
      fetched_at: new Date().toISOString(),
      indirect,
      pharmacies: result.pharmacies
    };
    memoryCache.set(cacheKey,{timestamp: now, body});
    return Response.json(body, {headers:{'Cache-Control':'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'}});
  } catch (error) {
    const stored=await readBlob(`latest:${slug(region)}`);
    if(stored)return Response.json({...stored,stale:true,pharmacies:stored.pharmacies.filter(item=>inside(item,bounds))},{headers:{'Cache-Control':'no-cache'}});
    if (cached) return Response.json({...cached.body, stale:true}, {headers:{'Cache-Control':'no-cache'}});
    return Response.json({error:'El servicio oficial de farmacias de turno no está disponible temporalmente.'}, {status:503, headers:{'Cache-Control':'no-store'}});
  }
};
