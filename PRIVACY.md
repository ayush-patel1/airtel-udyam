# Track A prototype privacy and data-handling note

## Scope and data status
The YTL Track A pack contains fictional, synthetic businesses, people, registrations, leads and documents. It is a case-study dataset only. The prototype must never describe these records as real Airtel customers or official government records. Mock GSTIN/Udyam lookups are explicitly labelled synthetic and are not connected to GSTN or the Udyam portal.

## Data minimisation and purpose
- The public advisor collects business type, segment, city/tier, approximate team/site size, needs and budget only to filter the catalogue and create an indicative estimate.
- A callback request collects a phone number and optional email only after the customer explicitly agrees to advisor contact.
- WhatsApp consent is separate, optional and required before any outbound WhatsApp message.
- GSTIN/Udyam identifiers are requested only when needed for a selected product or KYC comparison.
- The lead dashboard uses only fields needed for funnel analysis and sales follow-up. Identifiers are masked in returned lists and registry responses.

## Consent and transparency
- Show the callback consent separately from optional WhatsApp consent.
- Show the KYC consent notice before document processing and explain that OCR is extraction only, not approval or authenticity verification.
- The dataset importer is restricted to ADMIN staff. KYC specimen images and OCR output are available only to ADMIN/REVIEWER.
- Never expose the judges-only pack, answer key, planted judge signals or regeneration scripts in the customer-facing app.

## Security
- Keep provider credentials server-side in Vercel environment variables.
- Encrypt phone, email, GSTIN, Udyam identifiers and OCR text at rest with AES-256-GCM; use separate HMAC tokens only where deterministic matching is needed.
- Keep Firebase and any document storage private; use role-based access, short-lived signed URLs, audit events and rate limits.
- Do not log full identifiers, OCR text, document contents, tokens or ciphertext. Mask identifiers in UI and API responses.
- The imported dataset is synthetic, but apply the same access controls as if it were real.

## Retention and deletion
- For the prototype, retain uploaded KYC documents only for the active demo/review period and delete them within 90 days after the demo unless a documented test requirement says otherwise.
- Remove the imported Track A pack from Firebase when the case study ends. Delete derived OCR text and cached exports at the same time.
- For real deployment, retention periods, deletion requests, legal basis, access logging, backups and regional storage must be approved by Airtel's privacy/security teams before collecting real customer data.

## Human review and limitations
- Registry matches are mock data and cannot establish a legal registration.
- OCR confidence and deterministic mismatch flags are aids for reviewers, not automated KYC decisions.
- The call-priority score is an explainable queue-ordering aid only. It must not decide service eligibility, pricing, credit, or access to support.
- No real Airtel CRM, provisioning, GSTN, Udyam, or WhatsApp production connection is implied by this prototype.
