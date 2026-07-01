# Draft new-client intake request — reference

Full rules and edge cases. The agent reads this when it needs the fine print; SKILL.md is the spine.

## Decision points & edge cases

- **No suitable consent form exists for a consent-heavy treatment** → do not send a generic form; surface to the owner so they create/select the right one (the consultation workflow handles form creation).
- **client is not actually first-time** (prior completed appointment found) → they likely already have intake; skip unless the owner explicitly wants a refresh.
- **No `email` consent** → route the ask through the owner; the intake still has to happen, just not via automated outbound.

## Verification & consent

- ❌ Asking for health history or consent in the message body or expecting a free-text reply. Sensitive data belongs in the form only.
- ❌ Sending a generic intake form for a consent-heavy treatment (botox/filler/laser/tint). The form must match the treatment's safety + consent needs.
- ❌ A cold "fill this out" with no reason. State the why (safety + personalization) — that's what gets it done before the visit.
- ❌ Sending without consent — route through the owner instead.
- ❌ Re-requesting intake from returning clients who already have it on file.
