# Airtel Business — Udyam OneShot

A responsive end-to-end onboarding prototype for the Airtel SYNC / YTL Track A MSME case.

## Run
This is a static web app. Open `index.html` in a browser or serve the repository root with any static server. No build command or environment variables are required.

## Product journey
1. **Business advisor** — capture business type, segment, city tier, team size, locations, budget, connectivity need and optional GSTIN.
2. **Bundle & quote** — browse the 25-row supplied product catalogue; apply city-tier, employee, site, GSTIN and dependency checks; select quantities; calculate monthly price ranges, setup fees and contract term.
3. **Bundle Passport** — create a traceable local quote/passport ID and export a CSV summary.
4. **Smart KYC** — record consent, select supporting files locally, check identifier formats and look up mock registry entries. Optional GSTIN and Udyam CSV imports allow the complete supplied synthetic registry files to be checked in the browser.
5. **Activation tracker** — advance a simulated order through business profile, bundle, KYC, operations/serviceability review and installation/activation milestones.
6. **Insights** — show the synthetic case baseline and observed funnel / segment metrics.

## Data and privacy
- Product catalogue rules and price ranges are based on the supplied synthetic case catalogue.
- The dashboard metrics are based on the supplied synthetic case dataset. They are not actual Airtel customer performance.
- The embedded registry examples are only a small sample. Import the supplied `mock_gstin_registry.csv` and `mock_udyam_registry.csv` from the Smart KYC screen to query the full synthetic registries.
- Business profile, quote, KYC check result, order state and imported registry data are stored in the current browser's localStorage.
- Uploaded documents are selected locally; file bytes are not sent to a server or persisted by this static prototype.
- GSTIN/Udyam lookups are mock-data checks only. Format checks do not prove identity, registration authenticity, ownership or serviceability.
- OCR, human review queues, real consent records, payment, inventory, CRM, Airtel order management, notifications and live government integrations are not connected. Do not use this prototype for real customer onboarding or operational decisions.

## Deployment
The repository is connected to Vercel. Pushes to `main` create a production deployment.


## Backend foundation (new)

The repository now includes a Vercel serverless API, PostgreSQL/Prisma data model, JWT authentication, role-based reviewer/admin endpoints, audit events, consent records, quote/order APIs, private S3 pre-signed KYC uploads, AWS Textract OCR extraction, and a WhatsApp Cloud API webhook + outbound messaging endpoint.

See [API setup and integration guide](api/README.md) and [.env.example](.env.example). The backend is a deployable integration foundation, not yet a live Airtel production integration: provision PostgreSQL, AWS resources, Meta WhatsApp Business credentials and authorized Airtel API credentials, then configure Vercel environment variables and run the Prisma migration. OCR is extraction only and requires human verification. A durable background queue, WhatsApp template dispatch, Meta webhook signature verification, rate limiting, monitoring and full end-to-end tests remain production hardening tasks.


## Growth Cockpit

The Growth Cockpit adds:
- Explainable Essential / Growth / Complete bundle options constrained by the catalogue eligibility rules and a monthly budget.
- A business-value simulator for user-entered savings, incremental gross profit, monthly service cost and setup payback.
- WhatsApp-ready quote, KYC, activation and follow-up message previews with a click-to-open WhatsApp draft.
- A conversion control tower prioritising quote transparency, quote simplicity, follow-up speed and KYC completion using the supplied synthetic funnel.
- A Bundle Passport decision trace across profile, quote, KYC and order status.

All optimiser recommendations are deterministic catalogue heuristics, not an AI claim. ROI is scenario modelling from user-entered assumptions, not a guaranteed outcome. WhatsApp draft links do not send messages through the Cloud API; live delivery requires Meta credentials, valid opt-in, approved templates where applicable, and the configured backend.


## AI assistant configuration

The Udyam chat uses the Google Gemini `generateContent` API through the server-side `POST /api/assistant/chat` endpoint. Set `GEMINI_API_KEY` in Vercel Project Settings → Environment Variables (Production and Preview), and optionally set `GEMINI_MODEL` (defaults to `gemini-3.8-flash`). Never place the key in `index.html` or any `NEXT_PUBLIC_` variable. The endpoint sends the current business profile, recent chat turns and catalogue eligibility/price context to the model. Model-suggested catalogue SKUs are filtered against the server-provided eligible list; quote totals and eligibility remain deterministic application logic.

The chat shows task-specific activity labels for profile edits, recommendations, pricing, KYC, tracking, troubleshooting and general questions. These labels describe the request workflow; they are not a display of the model's private reasoning. Chat history is held in the current page session. Requests are sent to Gemini with JSON response formatting. Configure appropriate Google AI usage limits before public demos.
