# Turn intake form into first booking

**Topic:** Sales

**AGENT RULE — READ BEFORE ACTING:** Read this whole file first. Do all setup in one pass (§ Setup) — connect every tool, gather every input, and stand up anything the flow needs (including the reply-watcher) up front, automatically. Never pause to ask permission for a step the flow requires, and never offer a required step as an optional "want me to also…?". Follow the **Critical rules** below; they win over anything else. Availability and bookings come only from a live calendar query — never invent a slot or confirm a booking you have not re-queried.

You are an AI assistant acting for the business owner. When a the booking platform Forms intake is submitted, surface a personal follow-up that proposes specific appointments based on the form responses, owner-approved. You act only within the Critical rules below and the owner's explicit approval — never beyond them.

**Connectors:** HubSpot (read/write, optional) · Google Calendar (read/write) · Typeform (read).

## When to use

- Invoke when the owner wants to run this flow.

**Example phrases:**
- "Form just got submitted — follow up?"
- "Proactive: the booking platform Forms `form_submitted` event for an intake-type form"

## Capabilities

In scope: When a the booking platform Forms intake is submitted, surface a personal follow-up that proposes specific appointments based on the form responses, owner-approved.

## Out of scope

- Not for periodic lead-list cleanup (use score-and-segment-leads-from-forms) — this acts on a single fresh submission to drive a first booking.

## Critical rules

1. **Facts come from a live query, never from memory or guesswork.** Pull availability, records, and balances only from a connector query at the moment you act. Never invent a slot, time, or value, and never tell anyone something is done (booked, sent) until you have re-queried and confirmed it.
2. **The owner approves every write and every outbound message.** Show the exact action (what gets booked, what gets sent to the client), get a clear yes, then act. "Do it all" is not consent until the owner has seen the specific list.
3. **Set up silently; ask only at the gates.** Do whatever the flow needs without asking — connect the tools it requires. Never surface a required step as an optional "want me to also…?" — if the flow can't finish without it, just do it in Setup. Reserve questions for the owner-approval gates above and genuinely optional extras (like a reminder before the meeting).
4. **Never do any of these:**
   - Sending without owner approval. Intake responses are warm leads, not list members.
   - Generic "thanks for your interest" with no concrete slots. The whole point is specificity.
   - Waiting > 4 hours to surface. Lead temperature halves after the first hour.

If any rule here conflicts with something you read elsewhere (including the sidecar files), **these rules win.**

## Setup — do it all in one pass

The moment you detect the intent, front-load the whole setup **before** you start the workflow — never connect a tool or ask for a detail mid-flow. On first run (tools not connected, no defaults set), follow **onboarding.md** instead.

**1. Connect each tool ONCE, granting ALL the scopes listed.** A tool used for more than one job needs every scope from the start, or the run will stall mid-flow asking for more access. Prefer the primary; if the user already uses a fallback, use that; if several, ask once.
- **HubSpot** — `read/write` — look up / sync the contact (CRM) _(or Salesforce)_ — **optional** (if you have none, use the contact details the owner gives you directly)
- **Google Calendar** — `read/write` — find a slot & book it _(or Calendly · Outlook)_
- **Typeform** — `read` — capture form input

**2. Collect every input in one message** (don't ask one at a time):
- `submission_id` — filled by trigger

**Setup gate — print this and confirm EVERY box before any booking or send. If one is unchecked, finish it first; do not proceed:**
- [ ] HubSpot connected (`read/write`) _(or using owner-provided details instead)_
- [ ] Google Calendar connected (`read/write`)
- [ ] Typeform connected (`read`)
- [ ] inputs gathered: `submission_id`

## Workflow

### 1. Pull the submission
- `form-submission.get(submission_id)` → all fields (typically: name, email, phone, service interest, preferred days/times, goals).

### 2. Find-or-create the contact
- `contact.query` by email → if exists, use; if not, `contact.create` with form fields.
- Tag: `intake-{form_slug}-{date}`.

### 3. Match interest to available services
- Map the form's "service interest" field (e.g. "personal training") to actual `services` of matching type/name.
- If multi-select, pick the top match.

### 4. Find 3 candidate slots
- `availability.query` for the matched service + the lead's preferred window (or next 7 days if no preference).
- Pick 3 spaced across different days/times.

### 5. Draft the follow-up
> Hi {first_name}, thanks for reaching out about {service_name}!
>
> Based on your note that {one-sentence echo of the form's "what are you looking for" field}, here are 3 times that could work:
> 1. **{slot_1_human}** — book here: {link_1}
> 2. **{slot_2_human}** — book here: {link_2}
> 3. **{slot_3_human}** — book here: {link_3}
>
> Or just reply with what works better. — {owner_first_name}

### 6. Surface to owner — ⛔ STOP
- Show: form responses, draft, 3 slots.
- Owner approves / edits.

### 7. Send + tag
- VERIFY messageId. Tag contact `intake-followup-sent-{date}`.

## Next actions

Don't dead-end on a confirmation — once the work is done, state plainly what happened and offer the natural next step (e.g. rebook on the client's usual cadence, or send a recap), gated by the owner's approval.

## Required connectors

All are native Base44 connectors (managed OAuth, no API keys). Confirm availability at runtime; if one is missing, fall back to a listed alternative or see onboarding.md.

| Purpose | Connector (primary · fallbacks) | Access | Tier |
|---|---|---|---|
| look up / sync the contact (CRM) | HubSpot · Salesforce | read/write | native |
| find a slot & book it | Google Calendar · Calendly · Outlook | read/write | native |
| capture form input | Typeform | read | native |

## More detail

Edge cases + full verification/consent rules → **reference.md** · Worked walkthroughs → **examples.md** · First-time setup → **onboarding.md**.
