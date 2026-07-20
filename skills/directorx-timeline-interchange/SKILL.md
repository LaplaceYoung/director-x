---
name: directorx-timeline-interchange
description: Audit or design timeline interchange for OTIO, FCPXML, EDL, NLE project import/export, proxy relinking, or cross-editor handoff. Use when a Director X timeline must cross an adapter boundary without confusing source media time with parent timeline time.
---

# Director X Timeline Interchange

Treat interchange as a typed translation with an explicit loss report. A file existing on disk is not proof that another editor will reconstruct the same cut.

## Procedure

1. Name the source timeline, target format/application, exact adapter/version, frame rate, timecode basis, media-root policy, and required features. Use `directorx.timeline+json` as the executable lossless baseline; completion for another format means its executable adapter availability and supported features are observed rather than assumed.
2. Inventory tracks, clips, gaps, transitions, effects, speed changes, audio channels, captions, markers, nested sequences, metadata, and media references. Read [the interchange mapping contract](references/timeline-interchange-contract.md) for format-specific mapping and loss classification.
3. Map `sourceRange` and `timelineRange` separately with rational time. Preserve half-open ranges, clip identity, media identity, track kind, and parent-child timing.
4. For the native baseline, call `directorx_export_timeline_interchange` with a registered canonical Revision. It writes `timeline_interchange.dx.json`, `timeline_interchange_manifest.json`, and `timeline_interchange_loss_report.json`; completion means every unsupported or approximated feature has an owner-visible disposition.
5. Re-import through an independent adapter path or target-application probe. Compare duration, clip order, source in/out, timeline position, transition spans, caption times, and media relinks.
6. Register the interchange file, loss report, and `roundtrip_validation.json` on the canvas. The Director X adapter serializes and independently re-imports its JSON before reporting success. A material loss or timing drift becomes an `edit_change` native question before the handoff is accepted.

## Completion bar

The handoff is complete only when every clip and required semantic feature is either round-trip verified or explicitly listed as a loss with a repair path. Unresolved media references keep the timeline round trip valid but make the package `handoffReady=false` until relink evidence exists. When no executable adapter exists for a requested external format, deliver the verified Director X JSON package plus an adapter plan and state that the external export was not performed.
