import fs from 'node:fs';
import {createHash} from 'node:crypto';
import { publicMetrics } from './core.mjs';
export const registeredQueries = new Map(publicMetrics.map((m,i)=>['public_metric_'+i,m]));
export const queryKey=(expr)=>'approved_'+createHash('sha256').update(expr).digest('hex').slice(0,24);
export function fixedQuery(expr,application){return expr.replace(/\$\{?instance(?::regex)?\}?/g,application==='local'?'chingadera':'.*').replace(/\$\{?__rate_interval\}?/g,'5m').replace(/\$\{?__interval\}?/g,'5m').replace(/\$\{?__range_s\}?/g,'3600').replace(/\$\{?__range\}?/g,'1h').replace(/\$\{?__auto\}?/g,'5m').replace(/\$\{?[a-zA-Z_][a-zA-Z0-9_]*(?::[a-z]+)?\}?/g,'.*');}
const catalog=JSON.parse(fs.readFileSync(new URL('../config/catalog.json',import.meta.url),'utf8'));
for(const d of catalog)for(const p of d.panels)if(!p.datasource||p.datasource==='grafanacloud-prom')for(const expr of p.queries||[])registeredQueries.set(queryKey(expr),{expr:fixedQuery(expr,d.application)});
// The datasource talks Prometheus to this private listener. Client expressions are identifiers,
// never forwarded PromQL. Registered expressions and all label policy live in Git.
export function validateQuery(params, now=Date.now()/1000) {
  if ([...params.keys()].some(k=>!['query','start','end','step','time','timeout'].includes(k)))throw Error('Unsupported parameter');
  if ([...new Set(params.keys())].some(k=>params.getAll(k).length!==1))throw Error('Duplicate parameter');
  const metric=registeredQueries.get(params.get('query'));
  if(!metric)throw Error('Unregistered query');
  const end=Number(params.get('end')||params.get('time')||now),start=Number(params.get('start')||end-3600);
  const step=Number(params.get('step')||Math.max(30,Math.ceil((end-start)/180)));
  if(![end,start,step].every(Number.isFinite)||end>now+60||start<now-604860||end<=start||end-start>604800||step<30||(end-start)/step>400)throw Error('Query bounds exceeded');
  return {metric,start,end,step};
}
export async function boundedJSON(response,limit=2_000_000) {
  if(!response.ok)throw Error('Telemetry unavailable');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Result budget exceeded');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function sanitizeResult(data){
  if(data.status!=='success'||!Array.isArray(data.data?.result))throw Error('Invalid telemetry response');
  if(data.data.result.length>24)throw Error('Series budget exceeded');
  return {status:'success',data:{resultType:data.data.resultType,result:data.data.result.map((r,i)=>({metric:{series:`Series ${i+1}`},...(r.values?{values:r.values.slice(0,401)}:{value:r.value})}))}};
}
