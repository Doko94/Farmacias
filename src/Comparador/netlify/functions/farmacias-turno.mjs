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

const text = (value) => String(value ?? '').trim();
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
  const detailed=await mapLimit(locals,6,async local=>{
    try { return await postSeremi({func:'local',im:local.im,lt:local.lt||'',lg:local.lg||'',tp:local.tp||'',fecha:date}); }
    catch { return null; }
  });
  const pharmacies=locals.map((marker,index)=>{
    const detail=detailed[index]||{},local=detail.local||{},schedule=detail.horario||{};
    const duty=cleanHtml(schedule.turno),times=duty.match(/(?:De\s+)?(\d{1,2}:\d{2})\s+a\s+(\d{1,2}:\d{2})/i);
    return {id:text(marker.im),date,name:text(local.nm)||`Farmacia ${marker.im}`,region:text(region.nombre),region_id:text(region.id),commune:communeNames.get(String(local.cm))||'',locality:'',address:text(local.dr),phone:text(local.tl),latitude:number(marker.lt),longitude:number(marker.lg),opens_at:times?.[1]||'',closes_at:times?.[2]||'',weekday:'',type:String(marker.tp)==='3'?'Farmacia de urgencia':'Farmacia de turno',open_now:null,on_duty:true,schedule:cleanHtml(schedule.semana),duty_schedule:duty};
  }).filter(item=>item.name&&item.commune&&item.latitude!==null&&item.longitude!==null);
  if(!pharmacies.length)throw new Error('SEREMI no devolvió farmacias de turno con detalle');
  return {endpoint:SEREMI_ENDPOINT,date,pharmacies};
}

function blobStore() { try { return getStore({name:'farmacias-turno',consistency:'strong'}); } catch { return null; } }
async function readBlob(key) { try { return await blobStore()?.get(key,{type:'json'})||null; } catch { return null; } }
async function writeBlob(key,value) { try { await blobStore()?.setJSON(key,value); } catch {} }
export async function persistSeremiRegion(region) {
  const result=await fetchSeremiRegion(region); const body={source:'SEREMI en Línea · Ministerio de Salud de Chile',source_url:result.endpoint,fetched_at:new Date().toISOString(),effective_date:result.date,indirect:false,pharmacies:result.pharmacies};
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
  const url=new URL(request.url); const bounds=requestBounds(url); const region=text(url.searchParams.get('region')); const mode=url.searchParams.get('mode')==='all'?'all':'duty';
  const cacheKey=`${mode}|${region}|${Object.values(bounds).map(value=>value.toFixed(2)).join('|')}`;
  const cached=memoryCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_MS) {
    return Response.json(cached.body, {headers:{'Cache-Control':'public, max-age=300, s-maxage=1800'}});
  }
  if(mode==='all') {
    try {
      let result; let source;
      try { result=await fetchBuscaFarma(bounds,region); source='Directorio general de farmacias · información pública consolidada'; }
      catch { result=await fetchBuscaFarmaViaReader(bounds,region); source='Directorio general de farmacias · servicio de respaldo'; }
      const body={source,source_url:result.endpoint,fetched_at:new Date().toISOString(),indirect:true,directory:true,pharmacies:result.pharmacies};
      memoryCache.set(cacheKey,{timestamp:now,body}); return Response.json(body,{headers:{'Cache-Control':'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'}});
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
