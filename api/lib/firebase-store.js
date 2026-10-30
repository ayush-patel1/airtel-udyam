import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { randomUUID } from "node:crypto";

let database;
export function getFirebaseDatabase(){
  if(database)return database;
  const databaseURL=process.env.FIREBASE_DATABASE_URL;
  const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if(!databaseURL||!raw)throw new Error("Firebase is not configured. Set FIREBASE_DATABASE_URL and FIREBASE_SERVICE_ACCOUNT_JSON.");
  let serviceAccount;
  try{serviceAccount=JSON.parse(raw)}catch{throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");}
  const app=getApps()[0]||initializeApp({credential:cert(serviceAccount),databaseURL});
  database=getDatabase(app);
  return database;
}
const stamp=()=>new Date().toISOString();
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function matches(row,where={}){
  return Object.entries(where).every(([key,expected])=>{
    const actual=row?.[key];
    if(expected&&typeof expected==="object"&&!Array.isArray(expected)){
      if("in" in expected)return expected.in.includes(actual);
      if("not" in expected)return actual!==expected.not;
      if("equals" in expected)return actual===expected.equals;
    }
    return actual===expected;
  });
}
function sortRows(rows,orderBy){
  if(!orderBy)return rows;
  const [key,direction]=Object.entries(orderBy)[0]||[];
  if(!key)return rows;
  return rows.sort((a,b)=>{
    const av=a[key]??"",bv=b[key]??"";
    const cmp=av instanceof Date?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true});
    return direction==="desc"?-cmp:cmp;
  });
}
function project(row,select){
  if(!select)return row;
  return Object.fromEntries(Object.entries(select).filter(([,yes])=>yes).map(([k])=>[k,row[k]]));
}
const relations={
  user:{auditEvents:["auditEvents","actorId","id"]},
  business:{quotes:["quotes","businessId","id"],orders:["orders","businessId","id"],documents:["kycDocuments","businessId","id"],messages:["messages","businessId","id"]},
  quote:{business:["businesses","id","businessId"],orders:["orders","quoteId","id"]},
  order:{business:["businesses","id","businessId"],quote:["quotes","id","quoteId"]},
  kycDocument:{business:["businesses","id","businessId"]},
  message:{business:["businesses","id","businessId"]},
  auditEvent:{actor:["users","id","actorId"]}
};
export function createFirebaseStore(){
  const db=getFirebaseDatabase();
  const names={user:"users",business:"businesses",quote:"quotes",kycDocument:"kycDocuments",order:"orders",consent:"consents",auditEvent:"auditEvents",message:"messages",integrationEvent:"integrationEvents"};
  const refFor=model=>db.ref(names[model]);
  const all=async model=>{
    const snap=await refFor(model).get(),value=snap.val()||{};
    return Object.entries(value).map(([id,row])=>({id,...row}));
  };
  const enrich=async(model,row,include)=>{
    if(!row||!include)return row;
    const out={...row};
    for(const [key,opts] of Object.entries(include)){
      if(!opts)continue;
      const relation=relations[model]?.[key];
      if(!relation)continue;
      const [collection,foreignKey,localKey]=relation;
      const targetModel=Object.keys(names).find(k=>names[k]===collection);
      if(!targetModel)continue;
      const target=await all(targetModel);
      if(foreignKey==="id")out[key]=target.find(x=>x.id===row[localKey])||null;
      else{
        let rows=target.filter(x=>x[foreignKey]===row[localKey]);
        if(opts.orderBy)rows=sortRows(rows,opts.orderBy);
        if(opts.take)rows=rows.slice(0,opts.take);
        if(opts.select)rows=rows.map(x=>project(x,opts.select));
        out[key]=rows;
      }
    }
    return out;
  };
  const modelApi=model=>({
    async create({data}){
      const id=data.id||randomUUID();
      const row={...clone(data),id,createdAt:data.createdAt||stamp()};
      if(model!=="user"&&model!=="integrationEvent")row.updatedAt=row.updatedAt||stamp();
      await refFor(model).child(id).set(row);
      return row;
    },
    async findUnique({where,include,select}){
      const rows=await all(model),row=rows.find(x=>matches(x,where));
      return project(await enrich(model,row,include),select);
    },
    async findFirst({where={},include,orderBy,take,select}){
      let rows=(await all(model)).filter(x=>matches(x,where));
      rows=sortRows(rows,orderBy);
      const row=take===0?null:rows[0]||null;
      return project(await enrich(model,row,include),select);
    },
    async findMany({where={},include,orderBy,take,select}={}){
      let rows=(await all(model)).filter(x=>matches(x,where));
      rows=sortRows(rows,orderBy);
      if(Number.isFinite(take))rows=rows.slice(0,take);
      const result=[];
      for(const row of rows)result.push(project(await enrich(model,row,include),select));
      return result;
    },
    async update({where,data}){
      const existing=(await all(model)).find(x=>matches(x,where));
      if(!existing)throw Object.assign(new Error(model+" record not found"),{status:404});
      const next={...existing,...clone(data),id:existing.id,updatedAt:stamp()};
      await refFor(model).child(existing.id).update(next);
      return next;
    },
    async upsert({where,create,update}){
      const existing=(await all(model)).find(x=>matches(x,where));
      if(existing)return modelApi(model).update({where:{id:existing.id},data:update});
      return modelApi(model).create({data:create});
    },
    async count({where={}}={}){return (await all(model)).filter(x=>matches(x,where)).length;}
  });
  const store={};
  for(const model of Object.keys(names))store[model]=modelApi(model);
  store.$transaction=async operations=>Promise.all(operations);
  store.$disconnect=async()=>{};
  return store;
}
