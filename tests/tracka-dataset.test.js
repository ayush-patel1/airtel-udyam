import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, buildTrackAAnalytics, scoreTrackALead, lookupGstin, lookupUdyam, analyseKycSamples, buildTrackAEstimate } from "../api/lib/tracka-dataset.js";

test("CSV parser handles commas, escaped quotes and embedded newlines",()=>{
  const rows=parseCsv('id,name,note\n1,"A, B","said ""hello"""\n2,"Line one\nLine two",ok\n');
  assert.equal(rows.length,2);assert.equal(rows[0].name,"A, B");assert.equal(rows[0].note,'said "hello"');assert.equal(rows[1].name,"Line one\nLine two");
});
test("analytics builds cumulative funnel and segment/source rates",()=>{
  const rows=[
    {lead_id:"1",stage_reached:"Lead",outcome:"Dropped",segment:"Micro",lead_source:"Web",drop_reason:"Price too high",acquisition_cost_inr:"100"},
    {lead_id:"2",stage_reached:"Needs assessed",outcome:"Dropped",segment:"Office",lead_source:"Partner",drop_reason:"KYC issue",acquisition_cost_inr:"200"},
    {lead_id:"3",stage_reached:"Activated",outcome:"Activated",segment:"Office",lead_source:"Web",days_lead_to_activation:"10",customer_follow_up_calls:"2",monthly_bundle_value_inr:"1000",acquisition_cost_inr:"300",nps_score:"9",churned_within_6_months:"N"}
  ];
  const a=buildTrackAAnalytics(rows);
  assert.equal(a.totalLeads,3);assert.equal(a.activated,1);assert.equal(a.funnel[0].count,3);assert.equal(a.funnel[1].count,2);assert.equal(a.funnel[2].count,2);assert.equal(a.funnel[5].count,1);assert.equal(a.blendedCac,600);assert.equal(a.avgNps,9);
});
test("lead score explains quote and KYC recovery next steps",()=>{
  const quote=scoreTrackALead({stage_reached:"Quote accepted",products_of_interest:"P01",has_gstin:"Y",customer_follow_up_calls:"3"});
  assert.equal(quote.priority,"HIGH");assert.match(quote.nextAction,/KYC/);assert.ok(quote.reasons.length>=2);
  const cold=scoreTrackALead({stage_reached:"Lead",drop_reason:"Unreachable after 3 attempts"});
  assert.ok(cold.score<quote.score);
});
test("quote engine honours imported catalogue eligibility, dependencies and prices",()=>{
  const products=[
    {product_id:"P01",product_name:"Fibre",category:"Connectivity",unit:"per site",price_min_inr_per_month:"999",price_max_inr_per_month:"1199",one_time_setup_inr:"0",min_contract_months:"12",available_city_tiers:"1;2",min_employees:"1",min_sites:"1",requires_gstin:"N",requires_one_of:"",target_segments:"micro;prof"},
    {product_id:"P09",product_name:"Backup",category:"Connectivity",unit:"per site",price_min_inr_per_month:"499",price_max_inr_per_month:"599",one_time_setup_inr:"1500",min_contract_months:"12",available_city_tiers:"1;2",min_employees:"1",min_sites:"1",requires_gstin:"N",requires_one_of:"P01|P02",target_segments:"prof"}
  ];
  const estimate=buildTrackAEstimate({cityTier:"1",segment:"prof",employees:5,sites:1,gstin:""},[{sku:"P01",quantity:1},{sku:"P09",quantity:1}],products);
  assert.equal(estimate.monthlyMin,1498);assert.equal(estimate.monthlyMax,1798);assert.equal(estimate.setupTotal,1500);assert.equal(estimate.pricingSource,"TRACKA_IMPORTED_CATALOGUE");
  assert.throws(()=>buildTrackAEstimate({cityTier:"1",segment:"prof",employees:5,sites:1},[{sku:"P09",quantity:1}],products),/requires a compatible base connectivity/);
});
test("mock registries return masked synthetic records",()=>{
  const gst=lookupGstin([{gstin:"32TTNXB7384T1ZW",legal_name:"Example LLP",trade_name:"Example",constitution:"LLP",principal_place_of_business:"Demo address",state:"Kerala",registration_date:"2020-01-01",status:"Active"}],"32TTNXB7384T1ZW");
  assert.equal(gst.found,true);assert.equal(gst.status,"Active");assert.ok(gst.gstin.includes("••"));
  const u=lookupUdyam([{udyam_number:"UDYAM-KL-00-3078801",enterprise_name:"Example",enterprise_type:"Micro",major_activity:"Services",nic_description:"Services",state:"Kerala",city:"Kochi",date_of_registration:"2023-01-01"}],"UDYAM-KL-00-3078801");
  assert.equal(u.found,true);assert.equal(u.enterpriseName,"Example");assert.ok(u.udyamNumber.includes("••"));
});
test("KYC specimen analysis flags incomplete and stale samples for human review",()=>{
  const groups=analyseKycSamples([
    {applicant_id:"K01",file_name:"K01_address_proof.png",document_type:"address_proof",ocr_text:"Billed to Example Ltd Bill date 2025-01-01"},
    {applicant_id:"K01",file_name:"K01_gst_certificate.png",document_type:"gst_certificate",ocr_text:"GSTIN 32TTNXB7384T1ZW Trade name Example Ltd"},
    {applicant_id:"K01",file_name:"K01_udyam_certificate.png",document_type:"udyam_certificate",ocr_text:"Udyam reg. number UDYAM-KL-00-3078801 Enterprise name Example Ltd"},
    {applicant_id:"K01",file_name:"K01_signatory_id.png",document_type:"signatory_id",ocr_text:"For business Example Ltd Valid till 2028-01-01"}
  ]);
  assert.equal(groups.length,1);assert.equal(groups[0].overallStatus,"NEEDS_CORRECTION");assert.ok(groups[0].issues.some(x=>x.code==="ADDRESS_PROOF_STALE"));
});
