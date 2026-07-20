# Director X plugin capability gap matrix

Research date: 2026-07-21

This note compares Director X's Codex-plugin boundary with current open-source video-agent projects. It is a product planning artifact, not a claim that every external project is production-ready.

## Signals from external projects

| Project | Observable strength | What Director X should learn | Boundary decision |
| --- | --- | --- | --- |
| [FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline) | Conversational refinement, media search, transition generation, reusable editing Skills | Keep natural-language edits attached to an immutable timeline and preserve style recipes as future-only reusable artifacts | Reuse interaction pattern; keep Director X's approval and evidence gates |
| [VideoDB Skills](https://github.com/video-db/skills) | See → Understand → Act; spoken/scene indexing, timestamp search, playable clips, realtime streams | Make video perception queryable instead of forcing the agent to rescan a whole file for every question | Do not add a hosted provider or API key requirement to the plugin core |
| [KinoCut](https://github.com/KyaniteLabs/kinocut) | Content-addressed ingest, preflight, inspection receipts, protected elements, salvage review | Bind every inspection and derivative to source hashes and explicit human evidence | Extend existing artifact/rights contracts; avoid a second media store |
| [ai-video-studio](https://github.com/yfge/ai-video-studio) | Timeline-first production, character/style continuity, batch workflows | Treat continuity and reusable production recipes as first-class artifacts | Candidate P1 after evidence retrieval and local editing loop |
| [bradautomates/claude-video](https://github.com/bradautomates/claude-video) | Transcript-first reading, adaptive sampling, focused ranges, bounded frame inspection | Return a fast first visual result and make follow-up ranges explicit | Already rewritten in Node ESM; compatibility branch added FPS/coverage safety |

## Current Director X gap assessment

| Area | Current state | Gap | Priority | Planned feature |
| --- | --- | --- | --- | --- |
| Video ingest/read | Local and authorized-reference ingest; adaptive profiles; full-frame parity | Index contracts existed, but no local query executor | P0 | `feature/local-video-evidence-retrieval` — implemented here |
| Evidence search | Query plans and claim bundles | Candidate ranking was entirely delegated to the agent | P0 | Deterministic local observation search with persisted candidates |
| Visual semantic search | No local multimodal embedding runtime | Need provider-routed optional analyzer with explicit cost/rights evidence | P1 | Add analyzer adapter behind `media-evidence` contracts |
| Playable evidence clips | Selected moments can now become bounded MP4 review artifacts with receipts and canvas lineage | Add explicit human approval/reject controls before any derivative can support an edit or claim | P1 | `feature/evidence-review-clip-materializer` — implemented here; next add review decision persistence |
| Reusable production style | Static Skills and knowledge patches | No user-approved recipe that can be replayed on new media | P1 | Versioned style recipe artifact and approval boundary |
| Human editing loop | Director X Cut and timeline interchange exist | Need stronger natural-language edit intent translation and preview diff UX | P1 | Edit-intent compiler improvements |
| Provenance | Hashes, rights metadata, receipts, review evidence | No portable provenance manifest/C2PA bridge | P2 | Optional provenance export, never a delivery gate until verified |
| Live perception | Batch local video reading | No RTSP/desktop session adapter in the plugin core | P2 | Separate capability package; do not burden short-video intake |

## Product rule derived from the research

The plugin should progressively move from **read → summarize** to **index → query → inspect → claim**. Every speed improvement must retain four invariants:

1. candidates are not claims;
2. selected moments carry source time and evidence refs;
3. reference-only media cannot silently become delivery assets;
4. bounded budgets and a durable Run remain the single source of truth.

The first implementation in this queue is deliberately local and deterministic. It makes the existing evidence contract executable without committing Director X to a hosted perception vendor or a second Python runtime.
