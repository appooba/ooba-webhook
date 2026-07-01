# Collect documents before a appointment — examples

Worked walkthroughs (illustrative; the real values come from live queries).

## Example — typical run

Trigger: "Get {first_name}'s tax documents before their appointment"

Sequence:
1. 1. Determine the document requirement
2. 2. Resolve the intake form + deadline
3. 3. Resolve the client + consent
4. 4. Send the document request — ⛔ STOP, owner approval
5. 5. Track received vs outstanding
6. 6. Gate / flag the meeting
