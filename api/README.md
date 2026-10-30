# Udyam API

Vercel serverless Express API for the Airtel Udyam OneShot prototype.

## Required environment variables

- `FIREBASE_DATABASE_URL` — Firebase Realtime Database URL.\n- `FIREBASE_SERVICE_ACCOUNT_BASE64` — base64-encoded Firebase Admin service-account JSON (server-side only). `FIREBASE_SERVICE_ACCOUNT_JSON` is also accepted.
- `JWT_SECRET` — random secret, minimum 32 characters.
- `CORS_ORIGINS` — comma-separated allowed frontend origins.
- `AWS_REGION`, `AWS_S3_BUCKET` — private S3 bucket for KYC documents. Configure KMS encryption, block public access, lifecycle/retention and least-privilege IAM.
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, optional `WHATSAPP_API_VERSION` — Meta WhatsApp Cloud API credentials.
- `OPENAI_API_KEY` — reserved for the conversational intent/extraction adapter; never expose it to the browser.
- `AIRTEL_API_BASE_URL`, `AIRTEL_API_TOKEN` — reserved for Airtel catalogue/CRM/order/provisioning integration after API access is authorized.

## Setup

1. Provision Firebase Realtime Database and set `DATABASE_URL`.
2. Run `npm install`, then `npm run db:generate` and `npm run db:migrate`.
3. Create the first ADMIN account using a secure, one-time provisioning script (do not expose public signup).
4. Configure the environment variables in Vercel Project Settings.
5. Deploy. Verify `GET /api/health` and `GET /api/admin/integrations`.
6. In Meta Developer dashboard, configure the WhatsApp webhook URL as `https://YOUR_DOMAIN/api/webhooks/whatsapp`, verify token, and subscribe to `messages`.
7. Uploads use short-lived signed URLs; browser PUT must include the returned Content-Type header. The KYC OCR endpoint sends the stored S3 object to Textract.

## WhatsApp workflow

- Inbound WhatsApp webhook events are persisted idempotently in `IntegrationEvent` and `Message`.
- Outbound text is sent through the WhatsApp Cloud API endpoint.
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
- Before production, add rate limiting/WAF, CSRF strategy if using cookies, refresh-token rotation, webhook signature verification, queue processing, automated tests, backup/restore drills, monitoring/alerts and a formal privacy/retention policy.
