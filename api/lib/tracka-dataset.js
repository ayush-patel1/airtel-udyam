// Track A synthetic dataset helpers. All identifiers are fictional and used only for this prototype.
export function parseCsv(source) {
  const rows=[]; let row=[], cell="", quoted=false;
  const text=String(source||"").replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(quoted){
      if(ch==='"'&&next==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===","){row.push(cell);cell="";}
    else if(ch==="\n"||ch==="\r"){
      if(ch==="\r"&&next==="\n")i++;
      row.push(cell);cell="";
      if(row.some(v=>v!==""))rows.push(row);
      row=[];
    }else cell+=ch;
  }
  row.push(cell);if(row.some(v=>v!==""))rows.push(row);
  if(!rows.length)return [];
  const headers=rows.shift().map(v=>v.trim());
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||"").trim()])));
}
const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d};
const yes=v=>String(v||"").toUpperCase()==="Y";
const stageOrder=["Lead","Contacted","Needs assessed","Quote accepted","KYC complete","Activated"];
export function buildTrackAAnalytics(leads){
  const byStage=Object.fromEntries(stageOrder.map(s=>[s,0]));
  const segments={},sources={},drops={},channel={},monthlyRevenue=[];
  let activated=0,totalAcq=0,activationDays=0,followUps=0,churned=0,npsTotal=0,npsCount=0;
  for(const l of leads){
    const stage=l.stage_reached||"Lead",idx=Math.max(0,stageOrder.indexOf(stage));
    for(let i=0;i<=idx;i++)byStage[stageOrder[i]]++;
    const seg=l.segment||"Unknown";segments[seg]??={leads:0,activated:0,activationRate:0,monthlyValue:0,churned:0,npsTotal:0,npsCount:0};
    segments[seg].leads++;
    const src=l.lead_source||"Unknown";sources[src]??={leads:0,activated:0,activationRate:0};
    sources[src].leads++;
    totalAcq+=num(l.acquisition_cost_inr);
    followUps+=num(l.customer_follow_up_calls);
    channel[src]??={leads:0,activated:0};channel[src].leads++;
    if(l.outcome==="Activated"||stage==="Activated"){
      activated++;segments[seg].activated++;sources[src].activated++;channel[src].activated++;
      const value=num(l.monthly_bundle_value_inr);segments[seg].monthlyValue+=value;
      activationDays+=num(l.days_lead_to_activation);if(l.churned_within_6_months==="Y"){churned++;segments[seg].churned++;}
      if(l.nps_score!==""){const n=num(l.nps_score);npsTotal+=n;npsCount++;segments[seg].npsTotal+=n;segments[seg].npsCount++;}
      monthlyRevenue.push(value);
    }else if(l.drop_reason){drops[l.drop_reason]=(drops[l.drop_reason]||0)+1;}
  }
  for(const v of Object.values(segments)){v.activationRate=v.leads?Number((100*v.activated/v.leads).toFixed(2)):0;v.avgMonthlyValue=v.activated?Math.round(v.monthlyValue/v.activated):0;v.churnRate=v.activated?Number((100*v.churned/v.activated).toFixed(2)):0;v.avgNps=v.npsCount?Number((v.npsTotal/v.npsCount).toFixed(2)):null;delete v.monthlyValue;delete v.npsTotal;delete v.npsCount;}
  for(const v of Object.values(sources))v.activationRate=v.leads?Number((100*v.activated/v.leads).toFixed(2)):0;
  for(const v of Object.values(channel))v.activationRate=v.leads?Number((100*v.activated/v.leads).toFixed(2)):0;
  const elapsed=activationDays/Math.max(1,activated);
  return {
    totalLeads:leads.length,activated,dropped:leads.length-activated,activationRate:Number((100*activated/Math.max(1,leads.length)).toFixed(2)),
    funnel:stageOrder.map((stage,i)=>({stage,count:byStage[stage],conversionFromPrevious:i?Number((100*byStage[stage]/Math.max(1,byStage[stageOrder[i-1]])).toFixed(2)):100})),
    segments,sources,channelPerformance:channel,topDropReasons:Object.entries(drops).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([reason,count])=>({reason,count,share:Number((100*count/Math.max(1,leads.length-activated)).toFixed(2))})),
    avgLeadToActivationDays:Number(elapsed.toFixed(2)),avgFollowUpCalls:Number((followUps/Math.max(1,leads.length)).toFixed(2)),
    avgFollowUpCallsActivated:Number((leads.filter(l=>l.outcome==="Activated").reduce((s,l)=>s+num(l.customer_follow_up_calls),0)/Math.max(1,activated)).toFixed(2)),
    totalAcquisitionSpend:totalAcq,blendedCac:Math.round(totalAcq/Math.max(1,activated)),
    sixMonthChurnRate:Number((100*churned/Math.max(1,activated)).toFixed(2)),avgNps:npsCount?Number((npsTotal/npsCount).toFixed(2)):null,
    avgMonthlyBundleValue:Math.round(monthlyRevenue.reduce((a,b)=>a+b,0)/Math.max(1,activated)),
    annualisedActivatedRevenue:monthlyRevenue.reduce((a,b)=>a+b,0)*12,
    dataAsOf:"2026-07-15",synthetic:true
  };
}
export function scoreTrackALead(l){
  let score=15;const reasons=[];
  const stage=l.stage_reached||"Lead";
  const stagePoints={"Lead":4,"Contacted":12,"Needs assessed":23,"Quote accepted":38,"KYC complete":46,"Activated":0};
  score+=stagePoints[stage]||0;
  if(stage==="Quote accepted"){reasons.push("Quote accepted: follow up to complete KYC");}
  else if(stage==="KYC complete"){reasons.push("KYC complete: coordinate activation");}
  else if(stage==="Needs assessed"){reasons.push("Needs assessed: prepare a transparent quote");}
  if(l.drop_reason){
    if(/quote|price|expensive|complex/i.test(l.drop_reason)){score+=18;reasons.push("Pricing or quote friction is recoverable");}
    if(/document|kyc|gst|udyam|paperwork|signatory|match/i.test(l.drop_reason)){score+=16;reasons.push("KYC/document blocker can be resolved with assistance");}
    if(/unreachable|wrong|invalid/i.test(l.drop_reason)){score-=12;reasons.push("Contact details or reachability need validation");}
    if(/not interested|locked in|competitor/i.test(l.drop_reason)){score-=5;reasons.push("Customer expressed low immediate intent");}
  }
  if(l.products_of_interest) {score+=5;reasons.push("Product interest is recorded");}
  if(yes(l.has_gstin)||yes(l.has_udyam)){score+=4;reasons.push("At least one registration is recorded");}
  if(num(l.customer_follow_up_calls)>=3){score+=4;reasons.push("Customer has already made repeated follow-ups");}
  score=Math.max(0,Math.min(100,score));
  const nextAction=stage==="Quote accepted"?"Call to unblock KYC and confirm documents":stage==="KYC complete"?"Coordinate installation and activation":stage==="Needs assessed"?"Prepare a catalogue-backed bundle and quote":/price|quote|expensive|complex/i.test(l.drop_reason||"")?"Offer a simpler bundle and explain itemised pricing":/document|kyc|gst|udyam|paperwork|signatory|match/i.test(l.drop_reason||"")?"Offer guided KYC and document correction":/unreachable|wrong|invalid/i.test(l.drop_reason||"")?"Validate contact details before retrying":"Reconfirm business need and preferred callback time";
  return {score,priority:score>=65?"HIGH":score>=40?"MEDIUM":"LOW",reasons,nextAction};
}
const clean=(s)=>String(s||"").replace(/[^a-z0-9]/gi,"").toUpperCase();
const gstRegex=/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
export function lookupGstin(registry,gstin){
  const key=clean(gstin);if(!gstRegex.test(key))return {found:false,validFormat:false,error:"Enter a valid 15-character GSTIN format."};
  const row=registry.find(x=>clean(x.gstin)===key);if(!row)return {found:false,validFormat:true,status:"NOT_FOUND",message:"No match in the synthetic GST registry."};
  return {found:true,validFormat:true,gstin:key.slice(0,2)+"••••••••"+key.slice(-3),legalName:row.legal_name,tradeName:row.trade_name,constitution:row.constitution,principalPlaceOfBusiness:row.principal_place_of_business,state:row.state,registrationDate:row.registration_date,status:row.status,registry:"SYNTHETIC_GSTIN_REGISTRY",disclaimer:"Demo lookup only; not connected to GSTN and not an official verification."};
}
export function lookupUdyam(registry,number){
  const key=clean(number),row=registry.find(x=>clean(x.udyam_number)===key);
  if(!/^UDYAM[A-Z]{2}\d{2}\d{7}$/i.test(key))return {found:false,validFormat:false,error:"Enter a valid Udyam registration number format."};
  if(!row)return {found:false,validFormat:true,status:"NOT_FOUND",message:"No match in the synthetic Udyam registry."};
  const raw=row.udyam_number;
  return {found:true,validFormat:true,udyamNumber:raw.slice(0,8)+"••••"+raw.slice(-3),enterpriseName:row.enterprise_name,enterpriseType:row.enterprise_type,majorActivity:row.major_activity,nicDescription:row.nic_description,state:row.state,city:row.city,registrationDate:row.date_of_registration,registry:"SYNTHETIC_UDYAM_REGISTRY",disclaimer:"Demo lookup only; not connected to the official Udyam portal."};
}
export function analyseKycSamples(fixtures){
  const groups={};
  for(const doc of fixtures){groups[doc.applicant_id]??={applicantId:doc.applicant_id,documents:[],issues:[]};groups[doc.applicant_id].documents.push({fileName:doc.file_name,documentType:doc.document_type,ocrText:doc.ocr_text});}
  for(const applicant of Object.values(groups)){
    const all=applicant.documents.map(d=>d.ocrText).join(" ");
    const names=[...all.matchAll(/(?:Trade name|Enterprise name|For business|Billed to)\s+(.{3,70}?)(?=\s+(?:Constitution|Major activity|Supply address|Designation|ID no\.|GSTIN|City|State|Date of|Bill date|Specimen:|Format for|$))/gi)].map(m=>m[1].trim());
    const distinct=[...new Set(names.map(clean))].filter(Boolean);
    if(distinct.length>1)applicant.issues.push({severity:"REVIEW",code:"NAME_MISMATCH",message:"Business names differ across submitted documents."});
    const gst=all.match(/\b\d{2}[A-Z0-9]{10,13}\b/i);
    if(!gst)applicant.issues.push({severity:"REVIEW",code:"GSTIN_MISSING_OR_UNREADABLE",message:"GST certificate GSTIN could not be confidently extracted."});
    if(!/UDYAM-[A-Z]{2}-\d{2}-\d{7}/i.test(all))applicant.issues.push({severity:"REVIEW",code:"UDYAM_MISSING_OR_UNREADABLE",message:"Udyam registration number could not be confidently extracted."});
    const bill=all.match(/Bill date\s+(\d{4}-\d{2}-\d{2})/i);
    if(bill){const age=(Date.parse("2026-07-15")-Date.parse(bill[1]))/86400000;if(age>90)applicant.issues.push({severity:"CORRECTION",code:"ADDRESS_PROOF_STALE",message:"Address proof is older than 90 days as of 15 July 2026."});}
    if(!/Valid till\s+20\d{2}/i.test(all))applicant.issues.push({severity:"REVIEW",code:"SIGNATORY_VALIDITY_UNCLEAR",message:"Signatory ID expiry could not be confirmed from OCR."});
    if(!applicant.issues.length)applicant.issues.push({severity:"REVIEW",code:"HUMAN_REVIEW_REQUIRED",message:"No deterministic issue detected; reviewer must still inspect originals."});
  }
  return Object.values(groups).map(x=>({...x,documentCount:x.documents.length,overallStatus:x.issues.some(i=>i.severity==="CORRECTION")?"NEEDS_CORRECTION":"NEEDS_REVIEW"}));
}
