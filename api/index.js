import express from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";

const app = express();
const prisma = new PrismaClient();
const jsonParser = express.json({ limit: "1mb" });
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGINS || "").split(",").filter(Boolean), credentials: true }));
app.use((req,res,next) => {
  if (req.path.startsWith("/webhooks/whatsapp")) return next();
  return jsonParser(req,res,next);
});

const JWT_SECRET = process.env.JWT_SECRET;
const secret = () => {
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be configured with at least 32 characters");
  return new TextEncoder().encode(JWT_SECRET);
};
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const audit = (req, action, entityType, entityId, metadata={}) => prisma.auditEvent.create({
  data:{ actorId:req.user?.sub || null, action, entityType, entityId, ipAddress:req.ip, metadata }
});
const mask = value => value ? value.replace(/^(.{3}).*(.{3})$/, "$1••••••$2") : null;

async function auth(req,res,next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i,"");
    if (!token) return res.status(401).json({error:"Authentication required"});
    const {payload} = await jwtVerify(token, secret());
    const user = await prisma.user.findUnique({where:{id:payload.sub}});
    if (!user || !user.active) return res.status(401).json({error:"Invalid account"});
    req.user = {sub:user.id, role:user.role, email:user.email};
    next();
  } catch { return res.status(401).json({error:"Invalid or expired token"}); }
}
const allow = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({error:"Insufficient permissions"});
const makeToken = user => new SignJWT({role:user.role,email:user.email}).setProtectedHeader({alg:"HS256"}).setSubject(user.id).setIssuedAt().setExpirationTime("8h").sign(secret());

function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const err = new Error("Validation failed"); err.status=400; err.details=result.error.flatten(); throw err;
  }
  return result.data;
}

const businessSchema = z.object({
  name:z.string().min(2).max(160), phone:z.string().max(20).optional(), email:z.email().optional(),
  preferredLang:z.string().default("en"), segment:z.string().optional(), city:z.string().optional(),
  cityTier:z.string().optional(), gstin:z.string().max(20).optional(), udyamNumber:z.string().max(30).optional()
});
const quoteSchema = z.object({
  businessId:z.string(), items:z.array(z.object({sku:z.string(),name:z.string(),quantity:z.number().int().positive(),monthlyMin:z.number().nonnegative(),monthlyMax:z.number().nonnegative(),setupFee:z.number().nonnegative()})).min(1),
  ruleVersion:z.string().default("catalogue-v1"), contractMonths:z.number().int().positive().optional()
});

// Health and service readiness
app.get("/api/health", (req,res) => res.json({ok:true,service:"udyam-api",time:new Date().toISOString(),integrations:{llm:Boolean(process.env.GEMINI_API_KEY),
  database:Boolean(process.env.DATABASE_URL),whatsapp:Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  storage:Boolean(process.env.AWS_S3_BUCKET),ocr:Boolean(process.env.AWS_REGION)
}}));

// Public assistant endpoint. Keep provider credentials server-side; never send them to the browser.
const assistantRequests=new Map();
const assistantOutputSchema={
  type:"OBJECT",
  properties:{
    reply:{type:"STRING"},
    profile_updates:{type:"OBJECT",properties:{
      name:{type:"STRING",nullable:true},type:{type:"STRING",nullable:true},city:{type:"STRING",nullable:true},
      employees:{type:"INTEGER",nullable:true},sites:{type:"INTEGER",nullable:true},budget:{type:"NUMBER",nullable:true},need:{type:"STRING",nullable:true}
    },required:["name","type","city","employees","sites","budget","need"]},
    selected_skus:{type:"ARRAY",items:{type:"STRING"}},
    navigation:{type:"STRING",enum:["none","quote","kyc","tracker","growth","advisor"]}
  },required:["reply","profile_updates","selected_skus","navigation"]
};
app.post("/api/assistant/chat",asyncRoute(async(req,res)=>{
  if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:"AI assistant is not configured. Add GEMINI_API_KEY in Vercel project environment variables."});
  const input=validate(z.object({
    message:z.string().trim().min(1).max(4000),
    history:z.array(z.object({role:z.enum(["user","assistant"]),content:z.string().max(4000)})).max(12).default([]),
    business:z.record(z.string(),z.unknown()).optional(),
    catalogue:z.array(z.object({sku:z.string(),name:z.string(),category:z.string(),description:z.string().optional(),monthlyMin:z.number(),monthlyMax:z.number(),setupFee:z.number(),eligible:z.boolean(),reason:z.string().optional()})).max(40).default([]),
    editMode:z.boolean().default(false)
  }),req.body);
  const now=Date.now(),key=req.ip||"unknown",recent=(assistantRequests.get(key)||[]).filter(t=>now-t<60000);
  if(recent.length>=12)return res.status(429).json({error:"Please wait a moment before sending another message."});
  recent.push(now);assistantRequests.set(key,recent);
  const instructions=[
    "You are Udyam Assistant for Airtel Business, helping Indian MSMEs with onboarding and digital services.",
    "Be conversational, specific, concise and context-aware. Answer the actual question; do not force every query into a product recommendation.",
    "Use INR for prices. Never invent catalogue prices, eligibility, Airtel coverage, government verification, order status or integration status.",
    "The supplied catalogue includes server-calculated eligibility. Recommend only entries marked eligible=true. Use their SKU values in selected_skus. Never calculate or alter prices.",
    "If information is missing, ask one clear follow-up question. Do not assume city, employee count, GST status or business type.",
    "When editMode is true, help the user change the business profile in chat. If they identify a field but not its new value, ask for the value. When a clear new value is provided, set only that field in profile_updates and confirm it. For normal messages, profile_updates must be all null.",
    "For KYC, explain that format and sample registry checks are not official verification; sensitive documents must use secure upload and uncertain cases need human review.",
    "Do not claim that a recommendation, quote, KYC check, message or order has been executed unless the application context confirms it.",
    "Return valid structured data. reply is plain text with concise paragraphs; no HTML. selected_skus must contain only catalogue SKUs. navigation should be quote, kyc, tracker or growth only when a clear next-step screen is useful."
  ].join("\n");
  const context=JSON.stringify({business:input.business||null,catalogue:input.catalogue,editMode:input.editMode,history:input.history,message:input.message});
  const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
  const upstream=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},
      contents:[{role:"user",parts:[{text:context}]}],
      generationConfig:{responseMimeType:"application/json",responseSchema:assistantOutputSchema,maxOutputTokens:900,temperature:0.3}})
  });
  const payload=await upstream.json();
  if(!upstream.ok){console.error("Gemini assistant error",upstream.status,payload?.error?.status||"provider_error",payload?.error?.message||"");return res.status(502).json({error:"The AI assistant could not complete this request. Please try again.",providerStatus:upstream.status});}
  const raw=payload.candidates?.[0]?.content?.parts?.map(part=>part.text||"").join("").trim();
  if(!raw)return res.status(502).json({error:"The AI assistant returned an empty response. Please try again."});
  let result;try{result=JSON.parse(raw)}catch{return res.status(502).json({error:"The AI assistant returned an unreadable response. Please try again."});}
  const allowed=new Set(input.catalogue.filter(x=>x.eligible).map(x=>x.sku));
  result.selected_skus=(result.selected_skus||[]).filter(sku=>allowed.has(sku));
  res.json({result,model:process.env.GEMINI_MODEL||"gemini-2.5-flash"});
}));

// Bootstrap is intentionally disabled in production. Create the first ADMIN through a one-time secure script.
app.post("/api/auth/login", asyncRoute(async(req,res) => {
  const input=validate(z.object({email:z.email(),password:z.string().min(8)}),req.body);
  const user=await prisma.user.findUnique({where:{email:input.email.toLowerCase()}});
  if(!user || !user.active || !(await bcrypt.compare(input.password,user.passwordHash))) return res.status(401).json({error:"Invalid credentials"});
  const token=await makeToken(user); await audit({user:{sub:user.id},ip:req.ip},"AUTH_LOGIN","User",user.id);
  res.json({token,expiresIn:28800,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
}));
app.get("/api/auth/me",auth,(req,res)=>res.json({user:req.user}));

// Business profile and consent
app.post("/api/businesses",auth,asyncRoute(async(req,res)=>{
  const data=validate(businessSchema,req.body);
  const business=await prisma.business.create({data});
  await audit(req,"BUSINESS_CREATED","Business",business.id);
  res.status(201).json({business});
}));
app.get("/api/businesses/:id",auth,asyncRoute(async(req,res)=>{
  const b=await prisma.business.findUnique({where:{id:req.params.id},include:{quotes:{orderBy:{createdAt:"desc"},take:10},orders:{orderBy:{createdAt:"desc"},take:10}}});
  if(!b)return res.status(404).json({error:"Business not found"});
  res.json({business:{...b,gstin:mask(b.gstin),udyamNumber:mask(b.udyamNumber)}});
}));
app.post("/api/businesses/:id/consent",auth,asyncRoute(async(req,res)=>{
  const input=validate(z.object({purpose:z.string().min(3),channel:z.enum(["WEB","WHATSAPP","MOBILE"]),version:z.string().min(1),granted:z.boolean()}),req.body);
  const business=await prisma.business.findUnique({where:{id:req.params.id}});
  if(!business)return res.status(404).json({error:"Business not found"});
  const [consent]=await prisma.$transaction([
    prisma.consent.create({data:{businessId:business.id,...input,evidence:{ip:req.ip,userAgent:req.headers["user-agent"]||null}}}),
    prisma.business.update({where:{id:business.id},data:{consentAt:input.granted?new Date():null,consentPurpose:input.granted?input.purpose:null}})
  ]);
  await audit(req,"CONSENT_RECORDED","Business",business.id,{purpose:input.purpose,granted:input.granted,channel:input.channel});
  res.status(201).json({consent});
}));

// Deterministic quote calculation. Catalogue/eligibility is always server-authoritative.
app.post("/api/quotes",auth,asyncRoute(async(req,res)=>{
  const input=validate(quoteSchema,req.body);
  const business=await prisma.business.findUnique({where:{id:input.businessId}});
  if(!business)return res.status(404).json({error:"Business not found"});
  if(input.items.some(i=>i.monthlyMax<i.monthlyMin))return res.status(400).json({error:"Invalid price range"});
  const monthlyMin=input.items.reduce((s,i)=>s+i.monthlyMin*i.quantity,0);
  const monthlyMax=input.items.reduce((s,i)=>s+i.monthlyMax*i.quantity,0);
  const setupTotal=input.items.reduce((s,i)=>s+i.setupFee*i.quantity,0);
  const quote=await prisma.quote.create({data:{quoteNumber:"UDQ-"+Date.now().toString(36).toUpperCase()+"-"+randomUUID().slice(0,5).toUpperCase(),businessId:business.id,items:input.items,monthlyMin,monthlyMax,setupTotal,contractMonths:input.contractMonths,ruleVersion:input.ruleVersion}});
  await audit(req,"QUOTE_CREATED","Quote",quote.id,{quoteNumber:quote.quoteNumber,monthlyMin,monthlyMax});
  res.status(201).json({quote});
}));
app.get("/api/quotes/:id",auth,asyncRoute(async(req,res)=>{
  const quote=await prisma.quote.findUnique({where:{id:req.params.id},include:{business:{select:{id:true,name:true,city:true,segment:true}}}});
  if(!quote)return res.status(404).json({error:"Quote not found"});
  res.json({quote});
}));

// Private S3 upload: issue a short-lived pre-signed PUT URL; document bytes never pass through this function.
const s3=()=>new S3Client({region:process.env.AWS_REGION});
app.post("/api/kyc/upload-url",auth,allow("ADMIN","REVIEWER","SALES"),asyncRoute(async(req,res)=>{
  const input=validate(z.object({businessId:z.string(),fileName:z.string().min(1).max(180),mimeType:z.enum(["application/pdf","image/jpeg","image/png"]),sizeBytes:z.number().int().positive().max(10*1024*1024),documentType:z.string().min(2).max(60)}),req.body);
  if(!process.env.AWS_S3_BUCKET || !process.env.AWS_REGION)return res.status(503).json({error:"Secure document storage is not configured"});
  if(!await prisma.business.findUnique({where:{id:input.businessId}}))return res.status(404).json({error:"Business not found"});
  const key=`kyc/${input.businessId}/${randomUUID()}`;
  const command=new PutObjectCommand({Bucket:process.env.AWS_S3_BUCKET,Key:key,ContentType:input.mimeType,ServerSideEncryption:"aws:kms",Metadata:{businessid:input.businessId}});
  const uploadUrl=await getSignedUrl(s3(),command,{expiresIn:300});
  const doc=await prisma.kycDocument.create({data:{businessId:input.businessId,documentType:input.documentType,storageKey:key,originalName:input.fileName,mimeType:input.mimeType,sizeBytes:input.sizeBytes}});
  await audit(req,"KYC_UPLOAD_URL_ISSUED","KycDocument",doc.id,{documentType:input.documentType});
  res.status(201).json({documentId:doc.id,uploadUrl,expiresIn:300,requiredHeaders:{"Content-Type":input.mimeType}});
}));

// OCR extraction is advisory only; extracted text never marks a document as verified.
app.post("/api/kyc/:documentId/ocr",auth,allow("ADMIN","REVIEWER"),asyncRoute(async(req,res)=>{
  const doc=await prisma.kycDocument.findUnique({where:{id:req.params.documentId}});
  if(!doc)return res.status(404).json({error:"Document not found"});
  if(!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET)return res.status(503).json({error:"OCR storage is not configured"});
  const textract=new TextractClient({region:process.env.AWS_REGION});
  const out=await textract.send(new DetectDocumentTextCommand({Document:{S3Object:{Bucket:process.env.AWS_S3_BUCKET,Name:doc.storageKey}}}));
  const lines=(out.Blocks||[]).filter(b=>b.BlockType==="LINE").map(b=>b.Text).filter(Boolean);
  const extractedData={lines,provider:"AWS_TEXTRACT",extractedAt:new Date().toISOString(),disclaimer:"OCR extraction is not identity or document authenticity verification."};
  await prisma.kycDocument.update({where:{id:doc.id},data:{extractedData,reviewStatus:"NEEDS_REVIEW"}});
  await audit(req,"KYC_OCR_EXTRACTED","KycDocument",doc.id,{lineCount:lines.length});
  res.json({documentId:doc.id,extractedData});
}));
app.get("/api/kyc/queue",auth,allow("ADMIN","REVIEWER"),asyncRoute(async(req,res)=>{
  const docs=await prisma.kycDocument.findMany({where:{reviewStatus:{in:["PENDING","NEEDS_REVIEW"]}},include:{business:{select:{id:true,name:true,city:true}}},orderBy:{createdAt:"asc"},take:100});
  res.json({documents:docs});
}));
app.post("/api/kyc/:documentId/review",auth,allow("ADMIN","REVIEWER"),asyncRoute(async(req,res)=>{
  const input=validate(z.object({decision:z.enum(["VERIFIED","REJECTED"]),notes:z.string().max(1000).optional()}),req.body);
  const doc=await prisma.kycDocument.update({where:{id:req.params.documentId},data:{reviewStatus:input.decision,reviewerId:req.user.sub,reviewedAt:new Date()}});
  await audit(req,"KYC_REVIEW_"+input.decision,"KycDocument",doc.id,{notes:input.notes||null});
  res.json({document:doc});
}));

// Order state machine: clients cannot skip mandatory review/provisioning transitions.
const transitions={DRAFT:["QUOTED","CANCELLED"],QUOTED:["KYC_PENDING","CANCELLED"],KYC_PENDING:["UNDER_REVIEW","CANCELLED"],UNDER_REVIEW:["APPROVED","REJECTED"],APPROVED:["PROVISIONING"],PROVISIONING:["ACTIVE"],REJECTED:[],ACTIVE:[],CANCELLED:[]};
app.post("/api/orders",auth,asyncRoute(async(req,res)=>{
  const input=validate(z.object({businessId:z.string(),quoteId:z.string()}),req.body);
  const quote=await prisma.quote.findFirst({where:{id:input.quoteId,businessId:input.businessId}});
  if(!quote)return res.status(404).json({error:"Matching quote not found"});
  const order=await prisma.order.create({data:{orderNumber:"UDO-"+Date.now().toString(36).toUpperCase(),businessId:input.businessId,quoteId:input.quoteId,status:"QUOTED",milestones:[{status:"QUOTED",at:new Date().toISOString()}]}});
  await audit(req,"ORDER_CREATED","Order",order.id);
  res.status(201).json({order});
}));
app.patch("/api/orders/:id/status",auth,allow("ADMIN","REVIEWER","OPERATIONS"),asyncRoute(async(req,res)=>{
  const input=validate(z.object({status:z.enum(["KYC_PENDING","UNDER_REVIEW","APPROVED","REJECTED","PROVISIONING","ACTIVE","CANCELLED"])}),req.body);
  const order=await prisma.order.findUnique({where:{id:req.params.id}});
  if(!order)return res.status(404).json({error:"Order not found"});
  if(!transitions[order.status]?.includes(input.status))return res.status(409).json({error:`Transition ${order.status} → ${input.status} is not allowed`});
  if(input.status==="APPROVED"){
    const pending=await prisma.kycDocument.count({where:{businessId:order.businessId,reviewStatus:{not:"VERIFIED"}}});
    if(pending>0)return res.status(409).json({error:"All submitted KYC documents must be reviewed before approval"});
  }
  const milestones=Array.isArray(order.milestones)?order.milestones:[];
  milestones.push({status:input.status,at:new Date().toISOString(),actor:req.user.sub});
  const updated=await prisma.order.update({where:{id:order.id},data:{status:input.status,milestones}});
  await audit(req,"ORDER_STATUS_CHANGED","Order",order.id,{from:order.status,to:input.status});
  res.json({order:updated});
}));

// WhatsApp Cloud API webhook. Verify challenge, persist inbound events idempotently, and send outbound templates/text.
app.get("/api/webhooks/whatsapp",(req,res)=>{
  const mode=req.query["hub.mode"],token=req.query["hub.verify_token"],challenge=req.query["hub.challenge"];
  if(mode==="subscribe" && token && token===process.env.WHATSAPP_VERIFY_TOKEN)return res.status(200).send(challenge);
  return res.sendStatus(403);
});
app.post("/api/webhooks/whatsapp",express.json({type:"application/json"}),asyncRoute(async(req,res)=>{
  // Acknowledge quickly; persist the raw event for an async worker to process.
  const entries=req.body?.entry||[];
  for(const entry of entries) for(const change of entry.changes||[]) {
    const value=change.value||{};
    for(const msg of value.messages||[]) {
      const eventKey="wa-in-"+msg.id;
      await prisma.integrationEvent.upsert({where:{eventKey},create:{provider:"WHATSAPP",eventKey,eventType:"message",payload:msg},update:{}});
      await prisma.message.upsert({where:{providerId:msg.id},create:{channel:"WHATSAPP",direction:"INBOUND",providerId:msg.id,fromAddress:msg.from,toAddress:value.metadata?.display_phone_number||"",body:msg.text?.body||null,payload:msg},update:{}});
    }
    for(const status of value.statuses||[]) {
      const eventKey="wa-status-"+status.id+"-"+status.status;
      await prisma.integrationEvent.upsert({where:{eventKey},create:{provider:"WHATSAPP",eventKey,eventType:"message_status",payload:status},update:{}});
    }
  }
  res.sendStatus(200);
}));
app.post("/api/channels/whatsapp/send",auth,allow("ADMIN","REVIEWER","SALES","OPERATIONS"),asyncRoute(async(req,res)=>{
  const input=validate(z.object({to:z.string().regex(/^\+?[1-9]\d{7,14}$/),text:z.string().min(1).max(4096),businessId:z.string().optional()}),req.body);
  if(!process.env.WHATSAPP_TOKEN||!process.env.WHATSAPP_PHONE_NUMBER_ID)return res.status(503).json({error:"WhatsApp Cloud API credentials are not configured"});
  const response=await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION||"v23.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{
    method:"POST",headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,"Content-Type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:input.to.replace("+",""),type:"text",text:{preview_url:false,body:input.text}})
  });
  const payload=await response.json();
  if(!response.ok)return res.status(502).json({error:"WhatsApp provider rejected the message",provider:payload});
  const message=await prisma.message.create({data:{businessId:input.businessId,channel:"WHATSAPP",direction:"OUTBOUND",providerId:payload.messages?.[0]?.id,fromAddress:process.env.WHATSAPP_PHONE_NUMBER_ID,toAddress:input.to,body:input.text,status:"SENT",payload}});
  await audit(req,"WHATSAPP_MESSAGE_SENT","Message",message.id,{to:mask(input.to)});
  res.status(201).json({messageId:message.id,status:"SENT"});
}));

// Integration status, reviewer queue and audit access
app.get("/api/admin/integrations",auth,allow("ADMIN"),(req,res)=>res.json({whatsapp:Boolean(process.env.WHATSAPP_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_VERIFY_TOKEN),s3:Boolean(process.env.AWS_S3_BUCKET),ocr:Boolean(process.env.AWS_REGION),database:Boolean(process.env.DATABASE_URL),llm:Boolean(process.env.GEMINI_API_KEY),airtelApis:Boolean(process.env.AIRTEL_API_BASE_URL&&process.env.AIRTEL_API_TOKEN)}));
app.get("/api/admin/audit",auth,allow("ADMIN","REVIEWER"),asyncRoute(async(req,res)=>{
  const events=await prisma.auditEvent.findMany({orderBy:{createdAt:"desc"},take:Math.min(Number(req.query.limit)||100,500),include:{actor:{select:{name:true,email:true,role:true}}}});
  res.json({events});
}));
app.get("/api/admin/messages",auth,allow("ADMIN","REVIEWER","OPERATIONS"),asyncRoute(async(req,res)=>{
  const messages=await prisma.message.findMany({orderBy:{createdAt:"desc"},take:100});
  res.json({messages});
}));

app.use((err,req,res,next)=>{
  console.error(JSON.stringify({message:err.message,path:req.path,requestId:req.headers["x-vercel-id"]||null}));
  res.status(err.status||500).json({error:err.status?err.message:"Internal server error",...(err.details?{details:err.details}:{})});
});
export default app;