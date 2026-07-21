import { MINSAL_REGIONS, persistSeremiRegion } from './farmacias-turno.mjs';

export const config = { schedule: '0 */3 * * *' };

export default async () => {
  const hour=new Date().getUTCHours();
  const batchIndex=Math.floor(hour/3)%4;
  const regions=MINSAL_REGIONS.filter((_,index)=>index%4===batchIndex);
  const results=[];
  for(const region of regions) {
    try { const body=await persistSeremiRegion(region); results.push({region,ok:true,date:body.effective_date,count:body.pharmacies.length}); }
    catch(error) { results.push({region,ok:false,error:error.message}); }
  }
  return Response.json({updated_at:new Date().toISOString(),batch:batchIndex,results});
};
