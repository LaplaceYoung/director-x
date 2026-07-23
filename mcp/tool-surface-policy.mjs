export const DIRECTORX_PUBLIC_FACADE_NAMES = Object.freeze([
  "directorx_start_production",
  "directorx_resume_production",
  "directorx_get_production_status",
  "directorx_decide_production",
  "directorx_prepare_production",
  "directorx_research_video",
  "directorx_generate_media",
  "directorx_review_media_candidate",
  "directorx_build_rough_cut",
  "directorx_recover_production"
]);

// These are intentionally not exposed until they are implemented end-to-end.
// Keeping a roadmap separate from the registry prevents a model from being
// directed to a façade that tools/list cannot actually return.
export const DIRECTORX_PLANNED_FACADE_NAMES = Object.freeze([
  "directorx_design_video",
  "directorx_dispatch_production_team",
  "directorx_edit_video",
  "directorx_render_video",
  "directorx_audit_final_video",
  "directorx_repair_video",
  "directorx_finalize_production"
]);

export const LEGACY_TOOL_SURFACE_BUDGET = Object.freeze({
  total: 177,
  writeVisible: 150,
  legacyLooseContracts: 175,
  descriptorBytes: 270_000
});

export function auditToolSurface(definitions) {
  const tools = Array.isArray(definitions) ? definitions : [];
  const facadeNames = new Set(DIRECTORX_PUBLIC_FACADE_NAMES);
  return {
    total: tools.length,
    writeVisible: tools.filter((tool) => tool.annotations?.readOnlyHint !== true && tool._meta?.ui?.visibility?.includes("model") !== false).length,
    legacyLooseContracts: tools.filter((tool) => tool._meta?.["directorx/legacyLooseContract"] === true).length,
    appOnly: tools.filter((tool) => Array.isArray(tool._meta?.ui?.visibility) && tool._meta.ui.visibility.includes("app") && !tool._meta.ui.visibility.includes("model")).length,
    publicFacades: tools.filter((tool) => facadeNames.has(tool.name)).length,
    descriptorBytes: Buffer.byteLength(JSON.stringify(tools))
  };
}

export function assertLegacyToolSurfaceBudget(definitions, budget = LEGACY_TOOL_SURFACE_BUDGET) {
  const audit = auditToolSurface(definitions);
  const effectiveBudget = {
    ...budget,
    total: budget.total + audit.publicFacades,
    writeVisible: budget.writeVisible + audit.publicFacades,
    descriptorBytes: budget.descriptorBytes + (audit.publicFacades * 4_000)
  };
  const exceeded = Object.entries(effectiveBudget).filter(([key, limit]) => audit[key] > limit);
  if (exceeded.length) {
    throw new Error(`Director X legacy MCP tool surface grew beyond its migration budget: ${exceeded.map(([key, limit]) => `${key}=${audit[key]} > ${limit}`).join(", ")}. Add or deepen an intent Facade instead of exposing another low-level tool.`);
  }
  return audit;
}
