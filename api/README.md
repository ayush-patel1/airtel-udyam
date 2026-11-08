# Udyam API

Vercel serverless Express API for the Airtel Udyam OneShot prototype.

## Required environment variables

- `FIREBASE_DATABASE_URL` — Firebase Realtime Database URL.
- `FIREBASE_SERVICE_ACCOUNT_BASE64` — base64-encoded Firebase Admin service-account JSON (server-side only). `FIREBASE_SERVICE_ACCOUNT_JSON` is also accepted.
- `JWT_SECRET` — random secret, minimum 32 characters.
- `DATA_ENCRYPTION_KEY` — base64-encoded 32-byte AES-256-GCM key. Generate with `openssl rand -base64 32`.
- `TOKENIZATION_SECRET` — independent random secret of at least 32 bytes. Generate with `openssl rand -hex 32`.
- `CORS_ORIGINS` — comma-separated allowed frontend origins.
- `AWS_REGION`, `AWS_S3_BUCKET` — private S3 bucket for KYC documents. Configure KMS encryption, block public access, lifecycle/retention and least-privilege IAM.
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, optional `WHATSAPP_API_VERSION` — Meta WhatsApp Cloud API credentials.
- `GROQ_API_KEY` — server-side Groq API key used by the Udyam Assistant; never expose it to the browser.
- `GROQ_MODEL` — optional model override; defaults to `llama-3.3-70b-versatile`.
- `GEMINI_API_KEY` — used for interface translation and multimodal assistant attachment analysis. `GEMINI_MODEL` optionally selects the model (defaults to `gemini-3.8-flash`).
- `AIRTEL_API_BASE_URL`, `AIRTEL_API_TOKEN` — reserved for Airtel catalogue/CRM/order/provisioning integration after API access is authorized.

## Setup

1. Provision Firebase Realtime Database and set `FIREBASE_DATABASE_URL` plus the service-account credential.
2. Generate and configure `DATA_ENCRYPTION_KEY` and `TOKENIZATION_SECRET` before storing business identifiers, OCR text or message content. Keep backups of the keys in a secure secret manager; losing the encryption key makes ciphertext unrecoverable.
3. Run `npm install`. This repository uses the Firebase Realtime Database adapter; there are no Prisma migration or `db:generate` scripts.
4. Create the first ADMIN account from a trusted local machine (never expose public signup):
   ```bash
   npm install
   ADMIN_EMAIL="admin@your-company.example" ADMIN_NAME="Airtel Admin" ADMIN_PASSWORD="use-a-unique-14+-character-password" npm run admin:create
   ```
   Run this only after `FIREBASE_DATABASE_URL` and `FIREBASE_SERVICE_ACCOUNT_BASE64` are available in the local process environment. The script creates an active ADMIN user with a bcrypt-hashed password in Firebase and refuses to overwrite an existing email. Do not commit credentials or put them in frontend variables. Use a unique password and store it in a password manager. For additional staff, provision SALES, REVIEWER or OPERATIONS accounts through a trusted administrative process; do not create public registration.
5. Configure the environment variables in Vercel Project Settings. Keep all secrets server-side.
6. Deploy. Verify `GET /api/health`, sign in at the website using the provisioned account, and verify role-restricted routes such as `GET /api/admin/overview`.
7. Run `npm test` for API smoke tests.
8. In Meta Developer dashboard, configure the WhatsApp webhook URL as `https://YOUR_DOMAIN/api/webhooks/whatsapp`, verify token, and subscribe to `messages`.
9. Uploads use short-lived signed URLs; browser PUT must include the returned Content-Type header. The KYC OCR endpoint sends the stored S3 object to Textract.
5. Configure the environment variables in Vercel Project Settings.
6. Deploy. Verify `GET /api/health` and, after staff sign-in, `GET /api/admin/integrations`. Run `npm test` for API smoke tests.
7. In Meta Developer dashboard, configure the WhatsApp webhook URL as `https://YOUR_DOMAIN/api/webhooks/whatsapp`, verify token, and subscribe to `messages`.
8. Uploads use short-lived signed URLs; browser PUT must include the returned Content-Type header. The KYC OCR endpoint sends the stored S3 object to Textract.

## Quote integrity and reviewer workflow

- `POST /api/quotes` is restricted to `ADMIN` and `SALES` staff. The request contains only `businessId` and `items: [{ sku, quantity }]`; client-supplied prices are not accepted.
- The API loads the canonical case-study catalogue from `api/lib/catalogue.js`, validates city tier, segment, team size, site count, GSTIN format and product dependencies, then calculates the monthly range, setup total and minimum contract on the server.
- Every quote is stored as `DRAFT_ESTIMATE` with the catalogue version and `CASE_CATALOGUE_ESTIMATE` source. It is not an official Airtel offer or a live price.
- `GET /api/kyc/queue` is restricted to `ADMIN` and `REVIEWER`. Reviewers can request a short-lived document download URL from `GET /api/kyc/:documentId/download-url`, run OCR, then mark a document `VERIFIED`, `REJECTED` or `NEEDS_CORRECTION`.
- Order approval is blocked unless at least one verification document exists and every submitted document has been marked `VERIFIED`. This is a workflow guard, not a government authenticity check.
- The static customer experience currently saves its profile, estimate and Smart KYC checks in the browser. The staff APIs are an integration foundation and are not connected to a live Airtel reviewer queue in the deployed environment until Firebase, AWS and authorised staff accounts are provisioned.

## Advisor callback and sales lead desk

- `POST /api/leads/intake` is the public callback hand-off. It validates an explicit web callback consent, applies a basic per-IP request limit, encrypts phone/email before storage, and records the consent evidence. WhatsApp consent is separate and optional.
- `GET /api/staff/leads` is restricted to `ADMIN`, `SALES` and `OPERATIONS`. It returns open leads with contact details visible only to authenticated staff, latest quote/order context, pending-document count and a 0–100 call-priority score.
- `PATCH /api/staff/leads/:id` records advisor outcome, notes, follow-up time and contact timestamp. Changes are audit logged; `WON` and `LOST` leads leave the active queue.
- The call-priority score is deterministic and explainable. It ranks follow-up work; it is not a calibrated propensity probability and must not be used for credit, eligibility, pricing or KYC decisions.
- The staff desk requires a provisioned staff account. Configure Firebase, encryption and tokenization secrets before accepting callback requests.

## WhatsApp workflow

- Inbound WhatsApp webhooks require a valid `X-Hub-Signature-256` HMAC-SHA256 signature using `WHATSAPP_APP_SECRET` before events are persisted idempotently in `IntegrationEvent` and `Message`.
- Outbound text is sent through the WhatsApp Cloud API endpoint only when the business contact number matches the stored contact and the latest WhatsApp consent record is granted.
- Configure approved WhatsApp message templates for business-initiated messages such as quote follow-ups, KYC reminders and activation status. The current send endpoint sends session text only; template messaging is the next adapter extension.
- Respect the WhatsApp 24-hour customer service window, opt-in and template approval rules. Store channel/purpose consent before proactive messages.
- Add a durable queue/worker for webhook event processing, retries, dead-letter handling and template dispatch before production traffic.

## Security notes

- API access uses short-lived JWTs and role checks. No public user registration or default admin is provided.
- Keep credentials only in Vercel environment variables / secret manager.
- Business phone/email/GSTIN/Udyam values, OCR text and WhatsApp message content are AES-256-GCM encrypted at rest. Separate HMAC-SHA256 tokens support matching without exposing source values. Consent/audit IP evidence is tokenized. The encryption and tokenization keys are mandatory for sensitive writes; do not log or return ciphertext or tokens to the browser.
- Restrict CORS to the production frontend domain.
- Use private S3 with KMS, signed URLs, retention policies and access logging.
- OCR is extraction only; it does not authenticate documents. Human review is mandatory.
- Audit events are recorded for auth, business, consent, quote, KYC, order and WhatsApp actions.
- Before production, add distributed rate limiting/WAF, CSRF strategy if using cookies, refresh-token rotation, durable queue processing, automated integration tests, backup/restore drills, monitoring/alerts and a formal privacy/retention policy. WhatsApp signature validation is implemented and requires `WHATSAPP_APP_SECRET`; it must be configured before webhook events are accepted.


## Track A synthetic dataset

- Staff-only `POST /api/admin/dataset/import` accepts a gzip-compressed JSON envelope containing the four source CSV strings and 47 KYC specimen PNGs with browser-extracted OCR text. ADMIN role is mandatory; the import verifies exact expected row/document counts and writes the pack under Firebase Realtime Database `trackA/dataset`.
- `GET /api/admin/dataset/status` reports the imported manifest and counts.
- `GET /api/catalogue` returns the imported catalogue when present, otherwise the bundled case catalogue.
- `GET /api/mock/gstin/:gstin` and `GET /api/mock/udyam/:number` perform exact lookups against the imported fictional registries. Responses are explicitly marked synthetic; they are not connected to GSTN or the Udyam portal.
- `GET /api/staff/dataset/analytics` returns computed funnel, segment, channel, drop-reason, CAC, activation-time, churn and NPS aggregates.
- `GET /api/staff/dataset/leads` returns a filtered, paginated lead view and a transparent call-priority score. This is not a calibrated conversion probability.
- `GET /api/staff/dataset/kyc-samples` and `GET /api/staff/dataset/kyc-samples/:applicantId` are limited to ADMIN/REVIEWER and return sample OCR, validation flags and specimen images. OCR is advisory; human review is mandatory.

Dataset import requires Firebase credentials and the existing encryption/tokenization keys. Browser ZIP import uses JSZip and Tesseract.js from CDN; the 47 KYC specimen images are OCR-processed in the browser before upload. The dataset is fictional, but the app still masks registry identifiers in responses and keeps sample documents behind staff authentication.
