# Airtel Business — Udyam OneShot

A customer-facing digital onboarding experience for Indian MSMEs, built for the Airtel SYNC 2026 Digital Track.

**Product goal:** help a small business move from understanding its needs to discovering relevant services, comparing an indicative bundle, preparing verification documents and understanding what happens next — without hiding uncertainty or presenting a prototype action as a completed Airtel transaction.

## Customer experience

1. **Business discovery** — capture business type, location, team size, sites, budget and operational priorities.
2. **Personalised service discovery** — browse a 25-item sample catalogue with transparent eligibility rules and explainable recommendations.
3. **Bundle and estimate** — compare service combinations, monthly price ranges, setup costs and contract terms. The current browser journey saves a draft estimate locally; it is not an official Airtel quotation.
4. **Bundle Passport** — export a customer-readable summary of the selected services and assumptions.
5. **Smart KYC** — upload GST/Udyam certificates in the dedicated verification step, extract identifiers locally using browser OCR and review the extracted details. Extraction and format checks do not prove document authenticity or government registration.
6. **Journey guidance** — see the next step and understand which checks or human review remain.
7. **Growth Cockpit** — compare budget-constrained bundles, model user-entered business-value assumptions and review synthetic funnel insights.
8. **Udyam Assistant** — ask contextual questions, use guided prompts, switch supported languages, dictate messages and attach redacted business photos, floor plans, service brochures or bills for preliminary AI analysis.

## Assistant file analysis

- Accepts up to 3 PDF, JPG or PNG files per message; PDFs up to 1 MB each, images are resized/compressed in the browser, and the combined prepared files are limited to 2.5 MB to fit serverless request limits.
- Uses the server-side Gemini integration to summarise visible business context, then grounds the response in the available catalogue and current business profile.
- Files are processed for the request and are not written to the application's database or object storage by this chat feature.
- Customers should redact phone numbers, bank/account details, personal IDs and other sensitive information before upload.
- Do not upload GST/Udyam certificates, identity documents, bank statements or unredacted bills into chat. Official verification documents belong in Smart KYC.
- Image-based recommendations are preliminary. They are not a site survey, a coverage check, an official KYC decision, a binding quote or confirmation that an Airtel service is available.

## Trust, privacy and product integrity

- Catalogue prices are indicative ranges from the case prototype, not live Airtel prices.
- Eligibility rules are prototype catalogue rules, not Airtel serviceability or credit decisions.
- GSTIN/Udyam extraction is not an authenticity check. Final verification requires an authorised reviewer and an approved integration.
- Local profile, bundle, estimate draft and journey state are stored in the current browser. They are not a shared customer account or a durable Airtel CRM record.
- The backend vault uses AES-256-GCM encryption for business contact details, GSTIN/Udyam values, OCR text and WhatsApp message content, with separate HMAC-SHA256 tokens for matching. Audit and consent IP evidence is tokenized. Backend writes containing sensitive data fail closed until both encryption secrets are configured.
- The UI distinguishes estimates, draft requests, pending review and completed states. No Airtel order, payment, service activation or government verification is claimed unless a real integration confirms it.
- The journey prediction model is trained on synthetic sequences. Its scores are prototype guidance, not validated customer-intent probabilities and must not be used for eligibility, KYC, pricing or operational decisions.
- The deployed environment currently has the Groq and Gemini assistant credentials configured. Firebase persistence, encryption/tokenization secrets, private AWS document storage/Textract, WhatsApp Cloud API and Airtel CRM/catalogue/order integrations are optional backend adapters and must be provisioned and tested before those capabilities can be treated as live.

## Technology

- **Frontend:** responsive HTML, CSS and JavaScript; browser-native voice input/output; browser OCR with Tesseract.js and PDF.js for Smart KYC.
- **Assistant:** Groq chat completion with Gemini multimodal file analysis; server-side credentials and structured catalogue context.
- **Backend foundation:** Express on Vercel, JWT authentication, role-based access, Firebase Realtime Database adapter, audit events, S3 pre-signed uploads, AWS Textract OCR and WhatsApp Cloud API adapter. The staff quote API now accepts SKUs and quantities only; a canonical server-side catalogue calculates prices and eligibility. Reviewer access is role-gated, document links are short-lived, and order approval requires every submitted KYC document to be verified.
- **Analytics:** deterministic catalogue and budget rules, explainable recommendation signals, user-entered ROI scenarios and a synthetic journey model.

## Run locally

```bash
npm install
npm run dev
```

The frontend can also be served as static files, but assistant and API features require their server-side environment variables. Run the API smoke tests with:

```bash
npm test
```

## Backend configuration

See [API setup and integration guide](api/README.md) and [.env.example](.env.example). Create the first staff administrator only after Firebase is provisioned, using the one-time secure provisioning script:

```bash
ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... npm run admin:create
```

Never expose service-account credentials, JWT secrets or provider API keys in frontend code.

## Competition demonstration

Recommended live walkthrough:
1. Start as a small business and describe a real operational problem.
2. Let the assistant ask focused questions or inspect a redacted business photo/floor plan.
3. Show why the recommended services fit the business and compare a budget-constrained bundle.
4. Generate the indicative estimate and export the Bundle Passport.
5. Demonstrate Smart KYC extraction and clearly show that human review is still required.
6. Finish with the next-step guidance and Growth Cockpit, explaining which analytics are synthetic and which decisions are deterministic.

The prototype is designed to demonstrate the customer experience and integration architecture. It is not a production Airtel onboarding channel until authorised Airtel systems, identity, serviceability, pricing, order management and fulfilment integrations are connected.
