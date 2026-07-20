---
name: directorx-avatar-lipsync
description: Plan avatar, talking-head, host, lip-sync, voice, gesture, face consistency, background, and safety workflows for DirectorX videos. Use for AI presenter videos, education hosts, product explainers, and dialogue scenes.
---

# DirectorX Avatar Lipsync

Use this skill for host-led, avatar-led, or lip-sync video production.

## Workflow

1. Define host identity, voice, gesture range, background, and platform tone.
2. Split script into breath-friendly lines and lip-sync segments.
3. Keep mouth visibility, face lighting, and subtitle area stable.
4. Add safety notes for likeness consent and sensitive claims.
5. Route voice, avatar, and video generation through separate provider slots when useful.
6. Review face consistency, audio sync, subtitle sync, and expression fit.

## Output Contract

```json
{
  "avatar_id": "host_01",
  "identity_markers": [],
  "voice_profile": {},
  "segments": [],
  "sync_checks": [],
  "consent_notes": []
}
```

## Reference

Read `references/avatar-lipsync-guide.md` for host and lip-sync QA.
