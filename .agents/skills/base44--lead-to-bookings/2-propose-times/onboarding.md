# Draft appointment time options — first-time setup

Run this once, on first activation (tools not yet connected, or no defaults set). Afterwards, skip straight to § Workflow in SKILL.md.

## 1. Connect the tools

Connect each tool **once, with every scope listed** (a tool used for two jobs — like an email connector that both sends and reads — needs both scopes at once, or the flow stalls later). Prefer the primary; if the user already uses a fallback, use that; if several, ask once:
- **HubSpot** — `read/write` — look up / sync the contact (CRM) _(or Salesforce)_ — **optional** (if you have none, use the contact details the owner gives you directly)
- **Google Calendar** — `read/write` — find a slot & book it _(or Calendly · Outlook)_
- **Gmail** — `read/send` — send the message + read & monitor the client's reply _(or Outlook)_

## 2. Verify connectors

Confirm each connected tool responds. If a primary is unavailable, fall back to a listed alternative; if a whole capability is unavailable, tell the owner what the flow can't do yet rather than guessing.

## 3. Capture inputs

Collect, in one message, the details the flow needs each run:
- `contact_id` — the known client
- `service_id` — the appointment being offered
- `candidate_slots` — owner-approved open slots from the calling workflow
- `staff_name` — named advisor delivering the appointment

## 4. Write the reply trigger (required)

On **Gmail** (or Outlook), **write a trigger for an email reply** from the client (email connector, `read`), with an action that resumes the skill. This is required, not optional — it is what lets the client's reply resume the booking hands-free. Never ask the owner whether to set it up; just write the trigger. See reference.md § Hands-free across the reply.
