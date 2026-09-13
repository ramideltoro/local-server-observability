import {publishDashboard} from './publish.mjs';
import fs from 'node:fs/promises';
import {readState} from './store.mjs';
import {nativeCatalog,proxyGrafana,body} from './native.mjs';
import {alertCatalog} from './alerts.mjs';
export function workspace({owner,grafana,json,cached,root}){
 const rates=new Map();
 return async(req,res,u)=>{
  if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/grafana/')||u.pathname.startsWith('/owner/grafana/')){const ip=req.socket.remoteAddress+':'+String(req.headers['cf-connecting-ip']||'');const now=Date.now();let r=rates.get(ip);if(!r||r.until<now)r={count:0,until:now+60000};r.count++;rates.set(ip,r);if(rates.size>2000)rates.delete(rates.keys().next().value);if(r.count>240){json(res,429,{error:'Request budget exceeded'});return true;}} 
  const p=u.pathname;
  if(p.startsWith('/grafana/')||p.startsWith('/owner/grafana/')){
   const privateView=p.startsWith('/owner/');
   if(privateView&&!await owner(req)){json(res,401,{error:'Google owner sign-in required'},true);return true;}
   await proxyGrafana(req,res,u,privateView);return true;
  }
  const routes=['/api/public/inventory','/api/public/dashboards','/api/public/issues','/api/public/reports','/api/public/rules','/api/owner/scan','/api/owner/publish'];
  if(!routes.includes(p))return false;
  if(p==='/api/owner/scan'||p==='/api/owner/publish'){
   if(req.method!=='POST'){json(res,405,{error:'POST required'},true);return true;}
   if(!await owner(req)||req.headers.origin!=='https://observe.ramideltoro.com'){json(res,403,{error:'Owner and same-origin request required'},true);return true;}
   if(!process.env.AUTOMATION_TOKEN){json(res,503,{error:'Manual dispatch is not configured'},true);return true;}
   if(p==='/api/owner/publish'){const input=JSON.parse((await body(req,2048)).toString());json(res,201,await publishDashboard(input.uid,process.env.AUTOMATION_TOKEN),true);return true;}
   const response=await fetch('https://api.github.com/repos/ramideltoro/local-server-infra/actions/workflows/inspect.yml/dispatches',{method:'POST',headers:{Authorization:'Bearer '+process.env.AUTOMATION_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(12000)});
   json(res,response.ok?202:502,{message:response.ok?'Inspection queued in GitHub Actions':'Dispatch failed'},true);return true;
  }
  if(req.method!=='GET'){json(res,405,{error:'Read-only endpoint'});return true;}
  if(p.endsWith('/inventory'))json(res,200,JSON.parse(await fs.readFile(root+'/config/inventory.json','utf8')));
  if(p.endsWith('/dashboards'))json(res,200,await nativeCatalog());
  if(p.endsWith('/issues'))json(res,200,(await readState()).issues);
  if(p.endsWith('/reports')){const s=await readState();json(res,200,{reports:s.reports,lastSuccess:s.lastSuccess,overdue:!s.lastSuccess||Date.now()-Date.parse(s.lastSuccess)>27*3600000});}
  if(p.endsWith('/rules'))json(res,200,await cached('rule-catalog',async()=>{const [rules,groups,alerts]=await Promise.all([grafana('/api/v1/provisioning/alert-rules'),grafana('/api/prometheus/grafana/api/v1/rules'),grafana('/api/alertmanager/grafana/api/v2/alerts')]);return alertCatalog(rules,groups,alerts);},60000));
  return true;
 };
}
