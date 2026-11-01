# Chasing verification map

The maintained source for verifying what a Chasing user experiences. Read the index, then drive from the matching feature file.

## Baseline preconditions

- `npm run check` reports `fail 0`.
- `DEEPSEEK_API_KEY` is set.
- TUI drives run in a fresh `mktemp -d /tmp/chasing-verify.XXXX` workspace, never in a directory holding real Chasing evidence.

## Proof and skip reporting

- Report the scenario id or exact keystrokes used, and the evidence events that show the claim.
- A scenario that errors on the provider is unverified, not failed. Say so.
- Never report a TUI-only behaviour as verified through the simulator.

## Features

- [Opt-in activation](./opt-in.md) covers `/chasing`, `/chasing-leave`, `/chasing-sync` and the inactive guard.
- [Learning session](./learning-session.md) covers the full flow from goal to confirmed end, with its guards.
- [Materials](./materials.md) covers learning from a Markdown file and the workspace lockout.
