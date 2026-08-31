# sokrates-mode

A Pi skill and extension for compact plan sparring in a separate [Herdr](https://herdr.dev) tab.

## What it does

- Opens a fullscreen TUI beside the Pi session that invoked it.
- Shows the current plan and a focused debate transcript.
- Sends questions to that exact live Pi session over a private Unix socket.
- Lets the model replace the plan; persists the latest plan in Pi session entries.
- Offers a manual **Conclude debate** handoff after checking decisions, alternatives, open questions, validation, and rollback.
- Lets the model suggest concluding when the plan is mature, without ever triggering conclusion automatically or repeating unchanged suggestions.
- Blocks tools during sparring turns: debate cannot mutate the project.
- Keeps prompts and replies bounded to reduce token use.

## Requirements

- Pi `0.84.4+`
- Herdr with `tab create`, `tab focus`, and `pane run`
- Node.js `22+`

Pi must itself be running in Herdr.

## Install

```bash
npm install
npm run build
pi install /absolute/path/to/sokrates-mode
```

Run `/reload` in an existing Pi session after first installation.

## Use

```text
/skill:sokrates-mode
```

Or open directly, optionally supplying a compact plan:

```text
/sokrates 1. Inspect API. 2. Add implementation. 3. Test.
```

Inside the TUI:

- `Enter`: send
- `Shift+Enter`: newline
- `/plan <replacement>`: replace the plan without an AI call
- `/conclude` or `Ctrl+D`: manually conclude and create the structured handoff
- `/quit` or `Ctrl+C`: close the tab

## Design

The Pi extension owns an authenticated mode-`0600` Unix socket scoped to the current session. Herdr creates a tab in the caller's exact workspace and runs `dist/tui.js` there. Questions become hidden custom messages in the existing Pi session, so the same model and context answer them. A strict compact protocol allows optional full-plan replacement with `<SOKRATES_PLAN>` markers. The extension strips those markers from the persisted assistant message and stores plan state as non-context custom entries. A successful manual conclusion is validated for decisions, rejected alternatives, unresolved questions, the complete revised plan, and scope/constraints/acceptance criteria/tests/rollback coverage, then queued as context for the next coding turn.

Only one sparring request is accepted at a time, and requests are rejected while Pi is busy. This avoids turn interleaving and accidental interference with coding work.

## Development

```bash
npm test
npm run check
npm run build
```
