---
name: directorx-longform-adaptation
description: Adapt DirectorX from short videos to long-form or multi-scene production, including script-to-video, novel-to-video, episode breakdown, scene graph, character memory, camera dependency graph, best-of-k review, and continuity QA.
---

# DirectorX Longform Adaptation

Use this skill for scripts, stories, episodes, courses, and long videos that need continuity beyond a single short clip.

## Workflow

1. Segment source material into episode, sequence, scene, beat, and shot.
2. Build memory for character, location, object, tone, timeline facts, and unresolved promises.
3. Split provider generation into bounded short segments. Each segment owns an approved start frame, generated clip, extracted/approved end frame, and continuity review.
4. Call `directorx_register_longform_plan` for hierarchy and memory. For each continuity-sensitive multi-shot sequence, call `directorx_compile_camera_continuity_graph`, then require `DX-Reference-Analyst` to inspect the actual image candidates and call `directorx_review_camera_references`.
5. Call `directorx_register_segment_continuity_plan` for the render gate. Except for the first segment, each start frame must exactly equal the previous segment's end-frame asset; prose claims do not satisfy the chain.
6. Every continuity-critical segment generation request uses `keyframes_to_video` with both approved boundary anchors and binds its Camera Graph Clip node plus reference target IDs. Generate segment N, review it, select it, extract/register its real final frame, then use that frame as the input for segment N+1. Only dependency-free tasks in the same Camera Graph wave may run concurrently.
7. Define each handoff's match policy, action overlap, camera direction/speed, subject pose, wardrobe/product state, environment/light, audio bridge, and measurable acceptance criteria.
8. Prefer a provider with first/last-frame control. If the user-approved provider cannot satisfy a required tail frame or transition, reroute through native approval or revise the production promise; never silently downgrade the graph to first-frame-only generation.
9. Use best-of-k review on high-impact segments and every failed boundary. Reject identity drift, screen-direction reversal, camera velocity jumps, lighting jumps, geometry changes, duplicated action, or frozen bridge frames.
10. After every selection, call `directorx_extract_segment_boundary_frames`. Then call `directorx_audit_segment_continuity`; FFmpeg SSIM and subject/camera/motion/environment/audio checks must all pass for every adjacent pair.
11. Call `directorx_register_segment_stitch_plan` with one audited selected clip per segment and one reviewed transition/audio bridge per boundary. The legacy long-form stitch artifact may carry additional episode metadata, but Remotion/FFmpeg is gated by the generic audited stitch plan and must not infer clip order from filenames.
12. Render continuous audio separately across segment boundaries where possible. Use ambience beds, J/L cuts, music continuity, and overlap-aware dialogue timing so visual joins do not create audible cuts.
13. Plan recap, chapter, subtitle, and export variants for platform fit, then review boundary frames in the final render—not only in source clips.

## Output Contract

```json
{
  "longform_id": "episode_01",
  "hierarchy": [],
  "continuity_memory": {},
  "dependency_graph": {},
  "camera_dependency_graph": {},
  "reference_selection_plan": {},
  "segments": [],
  "frame_handoffs": [],
  "stitch_plan": {},
  "high_risk_shots": [],
  "review_strategy": {}
}
```

## Reference

Read `references/longform-adaptation-guide.md` for hierarchy and continuity rules.
