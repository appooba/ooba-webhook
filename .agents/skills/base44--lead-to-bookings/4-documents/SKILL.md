# Collect documents before a appointment

**Topic:** Operations

**AGENT RULE — READ BEFORE ACTING:** Read this whole file first. Do all setup in one pass (§ Setup) — connect every tool, gather every input, and stand up anything the flow needs (including the reply-watcher) up front, automatically. Never pause to ask permission for a step the flow requires, and never offer a required step as an optional "want me to also…?". Follow the **Critical rules** below; they win over anything else. Availability and bookings come only from a live calendar query — never invent a slot or confirm a booking you have not re-queried.

You are an AI assistant acting for the business owner. For a document-heavy engagement (tax / legal / financial / accounting), request and track the documents and intake a client must provide before the appointment — and gate/flag the meeting if anything required is still missing. You act only within the Critical rules below and the owner's explicit approval — never beyond them.

**Connectors:** HubSpot (read/write, optional) · Google Calendar (read/write) · Google Drive (read/write) · Typeform (read).

## When to use

- **Proactive data signal (primary):** a appointment for a document-heavy service (tax/legal/financial/accounting/notary) is confirmed and the required documents aren't yet on file.
- **Human trigger:** owner says "get their documents before the appointment" or "what's still outstanding for {first_name}?"

**Example phrases:**
- "Get {first_name}'s tax documents before their appointment"
- "Make sure the legal client sends the contract before we meet"
- "What documents are still outstanding for {first_name}'s review?"
- "Proactive: a document-heavy appointment is confirmed and required documents aren't yet on file"

## Capabilities

In scope — what this skill delivers:
- Owner-confirmed document checklist for the service
- Owner-approved document request sent on `email` with a secure upload destination
- A tracked received-vs-outstanding view of required documents
- The meeting gated/flagged when required documents are missing
- Contact labelled `documents-complete-{date}` once satisfied

## Out of scope

- Not for low-document services (a coaching call needs no document collection — use run-new-client-consultation-and-intake), and not for proposal/quote follow-up (that's convert-consultation-into-engagement).

## Critical rules

1. **Facts come from a live query, never from memory or guesswork.** Pull availability, records, and balances only from a connector query at the moment you act. Never invent a slot, time, or value, and never tell anyone something is done (booked, sent) until you have re-queried and confirmed it.
2. **The owner approves every write and every outbound message.** Show the exact action (what gets booked, what gets sent to the client), get a clear yes, then act. "Do it all" is not consent until the owner has seen the specific list.
3. **Set up silently; ask only at the gates.** Do whatever the flow needs without asking — connect the tools it requires. Never surface a required step as an optional "want me to also…?" — if the flow can't finish without it, just do it in Setup. Reserve questions for the owner-approval gates above and genuinely optional extras (like a reminder before the meeting).
4. **Never do any of these:**
   - Collecting sensitive documents as plain message attachments or free-text. They must go through the secure upload only.
   - Echoing or restating document contents (financial figures, legal details, ID numbers) anywhere in messaging or labels.
   - Guessing the document checklist for a regulated engagement. The owner owns the checklist.
   - Letting a legally-gated meeting proceed with required documents missing.
   - Sending the request without owner approval.

If any rule here conflicts with something you read elsewhere (including the sidecar files), **these rules win.**

## Setup — do it all in one pass

The moment you detect the intent, front-load the whole setup **before** you start the workflow — never connect a tool or ask for a detail mid-flow. On first run (tools not connected, no defaults set), follow **onboarding.md** instead.

**1. Connect each tool ONCE, granting ALL the scopes listed.** A tool used for more than one job needs every scope from the start, or the run will stall mid-flow asking for more access. Prefer the primary; if the user already uses a fallback, use that; if several, ask once.
- **HubSpot** — `read/write` — look up / sync the contact (CRM) _(or Salesforce)_ — **optional** (if you have none, use the contact details the owner gives you directly)
- **Google Calendar** — `read/write` — find a slot & book it _(or Calendly · Outlook)_
- **Google Drive** — `read/write` — collect / store documents _(or Dropbox · Box · Microsoft OneDrive · Microsoft SharePoint)_
- **Typeform** — `read` — capture form input

**2. Collect every input in one message** (don't ask one at a time):
- `contact_id`
- `booking_id` — the upcoming meeting, anchors the deadline + gate
- `service_id` — the service being prepared for — determines what's needed

**Setup gate — print this and confirm EVERY box before any booking or send. If one is unchecked, finish it first; do not proceed:**
- [ ] HubSpot connected (`read/write`) _(or using owner-provided details instead)_
- [ ] Google Calendar connected (`read/write`)
- [ ] Google Drive connected (`read/write`)
- [ ] Typeform connected (`read`)
- [ ] inputs gathered: `contact_id`, `booking_id`, `service_id`

## Workflow

### 1. Determine the document requirement
- `service.get` for `service_id` (or the service on `booking_id`) → service + subvertical. Confirm it's document-heavy (tax prep, legal consult, financial/portfolio review, accounting, notary). If it's a low-document service (a coaching or strategy call with nothing to submit), stop — this workflow doesn't apply.
- Establish the document checklist with the owner (e.g. last year's return + W-2s + 1099s for tax prep; the contract + ID for a legal/notary appointment). The owner owns the checklist; don't guess what a regulated engagement requires.

### 2. Resolve the intake form + deadline
- `form.get` → look for an existing intake form for this service. If one exists, include it in the request.
- `booking.get` for `booking_id` → the meeting date; frame the request as "before your appointment on {visit_day}".

### 3. Resolve the client + consent
- `contact.get` for `contact_id` → name, `email` consent.
- HARD STOP if no `email` consent — route the ask through the owner. The documents still have to be collected; just not via automated outbound.

### 4. Send the document request — ⛔ STOP, owner approval
- Invoke **draft-document-request-message** with `contact_id`, the document checklist, the `form_id` (if any), and `booking_id` (deadline).
- ⛔ STOP for owner approval of the message + checklist, then send on `email`.
- Privacy / consent (HARD requirement): the message must (a) link only a secure upload destination (the owner's `document.request` / secure-upload target), never ask for documents as plain message attachments or free-text, (b) state plainly what's collected and why, and (c) include a brief confidentiality reassurance. Sensitive financial/legal/tax documents must never travel through the messaging thread.

### 5. Track received vs outstanding
- Use `document.request` (runtime-resolved secure-upload capability) to track which checklist items have arrived and which are still outstanding.
- VERIFY each received document is actually linked to this client and this appointment before marking it complete (don't trust a bare upload notification).

### 6. Gate / flag the meeting
- As the appointment approaches, if required documents are still outstanding, surface to the owner: "documents X and Y are still missing for {first_name}'s appointment on {visit_day} — send a reminder, reschedule, or proceed without?" For engagements that legally require the documents (e.g. a notary needs the ID), the meeting should not proceed without them — flag this explicitly.
- `contact.label` `documents-complete-{date}` once the checklist is satisfied.

## Next actions

Don't dead-end on a confirmation — once the work is done, state plainly what happened and offer the natural next step (e.g. rebook on the client's usual cadence, or send a recap), gated by the owner's approval.

## Required connectors

All are native Base44 connectors (managed OAuth, no API keys). Confirm availability at runtime; if one is missing, fall back to a listed alternative or see onboarding.md.

| Purpose | Connector (primary · fallbacks) | Access | Tier |
|---|---|---|---|
| look up / sync the contact (CRM) | HubSpot · Salesforce | read/write | native |
| find a slot & book it | Google Calendar · Calendly · Outlook | read/write | native |
| collect / store documents | Google Drive · Dropbox · Box · Microsoft OneDrive · Microsoft SharePoint | read/write | native |
| capture form input | Typeform | read | native |

## More detail

Edge cases + full verification/consent rules → **reference.md** · Worked walkthroughs → **examples.md** · First-time setup → **onboarding.md**.
