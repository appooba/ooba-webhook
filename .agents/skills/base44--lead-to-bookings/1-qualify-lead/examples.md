# Turn intake form into first booking — examples

Worked walkthroughs (illustrative; the real values come from live queries).

## Example — typical run

Trigger: "Form just got submitted — follow up?"

Sequence:
1. 1. Pull the submission
2. 2. Find-or-create the contact
3. 3. Match interest to available services
4. 4. Find 3 candidate slots
5. 5. Draft the follow-up
6. 6. Surface to owner — ⛔ STOP
7. 7. Send + tag
