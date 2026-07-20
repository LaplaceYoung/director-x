# Third-party notices

## OpenMontage

Director X was developed with architecture and regression research against [OpenMontage](https://github.com/calesthio/OpenMontage), snapshot commit `89d5f1f88b5bc7e60c9bf393d472c133ed7a2645`, licensed under GNU AGPLv3. The upstream snapshot is not vendored in this repository. Director X retains this notice for source-baseline traceability and is distributed under AGPL-3.0-or-later.

## OpenCut Classic

Director X Cut uses a bounded, rewritten integration derived from the project, scene, track, local-storage, and browser-editing architecture of [OpenCut Classic](https://github.com/OpenCut-app/opencut-classic).

- Upstream commit: `cf5e79e919144200294fb9fed22a222592a0aeea`
- Upstream snapshot date: 2026-05-17
- License: MIT
- Copyright: 2025-2026 OpenCut
- License copy: `third_party/opencut-classic/LICENSE`

The Director X product does not use the OpenCut name or logo as its own brand and does not imply upstream sponsorship or endorsement. The editor UI is branded “Director X Cut”. OpenCut Classic does not inject a video-export watermark, so Director X Cut does not add or replace a forced output watermark; only the editor product surface, project metadata, icons, and copy are rebranded.

Director X keeps its canonical timeline and source media outside the editor adapter. The adapter emits a reversible timeline patch that requires Codex native user approval, re-rendering, and renewed final-media review.

## Claude Video

Director X's adaptive video-reading profiles, duration-aware frame budgets, transcript cue frames, keyframe/scene fallback, and grayscale frame-deduplication strategy were informed by [bradautomates/claude-video](https://github.com/bradautomates/claude-video).

- Upstream commit: `83da59fa78c3eee9e20f515fe75c438bb5166efd`
- License: MIT
- Copyright: 2026 Bradley Bonanno
- License copy: `third_party/claude-video/LICENSE`

Director X rewrites this capability in Node ESM and integrates it with the existing persistent Run, native download authorization, rights metadata, frame-identity evidence, and live canvas. It does not vendor the upstream Python runtime, Claude-specific read protocol, installer, or credential storage.

## Managed media runtime

Director X installs the following tools into a user-scoped runtime directory. Their package code and model weights are not committed to this repository.

- [HyperFrames](https://github.com/heygen-com/hyperframes), pinned to `0.7.60`, Apache-2.0.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper), pinned to `1.2.1`, MIT. It is a CTranslate2 implementation of the OpenAI Whisper model architecture.
- [Remotion](https://github.com/remotion-dev/remotion), pinned to `4.0.484`, under Remotion's published license terms. Director X does not relicense Remotion.

The installer keeps these dependencies isolated under `~/.directorx/media-runtime/`. Whisper model weights are fetched only on first use of the selected model and remain subject to their upstream model licenses.
