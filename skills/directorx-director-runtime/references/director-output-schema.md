# Director Output Schema Notes

## Required Stage Output Fields

- `director_contract_fingerprint`: active `director_contract.json` fingerprint.
- `inherited_directive_ids`: Director rules consumed by this artifact.
- `override_records`: explicit, scoped, approved deviations; empty by default.

- `artifacts`: structured files created or updated by the stage.
- `decisions`: director decisions with rationale.
- `requiredApprovals`: user decisions needed before changing scope, cost, or delivery promise.
- `providerRequests`: generation, search, analysis, editing, or render requests.
- `memoryUpdates`: patches to project memory.
- `reviewCriteria`: checks that prove the output can move forward.

## Director Contract

`Director.md` is compiled into `director_contract.json` with stable directive IDs for story, style, camera, performance, audio, edit, continuity, negative rules, generation, and review. A downstream artifact is stale when its fingerprint differs from the active contract.

Every override contains `directive_id`, `scope`, `rationale`, `reviewer`, `approval_state`, and `expires_after_stage` when temporary.

## Shot Fields

- `shot_id`
- `sequence_id`
- `purpose`
- `duration_seconds`
- `importance`
- `video_type`
- `visual_description`
- `subject`
- `scene`
- `camera`
- `composition`
- `lighting`
- `color`
- `audio`
- `model_hint`
- `cost_level`
- `consistency_constraints`
- `success_criteria`
