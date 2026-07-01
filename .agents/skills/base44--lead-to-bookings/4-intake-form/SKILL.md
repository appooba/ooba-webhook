# Draft new-client intake request

**Topic:** Operations

**AGENT RULE — READ BEFORE ACTING:** Read this whole file first. Do all setup in one pass (§ Setup) — connect every tool, gather every input, and stand up anything the flow needs (including the reply-watcher) up front, automatically. Never pause to ask permission for a step the flow requires, and never offer a required step as an optional "want me to also…?". Follow the **Critical rules** below; they win over anything else. Availability and bookings come only from a live calendar query — never invent a slot or confirm a booking you have not re-queried.

You are an AI assistant acting for the business owner. Draft a message asking a new client to complete the intake / consent form before their first appointment, explaining the why (safety + personalization) and linking the form. You act only within the Critical rules below and the owner's explicit approval — never beyond them.

**Connectors:** HubSpot (read/write, optional) · Gmail (send) · Google Drive (read/write) · Typeform (read).

## When to use

- **Proactive data signal (primary):** a client with no prior completed appointment has a first appointment confirmed for a service the owner has flagged as intake/consent-required.
- **Human trigger:** owner says "send the new client the intake form" or "make sure they sign consent before the visit".

**Example phrases:**
- "Send {first_name} the intake form before their first visit"
- "Make sure the new client fills out consent before appointment"
- "Proactive: a first-time client's appointment is confirmed and an intake/consent form is required for that service"

## Capabilities

In scope — what this skill delivers:
- Owner-approved intake/consent request sent (or routed to owner)
- Contact tagged `intake-requested-{date}`
- Any missing/mismatched consent form flagged to the owner

## Out of scope

- Not for returning clients who already have intake on file, and not for rebooking nudges (that's draft-rebooking-reminder-message).

## Critical rules

1. **Facts come from a live query, never from memory or guesswork.** Pull availability, records, and balances only from a connector query at the moment you act. Never invent a slot, time, or value, and never tell anyone something is done (booked, sent) until you have re-queried and confirmed it.
2. **The owner approves every write and every outbound message.** Show the exact action (what gets booked, what gets sent to the client), get a clear yes, then act. "Do it all" is not consent until the owner has seen the specific list.
3. **Set up silently; ask only at the gates.** Do whatever the flow needs without asking — connect the tools it requires. Never surface a required step as an optional "want me to also…?" — if the flow can't finish without it, just do it in Setup. Reserve questions for the owner-approval gates above and genuinely optional extras (like a reminder before the meeting).
4. **Never do any of these:**
   - Asking for health history or consent in the message body or expecting a free-text reply. Sensitive data belongs in the form only.
   - Sending a generic intake form for a consent-heavy treatment (botox/filler/laser/tint). The form must match the treatment's safety + consent needs.
   - A cold "fill this out" with no reason. State the why (safety + personalization) — that's what gets it done before the visit.
   - Sending without consent — route through the owner instead.
   - Re-requesting intake from returning clients who already have it on file.

If any rule here conflicts with something you read elsewhere (including the sidecar files), **these rules win.**

## Setup — do it all in one pass

The moment you detect the intent, front-load the whole setup **before** you start the workflow — never connect a tool or ask for a detail mid-flow. On first run (tools not connected, no defaults set), follow **onboarding.md** instead.

**1. Connect each tool ONCE, granting ALL the scopes listed.** A tool used for more than one job needs every scope from the start, or the run will stall mid-flow asking for more access. Prefer the primary; if the user already uses a fallback, use that; if several, ask once.
- **HubSpot** — `read/write` — look up / sync the contact (CRM) _(or Salesforce)_ — **optional** (if you have none, use the contact details the owner gives you directly)
- **Gmail** — `send` — send the message _(or Outlook)_
- **Google Drive** — `read/write` — collect / store documents _(or Dropbox · Box · Microsoft OneDrive · Microsoft SharePoint)_
- **Typeform** — `read` — capture form input

**2. Collect every input in one message** (don't ask one at a time):
- `contact_id`
- `form_id` — the intake/consent form to send
- `booking_id` — the upcoming first visit, for the deadline

**Setup gate — print this and confirm EVERY box before any booking or send. If one is unchecked, finish it first; do not proceed:**
- [ ] HubSpot connected (`read/write`) _(or using owner-provided details instead)_
- [ ] Gmail connected (`send`)
- [ ] Google Drive connected (`read/write`)
- [ ] Typeform connected (`read`)
- [ ] inputs gathered: `contact_id`, `form_id`, `booking_id`

## Workflow

### 1. Resolve the form
- `form.get` for `form_id` → form name, public link, and which fields it contains.
- Confirm the form matches the booked treatment. A botox/filler/laser visit needs the consent + health-history form, not a generic contact form. If the only form on file is generic and the treatment is consent-heavy, **HARD STOP** and surface to the owner: "this treatment needs a consent form and I only see a generic intake — which form should I send?"

### 2. Resolve contact + consent
- `contact.get` → first name, marketing consent on `email`.
- HARD STOP if no `email` consent — surface to the owner to send manually. Do not skip the intake; just route the ask through the owner.

### 3. Compute the deadline
- If `booking_id` is present, frame the ask as "before your visit on {visit_day}". Otherwise "before your first appointment".

### 4. Draft the message

> Hi {first_name},
>
> Looking forward to seeing you for your first appointment! Before you come in, please take 3 minutes to fill out this quick form — it covers a bit of health background and consent so we can keep your treatment safe and tailored to you.
>
> {form_name}: {form_link}
>
> Finishing it before {visit_day_or_your_visit} means we can spend your appointment on the treatment, not paperwork. Any questions, just reply.
>
> — {owner_first_name}

Privacy / consent handling (HARD requirement): the message must (a) state plainly *why* health/consent information is being collected, (b) link only the owner's own form (never ask for health details in free-text reply), and (c) never echo any health information back over `email`. Health and consent data are sensitive — keep them inside the form, not in the messaging thread.

### 5. ⛔ STOP for owner approval
- Show: client name, the form being sent, the deadline, draft message, channel.
- Owner: approve / edit / "use a different form" / skip.

### 6. Send + tag
- `campaign.send` (transactional, single-recipient) via `email`.
- VERIFY: confirm a `messageId` returned (don't trust 200-OK alone).
- Tag contact: `intake-requested-{date}`.

## Next actions

Don't dead-end on a confirmation — once the work is done, state plainly what happened and offer the natural next step (e.g. rebook on the client's usual cadence, or send a recap), gated by the owner's approval.

## Required connectors

All are native Base44 connectors (managed OAuth, no API keys). Confirm availability at runtime; if one is missing, fall back to a listed alternative or see onboarding.md.

| Purpose | Connector (primary · fallbacks) | Access | Tier |
|---|---|---|---|
| look up / sync the contact (CRM) | HubSpot · Salesforce | read/write | native |
| send the message | Gmail · Outlook | send | native |
| collect / store documents | Google Drive · Dropbox · Box · Microsoft OneDrive · Microsoft SharePoint | read/write | native |
| capture form input | Typeform | read | native |

## More detail

Edge cases + full verification/consent rules → **reference.md** · Worked walkthroughs → **examples.md** · First-time setup → **onboarding.md**.
