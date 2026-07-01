# Turn intake form into first booking — reference

Full rules and edge cases. The agent reads this when it needs the fine print; SKILL.md is the spine.

## Decision points & edge cases

- **Form fields are incomplete** (no service interest) → ask the owner in a single nudge: "Sarah's form didn't say which service she wants — want me to ask?" Don't guess.
- **Multiple services match** → propose the top 2; let the customer pick by replying.
- **No available slots in the lead's window** → propose the closest 3 outside their window; surface as "the slots you asked about are full — closest available are…"

## Verification & consent

- ❌ Sending without owner approval. Intake responses are warm leads, not list members.
- ❌ Generic "thanks for your interest" with no concrete slots. The whole point is specificity.
- ❌ Waiting > 4 hours to surface. Lead temperature halves after the first hour.
