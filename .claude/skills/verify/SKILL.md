---
name: verify
description: Drive the Chasing Pi extension the way a learner does and prove behaviour from its evidence files. Use after changing src/, src/prompt.md, eval/ or scripts/, before merging, or when asked whether a Chasing flow (opt-in, diagnostic, coverage, verification, ending, materials) still works.
---

# Verify Chasing

Chasing is a Pi extension. A user types `/chasing` in Pi, then learns through questions. The proof is never "it typechecks". It is a real session whose evidence JSONL shows the flow you claim.

Two harnesses drive it. Pick by what you changed.

- `npm run simulate` runs headless sessions where a DeepSeek-played learner answers Chasing's questions. Use it for anything that affects the learning flow, tools, prompt or checks.
- A tmux-hosted Pi TUI. Use it for commands, status bar, notifications and opt-in behaviour, which the simulator does not see.

The feature map is in [features/README.md](features/README.md). Read the matching file before driving.

## Launch

Nothing stays running. Each drive launches its own instance.

Headless, from the repo root:

```bash
npm run simulate -- <write-skew|bh-fdr|measurement-invariance|all> [--model provider/id]
```

It is ready when it prints nothing for a while; each scenario takes 3 to 8 minutes. It ends with one summary line per scenario, `PASS|FAIL <id> · hard n/m · turns t/max · ended|not ended · failed: <checks> · <runDir>`, and exit code 0 only if every scenario passed its hard checks. Run it in the background.

TUI, in a disposable workspace:

```bash
WS=$(mktemp -d /tmp/chasing-verify.XXXX)
tmux new-session -d -s chasing-verify -x 160 -y 45 -c "$WS" "zsh -ic 'pi -ne -e $PWD/src/index.ts --provider deepseek --model deepseek-v4-flash --session-dir $WS/sessions; echo EXIT=\$?; sleep 120'"
```

Ready means the footer line shows `(deepseek) deepseek-v4-flash`. Check with `tmux capture-pane -p -t chasing-verify | grep -v '^$' | tail -5`. `pi` is a zsh function that sets a proxy, so it must run through `zsh -ic`. Pass `--provider deepseek` separately, because `deepseek/deepseek-v4-flash` is ambiguous to the CLI.

## Doctor

Run before driving, and again whenever a run errors early.

```bash
npm run check
test -n "$DEEPSEEK_API_KEY" && echo key-ok
```

`npm run check` must report `fail 0`. If the key is missing, `source ~/.zshrc`. A simulate run that ends `ERROR <id> · Chasing model error` is a provider or network fault, not a Chasing bug. Rerun once before attributing it.

## Drive

Headless. Run the scenario whose behaviour you touched, or `all` before a merge. Then read the run directory it printed.

- `report.json` has `report.results[]` (`name`, `hard`, `pass`, `detail`) and every tool outcome in `tools[]`.
- `transcript.md` has what the learner and Chasing said, turn by turn.
- `workspace/.chasing/sessions/<id>.jsonl` is the evidence. One event per line, `sequence` strictly increasing.

TUI. Send keys and read the pane.

```bash
tmux send-keys -t chasing-verify "/chasing" Enter
sleep 2; tmux capture-pane -p -t chasing-verify | grep -v '^$' | tail -6
jq -c '{sequence,type,phase}' "$WS"/.chasing/sessions/*.jsonl
```

Each prompt to the model costs a DeepSeek call. Commands (`/chasing`, `/chasing-leave`, `/chasing-sync`) do not.

## Evidence

A proof names the scenario or keystrokes, the summary line or pane capture, and the evidence events that show the behaviour. Read the events, not only the summary. A PASS with `failed: tool-errors` is still a pass, but each tool error in `report.json` is a candidate bad case; say which ones you read.

The simulated learner is a regression harness. Its sessions show that the flow and guards work. They are not evidence that Chasing's questions are good for a human learner, and a report must not claim that.

Proof artifacts live in `eval/runs/<timestamp>-<id>/` (gitignored). Keep them. For TUI runs, copy the pane capture and the JSONL into `eval/runs/<timestamp>-tui/` before cleanup.

## Cleanup

```bash
tmux kill-session -t chasing-verify
rm -rf "$WS"
```

Kill only the `chasing-verify` tmux session you started. Never delete `eval/runs/`. A simulate run cleans up itself; it disposes its Pi session in a `finally`.

## Helpers

- `scripts/simulate.ts` is the headless driver, run through `npm run simulate`. Scenarios are in `eval/scenarios.ts`, checks in `eval/checks.ts`.
- `node scripts/export-turns.ts <pi-session.jsonl>` turns a real Pi session file into a Markdown review transcript with an annotation line per question. Use it on human sessions from `~/.pi/agent/sessions/`, not on simulator runs.
