import {api} from '../../server/api.ts';
import {getEnvironment} from '../../server/adapters.mjs';
const required=['ADMIN_PASSWORD','SESSION_SECRET','PHOTO_CODE','B2_ENDPOINT','B2_REGION','B2_BUCKET','B2_KEY_ID','B2_APPLICATION_KEY'];
export default async function handler(request:Request,context:{ip?:string}){
 const url=new URL(request.url);const configured=required.every(k=>!!process.env[k])&&!!process.env.NETLIFY_DB_URL;
 if(url.pathname==='/api/config')return Response.json({configured,photoCodeConfigured:!!process.env.PHOTO_CODE},{headers:{'Cache-Control':'no-store'}});
 if(!configured)return Response.json({error:'The host is finishing website setup. Please try again later.'},{status:503,headers:{'Cache-Control':'no-store'}});
 const headers=new Headers(request.headers);headers.set('CF-Connecting-IP',context.ip||'unknown');
 try{return await api(new Request(request,{headers}),getEnvironment())}catch{return Response.json({error:'The website is temporarily unavailable. Please try again later.'},{status:503})}
}
export const config={path:'/api/*'};
