---
name: directorx-continuity-memory
description: Design and update DirectorX production memory for character, product, scene, style, voice, music, timeline, approval, failed constraint, and long-running video-agent continuity. Use when improving memory_state, continuity_plan, or checkpoint artifacts.
---

# DirectorX Continuity Memory

Use this skill to keep video projects stable across shots, retries, providers, edits, and sessions.

## Workflow

1. Identify continuity entities: character, product, scene, object, voice, music, style, timeline, promise, approval, failed constraint.
2. Store stable memory separately from temporary working notes.
3. Attach each memory key to the artifacts and shots that depend on it.
4. Update memory after accepted shots, rejected attempts, user approvals, and fallback decisions.
5. Use checkpoints to resume work without reinterpreting approved facts.
6. Emit drift warnings when new outputs conflict with memory.
7. Keep empirical model-routing knowledge separate from creative continuity memory. Only store proposals that a user accepted through Codex `request_user_input`; attach authority, project/workspace scope, source report, expiry, and revocation history.
8. Expired or revoked model knowledge is historical evidence, not an active routing hint. It must never rewrite an already approved provider/model route.

## Output Contract

```json
{
  "memory_key": "product.main.color",
  "value": "matte black",
  "source_artifact": "project_brief.json",
  "dependent_shots": [],
  "change_policy": "requires_approval"
}
```

## Reference

Read `references/continuity-memory-guide.md` for memory keys and drift handling.
