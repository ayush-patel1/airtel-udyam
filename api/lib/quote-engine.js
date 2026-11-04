import { CATALOGUE, CATALOGUE_VERSION } from "./catalogue.js";

function invalid(message,status=409){return Object.assign(new Error(message),{status});}

export function buildEstimate(business,requestedItems){
  if(!business?.cityTier||!business?.segment)throw invalid("Complete the business location and segment before preparing an estimate",400);
  const skus=requestedItems.map(item=>item.sku);
  if(new Set(skus).size!==skus.length)throw invalid("Each catalogue service can appear only once; update its quantity instead",400);
  const selected=new Set(skus),items=[];
  for(const requested of requestedItems){
    const product=CATALOGUE.get(requested.sku);
    if(!product)throw invalid("Unknown catalogue service: "+requested.sku,400);
    if(!product.cityTiers.includes(String(business.cityTier)))throw invalid(product.name+" is not eligible for the selected city tier");
    if(!product.segments.includes(String(business.segment)))throw invalid(product.name+" is not eligible for the selected business segment");
    if(Number(business.employees||0)<product.minEmployees)throw invalid(product.name+" requires at least "+product.minEmployees+" employees");
    if(Number(business.sites||1)<product.minSites)throw invalid(product.name+" requires at least "+product.minSites+" business sites");
    if(product.requiresGstin&&!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(String(business.gstin||"")))throw invalid(product.name+" requires a GSTIN to be provided for subsequent verification");
    if(product.dependencies.length&&!product.dependencies.some(sku=>selected.has(sku)))throw invalid(product.name+" requires a compatible base connectivity service");
    items.push({
      sku:product.sku,name:product.name,category:product.category,unit:product.unit,
      quantity:requested.quantity,monthlyMin:product.monthlyMin,monthlyMax:product.monthlyMax,
      setupFee:product.setupFee,contractMonths:product.contractMonths
    });
  }
  return {
    items,
    monthlyMin:items.reduce((sum,item)=>sum+item.monthlyMin*item.quantity,0),
    monthlyMax:items.reduce((sum,item)=>sum+item.monthlyMax*item.quantity,0),
    setupTotal:items.reduce((sum,item)=>sum+item.setupFee*item.quantity,0),
    contractMonths:Math.max(...items.map(item=>item.contractMonths)),
    ruleVersion:CATALOGUE_VERSION,
    pricingSource:"CASE_CATALOGUE_ESTIMATE",
    status:"DRAFT_ESTIMATE"
  };
}
