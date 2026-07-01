# Schedule an appointment for a client — reference

Full rules and edge cases. The agent reads this when it needs the fine print; SKILL.md is the spine.

## Decision points & edge cases

- **Branch routing (top of flow):** specific slot given → Branch A (direct-book); no fixed time → Branch B (propose-and-choose).
- **Branch A slot no longer open** → fall back to Branch B and propose alternatives; don't book a different time without re-agreeing.
- **0 contact matches** → surface to owner; this is for known clients, not new-lead capture.
- **No availability with the preferred advisor in the window** → surface; offer another advisor on the same service (named, not silent) or a wider window.
- **No email consent (Branch B)** → draft-appointment-time-options HARD STOPs and routes the options back to the owner to call instead.
- **Slot taken between proposal and confirm (Branch B)** → the B5 re-validate catches it; offer the remaining open options rather than overbooking.

## Verification & consent

- ❌ Telling the owner or the client "booked" before the VERIFY step. the booking system can 200-OK + ghost-create; the booking must be query-verified.
- ❌ Booking off a remembered/agreed time without re-validating it's still open (Branch A) — slots move.
- ❌ Confirming a proposed slot without re-validating it's still free (Branch B). That's the double-book trap.
- ❌ Sending the options message without owner approval and without a email consent check.
- ❌ Depending on `booking.hold` — it's optional/preferred; if absent, the re-validate-before-confirm step is the guard, so never block on it.
- ❌ Using this for a live phone/walk-in happening now (that's assist-customer-on-the-phone-or-walkin) or for cadence-due retention sweeps (that's rebook-client-on-regular-cadence).
- ❌ Silently creating a new contact. This workflow is for **known** clients; an unknown lookup goes back to the owner.

## Hands-free across the reply (async)

This flow has an async gap: after the options go out, the client may reply minutes or days later. Don't hold the session open — suspend and resume:

1. **Checkpoint at the suspend point** (right after the options are sent) so the run can resume after a restart: persist the inputs gathered in Setup, plus the options/slots sent, any held booking ids, and the owner-approved selection set.
2. **Register the wait by writing a trigger.** On **Gmail** (or Outlook), **write a trigger for an email reply** from the client (email connector, `read`) whose action resumes this skill. Writing this trigger is what makes the wait hands-free — without it the run stalls until a human says "they replied".
3. **On resume** — load the checkpoint, parse the choice, re-validate the slot is still open → book + confirm → verify by re-query → notify client + owner → archive/disable the watcher.
