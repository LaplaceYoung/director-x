# Shot Planning Rubric

## Shot Function Types

- Hook shot: visible promise, contrast, or surprise.
- Anchor shot: establishes subject, setting, product, or problem.
- Proof shot: demonstrates a claim or mechanism.
- Texture shot: adds mood without slowing comprehension.
- Transition shot: changes topic, location, time, or energy.
- CTA shot: makes the final action obvious.

## Difficulty Factors

| Factor | Low | High |
| --- | --- | --- |
| Subject consistency | object/static scene | recurring character, face, product logo |
| Motion | static/pan | complex body motion, camera orbit, crowds |
| Text | no text | dense on-screen text, small UI, captions in frame |
| Physics | simple | liquid, cloth, hands, tools, fast interaction |
| Duration | 2-4s | 8s+ continuous action |
| Provider risk | common style | niche visual style or strict reference match |

## Long-Video Graph

Model dependencies as:
`episode -> sequence -> scene -> shot -> camera_node / asset_node / transition_anchor`.

Each node needs id, role, memory keys, owner artifact, and failure impact.

## Executable Camera Graph

- Every non-origin shot points to an earlier parent shot and its `first` or `last` frame.
- `reuse` requires the child first-frame asset to equal the parent frame asset.
- `reference_recompose` generates a new angle while preserving the parent frame as a forced visual reference.
- `transition_extract` requires a provider route capable of generating and decoding a camera transition.
- `medium`, `large`, and downstream-referenced shots require an explicit last-frame asset.
- The graph must be acyclic and every frame/Clip task must appear exactly once in a topological execution wave.
- External references are eligible only after local quality audit and rights classification. A later shot cannot leak into an earlier shot's reference set.
- `DX-Reference-Analyst` must retain forced continuity anchors and attach multimodal evidence for every approved first/last-frame selection.
