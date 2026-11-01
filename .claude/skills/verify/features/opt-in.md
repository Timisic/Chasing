# Opt-in activation

Chasing does nothing in an ordinary Pi session. It starts only when the user runs `/chasing` and stops on `/chasing-leave` or a confirmed end.

## Sub-features

- `optin-idle` means a fresh Pi session has no Chasing status, and Chasing tools refuse with "Chasing is inactive".
- `optin-start` means `/chasing` starts a topic, sets the status bar and session name, and records `session_started`.
- `optin-leave` means `/chasing-leave` returns to ordinary Pi and records `chasing_left`. Without an active topic it only notifies.
- `optin-sync` means `/chasing-sync` replays evidence to Langfuse, and warns when there is nothing to sync or Langfuse is off.

## How to get to it (user POV)

- Type `/chasing`, `/chasing-leave` or `/chasing-sync` in the Pi editor.

## Driving it with tmux

Preconditions:

- The TUI is launched per the skill's Launch section and its footer shows the DeepSeek model.

- **Leave with nothing running.** Run `tmux send-keys -t chasing-verify "/chasing-leave" Enter`. The pane shows `Chasing 未在运行。` and `$WS/.chasing/` does not exist.
- **Start.** Run `tmux send-keys -t chasing-verify "/chasing" Enter`. The pane shows `新的 Chasing 主题已就绪` and the footer shows `• Chasing` and `Chasing · 目标澄清`.
- **Leave.** Run `tmux send-keys -t chasing-verify "/chasing-leave" Enter`. The pane shows `已离开 Chasing，Pi 已恢复普通模式。`.
- **Proof.** Run `jq -c '{sequence,type,phase}' "$WS"/.chasing/sessions/*.jsonl`. It prints `session_started` at sequence 1 in `onboarding`, then `chasing_left` at sequence 2 in `inactive`.

## Gotchas

- The session name `Chasing` stays in the footer after leaving. Only the status line clears.
- `optin-idle` with a model prompt costs a call. Prompt "list the files here" without `/chasing` and confirm the reply uses ordinary Pi tools and no `chasing_` tool appears.
