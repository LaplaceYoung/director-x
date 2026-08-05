# Codex native questioning

Director X uses Codex's native `request_user_input`. It does not create a custom questionnaire, chat protocol, approval engine, or canvas interaction for user decisions.

This questioning style is adapted for video production from Matt Pocock's Grilling Skill:

`https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md`

## Core behavior

1. Ask one question at a time. Wait for the answer before choosing the next branch.
2. Ask only about a decision that materially changes the video, production route, cost, rights, or delivery.
3. Look up discoverable facts in the project, source material, codebase, or official documentation instead of asking the user.
4. Leave creative, commercial, rights, and risk decisions to the user.
5. Put the recommended answer first and explain its concrete tradeoff.
6. Resolve dependencies in order. Do not ask about a downstream model before the user has chosen the production route that requires it.
7. Preserve confirmed answers and never ask the same question again unless new evidence creates a real conflict.
8. Do not execute a disputed creative direction, paid provider call, download, or final render until the relevant decision is understood.
9. Once the current stage has enough shared understanding, stop interviewing and continue production in the same Codex task.

Relentless means continuing until material ambiguity is gone. It does not mean asking every imaginable question.

## Native question shape

Each `request_user_input` call should normally contain exactly one question:

- `header`: a short production decision, no more than 12 characters when practical.
- `question`: one direct sentence about the unresolved choice.
- `options`: two or three mutually exclusive choices.
- first option: the recommended answer, labelled `(Recommended)` or `(推荐)`.
- option description: one sentence describing the visible result, cost, or tradeoff.
- free-form answer: leave available for a custom direction.

Do not combine unrelated decisions such as audience, duration, visual style, and provider access in one call.

## Decision tree

Walk only the branches required by the user's request, in this dependency order:

1. **Outcome** — what must be delivered and what response it should create.
2. **Audience and surface** — who watches it and where.
3. **Source and rights** — which song, footage, likeness, brand, or reference may be downloaded or reused.
4. **Reference transfer** — which principles to carry over and which protected expression to avoid copying.
5. **Creative direction** — narrative angle, emotional tone, visual system, and must-keep elements.
6. **Production route** — supplied assets, generative media, Remotion, or a deliberate hybrid.
7. **Generation access** — provider and model only when a confirmed shot actually needs generation.
8. **Delivery constraint** — aspect ratio, duration, deadline, language, captions, and review/final quality.

Skip a branch when the user already answered it or when it cannot change the next action.

## Stage gates

Use just-in-time clarification instead of one long intake interview.

### Before acquiring source media

Confirm the exact source and whether the user is authorized to download or reuse it. Research metadata yourself.

### Before locking the concept

Confirm the primary creative direction after reference analysis or early research. Recommend the direction best supported by the evidence.

### Before generation or paid external calls

Confirm the production route, selected provider/model, expected cost or quota impact when known, and permission to submit. Never ask the user to paste an API key into chat.

### Before final render

Show a playable preview and ask for the single highest-impact unresolved review decision. Do not ask the user to approve details they can already see and did not object to.

## Example questions

### Creative direction

- Header: `视觉方向`
- Question: `参考片分析完成后，你希望我们优先迁移哪种视觉原则？`
- Recommended: `克制的电影感（推荐）` — preserves the reference's lighting and pacing without copying its branded expression.
- Alternative: `高密度科技感` — increases typography, UI overlays, and edit frequency.
- Alternative: `人物情绪优先` — gives performance and close-ups more screen time.

### Production route

- Header: `制作路线`
- Question: `这些镜头应优先使用生成模型还是现有素材与 Remotion？`
- Recommended: `生成与合成混合（推荐）` — uses generation only where new imagery is necessary and keeps titles, timing, and assembly deterministic.
- Alternative: `主要使用生成模型` — offers greater visual freedom with higher cost and continuity risk.
- Alternative: `仅素材与 Remotion` — is faster and controllable but cannot create missing live-action scenes.

### Provider access

- Header: `生成模型`
- Question: `这个身份一致性镜头使用哪条已核验模型路线？`
- Recommended: the highest-ranked suitable route with its exact reason.
- Alternatives: up to two viable routes with their tradeoffs.

Ask about key availability only after the user selects a route. If no key is available, create the generation placeholder and continue with the rest of production.

## Shared-understanding checkpoint

Before the first expensive, irreversible, or creatively locking action, summarize only the confirmed decisions in a few lines and ask one final native question:

`按以上方向进入下一制作阶段吗？`

Recommend continuing when there is no unresolved material conflict. If the user confirms, act immediately; do not end the task with another plan.
