# Collect documents before a appointment — reference

Full rules and edge cases. The agent reads this when it needs the fine print; SKILL.md is the spine.

## Decision points & edge cases

- **No `document.request` / secure-upload capability available at runtime** → do not fall back to asking for plain attachments; surface to the owner that documents need a secure destination and route the collection through their secure channel.
- **client sends sensitive documents in the message thread anyway** → flag to the owner; do not store or echo them; direct the client to the secure upload.
- **Required documents still missing at the deadline** → flag to the owner with options (remind / reschedule / proceed). For legally-gated services, recommend against proceeding.
- **Service turns out to be low-document** → stop; this workflow doesn't apply.
- **No `email` consent** → route the request through the owner.

## Verification & consent

- ❌ Collecting sensitive documents as plain message attachments or free-text. They must go through the secure upload only.
- ❌ Echoing or restating document contents (financial figures, legal details, ID numbers) anywhere in messaging or labels.
- ❌ Guessing the document checklist for a regulated engagement. The owner owns the checklist.
- ❌ Letting a legally-gated meeting proceed with required documents missing.
- ❌ Sending the request without owner approval.
