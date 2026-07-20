# Director X Privacy Policy

Last updated: July 20, 2026

Director X is an open-source, local-first video production plugin maintained by openmoss. This policy describes how the Director X plugin handles information when installed in Codex or ChatGPT desktop environments.

## Information Director X processes

Director X may process the following information only when needed for a user-requested video workflow:

- Prompts, project briefs, scripts, storyboards, production decisions, and review notes.
- User-provided images, audio, video, documents, and reference links.
- Locally generated production artifacts, including `Director.md`, shot plans, timelines, subtitles, renders, and quality reports.
- Provider and model selections, budget approvals, rights decisions, and production status.
- API credentials entered through the secure Director X canvas credential field.

## Local storage

Director X stores production state and media artifacts locally in the user's selected project directory, normally under `.directorx/`. The plugin does not intentionally upload project files to an openmoss-operated server.

API credentials entered through the Director X secure credential field are injected into the current local process as environment variables. Director X is designed not to write those credential values into project files, durable run records, logs, tool responses, or the plugin repository.

Users control their local project files and may delete Director X artifacts by removing the relevant local project or `.directorx/` run directory.

## Network access and third-party services

Director X may access external services when a user requests or approves an operation that requires them, including:

- Official websites, search results, public-domain libraries, licensed stock libraries, and user-approved reference media sources.
- Image, video, speech, music, transcription, or other media providers selected by the user.
- MOSI Platform services when the user selects a MOSS-TTS route.

Information sent to a third-party provider is governed by that provider's privacy policy and terms. Director X presents provider, model, cost, credential, and rights decisions for user confirmation before material external operations. Users should not submit confidential or personal information to a provider unless they are authorized to do so.

## Reference media and rights records

Downloading a reference for local analysis does not grant reuse rights. Director X records source, authorization, provenance, and rights status and is designed to prevent reference-only media from entering a deliverable without separate reuse authorization.

## Telemetry

Director X does not include an openmoss-operated analytics or advertising service. Local execution evidence may include low-sensitivity technical metadata such as tool name, stage, duration, status, hashes, and error category. It is stored with the local production run unless the user deliberately exports or shares it.

## Data sharing

Openmoss does not sell Director X project data. Data is shared only when the user directs the plugin to use a third-party service, publish or export a deliverable, or otherwise transmit a selected artifact.

## Security

Director X uses scoped tool schemas, project-root path validation, secret filtering, explicit approval gates, rights records, and local evidence logs. No software can guarantee absolute security. Users are responsible for protecting their device, local projects, provider accounts, and API credentials.

## Children's privacy

Director X is a professional production tool and is not directed to children under 13.

## Changes

This policy may be updated as Director X capabilities or submission requirements change. Material changes will be recorded in the repository history and reflected by the date above.

## Contact and support

Questions, privacy requests, and security reports can be submitted through the public project issue tracker:

https://git.sotatts.online/yangqiankun/director-x/-/issues
