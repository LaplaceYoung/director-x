# Prompt repair loop

Review the generated candidate against evidence. Pick one primary defect:

- prompt ambiguity
- identity or geometry drift
- reference conflict
- composition
- lighting or color
- motion or physics
- action overload
- start/end boundary mismatch
- text or UI
- audio ownership or sync
- unsupported provider capability
- provider parameter or rejection

Preserve every dimension that already works. Change one variable:

- clarify one action
- reduce camera complexity
- replace camera movement with subject movement
- remove a conflicting reference
- add one missing reference
- split one overloaded shot
- simplify the composition
- correct one provider parameter
- reroute only after the simpler repair fails

Stop retrying when:

- the defect is outside the provider's documented capability
- the next attempt would repeat the same prompt
- identity or rights risk cannot be resolved
- the user must choose between meaningful tradeoffs

Report:

```text
Primary defect:
Evidence:
Preserve:
Single change:
Expected improvement:
Fallback:
```
