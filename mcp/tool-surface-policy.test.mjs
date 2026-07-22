import assert from "node:assert/strict";
import test from "node:test";
import { auditToolSurface, assertLegacyToolSurfaceBudget, DIRECTORX_PUBLIC_FACADE_NAMES } from "./tool-surface-policy.mjs";

const tool = (name, { readOnly = false, legacy = true, visibility } = {}) => ({
  name,
  annotations: { readOnlyHint: readOnly },
  _meta: { "directorx/legacyLooseContract": legacy, ...(visibility ? { ui: { visibility } } : {}) }
});

test("audits facade, legacy, write, app-only, and descriptor budgets independently", () => {
  const definitions = [
    tool(DIRECTORX_PUBLIC_FACADE_NAMES[0], { readOnly: false, legacy: false, visibility: ["model", "app"] }),
    tool("directorx_private_read", { readOnly: true }),
    tool("directorx_canvas_action", { visibility: ["app"] })
  ];
  const audit = auditToolSurface(definitions);
  assert.equal(audit.total, 3);
  assert.equal(audit.publicFacades, 1);
  assert.equal(audit.legacyLooseContracts, 2);
  assert.equal(audit.writeVisible, 1);
  assert.equal(audit.appOnly, 1);
});

test("fails closed when any legacy migration budget grows", () => {
  const definitions = [tool("directorx_one"), tool("directorx_two")];
  assert.throws(() => assertLegacyToolSurfaceBudget(definitions, { total: 1, writeVisible: 2, legacyLooseContracts: 2, descriptorBytes: 10_000 }), /total=2 > 1/);
  assert.doesNotThrow(() => assertLegacyToolSurfaceBudget(definitions, { total: 2, writeVisible: 2, legacyLooseContracts: 2, descriptorBytes: 10_000 }));
});
