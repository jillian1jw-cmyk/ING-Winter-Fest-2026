type Statement={bind(...args:unknown[]):Statement;first<T=any>():Promise<T|null>;all<T=any>():Promise<{results:T[]}>;run():Promise<unknown>};
type Database={prepare(q:string):Statement;batch(s:Statement[]):Promise<unknown>;transaction<T>(fn:(db:Database)=>Promise<T>):Promise<T>};
type Bucket={get(k:string):Promise<{body:any;url?:string;httpMetadata?:{contentType?:string}}|null>;put(k:string,b:ArrayBuffer,o?:any):Promise<unknown>;delete(k:string):Promise<unknown>};
// Event API: PostgreSQL records, private object storage, signed host sessions.
type Env={DB:Database;BUCKET:Bucket;ADMIN_PASSWORD?:string;SESSION_SECRET?:string;PHOTO_CODE?:string};
const CAP=9_000_000_000, MAX=4_000_000;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>json({error:message},status);
const enc=new TextEncoder();
async function digest(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function equal(a:string,b:string){return await digest(a)===await digest(b)}
async function signature(s:string,secret:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function admin(req:Request,env:Env){if(!env.SESSION_SECRET)return false;const c=req.headers.get('cookie')?.match(/(?:^|; )ing_host=([^;]+)/)?.[1];if(!c)return false;const [exp,sig]=c.split('.');return Number(exp)>Date.now()&&await equal(sig||'',await signature(exp,env.SESSION_SECRET))}
const clean=(x:unknown,n=200)=>typeof x==='string'?x.trim().slice(0,n):'';
const crewLabels:Record<string,string>={photo_booth:'Photo Booth Crew',food_drink:'Food & Drink Crew',cleanup:'Cleanup Crew',welcome_ticket:'Welcome & Ticket Crew'};
function crewData(value:unknown){try{const data=JSON.parse(String(value||'{}'));return {volunteerRoles:Array.isArray(data.roles)?data.roles.filter((id:unknown)=>typeof id==='string'&&Object.hasOwn(crewLabels,id)):[],volunteerNote:clean(data.note,1000)}}catch{return {volunteerRoles:[],volunteerNote:''}}}
const inviteCrewSQL="SELECT i.*,s.value AS volunteer_data FROM invites i LEFT JOIN settings s ON s.key=('volunteer:' || i.id) ORDER BY i.name";

type FoodItem={id:string;label:string;unit:string;needed:number;hint:string};
type FoodChoice={id:string;quantity:number;received:boolean};
type FoodClaim={items:FoodChoice[];note:string};
type FoodState={items:FoodItem[];claims:Record<string,FoodClaim>};
const initialFood:FoodItem[]=[
 {id:'beans',label:'Refried beans',unit:'half-size catering tray',needed:4,hint:'Standard half-size foil catering pan, approximately 12¾ × 10⅜ × 2½ inches deep.'},
 {id:'rice',label:'Spanish or cilantro-lime rice',unit:'half-size catering tray',needed:4,hint:'Standard half-size foil catering pan, approximately 12¾ × 10⅜ × 2½ inches deep. Tell us which rice in the note below.'},
 {id:'water',label:'Bottled water',unit:'40-bottle case',needed:3,hint:'40 bottles per contribution; 120 bottles total.'},
 {id:'zero',label:'Zero-sugar soda',unit:'12-pack',needed:4,hint:'Unopened 12-pack. Please note the flavor or brand below.'},
 {id:'drinks',label:'Assorted sodas or canned drinks',unit:'12-pack',needed:8,hint:'Unopened 12-pack; lemonade is welcome. Please note the flavor below.'},
 {id:'ice',label:'Ice',unit:'20-lb bag',needed:6,hint:'Bring on party day; coordinate delivery with the host.'},
 {id:'chips',label:'Plain tortilla chips',unit:'3-lb bag',needed:5,hint:'Unopened plain tortilla chips; 15 lb total.'},
 {id:'buns',label:'Standard hot dog buns',unit:'20 buns',needed:5,hint:'Package counts vary: bring unopened packages totaling at least 20 buns per contribution.'},
 {id:'ketchup',label:'Ketchup',unit:'about 64 oz total',needed:1,hint:'Unopened bottles totaling about 64 oz.'},
 {id:'mustard',label:'Yellow mustard',unit:'about 40 oz total',needed:1,hint:'Unopened bottles totaling about 40 oz.'},
 {id:'relish',label:'Relish',unit:'about 52 oz total',needed:1,hint:'Unopened containers totaling about 52 oz.'},
 {id:'cosmic_brownies',label:'Little Debbie Cosmic Brownies',unit:'about 24 individually wrapped brownies',needed:1,hint:'Bring unopened packages totaling about 24 brownies; package counts vary.'},
 {id:'dessert',label:'Assorted dessert to share',unit:'about 24 small servings',needed:3,hint:'Please tell us what you plan to bring in the note below.'}
];
async function readFood(db:Database,lock=false):Promise<FoodState>{const row=await db.prepare("SELECT value FROM settings WHERE key='food_signup'"+(lock?' FOR UPDATE':'')).first<any>();return row?JSON.parse(row.value):{items:structuredClone(initialFood),claims:{}}}
async function initFood(db:Database){await db.prepare("INSERT INTO settings(key,value) VALUES('food_signup',?) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify({items:initialFood,claims:{}})).run()}
async function writeFood(db:Database,state:FoodState){await db.prepare("UPDATE settings SET value=? WHERE key='food_signup'").bind(JSON.stringify(state)).run()}
function foodSummary(state:FoodState){return state.items.map(item=>{let claimed=0,received=0;for(const claim of Object.values(state.claims))for(const choice of claim.items)if(choice.id===item.id){claimed+=choice.quantity;if(choice.received)received+=choice.quantity}return {...item,claimed,remaining:Math.max(0,item.needed-claimed),received}})}
function personalFood(state:FoodState,id:string){const claim=state.claims[id];return {foodSelections:claim?.items.map(({id,quantity})=>({id,quantity}))||[],foodNote:claim?.note||''}}
function foodDescription(state:FoodState,id:string,receivedOnly=false){return (state.claims[id]?.items||[]).filter(x=>!receivedOnly||x.received).map(choice=>{const item=state.items.find(i=>i.id===choice.id);return `${item?.label||choice.id}: ${choice.quantity} × ${item?.unit||'contribution'}`}).join('; ')}

async function rate(req:Request,env:Env,kind:string,n:number){const key=kind+':'+new Date().toISOString().slice(0,10)+':'+await digest((req.headers.get('CF-Connecting-IP')||'local')+(env.SESSION_SECRET||''));const row=await env.DB.prepare('INSERT INTO limits(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=limits.count+1 RETURNING count').bind(key).first<{count:number}>();return (row?.count||0)<=n}
async function invite(req:Request,env:Env){const token=req.headers.get('X-Invite')||new URL(req.url).searchParams.get('invite')||'';return token.length===36?await env.DB.prepare('SELECT * FROM invites WHERE id=?').bind(token).first<any>():null}
async function photoAccess(req:Request,env:Env){return !!await invite(req,env)||!!(env.PHOTO_CODE&&await equal(req.headers.get('X-Photo-Code')||'',env.PHOTO_CODE))}
function csvCell(x:unknown){let s=String(x??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
export async function api(req:Request,env:Env):Promise<Response>{
 const u=new URL(req.url),p=u.pathname,m=req.method;
 try{
 if(!['GET','HEAD'].includes(m)&&req.headers.get('Origin')!==u.origin)return fail('Please use this website to submit your request.',403);
 const slots=['logo','banner','portrait','invitation','band_mojave','band_signs'];
 if(p.startsWith('/api/assets/')&&['GET','HEAD'].includes(m)){
 const slot=p.split('/').pop()||'';if(!slots.includes(slot))return fail('Image slot not found.',404);
 const obj=await env.BUCKET.get('website/'+slot);if(!obj)return fail('No image uploaded yet.',404);
 if(obj.url&&m!=='HEAD')return new Response(null,{status:302,headers:{Location:obj.url,'Cache-Control':'no-store'}});return new Response(m==='HEAD'?null:obj.body,{headers:{'Content-Type':obj.httpMetadata?.contentType||'image/jpeg','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
 }
 if(p.startsWith('/api/admin/assets/')&&m==='POST'){
 if(!await admin(req,env))return fail('Please sign in as the host.',401);
 const slot=p.split('/').pop()||'';if(!slots.includes(slot))return fail('Image slot not found.',404);
 if(Number(req.headers.get('Content-Length')||0)>MAX+50000)return fail('Choose an image under 4 MB.',413);
 const f=(await req.formData()).get('file');if(!(f instanceof File)||f.size>MAX||f.size<8)return fail('Choose a JPEG or PNG under 4 MB.');
 const data=await f.arrayBuffer(),b=new Uint8Array(data);const type=b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71?'image/png':null;
 if(!type)return fail('Choose a JPEG or PNG image.');
 await env.BUCKET.put('website/'+slot,data,{httpMetadata:{contentType:type}});return json({ok:true});
 }
 if(p==='/api/food'&&m==='GET')return json({items:foodSummary(await readFood(env.DB))});
 if(p==='/api/config')return json({configured:!!(env.ADMIN_PASSWORD&&env.SESSION_SECRET&&env.PHOTO_CODE),photoCodeConfigured:!!env.PHOTO_CODE});
 if(p==='/api/session'&&m==='GET')return json({authenticated:await admin(req,env)});
 if(p==='/api/session'&&m==='DELETE')return new Response(null,{headers:{'Set-Cookie':'ing_host=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
 if(p==='/api/session'&&m==='POST'){
 if(!env.ADMIN_PASSWORD||!env.SESSION_SECRET)return fail('Host sign-in will be enabled when the site is connected to the website.',503);
 if(!await rate(req,env,'login',20))return fail('Too many attempts. Please try tomorrow.',429);
 const b=await req.json() as any;if(!await equal(clean(b.password,200),env.ADMIN_PASSWORD))return fail('That password is not correct.',401);
 const exp=String(Date.now()+8*3600_000);return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':`ing_host=${exp}.${await signature(exp,env.SESSION_SECRET)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`,'Cache-Control':'no-store'}});
 }
 if(p==='/api/invite'&&m==='GET'){const row=await invite(req,env);const crew=row?await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('volunteer:'+row.id).first<any>():null;return row?json({...crewData(crew?.value),...personalFood(await readFood(env.DB),row.id),name:row.name,maxGuests:row.max_guests,status:row.status,guests:row.guests,guestNames:row.guest_names,note:row.note}):fail('This invitation link was not found. Please contact your host.',404)}
 if(p==='/api/rsvp'&&m==='POST'){
 const row=await invite(req,env);if(!row)return fail('Please open your personal invitation link to RSVP.',403);
 if(Date.now()>=Date.parse('2026-12-06T08:00:00Z'))return fail('The RSVP deadline has passed. Please contact your host.');
 if(!await rate(req,env,'rsvp',60))return fail('Please try again tomorrow.',429);
 const b=await req.json() as any;if(!['going','declined'].includes(b.status))return fail('Choose an attendance response.');
 const guests=b.status==='going'?Number(b.guests):0;if(!Number.isInteger(guests)||guests<0||guests>row.max_guests||(b.status==='going'&&guests<1))return fail('Please check the number of guests.');
 if(b.volunteerRoles!==undefined&&(!Array.isArray(b.volunteerRoles)||b.volunteerRoles.length>4||b.volunteerRoles.some((id:unknown)=>typeof id!=='string'||!Object.hasOwn(crewLabels,id))))return fail('Please choose a listed volunteer role.');
 await initFood(env.DB);
 return await env.DB.transaction(async db=>{
 const food=await readFood(db,true);const activeInvite=await db.prepare('SELECT id,max_guests FROM invites WHERE id=?').bind(row.id).first<any>();if(!activeInvite)return fail('This invitation is no longer active.',403);if(guests>activeInvite.max_guests)return fail('Your invitation allowance changed. Refresh the page and check the guest count.',409);const oldClaim=food.claims[row.id];
 const choices=b.status==='declined'?[]:(b.foodSelections===undefined?(oldClaim?.items||[]):b.foodSelections);
 if(!Array.isArray(choices)||choices.length>50||choices.some((choice:any)=>!choice||typeof choice.id!=='string'||!Number.isInteger(choice.quantity)||choice.quantity<1||choice.quantity>1000)||new Set(choices.map((x:any)=>x.id)).size!==choices.length)return fail('Please check your food contribution quantities.');
 const counts=foodSummary(food);
 for(const choice of choices){const item=counts.find(i=>i.id===choice.id);const mine=oldClaim?.items.find(x=>x.id===choice.id)?.quantity||0;if(!item||choice.quantity>item.remaining+mine)return fail(`${item?.label||'That item'} was just claimed or changed. Refresh availability and choose again. Your RSVP has not been changed.`,409)}
 if(choices.length)food.claims[row.id]={items:choices.map((choice:any)=>({id:choice.id,quantity:choice.quantity,received:oldClaim?.items.some(x=>x.id===choice.id&&x.quantity===choice.quantity&&x.received)||false})),note:b.foodNote===undefined?(oldClaim?.note||''):clean(b.foodNote,1000)};else delete food.claims[row.id];
 const previous=await db.prepare('SELECT value FROM settings WHERE key=?').bind('volunteer:'+row.id).first<any>();const saved=crewData(previous?.value);
 const roles=b.status==='going'?[...new Set(b.volunteerRoles??saved.volunteerRoles)]:[];const note=b.status==='going'?(b.volunteerNote===undefined?saved.volunteerNote:clean(b.volunteerNote,1000)):'';
 await db.prepare('UPDATE invites SET status=?,guests=?,guest_names=?,note=?,updated=? WHERE id=?').bind(b.status,guests,clean(b.guestNames,1000),clean(b.note,1000),new Date().toISOString(),row.id).run();
 await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('volunteer:'+row.id,JSON.stringify({roles,note})).run();
 await writeFood(db,food);return json({ok:true,items:foodSummary(food),...personalFood(food,row.id)});
 });
 }
 if(p==='/api/photos'&&m==='GET'){const all=await admin(req,env);const rows=await env.DB.prepare(all?'SELECT * FROM photos ORDER BY created DESC LIMIT 500':'SELECT id,name,caption,created FROM photos WHERE state=\'approved\' ORDER BY created DESC LIMIT 200').all();return json(rows.results)}
 if(p.startsWith('/api/photo/')&&m==='GET'){
 const id=p.split('/').pop()||'';const row=await env.DB.prepare('SELECT * FROM photos WHERE id=?').bind(id).first<any>();if(!row||(row.state!=='approved'&&!await admin(req,env)))return fail('Photo not found.',404);
 const obj=await env.BUCKET.get('photos/'+id);if(!obj)return fail('Photo not found.',404);if(obj.url)return new Response(null,{status:302,headers:{Location:obj.url,'Cache-Control':'no-store'}});return new Response(obj.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'}});
 }
 if(p==='/api/photos'&&m==='POST'){
 if(!await photoAccess(req,env)&&!await admin(req,env))return fail('Use your invitation link or enter the photo code from the party.',403);
 if(Number(req.headers.get('Content-Length')||0)>MAX+50000)return fail('Choose a smaller photo. The limit is 4 MB.',413);
 if(!await rate(req,env,'photo',100))return fail('You’ve reached today’s upload limit of 100 photos.',429);
 const form=await req.formData(),file=form.get('photo');if(!(file instanceof File)||file.size>MAX||file.size<10)return fail('Please choose a photo under 4 MB.');
 const data=await file.arrayBuffer(),bytes=new Uint8Array(data);if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return fail('Please upload a JPEG photo using the photo picker.');
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO limits(key,count) VALUES(\'storage\',0) ON CONFLICT(key) DO NOTHING').run();
 const capacity=await env.DB.prepare('UPDATE limits SET count=count+? WHERE key=\'storage\' AND count+?<=? RETURNING count').bind(file.size,file.size,CAP).first();if(!capacity)return fail('The album is full. Please contact your host.',409);
 try{await env.BUCKET.put('photos/'+id,data,{httpMetadata:{contentType:'image/jpeg'}});await env.DB.prepare('INSERT INTO photos(id,name,caption,size,state,created) VALUES(?,?,?,?,?,?)').bind(id,clean(form.get('name'),80)||'Guest',clean(form.get('caption'),300),file.size,'pending',new Date().toISOString()).run()}catch(e){await env.BUCKET.delete('photos/'+id);await env.DB.prepare('UPDATE limits SET count=MAX(0,count-?) WHERE key=\'storage\'').bind(file.size).run();throw e}
 return json({ok:true,message:'Photo received! It will appear after your host approves it.'});
 }
 if(p==='/api/invitation'&&['GET','HEAD'].includes(m)){
 const obj=await env.BUCKET.get('invitation');if(!obj)return fail('No invitation uploaded yet.',404);if(obj.url&&m!=='HEAD')return new Response(null,{status:302,headers:{Location:obj.url,'Cache-Control':'no-store'}});return new Response(m==='HEAD'?null:obj.body,{headers:{'Content-Type':obj.httpMetadata?.contentType||'image/jpeg','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
 }
 if(p.startsWith('/api/admin/')){
 if(!await admin(req,env))return fail('Please sign in as the host.',401);
 if(p==='/api/admin/food'&&m==='GET'){
 const state=await readFood(env.DB);const invites=(await env.DB.prepare('SELECT id,name FROM invites ORDER BY name').all<any>()).results;const names=new Map(invites.map(i=>[i.id,i.name]));
 return json({items:foodSummary(state),claims:Object.entries(state.claims).map(([id,claim])=>({id,name:names.get(id)||'Household',...claim}))});
 }
 if(p==='/api/admin/food'&&m==='PUT'){
 const b=await req.json() as any;if(!Array.isArray(b.items)||b.items.length>50)return fail('Use up to 50 contribution items.');
 const items:FoodItem[]=b.items.map((i:any)=>({id:clean(i?.id,60),label:clean(i?.label,120),unit:clean(i?.unit,80),needed:Number(i?.needed),hint:clean(i?.hint,300)}));
 if(items.some(i=>!/^[a-zA-Z0-9_-]{1,60}$/.test(i.id)||!i.label||!i.unit||!Number.isInteger(i.needed)||i.needed<0||i.needed>1000)||new Set(items.map(i=>i.id)).size!==items.length)return fail('Each item needs a unique ID, name, contribution size, and a whole-number target between 0 and 1000.');
 await initFood(env.DB);return await env.DB.transaction(async db=>{const state=await readFood(db,true);for(const item of foodSummary(state)){const updated=items.find(i=>i.id===item.id);if(item.claimed&&(!updated||updated.needed<item.claimed))return fail('You cannot remove an item or reduce its target below the quantity already promised.',409);if(item.claimed&&updated&&(updated.label!==item.label||updated.unit!==item.unit))return fail('Keep the name and contribution size of a claimed item unchanged. Add a new item instead.',409)}state.items=items;await writeFood(db,state);return json({ok:true})});
 }
 if(p==='/api/admin/food/received'&&m==='PATCH'){
 const b=await req.json() as any;if(typeof b.received!=='boolean')return fail('Choose received or not received.');await initFood(env.DB);return await env.DB.transaction(async db=>{const state=await readFood(db,true);const item=state.claims[clean(b.inviteId,36)]?.items.find(x=>x.id===b.itemId);if(!item)return fail('Contribution not found.',404);item.received=b.received;await writeFood(db,state);return json({ok:true})});
 }
 if(p==='/api/admin/dashboard'){
 const invites=await env.DB.prepare(inviteCrewSQL).all();const bytes=await env.DB.prepare('SELECT count FROM limits WHERE key=\'storage\'').first<any>();const photos=await env.DB.prepare('SELECT COUNT(*) as count FROM photos').first<any>();return json({invites:invites.results.map((row:any)=>{const {volunteer_data,...invite}=row;return {...invite,...crewData(volunteer_data)}}),bytes:bytes?.count||0,photoCount:photos?.count||0,cap:CAP,photoCode:env.PHOTO_CODE||''});
 }
 if(p.startsWith('/api/admin/invites/')&&m==='PATCH'){
 const id=p.slice('/api/admin/invites/'.length);if(!/^[0-9a-fA-F-]{36}$/.test(id))return fail('Invitation not found.',404);
 const b=await req.json() as any,name=clean(b.name,120),max=Number(b.maxGuests);if(!name||!Number.isInteger(max)||max<1||max>20)return fail('Enter a name and an invitation allowance between 1 and 20.');
 await initFood(env.DB);return await env.DB.transaction(async db=>{await readFood(db,true);const row=await db.prepare('SELECT * FROM invites WHERE id=?').bind(id).first<any>();if(!row)return fail('Invitation not found.',404);if(row.status==='going'&&row.guests>max)return fail('This household has already RSVP’d for '+row.guests+' people. Update their RSVP through their invitation link before lowering the invitation allowance.',409);await db.prepare('UPDATE invites SET name=?,max_guests=?,updated=? WHERE id=?').bind(name,max,new Date().toISOString(),id).run();return json({ok:true})});
 }
 if(p.startsWith('/api/admin/invites/')&&m==='DELETE'){
 const id=p.slice('/api/admin/invites/'.length);if(!/^[0-9a-fA-F-]{36}$/.test(id))return fail('Invitation not found.',404);
 await initFood(env.DB);return await env.DB.transaction(async db=>{
 const food=await readFood(db,true);const row=await db.prepare('SELECT id FROM invites WHERE id=?').bind(id).first();if(!row)return fail('Invitation not found.',404);
 delete food.claims[id];await writeFood(db,food);
 await db.prepare('DELETE FROM settings WHERE key=?').bind('volunteer:'+id).run();
 await db.prepare('DELETE FROM invites WHERE id=?').bind(id).run();return json({ok:true});
 });
 }
 if(p==='/api/admin/invites'&&m==='POST'){
 const b=await req.json() as any,name=clean(b.name,120),max=Number(b.maxGuests);if(!name||!Number.isInteger(max)||max<1||max>20)return fail('Enter a name and a party size between 1 and 20.');const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO invites(id,name,email,max_guests,updated) VALUES(?,?,?,?,?)').bind(id,name,clean(b.email,200),max,new Date().toISOString()).run();return json({id});
 }
 if(p==='/api/admin/export'){
 const food=await readFood(env.DB);const rows=(await env.DB.prepare(inviteCrewSQL).all<any>()).results;for(const row of rows){const crew=crewData(row.volunteer_data);row.volunteer_roles=crew.volunteerRoles.map((id:string)=>crewLabels[id]).join('; ');row.volunteer_note=crew.volunteerNote;row.food_contributions=foodDescription(food,row.id);row.food_note=food.claims[row.id]?.note||'';row.food_received=foodDescription(food,row.id,true)}const keys=['name','email','status','guests','guest_names','note','volunteer_roles','volunteer_note','food_contributions','food_note','food_received'];return new Response([keys.join(','),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(','))].join('\r\n'),{headers:{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="ING-Winter-Fest-RSVPs.csv"','Cache-Control':'no-store'}});
 }
 if(p.startsWith('/api/admin/photos/')&&(m==='PATCH'||m==='DELETE')){
 const id=p.split('/').pop()||'',row=await env.DB.prepare('SELECT * FROM photos WHERE id=?').bind(id).first<any>();if(!row)return fail('Photo not found.',404);
 if(m==='PATCH'){await env.DB.prepare('UPDATE photos SET state=\'approved\' WHERE id=?').bind(id).run()}else{await env.BUCKET.delete('photos/'+id);const removed=await env.DB.prepare('DELETE FROM photos WHERE id=? RETURNING size').bind(id).first<{size:number}>();if(removed)await env.DB.prepare('UPDATE limits SET count=MAX(0,count-?) WHERE key=\'storage\'').bind(removed.size).run()}return json({ok:true});
 }
 if(p==='/api/admin/invitation'&&m==='POST'){
 if(Number(req.headers.get('Content-Length')||0)>MAX+50000)return fail('Invitation must be under 4 MB.',413);const f=(await req.formData()).get('file');if(!(f instanceof File)||f.size>MAX)return fail('Choose a JPEG or PNG under 4 MB.');const data=await f.arrayBuffer(),b=new Uint8Array(data);const type=b[0]===255&&b[1]===216?'image/jpeg':b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71?'image/png':null;if(!type)return fail('Choose a JPEG or PNG image.');await env.BUCKET.put('invitation',data,{httpMetadata:{contentType:type}});return json({ok:true});
 }
 }
 return fail('Not found.',404);
 }catch(e){console.error('Event API request failed',p);return fail('Something went wrong. Please try again.',500)}
}
