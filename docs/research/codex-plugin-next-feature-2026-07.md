# Director X Codex Plugin: Next Feature Research

Date: 2026-07-21
Repository state audited: `feature/complete-skill-metadata-catalog` at `4813eec36d1629ead9af2ae9a371aea4d8abc9ec`

## Decision

The highest-value independent next feature is a **first-run health doctor with consent-aware repair and an end-to-end local smoke proof**.

Exact branch name:

```text
feature/first-run-health-doctor
```

This feature should answer one user-level question reliably:

> “Director X is installed—but can this exact Codex session and Mac complete the kind of video task I am about to request, and if not, what is the single safe repair?”

It should not be a longer prerequisite checklist. It should turn the existing fragmented checks into one typed, task-profile-aware readiness result, repair only plugin-owned state after explicit consent, re-run behavioral probes, and produce a small previewable local media artifact as proof when the selected profile is ready.

## Excluded completed work

The recommendation deliberately excludes capabilities already completed or currently represented by dedicated branches/contracts:

- lifecycle hooks;
- MCP intent contracts and typed public-tool work;
- skill MCP dependencies;
- complete skill metadata catalog;
- Claude Video-inspired video reading.

The feature may consume those contracts, but must not reopen or duplicate them.

## Why this is the next priority

Director X's current startup path is strong at checking Codex host concepts—native Goal, native user input, agent dispatch, durable loop, and side Browser—but installation readiness is split across unrelated modules and assumptions.

Current repository evidence:

1. [`mcp/codex-host-capabilities.mjs`](../../mcp/codex-host-capabilities.mjs) checks Codex host tools and skills, but not executable media dependencies, plugin-cache version, installed MCP path, managed-runtime compatibility, workspace writeability, or provider-route readiness.
2. [`runtime/doctor-media-runtime.mjs`](../../runtime/doctor-media-runtime.mjs) only delegates to `inspectMediaRuntime()`.
3. [`runtime/media-runtime.mjs`](../../runtime/media-runtime.mjs) considers the managed Remotion browser, HyperFrames, and faster-whisper files. It does not probe FFmpeg, FFprobe, yt-dlp, Node compatibility, `uv`, actual decoding/rendering behavior, disk/write conditions, DX role session readiness, or the canvas handshake.
4. The doctor returns `installCommand: "pnpm install:runtime"`, but this standalone plugin's [`package.json`](../../package.json) does not define `install:runtime` or a doctor script. The command only appears available in the current development machine because the parent DirectorX pnpm workspace supplies it. An installed plugin cache or a standalone clone cannot rely on that parent workspace.
5. [`runtime/install-media-runtime.mjs`](../../runtime/install-media-runtime.mjs) can install pinned managed components, but it is exposed separately and does not produce an approved repair plan, verify external prerequisites, distinguish feature profiles, or explain restart requirements.
6. [`mcp/preflight-transaction.mjs`](../../mcp/preflight-transaction.mjs) can reach `repair_host_capabilities`, while setup repair remains a conceptual next action rather than one unified executable contract.
7. The manifest provides three production starter prompts, but none is a first-run verification route. Existing product screenshots are not referenced through `interface.screenshots`.

The result is a product gap between four states that are currently easy to confuse:

```text
plugin appears installed
  ≠ MCP server started
  ≠ current Codex session has required native capabilities and DX roles
  ≠ this machine can read, generate, render, review, and preview media
```

For an AI video plugin, that gap is more damaging than missing another advanced canvas interaction. Users discover it only after committing time to Intake or production.

## First-party evidence

### Plugin installation is cached and session-sensitive

Codex installs plugins into a cache and loads the installed copy rather than the marketplace source directly. Bundled skills become available in a new chat/session, and bundled MCP servers may require additional setup or authentication. This makes installed-version identity, new-session readiness, and MCP readiness legitimate first-run checks—not implementation detail.

Sources:

- [How the desktop app uses marketplaces](https://learn.chatgpt.com/docs/build-plugins#how-the-chatgpt-desktop-app-uses-marketplaces)
- [Plugin permissions and data sharing](https://learn.chatgpt.com/docs/plugins#how-permissions-and-data-sharing-work)
- [Install a local plugin](https://learn.chatgpt.com/docs/build-plugins#install-a-local-plugin-manually)

### Official plugins separate setup from workflow execution

OpenAI's public [`openai/plugins`](https://github.com/openai/plugins) repository contains dedicated setup/troubleshooting skills rather than making every workflow rediscover prerequisites. The clearest example is [`boltz-cli-setup`](https://github.com/openai/plugins/tree/main/plugins/boltz-api-cli/skills/boltz-cli-setup), which owns installation, version, PATH, sandbox, and authentication recovery while downstream skills route setup failures back to it. It requires exact approval before running mutable remote installers and verifies the result after installation.

The repository was inspected at commit `11c74d6ba24d3a6d48f54a194cd00ef3beea18f9`.

Transferable rules for Director X:

- one setup owner rather than duplicated prerequisite prose;
- diagnose before mutation;
- distinguish missing, stale, unauthorized, sandbox-blocked, and session-restart states;
- show exact external installer/command risk before approval;
- never treat a general request to use the plugin as approval to install remote code;
- rerun the probe after repair rather than declaring success from an exit code alone.

### Skills can expose a deliberate setup route

Official skill metadata supports UI description, a default prompt, implicit-invocation policy, and declared MCP dependencies through `agents/openai.yaml`. A dedicated setup skill can therefore be discoverable without polluting production skills with installation logic.

Source: [Build skills: optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata).

### Starter prompts are part of plugin product design

The plugin manifest supports up to three `interface.defaultPrompt` entries. Official examples use them to expose high-value entry workflows. Director X should dedicate one prompt to proving readiness, not merely describing another production request.

Source: [Plugin manifest fields](https://learn.chatgpt.com/docs/build-plugins#manifest-fields) and official manifests in [`openai/plugins`](https://github.com/openai/plugins).

### Public review tests setup and failure behavior

OpenAI's public plugin submission requires exactly five positive and three negative reproducible test cases. A deterministic first-run doctor creates the foundation for several of those cases: clean install, missing prerequisite, stale runtime, denied repair, unavailable authentication, and post-repair verification.

Source: [Submit plugins: testing](https://learn.chatgpt.com/docs/submit-plugins#testing).

## Candidate comparison

| Candidate | User impact now | Current gap | Independent branch | Verification strength | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| First-run health doctor and repair | Very high | High | Yes | Very high: clean-machine and failure fixtures | **P0 — select** |
| MCP Apps UI contract hardening | High | Medium: an MCP Apps-compatible canvas resource already exists | Yes | High, but host-surface testing is heavier | P1 after doctor |
| Public submission 5-positive/3-negative bundle | Medium-high | High | Yes | Very high | P1; depends on stable first-run behavior |
| Manifest screenshots and starter-prompt polish only | Medium | High but shallow | Yes | High | Fold the setup prompt into doctor; do screenshots separately |
| Remote `.app.json`/public MCP deployment | Potentially high | High | No without deployment/auth decisions | High once authorized | Defer |

The doctor wins because it improves every workflow and produces evidence needed by later App UI and public-submission work. A polished embedded canvas cannot compensate for an unavailable decoder, stale cached plugin, missing current-session DX roles, or a repair command that exists only in the parent monorepo.

## Proposed user experience

### Entry points

The feature should support three entries:

1. First explicit invocation through a plugin starter prompt:

   ```text
   Check my Director X setup and prove the zero-key local video path works.
   ```

2. Automatic routing from any production preflight that discovers an unmet task-profile requirement.
3. Explicit troubleshooting through `$directorx-setup-doctor` or the corresponding intent-level MCP tool.

### Readiness flow

```text
read-only diagnosis
  ↓
task-profile readiness matrix
  ↓
one minimal repair plan
  ↓
native consent when mutation/network/user scope is required
  ↓
repair execution
  ↓
fresh behavioral probes
  ↓
small local smoke preview registered on canvas
  ↓
ready / degraded-but-usable / exact blocker
```

### Task-profile readiness

Do not return one global `ready: false` merely because an optional provider is unavailable. Compile readiness for concrete profiles:

| Profile | Required evidence |
| --- | --- |
| `planning_only` | plugin/MCP identity, supported Node, workspace, native Goal/input, Run persistence |
| `local_video_read` | planning requirements + FFmpeg + FFprobe; yt-dlp only for URL input; Whisper only when captions are absent and transcription is requested |
| `zero_key_edit` | local reading + writable output + FFmpeg filter/encode behavioral probe |
| `local_composition` | zero-key edit + managed Remotion/HyperFrames runtime + browser executable + one-frame render probe |
| `provider_generation` | planning requirements + selected provider adapter + session-only credential presence + network/permission route; do not reveal credential values |
| `full_production` | selected production route's union, DX roles or documented generic-agent fallback, canvas/editor handshake, final audit path |

This prevents an unavailable optional dependency from blocking work that does not need it.

### Status model

Every check should return a stable code and structured evidence:

```json
{
  "checkId": "runtime.ffmpeg.decode",
  "status": "ready",
  "requiredFor": ["local_video_read", "zero_key_edit", "local_composition"],
  "observedVersion": "8.1.2",
  "evidence": "behavioral_probe_passed",
  "repairActionId": null,
  "requiresRestart": false
}
```

Allowed status classes should be explicit:

- `ready`: a current behavioral probe proves the capability;
- `installed_unverified`: files/version exist but behavior was not proven;
- `optional_missing`: current task profile can continue;
- `repairable`: Director X has a bounded repair action;
- `permission_required`: normal Codex or native user consent is required;
- `restart_required`: files are ready but the current Codex session cannot see them;
- `blocked`: no safe automatic repair exists;
- `unsupported`: the current platform/surface is outside the tested contract.

## Diagnosis coverage

### Plugin package and cache

- Resolve the actual installed plugin root from module location; never assume repository CWD.
- Compare manifest version, package base version, MCP server root, and managed-runtime release.
- Detect “marketplace source updated but installed cache is stale” as a restart/upgrade instruction, not a media-runtime failure.
- Verify all manifest paths, skills, metadata, MCP configuration, and required assets from the installed root.
- Confirm plugin-owned mutable paths are outside the installed cache and writable.

### Codex host and current session

- Reuse `detectCodexHostCapabilities()` for native Goal, user input, side Browser, collaboration, execution, and wait surfaces.
- Reuse DX role disk/session checks and distinguish `diskReady` from `sessionReady`.
- State clearly when a new chat or full app restart is the only repair.
- Verify the MCP resource can be listed/read and the canvas claim/heartbeat succeeds.

### Local media dependencies

- Node version satisfies `>=22`.
- FFmpeg and FFprobe are not only on `PATH`; generate, probe, decode, and hash a very short temporary fixture.
- yt-dlp is checked only for remote-video routes; `--version` is sufficient for initial health without an unnecessary network call.
- Managed Remotion, HyperFrames, browser executable, Python, faster-whisper script, and release manifest are checked separately.
- Distinguish installed Whisper code from downloaded model weights; do not claim transcription readiness when the first model download is still unproven.
- Check temporary/project output writeability and enough free space for the chosen bounded smoke test.

### Providers and credentials

- Evaluate only routes selected by the task profile.
- Report credential state as configured/missing/expired-if-verifiable; never return values or secret-bearing environment snapshots.
- Do not probe a paid generation call as part of first-run health unless the user separately approves cost.

## Repair policy

### Safe plugin-owned repairs

The repair engine may perform only bounded, typed actions, such as:

- create missing Director X-owned project directories;
- recreate a corrupt plugin-owned runtime manifest from verified installed components;
- install the pinned Director X managed runtime into the user-scoped Director X directory after native consent;
- install/update only Director X-managed custom agent files after native consent and without overwriting conflicts;
- clear/rebind stale Director X canvas session state without deleting Run artifacts.

### External repairs

System package installation, mutable downloads, authentication, PATH changes, or writes outside plugin/project-owned paths must be returned as explicit host actions with:

- the exact command or action;
- source/domain and version/checksum information when available;
- why it is required for the chosen task profile;
- filesystem/network scope;
- whether restart is required;
- a fresh verification command.

A general request to make a video is not consent to run Homebrew, npm, uv, a remote shell installer, or a user-wide role installer.

### Never auto-repair

- API keys or account creation;
- paid provider calls;
- project media deletion;
- replacement of user-owned agent configuration;
- global shell profile edits;
- broad cache deletion;
- plugin upgrades or app restart without telling the user.

## End-to-end smoke proof

Binary/version checks are insufficient. After required repairs, the selected zero-key profile should optionally create a 2–3 second synthetic, rights-safe diagnostic clip containing:

- a deterministic color/motion pattern;
- a generated local audio tone;
- known duration, frame rate, dimensions, and audio sample rate;
- a decode and FFprobe parity check;
- one preview thumbnail;
- if `local_composition` is selected, a one-frame or minimal Remotion render.

Register the preview as a diagnostic canvas asset and remove temporary intermediates while preserving a compact receipt. The artifact should be visibly labeled “Director X setup test,” never confused with user production output.

Passing means the media was created, decoded, probed, and previewed—not merely that executables were found.

## Exact code boundary

The branch should be constrained to the following responsibilities.

### New modules

- `runtime/plugin-health.mjs`
  - pure probe orchestration;
  - task-profile requirements;
  - stable check/status schema;
  - no mutation.
- `runtime/plugin-repair.mjs`
  - compile typed repair plans;
  - execute only approved Director X-owned actions;
  - require fresh post-repair diagnosis.
- `runtime/plugin-smoke-test.mjs`
  - bounded synthetic local media proof;
  - receipt and cleanup.
- Matching `*.test.mjs` files with injected process/filesystem runners.

### MCP integration

- Add one read-only public intent tool, for example `directorx_diagnose_setup`.
- Add one write tool, for example `directorx_repair_setup`, accepting only a previously issued repair-plan ID and native approval evidence.
- Define input/output schemas through the completed MCP intent-contract layer.
- Add the health summary to preflight without creating a Run or Goal solely for diagnosis.
- Project diagnostic results into Activity/Setup; do not add setup JSON as core storyboard/media nodes.

### Skill and plugin surface

- Add `skills/directorx-setup-doctor/SKILL.md` and `agents/openai.yaml` with the Director X MCP dependency.
- Permit implicit invocation for missing-runtime/setup/error language, but keep repair execution approval-gated.
- Replace one of the three plugin starter prompts with the first-run zero-key verification prompt.
- Add local `doctor` and `install:runtime` scripts to this standalone plugin's `package.json`; commands must not depend on the parent DirectorX workspace.
- Update validation to prove those scripts resolve from a standalone checkout/plugin-cache-shaped fixture.

### Explicit non-goals

- no lifecycle-hook implementation;
- no redesign of the public intent-tool layer;
- no new provider integration;
- no remote MCP deployment or `.app.json` publishing;
- no system package manager abstraction beyond typed suggested host actions;
- no full public-submission bundle;
- no rewrite of canvas/editor UI.

## Acceptance evidence

The feature is complete only when all of the following evidence exists.

### Contract tests

- Stable health result schema and task-profile dependency graph.
- Every failed required check yields one valid next action or an explicit non-repairable blocker.
- Optional missing tools do not block unrelated profiles.
- Repair tools reject invented, expired, cross-project, or already-consumed repair-plan IDs.
- No output contains environment-variable values, credentials, auth headers, or secret-bearing paths.

### Failure matrix

Fixtures must cover at least:

1. clean supported machine;
2. missing FFmpeg/FFprobe;
3. FFmpeg present but behavioral probe fails;
4. missing yt-dlp while reading a local video versus a URL;
5. missing/outdated managed runtime;
6. managed runtime installed but browser executable missing;
7. DX roles installed on disk but unavailable in the current session;
8. stale plugin cache/version mismatch;
9. project output not writable;
10. repair denied by the user;
11. repair succeeds but verification still fails;
12. provider credential absent without leaking secret data.

### Standalone installation proof

- Copy the plugin into a temporary cache-shaped directory with no parent pnpm workspace.
- Run its local doctor and managed-runtime command resolution from that directory.
- Start the stdio MCP server from `.mcp.json` and complete initialize, tools/list, diagnosis, resource list/read, and shutdown.
- Verify paths containing spaces and a non-default `DIRECTORX_MEDIA_RUNTIME_ROOT`.

### Behavioral smoke proof

- Synthetic clip has exact expected frame/audio/duration evidence.
- Preview asset is readable through the canvas resource.
- Temporary files are bounded and cleaned after success and failure.
- Re-running the smoke test is idempotent and does not create a production Run or consume provider budget.

### Manual Codex acceptance

- Fresh plugin install, new task, select setup starter prompt.
- Diagnosis appears before Goal/Intake and does not ask irrelevant production questions.
- One repair approval produces one repair action.
- Restart-required state tells the user exactly why and resumes cleanly in a new task.
- A passing result visibly previews the diagnostic clip and then offers to start a real production.

### Submission-oriented evidence

This branch need not create the complete public submission suite, but should export reusable cases for it:

- positive: clean zero-key setup produces the diagnostic preview;
- positive: missing managed runtime is repaired after consent and then passes;
- negative: repair is declined and no mutation occurs;
- negative: missing system dependency produces a bounded instruction rather than pretending readiness.

## Priority after this branch

1. **P1: `feature/mcp-app-ui-contracts`** — harden CSP/domain/component descriptions, app-only actions, localized UI resource metadata, and no-UI structured fallback.
2. **P1: `feature/plugin-submission-test-suite`** — exact five positive and three negative public-review cases, manifest screenshots, support metadata, privacy matrix, and tool scan snapshot.
3. **P2: `feature/plugin-listing-resources`** — production PNG screenshots, focused listing copy, and starter-prompt outcome evaluation beyond the setup prompt included here.

The first-run doctor should land first because those later features need a stable, reproducible definition of “the installed plugin is ready.”
