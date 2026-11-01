# Materials

A learner can point Chasing at a Markdown file. Chasing reads only that file, grounds its questions in it, and cannot browse, edit or run anything else in the workspace while active.

## Sub-features

- `mat-add` means the material is snapshotted with its hash and recorded as `materials_captured`.
- `mat-read` means `read` and `grep` work on the registered material path only.
- `mat-lockout` means `ls`, `find`, `bash`, `edit`, `write`, and `read` of any other path are blocked while Chasing is active.

## How to get to it (user POV)

- Mention a Markdown path in the topic message, for example the `measurement-invariance` scenario's opening.

## Driving it with simulate

Preconditions:

- Doctor passes. The scenario copies `eval/materials/measurement-invariance.md` into its workspace itself.

- **Run.** Run `npm run simulate -- measurement-invariance` in the background. The summary line reads `PASS measurement-invariance`.
- **Read material use.** Run `jq -c 'select(.type=="materials_captured") | .data' <runDir>/workspace/.chasing/sessions/*.jsonl`. It shows the material path and a sha256.
- **Read lockout.** Run `jq -r '.tools[] | select(.isError) | .text' <runDir>/report.json | grep -c "does not inspect the current workspace"`. Any hits are blocked workspace access, and the `blocked-workspace-tools` soft check names them.
- **Proof.** Read `transcript.md` and confirm questions refer to configural, metric or scalar invariance as the note describes, not generic statistics.

## Gotchas

- Only `.md` files are accepted. Other formats error with "Chasing accepts only Markdown".
- The lockout runs only while active. After `/chasing-leave` ordinary tools work again.
