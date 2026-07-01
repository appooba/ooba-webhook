---
name: lead-to-booking-engine
description: >-
  End-to-end new-client acquisition pipeline: takes a fresh intake-form
  submission and drives it to a confirmed, prepped first appointment — qualify
  the lead and propose times, let the client pick, book and verify, then
  collect the intake/consent form and any required documents before the visit.
  Use when an intake form is submitted, when the owner says "follow up on this
  lead / get them booked / send a few times that work", or when a first-time
  appointment needs intake, consent, or documents before it happens. Not for
  periodic lead-list hygiene or rebooking existing clients.
---

# Lead-to-Booking Engine

Turn one intake-form submission into a confirmed, fully-prepped first appointment. This skill bundles five owner-supervised stages, each a self-contained playbook in its own file. Run them in order; skip a stage that doesn't apply.

**AGENT RULE — READ BEFORE ACTING:** This SKILL.md is the index. For the stage you're running, open and follow its file in full — each one carries its own Setup, Critical rules, Workflow, and connectors. The Critical rules inside each stage file win over anything else.

## The pipeline

| Stage | When it runs | Playbook |
|---|---|---|
| **1 · Qualify** | An intake form is submitted, or the owner points at a fresh lead | [1-qualify-lead/SKILL.md](1-qualify-lead/SKILL.md) |
| **2 · Propose times** | A qualified lead needs a first appointment and no exact time is fixed | [2-propose-times/SKILL.md](2-propose-times/SKILL.md) |
| **3 · Book** | The client picks a slot (or the owner already has an agreed time) | [3-book/SKILL.md](3-book/SKILL.md) |
| **4a · Intake / consent** | The booked service needs an intake or consent form before the visit | [4-intake-form/SKILL.md](4-intake-form/SKILL.md) |
| **4b · Documents** | The booked service is document-heavy (tax / legal / financial / notary) | [4-documents/SKILL.md](4-documents/SKILL.md) |

## How the stages hand off

1. **Qualify** pulls the submission, finds-or-creates the contact, and matches the form's interest to a real service.
2. → **Propose times** offers 3 real open slots and sends them, owner-approved, with a reply-watcher armed. *(If the owner already has an agreed time, skip straight to Book's direct-book branch.)*
3. → **Book** resumes on the client's reply: re-validates the picked slot, books, and VERIFY-confirms by re-query.
4. → **Prep** runs only if the service needs it: **4a** for an intake/consent form, **4b** for documents. Both gate the visit until what's required is on file.

## Rules that hold across every stage

These are common to all five playbooks; each file states them in full, but they never change:
- **Facts come from a live query, never memory.** Never invent a slot or say something is done before re-querying.
- **The owner approves every write and every outbound message** — at each stage's ⛔ STOP gate.
- **Sensitive data (health, consent, financial, legal, ID) stays in forms / secure upload** — never in messages, never echoed back.
- **VERIFY before claiming "booked"** — re-query by contact; a 200-OK can ghost-create.
- **Set up silently, ask only at the gates** — connect tools and write the reply-watcher in each stage's Setup, automatically.

## Connectors (union across stages)

All native Base44 connectors (managed OAuth). Each stage's file lists the subset it needs; connect each once with all scopes.

| Purpose | Connector (primary · fallbacks) | Access |
|---|---|---|
| Contact / CRM | HubSpot · Salesforce | read/write (optional) |
| Find a slot & book it | Google Calendar · Calendly · Outlook | read/write |
| Send messages + watch the reply | Gmail · Outlook | read/send |
| Collect / store documents | Google Drive · Dropbox · Box · OneDrive · SharePoint | read/write |
| Capture form input | Typeform | read |
