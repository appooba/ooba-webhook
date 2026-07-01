# Schedule an appointment for a client — examples

Worked walkthroughs (illustrative; the real values come from live queries).

## Example — Branch A — direct-book (slot already agreed)

Trigger: "Book {first_name} in for a appointment on Thursday at 2"

Sequence:
1. A1. Re-validate the slot
2. A2. ⛔ STOP for owner approval
3. A3. Create + confirm — then VERIFY

## Example — Branch B — propose-and-choose (time not fixed)

Trigger: "Book {first_name} in for a appointment on Thursday at 2"

Sequence:
1. B1. Find real open slots
2. B2. ⛔ STOP for owner approval of the options
3. B3. (Optional) hold the options, then send
4. B4. client picks a slot
5. B5. Re-validate, create + confirm — then VERIFY
