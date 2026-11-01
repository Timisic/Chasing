# Learning session

A learner states a goal, answers a diagnostic round, confirms a mission, then works through coverage items by answering one question at a time until every item is verified and they agree to end. Chasing never summarizes at the end.

## Sub-features

- `flow-order` means phases go onboarding, mapping, deepening, verification, ending, ended, without going back past mapping.
- `flow-diagnostic` means the first questions come as one diagnostic round and a mastery map is recorded only after its answer.
- `flow-mission` means no question is prepared before a mission and its 3 to 8 coverage items exist.
- `flow-one-question` means each turn shows exactly one prepared question, never free-form prose.
- `flow-verified` means a coverage item becomes verified only right after the learner answers a `verification` question.
- `flow-end` means the end is suggested only when every item is verified, and the session ends only after the learner confirms.

## How to get to it (user POV)

- Run `/chasing`, then send a topic or question in the Pi editor.

## Driving it with simulate

Preconditions:

- Doctor passes.

- **Run.** Run `npm run simulate -- write-skew` in the background. The summary line reads `PASS write-skew · hard 5/5`.
- **Read checks.** Run `jq '.report.results[] | select(.pass|not)' <runDir>/report.json`. Only soft checks may appear.
- **Read guard hits.** Run `jq -r '.tools[] | select(.isError) | .text' <runDir>/report.json`. Each line is a guard refusing a model mistake. Name each one in the report.
- **Proof.** Run `jq -c '{sequence,type,phase}' <runDir>/workspace/.chasing/sessions/*.jsonl`. Sequences increase by 1 with no gaps, `coverage_updated` with a verified item follows a `user_answer` to a verification question, and `end_suggested` precedes `session_ended`.

## Gotchas

- `not ended` with `turn-budget` failing means the learner never agreed to end within `maxTurns`. Read the transcript before blaming Chasing; the learner prompt refuses to end until its goal is met.
- DeepSeek sometimes sends malformed tool arguments. Those show as tool errors and are model faults, not guard bugs.
- The learner holds its misconceptions on purpose. A session where it gives in on the first push means the learner prompt regressed.
