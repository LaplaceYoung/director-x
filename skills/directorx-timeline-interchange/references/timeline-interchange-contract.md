# Timeline Interchange Mapping Contract

## Time domains

- `sourceRange`: the portion read from media; it remains in source-media time.
- `timelineRange`: the placement and duration under the parent timeline.
- `availableRange`: optional known media bounds; it validates handles but does not replace either range.
- Canonical values use rational `{ value, rate }` time and half-open intervals. Floating seconds are display projections.

Never derive source in/out from a clip's parent position. A clip can begin at timeline 10 seconds while reading source media from 42 seconds.

## Identity and relinking

Keep stable clip IDs and media IDs separate from filenames. Record absolute source provenance in Director X but export portable relative/proxy relink hints where the target permits. Hashes verify media identity after relink.

## Loss classes

- `lossless`: target and round trip preserve the canonical value.
- `approximated`: target expresses a bounded equivalent; record the approximation and tolerance.
- `baked`: render the feature into media and record that editability is lost.
- `dropped`: target cannot carry it; require an explicit repair or user decision.
- `blocked`: the loss changes approved narrative, duration, rights, captions, audio, or delivery promises.

## Minimum round-trip checks

- project rate and duration;
- track kind and order;
- clip/media identity;
- source start and duration;
- parent timeline start and duration;
- gaps and overlaps;
- transitions and handles;
- captions and markers;
- audio channels, gain, and sync;
- every loss-report entry.

## Executable baseline

`directorx_export_timeline_interchange` is the built-in adapter for `directorx.timeline+json` version `1.0`. It preserves the canonical Revision, stable clip/media IDs, rational `sourceRange`, rational parent `timelineRange`, effects and metadata. Its four outputs are:

- `timeline_interchange.dx.json` — portable canonical timeline document;
- `timeline_interchange_manifest.json` — adapter identity, counts, media bindings and handoff readiness;
- `timeline_interchange_loss_report.json` — explicit feature-loss status and external adapters not executed;
- `roundtrip_validation.json` — independent JSON serialize/import comparison.

Do not rename this JSON as `.otio`, `.fcpxml`, or `.edl`. Those formats require an observed executable adapter and a second import probe in the target representation.
