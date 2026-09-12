import {jwtVerify} from 'jose';
export async function verifyOwnerToken(token,keys,{issuer,audience,emails}){
 if(typeof token!=='string'||!keys||!issuer||!audience?.length)return false;
 try{const {payload}=await jwtVerify(token,keys,{issuer,audience,algorithms:['RS256']});return typeof payload.email==='string'&&emails.map(e=>e.trim().toLowerCase()).includes(payload.email.toLowerCase())}catch{return false}
}
