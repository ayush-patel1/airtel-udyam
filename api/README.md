# Udyam API

Vercel serverless Express API for the Airtel Udyam OneShot prototype.

## Required environment variables

- `FIREBASE_DATABASE_URL` — Firebase Realtime Database URL.\n- `FIREBASE_SERVICE_ACCOUNT_BASE64` — base64-encoded Firebase Admin service-account JSON (server-side only). `FIREBASE_SERVICE_ACCOUNT_JSON` is also accepted.
- `JWT_SECRET` — random secret, minimum 32 characters.
- `CORS_ORIGINS` — comma-separated allowed frontend origins.
- `AWS_REGION`, `AWS_S3_BUCKET` — private S3 bucket for KYC documents. Configure KMS encryption, block public access, lifecycle/retention and least-privilege IAM.
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, optional `WHATSAPP_API_VERSION` — Meta WhatsApp Cloud API credentials.
- `GROQ_API_KEY` — server-side Groq API key used by the Udyam Assistant; never expose it to the browser.
- `GROQ_MODEL` — optional model override; defaults to `llama-3.3-70b-versatile`.
- `GEMINI_API_KEY` — used for interface translation and multimodal assistant attachment analysis. `GEMINI_MODEL` optionally selects the model (defaults to `gemini-3.8-flash`).
- `AIRTEL_API_BASE_URL`, `AIRTEL_API_TOKEN` — reserved for Airtel catalogue/CRM/order/provisioning integration after API access is authorized.

## Setup

1. Provision Firebase Realtime Database and set `FIREBASE_DATABASE_URL` plus the service-account credential.
2. Run `npm install`. This repository uses the Firebase Realtime Database adapter; there are no Prisma migration or `db:generate` scripts.
3. Create the first ADMIN account using a secure, one-time provisioning script (do not expose public signup).
4. Configure the environment variables in Vercel Project Settings.
5. Deploy. Verify `GET /api/health` and, after staff sign-in, `GET /api/admin/integrations`. Run `npm test` for API smoke tests.
6. In Meta Developer dashboard, configure the WhatsApp webhook URL as `https://YOUR_DOMAIN/api/webhooks/whatsapp`, verify token, and subscribe to `messages`.
7. Uploads use short-lived signed URLs; browser PUT must include the returned Content-Type header. The KYC OCR endpoint sends the stored S3 object to Textract.

## Quote integrity and reviewer workflow

- `POST /api/quotes` is restricted to `ADMIN` and `SALES` staff. The request contains only `businessId` and `items: [{ sku, quantity }]`; client-supplied prices are not accepted.
- The API loads the canonical case-study catalogue from `api/lib/catalogue.js`, validates city tier, segment, team size, site count, GSTIN format and product dependencies, then calculates the monthly range, setup total and minimum contract on the server.
- Every quote is stored as `DRAFT_ESTIMATE` with the catalogue version and `CASE_CATALOGUE_ESTIMATE` source. It is not an official Airtel offer or a live price.
- `GET /api/kyc/queue` is restricted to `ADMIN` and `REVIEWER`. Reviewers can request a short-lived document download URL from `GET /api/kyc/:documentId/download-url`, run OCR, then mark a document `VERIFIED`, `REJECTED` or `NEEDS_CORRECTION`.
- Order approval is blocked unless at least one verification document exists and every submitted document has been marked `VERIFIED`. This is a workflow guard, not a government authenticity check.
- The static customer experience currently saves its profile, estimate and Smart KYC checks in the browser. The staff APIs are an integration foundation and are not connected to a live Airtel reviewer queue in the deployed environment until Firebase, AWS and authorised staff accounts are provisioned.

## WhatsApp workflow

- Inbound WhatsApp webhooks require a valid `X-Hub-Signature-256` HMAC-SHA256 signature using `WHATSAPP_APP_SECRET` before events are persisted idempotently in `IntegrationEvent` and `Message`.
- Outbound text is sent through the WhatsApp Cloud API endpoint only when the business contact number matches the stored contact and the latest WhatsApp consent record is granted.
- Configure approved WhatsApp message templates for business-initiated messages such as quote follow-ups, KYC reminders and activation status. The current send endpoint sends session text only; template messaging is the next adapter extension.
- Respect the WhatsApp 24-hour customer service window, opt-in and template approval rules. Store channel/purpose consent before proactive messages.
- Add a durable queue/worker for webhook event processing, retries, dead-letter handling and template dispatch before production traffic.

## Security notes

- API access uses short-lived JWTs and role checks. No public user registration or default admin is provided.
- Keep credentials only in Vercel environment variables / secret manager.
- Restrict CORS to the production frontend domain.
- Use private S3 with KMS, signed URLs, retention policies and access logging.
- OCR is extraction only; it does not authenticate documents. Human review is mandatory.
- Audit events are recorded for auth, business, consent, quote, KYC, order and WhatsApp actions.
- Before production, add distributed rate limiting/WAF, CSRF strategy if using cookies, refresh-token rotation, durable queue processing, automated integration tests, backup/restore drills, monitoring/alerts and a formal privacy/retention policy. WhatsApp signature validation is implemented and requires `WHATSAPP_APP_SECRET`; it must be configured before webhook events are accepted.
