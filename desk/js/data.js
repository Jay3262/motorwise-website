// Data layer. Two interchangeable adapters with the same API:
//   LocalStore  - IndexedDB on this device. Used for SAMPLE MODE (testing).
//   SupaStore   - Supabase (Postgres + Auth + Storage + Realtime). Used for LIVE MODE.
import { CONFIG, BUSINESS_DEFAULTS } from "./config.js";

export const TABLES = ["cars","photos","leads","viewings","transactions","customers","handovers","issues","templates","settings","notes","audit","push_subscriptions"];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const nowIso = () => new Date().toISOString();

/* ---------------- Local (IndexedDB) ---------------- */
function idb(name){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(name,3);
    r.onupgradeneeded=()=>{const d=r.result;for(const t of [...TABLES,"files","meta"]) if(!d.objectStoreNames.contains(t)) d.createObjectStore(t,{keyPath:t==="files"||t==="meta"?"key":"id"});};
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
const tx=(db,store,mode,fn)=>new Promise((res,rej)=>{const t=db.transaction(store,mode);const s=t.objectStore(store);const out=fn(s);t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error);});

export class LocalStore{
  constructor(name){this.name=name;this.kind="local";this.listeners=new Set();}
  async init(){this.db=await idb(this.name);}
  async user(){const u=await tx(this.db,"meta","readonly",s=>s.get("user"));return u?u.value:null;}
  async signIn(email){const u={id:"local-"+email.toLowerCase(),email:email.toLowerCase(),name:email.split("@")[0]};await tx(this.db,"meta","readwrite",s=>s.put({key:"user",value:u}));return u;}
  async signOut(){await tx(this.db,"meta","readwrite",s=>s.delete("user"));}
  async list(t){return tx(this.db,t,"readonly",s=>s.getAll());}
  async get(t,id){return tx(this.db,t,"readonly",s=>s.get(id));}
  async insert(t,row){row={id:uid(),created_at:nowIso(),...row};await tx(this.db,t,"readwrite",s=>s.put(row));this.emit(t);return row;}
  // Read and write in ONE transaction, so two quick edits can never overwrite each other.
  async update(t,id,patch){const row=await new Promise((res,rej)=>{const x=this.db.transaction(t,"readwrite");const st=x.objectStore(t);let out;const g=st.get(id);g.onsuccess=()=>{out={...g.result,...patch,updated_at:nowIso()};st.put(out);};x.oncomplete=()=>res(out);x.onerror=()=>rej(x.error);});this.emit(t);return row;}
  async remove(t,id){await tx(this.db,t,"readwrite",s=>s.delete(id));this.emit(t);}
  async putFile(path,blob){await tx(this.db,"files","readwrite",s=>s.put({key:path,blob,type:blob.type}));return path;}
  async fileBlob(path){const f=await tx(this.db,"files","readonly",s=>s.get(path));return f?f.blob:null;}
  async fileUrl(path){const b=await this.fileBlob(path);return b?URL.createObjectURL(b):"";}
  async nextInvoiceNumber(){const st=(await this.list("settings"))[0];const n=st.next_invoice_number;await this.update("settings",st.id,{next_invoice_number:n+1});return `${st.invoice_prefix}-${n}`;}
  async team(){const st=(await this.list("settings"))[0];return (st&&st.team)||[];}
  async invoke(){throw new Error("Needs live mode (Supabase) to use this service.");}
  async wipe(){for(const t of [...TABLES,"files"]) await tx(this.db,t,"readwrite",s=>s.clear());}
  onChange(fn){this.listeners.add(fn);}
  emit(t,remote=false){if(!remote) this.lastWrite=Date.now();for(const f of this.listeners) f(t,remote);}
}

/* ---------------- Supabase ---------------- */
export class SupaStore{
  // Every table stores rows as (id uuid, created_at, updated_at, data jsonb). The app works with plain objects.
  constructor(){this.kind="supabase";this.listeners=new Set();}
  async init(){
    if(!window.supabase) await new Promise((res,rej)=>{const sc=document.createElement("script");sc.src="js/vendor/supabase.js";sc.onload=res;sc.onerror=()=>rej(new Error("Could not load the Supabase library"));document.head.appendChild(sc);});
    this.sb=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
    this.sb.channel("all").on("postgres_changes",{event:"*",schema:"public"},p=>{if(Date.now()-(this.lastWrite||0)>3000) this.emit(p.table,true);}).subscribe();
  }
  row(r){return r?{...(r.data||{}),id:r.id,created_at:r.created_at,updated_at:r.updated_at}:null;}
  async user(){const {data}=await this.sb.auth.getUser();if(!data.user) return null;const {data:m}=await this.sb.from("team_members").select("name").eq("email",data.user.email).maybeSingle();return {id:data.user.id,email:data.user.email,name:(m&&m.name)||data.user.email.split("@")[0]};}
  async signIn(email,password){const {error}=await this.sb.auth.signInWithPassword({email,password});if(error) throw error;return this.user();}
  async signOut(){await this.sb.auth.signOut();}
  async resetPassword(email){const {error}=await this.sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error) throw error;}
  async list(t){const {data,error}=await this.sb.from(t).select("*");if(error) throw error;return data.map(r=>this.row(r));}
  async get(t,id){const {data,error}=await this.sb.from(t).select("*").eq("id",id).maybeSingle();if(error) throw error;return this.row(data);}
  async insert(t,row){const id=row.id||uid();const {id:_,...rest}=row;const {data,error}=await this.sb.from(t).insert({id,data:rest}).select().single();if(error) throw error;this.emit(t);return this.row(data);}
  // Merges only the changed fields on the server (patch_row), so edits from both phones don't overwrite each other.
  async update(t,id,patch){const {id:_,created_at,updated_at,...rest}=patch;const {data,error}=await this.sb.rpc("patch_row",{tbl:t,row_id:id,patch:rest});if(error) throw error;this.emit(t);return this.row(data);}
  async remove(t,id){const {error}=await this.sb.from(t).delete().eq("id",id);if(error) throw error;this.emit(t);}
  async putFile(path,blob){const {error}=await this.sb.storage.from("private").upload(path,blob,{upsert:false,contentType:blob.type});if(error) throw error;return path;}
  async fileBlob(path){const {data,error}=await this.sb.storage.from("private").download(path);if(error) return null;return data;}
  async fileUrl(path){const {data}=await this.sb.storage.from("private").createSignedUrl(path,3600);return data?data.signedUrl:"";}
  async nextInvoiceNumber(){const {data,error}=await this.sb.rpc("next_invoice_number");if(error) throw error;return data;}
  async team(){const {data,error}=await this.sb.from("team_members").select("email,name");if(error) throw error;return data;}
  async invoke(fn,body){const {data,error}=await this.sb.functions.invoke(fn,{body});if(error) throw error;return data;}
  async savePush(sub,user){await this.insert("push_subscriptions",{user_email:user.email,subscription:sub.toJSON?sub.toJSON():sub});}
  onChange(fn){this.listeners.add(fn);}
  emit(t,remote=false){if(!remote) this.lastWrite=Date.now();for(const f of this.listeners) f(t,remote);}
}

export const isLiveConfigured=()=>!!(CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_ANON_KEY);

/* ---------------- Templates (wording to approve) ---------------- */
// Status "draft" = not yet approved by the business/legal/accountant. Packs using draft wording are watermarked DRAFT.
export const TEMPLATE_DEFAULTS=[
 {key:"tcs",title:"Terms and conditions of sale",status:"draft",body:
"1. Who you are buying from. You are buying from {legal_name}, a sole trader trading as {trading_name}, {invoice_address}. We sell vehicles as a business, so you have full consumer rights.\n"+
"2. The vehicle. The vehicle is used. Its price reflects its age, mileage and condition, and wear and tear normal for a vehicle of this age is to be expected. The faults and condition points listed on the order form were explained to you before you agreed to buy. You cannot claim for those faults, or for faults you could reasonably have seen when you inspected the vehicle.\n"+
"3. Your legal rights. Under the Consumer Rights Act 2015 the vehicle must be of satisfactory quality (taking into account its age, mileage and price), fit for purpose and as described. If a fault that was present when you bought it shows up within 30 days, you may be able to reject the vehicle for a refund. After 30 days and within 6 months, you can ask us to repair it first. Nothing in these terms affects your legal rights.\n"+
"4. Warranty and goodwill look-over. No warranty is included unless one is written on the order form. If something comes up within {aftercare_days} days of collection, contact us and we will take a look as a goodwill gesture. This is in addition to your legal rights and is not a promise of a free repair.\n"+
"5. Price and payment. The price on the order form is the full price, with no fees added. The vehicle stays our property until it has been paid for in full.\n"+
"6. Deposits. A deposit holds the vehicle for you for the time we agree. If we cannot supply the vehicle, we refund your deposit in full. If you decide not to go ahead without a good reason, we may keep the reasonable costs and losses this causes us from the deposit and refund the rest.\n"+
"7. Part exchange. If you part exchange a vehicle, you confirm that you own it, that no finance is owed on it (or you have told us the amount), that its mileage is genuine, and that you have told us about any faults you know of. If any of this is untrue, you must pay us the difference in value, or any amount we have to pay to clear finance.\n"+
"8. After collection. From collection you are responsible for insuring and taxing the vehicle. We are not responsible for damage caused by accidents or misuse after collection, or for work done by others. If a problem comes up, please contact us before having it repaired elsewhere so we can look at it first. This does not remove your legal rights.\n"+
"9. Problems and complaints. Contact us first on {phone} or {email}, quoting your order number, and we will try to put things right. For free, independent advice, contact the Citizens Advice consumer helpline.\n"+
"10. Your details. We use your details to complete this sale and deal with anything after it. We keep sale records for as long as the law requires for tax and accounts. We do not sell your details or send you marketing without your consent.\n"+
"11. Law. These terms are governed by the law of England and Wales."},
 {key:"distance_rights",title:"Extra clause: sales agreed remotely or away from our site",status:"draft",body:
"12. Your right to cancel. This sale was agreed without you visiting us, or away from our site. You may cancel within 14 days of receiving the vehicle by telling us clearly (a message is fine). Return the vehicle in the condition you received it; we will refund you within 14 days of getting it back, less any reduction for extra mileage or use beyond what was needed to check the vehicle."},
 {key:"next_steps",title:"Before you drive away (order form)",status:"draft",body:
"1. Insure the vehicle in your name before driving it.  2. Tax it online at GOV.UK using the 12-digit reference on the green new keeper slip (V5C/2) we have given you. Tax does not transfer with the vehicle.  3. We tell DVLA that you are the new keeper; your new log book (V5C) will arrive by post. If it has not arrived within 4 weeks, contact DVLA.  4. You can check the MOT history at GOV.UK using the registration number."},
 {key:"warranty",title:"Extra clause: warranty (only if a warranty is sold)",status:"draft",body:"13. Warranty. [Add the warranty provider, cover, length and claims process here before approving.]"}
];

/* ---------------- Sample data (clearly labelled) ---------------- */
export async function seedSample(store){
  const existing=await store.list("settings");
  if(existing.length) return;
  await store.insert("settings",{...BUSINESS_DEFAULTS,sample:true,team:[{name:"Jay",email:"jay@sample.test"},{name:"Second user",email:"second@sample.test"}]});
  for(const t of TEMPLATE_DEFAULTS) await store.insert("templates",{...t,version:1,approved_by:null,approved_at:null});
  const d=(n)=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
  const tig=await store.insert("cars",{sample:true,reg:"SAMPLE 2",make:"Vauxhall",model:"Astra",variant:"1.6 SXi (SAMPLE)",year:2011,colour:"Black",fuel:"Petrol",gearbox:"Manual",mileage:112000,mileage_approx:true,asking_price:1795,mot_expiry:d(150),service_history:"Ask: not yet confirmed",condition:"",known_faults:"",keys:2,status:"preparing",purchase_date:d(-6),checklist:{},cover_photo:null});
  await store.insert("transactions",{sample:true,car_id:tig.id,type:"purchase",amount:1150,date:d(-6),method:"bank",note:"SAMPLE: purchase cost"});
  await store.insert("transactions",{sample:true,car_id:tig.id,type:"expense",category:"valeting",amount:60,date:d(-3),method:"card",note:"SAMPLE: valet"});
  const cor=await store.insert("cars",{sample:true,reg:"SAMPLE 1",make:"Ford",model:"Fiesta",variant:"1.25 Zetec (SAMPLE)",year:2009,colour:"Silver",fuel:"Petrol",gearbox:"Manual",mileage:98000,asking_price:1495,mot_expiry:d(240),service_history:"Partial",condition:"Tidy for age",known_faults:"Stone chips on bonnet",keys:1,status:"available",purchase_date:d(-20),checklist:{},cover_photo:null});
  await store.insert("transactions",{sample:true,car_id:cor.id,type:"purchase",amount:800,date:d(-20),method:"cash",note:"SAMPLE: purchase"});
  await store.insert("transactions",{sample:true,type:"overhead",category:"pitch rent",amount:150,date:d(-10),method:"bank",note:"SAMPLE: monthly bays rent"});
  await store.insert("leads",{sample:true,name:"Sample Customer",phone:"07700 900123",email:"sample@example.com",source:"WhatsApp",car_id:cor.id,stage:"new",assigned_to:null,follow_up:d(0),notes:"SAMPLE: asked if the Fiesta is still available",messages:[]});
}
