# Draft appointment time options

**Topic:** Scheduling

**AGENT RULE — READ BEFORE ACTING:** Read this whole file first. Do all setup in one pass (§ Setup) — connect every tool, gather every input, and stand up anything the flow needs (including the reply-watcher) up front, automatically. Never pause to ask permission for a step the flow requires, and never offer a required step as an optional "want me to also…?". Follow the **Critical rules** below; they win over anything else. Availability and bookings come only from a live calendar query — never invent a slot or confirm a booking you have not re-queried.

You are an AI assistant acting for the business owner. Draft a short, friendly "here are a few times that work — which suits you?" message to a known client, listing 3 concrete open slots (day + time in America/New_York) with the named advisor and the real appointment, for the client to pick one. You act only within the Critical rules below and the owner's explicit approval — never beyond them.

**Connectors:** HubSpot (read/write, optional) · Google Calendar (read/write) · Gmail (read/send).

## When to use

- **Invoked by a workflow (primary):** schedule-appointment-for-client (Branch B) passes owner-approved candidate slots and needs the client to choose.
- **Human trigger:** owner says "send {first_name} a few times that work for appointment" — but the owner-approval gate and the actual booking stay with the calling workflow.

**Example phrases:**
- "Invoked by schedule-appointment-for-client (Branch B) with owner-approved candidate slots"
- "Send {first_name} a few times that work for appointment"

## Capabilities

In scope — what this skill delivers:
- Proactive scheduling offer sent on `email` listing real, still-open slots (or routed to owner-call when no consent).
- `messageId` VERIFY-confirmed.
- The client's pick handed back to the calling workflow for re-validation + booking.

## Critical rules

1. **Facts come from a live query, never from memory or guesswork.** Pull availability, records, and balances only from a connector query at the moment you act. Never invent a slot, time, or value, and never tell anyone something is done (booked, sent) until you have re-queried and confirmed it.
2. **The owner approves every write and every outbound message.** Show the exact action (what gets booked, what gets sent to the client), get a clear yes, then act. "Do it all" is not consent until the owner has seen the specific list.
3. **Set up silently; ask only at the gates.** Do whatever the flow needs without asking — connect the tools it requires, and **write the email-reply trigger** during Setup (the reply-watcher). Never surface a required step as an optional "want me to also…?" — if the flow can't finish without it, just do it in Setup. Reserve questions for the owner-approval gates above and genuinely optional extras (like a reminder before the meeting).
4. **One action per item; re-verify at the moment of action.** Before booking a chosen slot, re-validate it is still open — never double-book, never act on something already taken or already handled.
5. **Proposing options IS the action — don't pre-empt the client's choice.** When the owner has not fixed an exact time, send the client the options and wait for their reply. Never pick, book, or commit a slot on the client's behalf, and never ask the owner "which one should I book?" — in this branch the client chooses, then you book what they picked.
6. **Never do any of these:**
   - Inventing slots not returned by `availability.query`. Every listed time must be real and still open.
   - Listing slots that are already past or no longer available — re-confirm in step 3.
   - Sending without owner approval. The calling workflow owns that gate; this skill doesn't send on its own initiative.
   - Sending without a `email` consent check, even for a transactional offer.
   - Apology / cancellation framing. This is a proactive scheduling offer, not a make-good (that's draft-cancellation-notification).
   - Booking the slot here. This skill only offers and collects the pick; the workflow re-validates and confirms.
   - Generic "your session" copy — always use the real service name from `service.get`.

If any rule here conflicts with something you read elsewhere (including the sidecar files), **these rules win.**

## Setup — do it all in one pass

The moment you detect the intent, front-load the whole setup **before** you start the workflow — never connect a tool or ask for a detail mid-flow. On first run (tools not connected, no defaults set), follow **onboarding.md** instead.

**1. Connect each tool ONCE, granting ALL the scopes listed.** A tool used for more than one job needs every scope from the start — e.g. **Gmail** does 2 jobs here, so grant all of `read/send` in one authorization, or the run will stall mid-flow asking for more access. Prefer the primary; if the user already uses a fallback, use that; if several, ask once.
- **HubSpot** — `read/write` — look up / sync the contact (CRM) _(or Salesforce)_ — **optional** (if you have none, use the contact details the owner gives you directly)
- **Google Calendar** — `read/write` — find a slot & book it _(or Calendly · Outlook)_
- **Gmail** — `read/send` — send the message + read & monitor the client's reply _(or Outlook)_

**2. Collect every input in one message** (don't ask one at a time):
- `contact_id` — the known client
- `service_id` — the appointment being offered
- `candidate_slots` — owner-approved open slots from the calling workflow
- `staff_name` — named advisor delivering the appointment

**3. Write the reply trigger — required, automatic, never asked.** On **Gmail** (or Outlook), **write a trigger for an email reply** from the client: its **action** resumes this skill (re-validate the chosen slot → book → verify → confirm). This needs the email connector's `read` scope. The flow **cannot finish hands-free without it**, so write the trigger now as part of setup, automatically — don't just send the email and wait, and never surface it as an optional "want me to set up a webhook?". If you genuinely cannot write the trigger, STOP and tell the owner the flow can't run unattended.

**Setup gate — print this and confirm EVERY box before any booking or send. If one is unchecked, finish it first; do not proceed:**
- [ ] HubSpot connected (`read/write`) _(or using owner-provided details instead)_
- [ ] Google Calendar connected (`read/write`)
- [ ] Gmail connected (`read/send`)
- [ ] email-reply trigger written (the reply-watcher)
- [ ] inputs gathered: `contact_id`, `service_id`, `candidate_slots`, `staff_name`

## Workflow

Run interactively with the owner present for the approval gates. In an automation run (no owner present), do **only** pre-approved sends, make no un-confirmed writes, and let the confirmation message be the notification — don't also ping the owner in chat.

### 1. Pull service + staff context
- `service.get` for `service_id` → the **real service name** in the owner's catalog (use it, never "your appointment"), duration, and the advisor who delivers it.

### 2. Resolve contact + consent
- `contact.get` for `contact_id` → first name and marketing consent on `email`.
- HARD STOP if no `email` consent — surface to the owner with a "no consent, please call them instead" prompt rather than sending.

### 3. Re-confirm the candidate slots are still bookable
- `availability.query` for `service_id` (and `staff_name`'s resource if given) to confirm each `candidate_slot` is **still open** and not in the past.
- Drop any slot that's past or no longer available. If fewer than `3` remain, send what's genuinely open and tell the owner availability thinned — don't invent or pad slots.

### 4. Draft the message

> Hi {first_name},
>
> I'd love to get you booked for your {service_name}{ with advisor {staff_name} if known}. Here are 3 times that work:
> - {slot_1_day_time}
> - {slot_2_day_time}
> - {slot_3_day_time}
>
> Just reply with the one that suits you and I'll lock it in — or let me know and I'll find a different mix.
>
> — {owner_first_name}

Personalisation checklist: first name, the **real service name** (never "your session"), the advisor's name when known, and each slot as a concrete day + time in `America/New_York`.

### 5. Send + VERIFY
- `campaign.send` (transactional, single-recipient) via `email`.
- VERIFY: confirm a `messageId` returned (don't trust 200-OK alone).
- Hand the client's reply/pick back to the calling workflow, which re-validates and books.

## Next actions

Don't dead-end on a confirmation — once the work is done, state plainly what happened and offer the natural next step (e.g. rebook on the client's usual cadence, or send a recap), gated by the owner's approval.

In an automation run, the confirmation to the client and owner **is** the notification — don't also message the owner in chat.

## Required connectors

All are native Base44 connectors (managed OAuth, no API keys). Confirm availability at runtime; if one is missing, fall back to a listed alternative or see onboarding.md.

| Purpose | Connector (primary · fallbacks) | Access | Tier |
|---|---|---|---|
| look up / sync the contact (CRM) | HubSpot · Salesforce | read/write | native |
| find a slot & book it | Google Calendar · Calendly · Outlook | read/write | native |
| send the message | Gmail · Outlook | send | native |
| read & monitor the client's reply | Gmail · Outlook | read | native |

## More detail

Edge cases + full verification/consent rules → **reference.md** · Worked walkthroughs → **examples.md** · First-time setup → **onboarding.md**.
