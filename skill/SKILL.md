---
name: sokrates-mode
description: Opens a separate Herdr TUI to challenge, refine, and question the current coding plan with the current Pi session. Use when the user asks to debate, spar over, stress-test, or improve a plan, or explicitly requests Sokrates mode.
compatibility: Requires Pi with the sokrates-mode extension, Herdr, and Node.js 22+.
---

# Sokrates Mode

1. Distill the current implementation plan into a compact, complete Markdown plan. Preserve decisions, constraints, risks, and unresolved questions; omit discussion history.
2. Call `sokrates_open` once with that plan.
3. Stop. Do not restate the plan or add commentary after the tool call. The user retains manual control of the TUI's **Conclude debate** action; never invoke conclusion automatically.

If no plan exists, pass a short statement of the goal plus known constraints and mark unknowns explicitly.
