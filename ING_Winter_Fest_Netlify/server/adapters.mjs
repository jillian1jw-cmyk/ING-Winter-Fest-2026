import postgres from 'postgres';
import {getConnectionString} from '@netlify/database';
import {S3Client,HeadObjectCommand,GetObjectCommand,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
export function translateSQL(query){let n=0;return query.replace(/\?/g,()=>'$'+(++n)).replaceAll('MAX(0,count-', 'GREATEST(0,count-')}
export function createDatabase(sql){
 const normalize=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,['count','size','guests','max_guests'].includes(k)&&typeof v==='string'?Number(v):v])));
 return {prepare(query){const text=translateSQL(query);let values=[];const statement={text,get values(){return values},bind(...args){values=args;return statement},async first(){return normalize(await sql.unsafe(text,values))[0]||null},async all(){return {results:normalize(await sql.unsafe(text,values))}},async run(){await sql.unsafe(text,values);return {success:true}}};return statement},async batch(statements){return sql.begin(async transaction=>{const results=[];for(const s of statements){await transaction.unsafe(s.text,s.values);results.push({success:true})}return results})}};
}
export function createBucket(client,bucket,sign=getSignedUrl){return {
 async get(key){try{const o=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));return {body:null,httpMetadata:{contentType:o.ContentType},url:await sign(client,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:300})}}catch(e){if(e.name==='NotFound'||e.name==='NoSuchKey'||e.$metadata?.httpStatusCode===404)return null;throw e}},
 async put(key,data,options={}){await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:new Uint8Array(data),ContentType:options.httpMetadata?.contentType||'application/octet-stream'}))},
 async delete(key){await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}))}
}}
let cached;
export function getEnvironment(){
 if(cached)return cached;
 const p=process.env;
 const endpoint=new URL(p.B2_ENDPOINT);
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.backblazeb2.com')||endpoint.username||endpoint.password)throw Error('Configure a valid Backblaze S3 endpoint.');
 const sql=postgres(getConnectionString(),{max:2,prepare:false,idle_timeout:20,connect_timeout:10,ssl:'require'});
 const s3=new S3Client({endpoint:endpoint.origin,region:p.B2_REGION,forcePathStyle:true,credentials:{accessKeyId:p.B2_KEY_ID||'',secretAccessKey:p.B2_APPLICATION_KEY||''}});
 cached={DB:createDatabase(sql),BUCKET:createBucket(s3,p.B2_BUCKET),ADMIN_PASSWORD:p.ADMIN_PASSWORD,SESSION_SECRET:p.SESSION_SECRET,PHOTO_CODE:p.PHOTO_CODE};return cached;
}
