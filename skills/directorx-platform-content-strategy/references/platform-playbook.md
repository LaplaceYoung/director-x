# Platform Playbook

## Universal Short-Video Rules

- First 1-3 seconds: show outcome, conflict, surprising claim, visual transformation, or direct user pain.
- First frame must communicate category, result, conflict, or subject before motion starts.
- Every 3-5 seconds: introduce a new visual beat, subtitle emphasis, question, example, object, chart, cutaway, or sound cue.
- Script structure: hook -> context -> escalation/proof -> payoff -> interaction.
- Subtitles: short lines, high contrast, key terms highlighted, synchronized with voice, no long paragraph cards.
- Cover/title: one concrete promise, one clear subject, one visual proof.
- Interaction: ask for a concrete comment, save, comparison, next topic, or user case.
- Compliance: avoid misleading claims, fake official identity, off-platform transaction prompts, bait without payoff, low originality, and repeated visual templates.

## Douyin

- Best fit: fast emotional hook, useful knowledge, product reveal, comparison, story reversal.
- Pacing: 15-30s is a strong default for commercial or high-density topics; 30-60s needs dense beats; 60-90s needs chapter-like turns.
- Script: `痛点/反差 -> 一句话结论 -> 3 个证据或步骤 -> 结果画面 -> 评论问题`.
- Visual: vertical 9:16, large readable subtitles, quick object/diagram changes, early payoff preview.
- Prompt cue: include `douyin_hook`, `retention_turns`, `comment_prompt`, `save_reason`, `platform_compliance`.

## Kuaishou

- Best fit: practical, relatable, local-life, trust-based explanation, behind-the-scenes.
- Pacing: allow slightly more conversational rhythm while keeping clear beat changes.
- Script: `真实场景 -> 问题 -> 操作/经历 -> 结果 -> 朴素建议`.
- Visual: creator presence, grounded examples, less polished stiffness, visible process.

## Bilibili

- Best fit: deeper education, tech, ACG, reviews, analysis, longer narrative.
- Pacing: 60-180s can support setup and explanation; still needs early thesis.
- Script: `2 秒结果/问题 -> 背景 -> 机制拆解 -> 案例 -> 总结/延伸`.
- Visual: diagrams, references, chapter markers, terminology accuracy.
- Cover/title: clear subject; title should keep the key idea front-loaded and concise.

## Xiaohongshu

- Best fit: lifestyle, product experience, checklist, personal method, aesthetic comparison.
- Pacing: clean visual proof, practical detail, saved-value.
- Script: `结果图/痛点 -> 我的方法 -> 清单/步骤 -> 避坑 -> 收藏理由`.
- Visual: cover must be inspectable; subtitles and labels support scanning.

## TikTok / Shorts / Reels

- Best fit: immediate curiosity, repeatable format, strong audio rhythm, visual transformation.
- Pacing: first second matters; loop ending can improve replay.
- Script: `pattern interrupt -> fast proof -> twist/payoff -> loop/CTA`.
- Visual: bold subject motion, clear face/object/diagram, beat-matched edits.
- Shorts: tutorials or mini lessons can extend longer when the structure has chapter hooks; related-video handoff can support series or long-form continuation.
- Reels: watch/save/share/comment signals matter; design portable, shareable visual moments.

## Duration Bands

| Duration | Structure | Required checks |
| --- | --- | --- |
| 0-7s | single punch | one action, result, joke, or contrast; first frame is the topic; ending can loop |
| 8-15s | hook -> proof -> punch | 0-2s promise; 3-10s demo; last 2s result or question |
| 16-30s | hook -> setup -> proof -> close | default for commercial, tips, lifestyle, comparison |
| 31-60s | hook -> 3 beats -> payoff | three steps, reversals, or proofs; one mid-video visual refresh |
| 61-180s | mini lesson/story | chapter hook every 15-20s; series or long-form handoff |

## Content Type Rules

| Type | Structure |
| --- | --- |
| Tutorial / knowledge | misconception or result hook -> 3 steps -> example -> save reason |
| Product / seeding | real pain scene -> product action -> visible proof -> objection handling -> CTA |
| Review / comparison | conclusion first -> criteria -> A/B evidence -> suitable audience -> comment prompt |
| Vlog / lifestyle | goal or mood -> 3 scene fragments -> small conflict -> emotional landing |
| Comedy / story | setup -> misunderstanding/escalation -> reversal -> rewatch detail |
| Dance / music | signature pose -> beat drop -> action variation -> ending pose |
| Comment response | quoted comment -> test/answer -> result -> next question |

## Script Templates

### Explainer 60s

```text
0-3s: surprising claim or visual analogy
3-8s: define the problem in one sentence
8-20s: mechanism step 1 with concrete visual
20-35s: mechanism step 2 with analogy or example
35-48s: common misconception or contrast
48-56s: payoff summary
56-60s: save/comment prompt
```

### Product 45s

```text
0-2s: end result or before/after
2-8s: user pain
8-18s: product mechanism
18-30s: proof scene or demo
30-40s: trust/detail/limitation
40-45s: action prompt
```

### Story 75s

```text
0-4s: conflict image
4-15s: character and stakes
15-35s: attempt and obstacle
35-55s: reversal
55-70s: consequence
70-75s: emotional landing
```

## Source Anchors

- TikTok creative codes and top-performing ad practices: https://ads.tiktok.com/business/en-US/creative-codes, https://ads.tiktok.com/business/en-US/blog/creative-best-practices-top-performing-ads
- YouTube Shorts creator and support references: https://www.youtube.com/creators/shorts/, https://support.google.com/youtube/answer/10059070, https://support.google.com/youtube/answer/15424877, https://support.google.com/youtube/answer/12340300
- Bilibili creator manual reference: https://activity.hdslb.com/blackboard/static/20200918/ef5f6c1c85ed27c2411e1699a29eb4c8/8xKORHy30n.pdf
- Douyin, Kuaishou, and Xiaohongshu creator references: https://creator.douyin.com/, https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/operation/platform-capabilities/video/video-creator-promote-mount-mgmt-spec, https://www.oceanengine.com/faq/dyggsprhz.html, https://cp.kuaishou.com/, https://creator.xiaohongshu.com/
- Instagram creator and ranking references: https://creators.instagram.com/reels, https://creators.instagram.com/create-engaging-content, https://about.instagram.com/blog/announcements/instagram-ranking-explained
- Market and research references: https://www.questmobile.com.cn/research/report/2000767092954075138/, https://www.news.cn/fortune/20260415/5c3fa1ad75244d4ba9e7372646c11d74/c.html, https://arxiv.org/abs/2403.00454, https://arxiv.org/abs/2508.05633
