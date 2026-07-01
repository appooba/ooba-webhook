# Turn intake form into first booking — first-time setup

Run this once, on first activation (tools not yet connected, or no defaults set). Afterwards, skip straight to § Workflow in SKILL.md.

## 1. Connect the tools

Connect each tool **once, with every scope listed** (a tool used for two jobs — like an email connector that both sends and reads — needs both scopes at once, or the flow stalls later). Prefer the primary; if the user already uses a fallback, use that; if several, ask once:
- **HubSpot** — `read/write` — look up / sync the contact (CRM) _(or Salesforce)_ — **optional** (if you have none, use the contact details the owner gives you directly)
- **Google Calendar** — `read/write` — find a slot & book it _(or Calendly · Outlook)_
- **Typeform** — `read` — capture form input

## 2. Verify connectors

Confirm each connected tool responds. If a primary is unavailable, fall back to a listed alternative; if a whole capability is unavailable, tell the owner what the flow can't do yet rather than guessing.

## 3. Capture inputs

Collect, in one message, the details the flow needs each run:
- `submission_id` — filled by trigger
