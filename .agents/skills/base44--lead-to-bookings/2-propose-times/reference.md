# Draft appointment time options — reference

Full rules and edge cases. The agent reads this when it needs the fine print; SKILL.md is the spine.

## Decision points & edge cases

- **No `email` consent** → don't send; route to the owner to call instead.
- **Fewer than `3` slots still open** → send what's open (down to 1) and flag thin availability to the owner; never pad with invented times.
- **All candidate slots now gone** → don't send a slotless message; return to the calling workflow to re-query availability.
- **Owner edits the copy** → re-send the owner's version; the approval gate lives in the calling workflow.

## Verification & consent

- ❌ Inventing slots not returned by `availability.query`. Every listed time must be real and still open.
- ❌ Listing slots that are already past or no longer available — re-confirm in step 3.
- ❌ Sending without owner approval. The calling workflow owns that gate; this skill doesn't send on its own initiative.
- ❌ Sending without a `email` consent check, even for a transactional offer.
- ❌ Apology / cancellation framing. This is a proactive scheduling offer, not a make-good (that's draft-cancellation-notification).
- ❌ Booking the slot here. This skill only offers and collects the pick; the workflow re-validates and confirms.
- ❌ Generic "your session" copy — always use the real service name from `service.get`.

## Hands-free across the reply (async)

This flow has an async gap: after the options go out, the client may reply minutes or days later. Don't hold the session open — suspend and resume:

1. **Checkpoint at the suspend point** (right after the options are sent) so the run can resume after a restart: persist the inputs gathered in Setup, plus the options/slots sent, any held booking ids, and the owner-approved selection set.
2. **Register the wait by writing a trigger.** On **Gmail** (or Outlook), **write a trigger for an email reply** from the client (email connector, `read`) whose action resumes this skill. Writing this trigger is what makes the wait hands-free — without it the run stalls until a human says "they replied".
3. **On resume** — load the checkpoint, parse the choice, re-validate the slot is still open → book + confirm → verify by re-query → notify client + owner → archive/disable the watcher.
