---
name: directorx-setup-doctor
description: Diagnose Director X plugin installation, local video prerequisites, managed runtime readiness, DX agent availability, restart requirements, and zero-Key smoke-test failures without creating a production Run.
---

# Director X Setup Doctor

Use this skill when the user asks whether Director X is installed correctly, reports that a tool or runtime is missing, or wants to prove the local zero-Key video path before production.

## Contract

1. Do not create a Codex Goal or Director X production Run.
2. Call `directorx_diagnose_setup` first with the smallest profile matching the requested work:
   - `planning_only`
   - `local_video_read`
   - `zero_key_edit`
   - `local_composition`
   - `provider_generation`
   - `full_production`
3. Report the selected profile, readiness, blockers, unverified capabilities, and the single `nextAction` in plain language.
4. A diagnosis is read-only. It must not expose credential values, spend provider budget, install packages, or create production state.
5. Never call `directorx_repair_setup` until the returned plan is executable and the user has explicitly accepted the exact repair through Codex `request_user_input`.
6. External actions such as Homebrew commands, Codex restart, plugin reinstall, or credential setup are instructions only. Do not execute them through the repair tool.
7. After a plugin-owned repair, call `directorx_diagnose_setup` again with the same profile. Do not claim success from installation output alone.
8. When the eligible action is `run_zero_key_smoke_test`, explain that it creates a two-second local video and audio preview, consumes no provider budget, and does not create a production Run. Ask natively before executing it.
9. If an active preflight canvas exists for the same project, the verified smoke clip and thumbnail appear there as setup evidence.

Keep the user-facing answer concise. Put raw check details in the tool result unless the user asks for a technical report.
