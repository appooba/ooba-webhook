# Draft new-client intake request — first-time setup

Run this once, on first activation (tools not yet connected, or no defaults set). Afterwards, skip straight to § Workflow in SKILL.md.

## 1. Connect the tools

Connect each tool **once, with every scope listed** (a tool used for two jobs — like an email connector that both sends and reads — needs both scopes at once, or the flow stalls later). Prefer the primary; if the user already uses a fallback, use that; if several, ask once:
- **HubSpot** — `read/write` — look up / sync the contact (CRM) _(or Salesforce)_ — **optional** (if you have none, use the contact details the owner gives you directly)
- **Gmail** — `send` — send the message _(or Outlook)_
- **Google Drive** — `read/write` — collect / store documents _(or Dropbox · Box · Microsoft OneDrive · Microsoft SharePoint)_
- **Typeform** — `read` — capture form input

## 2. Verify connectors

Confirm each connected tool responds. If a primary is unavailable, fall back to a listed alternative; if a whole capability is unavailable, tell the owner what the flow can't do yet rather than guessing.

## 3. Capture inputs

Collect, in one message, the details the flow needs each run:
- `contact_id`
- `form_id` — the intake/consent form to send
- `booking_id` — the upcoming first visit, for the deadline
