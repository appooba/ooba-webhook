# Draft appointment time options — examples

Worked walkthroughs (illustrative; the real values come from live queries).

## Example — typical run

Trigger: "Invoked by schedule-appointment-for-client (Branch B) with owner-approved candidate slots"

Sequence:
1. 1. Pull service + staff context
2. 2. Resolve contact + consent
3. 3. Re-confirm the candidate slots are still bookable
4. 4. Draft the message
5. 5. Send + VERIFY
