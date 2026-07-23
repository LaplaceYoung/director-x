# Skill Audit

## Matrix summary

| Group | Count | Invocation | Assessment |
| --- | ---: | --- | --- |
| `directorx` entry | 1 | Implicit | One outcome-led lifecycle entry; public Facades first |
| Production lifecycle | 4 | Explicit | Overlaps around orchestration, runtime, recovery, and canvas; keep until public Facades replace low-level sequencing |
| Research and understanding | 5 | Explicit | Strong domain coverage; video reading and media evidence should converge behind one research entry |
| Creative planning | 8 | Explicit | Valuable but fragmented; script, shot, style, cinematography, transition, and visual prompting need a single route contract |
| Generation and media | 4 | Explicit | Provider and render skills are useful specialist instructions, not good first-line entries |
| Editing and review | 7 | Explicit | Good stage ownership; users should reach these through the main Run rather than direct discovery |
| Specialized production | 4 | Explicit | Avatar, screen demo, collage, long-form are mode-specific and should remain explicit |
| Setup / interchange / benchmark | 4 | Explicit | Setup doctor is an operational entry; benchmark and interchange should stay opt-in |

Total bundled skill directories: **34**.

## Findings

- The entry Skill is the only implicit invocation point and now owns one focused job: start or resume a durable production Run.
- It names the complete current public spine: start, status, resume, decide, prepare, research, generate, review, and recover. It does not hand-build the preflight, Goal, Run, or interaction protocol.
- It has explicit non-goals for general video advice, plugin development, and requests that do not start or continue production. This reduces accidental injection and trigger ambiguity.
- Its metadata default prompt explicitly invokes `$directorx`; its short description is within the Codex UI target range.
- It routes public brief confirmation and configured stage approvals through `directorx_decide_production`; specialist Skills do not recreate those approval boundaries.
- The public brief confirmation is native, canonical-brief/fingerprint-bound, and routes its raw answer through the public decision Facade before preparation. Remaining P1s are host-signed confirmation evidence and the caller-supplied run-mode mapping boundary, not a missing prepare gate.
- Specialist metadata is consistently explicit-only, which prevents most trigger conflict.
- `directorx-production-orchestration` is intentionally post-boot and remains subordinate to `directorx`.
- The skill catalog is too broad for a first-time user even though the invocation policy is safe. Consolidation should happen through routing and Facades, not by deleting production knowledge prematurely.

## Decision

Keep specialist Skills explicit and load them only after a durable Run exists. A skill can be retired only when its guidance is represented in a tested parent route and no artifact contract is lost.
