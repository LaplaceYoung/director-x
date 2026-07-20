# Evidence Rough-Cut Playbook

## Interval model

Use half-open source intervals `[start, end)`. Snap the proposed cut inward to the project frame rate after applying `keepBeforeSeconds` and `keepAfterSeconds`; this keeps the promised context outside the cut. Merge overlapping adjusted ranges and union their evidence. Drop adjusted ranges shorter than `minimumCutSeconds` and record why.

An evidence reference is valid only when it resolves to a registered Run artifact, an A/V review marker ID, or evidence attached to such a marker. Search notes and unregistered filenames are leads, not evidence.

## Operation order

1. Split the immutable source clip at every unique cut boundary.
2. Delete only segments fully enclosed by approved cut intervals.
3. Move retained segments left by the cumulative removed duration.
4. Delete captions fully enclosed by a cut.
5. Shift later captions by the cumulative removed duration.

This order is deterministic and replayable against the base Revision. Every operation remains reversible and cites the interval evidence that caused it.

## Boundary collisions

A subtitle, word, action, transition, music hit, or required room-tone handle that crosses a proposed boundary makes that boundary unresolved. Adjust the range, split the semantic object with better evidence, or keep the material. Do not truncate meaning to make an automatic cut pass.

## Review rubric

- No clipped phonemes, breaths that sound artificial, or abrupt room-tone changes.
- No reaction shot or product-state change removed merely because speech is absent.
- Captions remain synchronized and readable after compression.
- Retained clips are contiguous, ordered, and free of accidental gaps.
- Removed duration and resulting duration match the proposal receipt.
- The user sees one native commit question that names the actual rough-cut impact.
