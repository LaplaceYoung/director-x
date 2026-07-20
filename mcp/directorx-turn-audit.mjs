#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_BOOT_ACTIONS = [
  "directorx_capability_preflight",
  "directorx_get_preflight_status",
  "directorx_resolve_user_interaction",
  "create_goal",
  "directorx_create_run",
  "directorx_bind_goal",
  "request_user_input",
];

export function auditDirectorXTurn(lines) {
  const records = lines.filter(Boolean).map((line) => JSON.parse(line));
  const serialized = records.map((record) => JSON.stringify(record));
  const userRequestedDirectorX = serialized.some((line) => line.includes("plugin://directorx@"));
  const payloads = records.map((record) => record.payload ?? record);
  const callPayloads = records.flatMap((record, recordIndex) =>
    expandCallPayload(record.payload ?? record, {
      recordIndex,
      timestamp: record.timestamp ?? record.payload?.timestamp ?? null
    })
  );
  const actions = REQUIRED_BOOT_ACTIONS.filter((name) =>
    callPayloads.some((payload) => payload.name === name),
  );
  const missingActions = REQUIRED_BOOT_ACTIONS.filter((name) => !actions.includes(name));
  const browserCanvasUrls = [...new Set(payloads.flatMap((payload) => findBrowserCanvasUrls(payload)))];
  const browserCalls = callPayloads.filter((payload) => payload.type === "browser_call");
  const navigationCalls = browserCalls.filter((payload) => payload.action === "navigate");
  const visibilityCalls = browserCalls.filter((payload) => payload.action === "visibility");
  const canvasTargetMatched = navigationCalls.some((payload) =>
    browserCanvasUrls.length
      ? browserCanvasUrls.some((url) => browserCallTargetsUrl(payload, url))
      : browserCallTargetsDirectorXVariable(payload)
  );
  const canvasVisibilityEnabled = navigationCalls.some((payload) => payload.visibility === true)
    || visibilityCalls.some((payload) => payload.visible === true || browserCallSetsVisibility(payload));
  const canvasOpened = navigationCalls.length > 0 && canvasTargetMatched && canvasVisibilityEnabled;
  const canvasHandoffPreserved = callPayloads.some(
    (payload) =>
      payload.type === "browser_call" &&
      payload.action === "finalize" &&
      Array.isArray(payload.keep) &&
      payload.keep.some((item) => item?.status === "handoff"),
  );
  const finalBrowserCall = browserCalls.at(-1) ?? null;
  const canvasHandoffWasFinalBrowserAction = finalBrowserCall?.action === "finalize"
    && finalBrowserCall.keep?.some((item) => item?.status === "handoff");
  const inlineCalls = callPayloads.filter((payload) => payload.name === "directorx_open_inline_canvas");
  const inlineCanvasOpened = inlineCalls.length > 0;
  const browserRuntimeAttempted = callPayloads.some((payload) =>
    payload.type === "browser_runtime_attempt" ||
    payload.type === "browser_call",
  );
  const inlineFallbackAuthorized = inlineCalls.some((payload) => {
    const argumentsText = JSON.stringify(payload.arguments ?? payload.input ?? {});
    return browserRuntimeAttempted && /fallbackReason/.test(argumentsText) && /failureDetail/.test(argumentsText);
  });
  const bootOrder = [
    "directorx_capability_preflight",
    ...(!inlineCanvasOpened ? ["browser:navigate"] : []),
    "directorx_get_preflight_status",
    "request_user_input",
    "directorx_resolve_user_interaction",
    "create_goal",
    "directorx_create_run",
    "directorx_bind_goal"
  ];
  const bootSequence = auditOrderedActions(callPayloads, bootOrder);
  const mcpUnavailable = payloads.some(
    (payload) =>
      (payload?.type === "tool_search_output" &&
        Array.isArray(payload.tools) &&
        payload.tools.length === 0) ||
      (payload?.type === "message" &&
        (JSON.stringify(payload).includes("没有可用的 Director X") ||
          JSON.stringify(payload).includes("no available Director X"))),
  );
  const substitutedPlanningDelivery = serialized.some(
    (line) =>
      line.includes("宣传片前期包") ||
      line.includes("pre-production package") ||
      line.includes("前期方案"),
  );
  const webResearchRecorded = callPayloads.some((payload) => payload.name === "directorx_record_web_research");
  const webSearchObserved = callPayloads.some((payload) => isHostWebAction(payload, "search"));
  const webOpenObserved = callPayloads.some((payload) => isHostWebAction(payload, "open"));
  const parallelPlanTools = new Set(["directorx_plan_production_team", "directorx_plan_parallel_subagents"]);
  const parallelPlanRecorded = callPayloads.some((payload) => parallelPlanTools.has(payload.name));
  const parallelPlanCall = callPayloads.find((payload) => parallelPlanTools.has(payload.name));
  const parallelPlanCallIndex = parallelPlanCall ? callPayloads.indexOf(parallelPlanCall) : -1;
  const plannedTaskCount = parallelPlanTaskCount(parallelPlanCall);
  const spawnCalls = callPayloads.filter((payload, index) => payload.name === "spawn_agent" && index > parallelPlanCallIndex);
  const subagentSpawnCount = spawnCalls.length;
  const subagentSpawnObserved = subagentSpawnCount > 0;
  const registerCalls = callPayloads.filter((payload, index) => payload.name === "directorx_register_subagent" && index > parallelPlanCallIndex);
  const subagentRegistrationCount = registerCalls.length;
  const expectedInitialSpawnCount = parallelPlanRecorded ? parallelPlanInitialWaveSize(parallelPlanCall) : 0;
  const parallelDispatchObserved = parallelPlanRecorded
    ? observedParallelSpawnWave(callPayloads, spawnCalls, expectedInitialSpawnCount)
    : false;
  const subagentRegistrationComplete = parallelPlanRecorded
    ? subagentRegistrationCount >= expectedInitialSpawnCount
    : false;
  const nonCanonicalRegistrations = registerCalls
    .map((payload) => normalizeCallArguments(payload)?.displayName)
    .filter((displayName) => displayName !== undefined && !/^DX-[A-Za-z0-9][A-Za-z0-9-]{1,48}$/.test(displayName));
  const canvasSurfaceReady = canvasOpened || (inlineCanvasOpened && inlineFallbackAuthorized);
  const goalCompletionCalls = callPayloads.filter((payload) => payload.name === "update_goal" && goalUpdateCompletes(payload));
  const goalCompletionPrepared = callPayloads.some((payload) => payload.name === "directorx_prepare_goal_completion");
  const failures = [];
  if (!userRequestedDirectorX) failures.push("no Director X plugin mention found");
  if (missingActions.length) failures.push(`missing boot actions: ${missingActions.join(", ")}`);
  if (!bootSequence.ok) failures.push(`invalid boot action order: ${bootSequence.failures.join("; ")}`);
  if (!canvasSurfaceReady) failures.push("browser canvas was not opened at the exact preflight URL with visibility enabled");
  else if (canvasOpened && !canvasHandoffPreserved) failures.push("browser canvas was not finalized as handoff");
  else if (canvasOpened && !canvasHandoffWasFinalBrowserAction) failures.push("browser canvas handoff was not the final Browser action of the turn");
  if (inlineCanvasOpened && !browserRuntimeAttempted) failures.push("inline canvas fallback was used without an observed Browser runtime attempt");
  else if (inlineCanvasOpened && !inlineFallbackAuthorized) failures.push("inline canvas fallback was used without browser-unavailable evidence");
  if (mcpUnavailable) failures.push("Director X MCP tools were unavailable");
  if (substitutedPlanningDelivery) failures.push("production was downgraded to a planning deliverable");
  if (webResearchRecorded && (!webSearchObserved || !webOpenObserved)) failures.push("web research was recorded without observed host search and source-open actions");
  if (parallelPlanRecorded && subagentSpawnCount < expectedInitialSpawnCount) failures.push(`parallel DX plan expected at least ${expectedInitialSpawnCount} spawn_agent calls but observed ${subagentSpawnCount}`);
  if (parallelPlanRecorded && !parallelDispatchObserved) failures.push("parallel DX plan was not dispatched as one concurrent host wave before waiting");
  if (parallelPlanRecorded && !subagentRegistrationComplete) failures.push(`parallel DX host wave expected at least ${expectedInitialSpawnCount} directorx_register_subagent calls but observed ${subagentRegistrationCount}`);
  if (nonCanonicalRegistrations.length) failures.push(`Director X subagent registrations used non-canonical identities: ${nonCanonicalRegistrations.join(", ")}`);
  if (goalCompletionCalls.length && !goalCompletionPrepared) failures.push("Codex Goal was completed without directorx_prepare_goal_completion");
  return {
    ok: failures.length === 0,
    actions,
    bootSequence,
    browserCanvasUrls,
    canvasOpened,
    canvasTargetMatched,
    canvasVisibilityEnabled,
    canvasHandoffPreserved,
    canvasHandoffWasFinalBrowserAction,
    canvasSurfaceReady,
    inlineCanvasOpened,
    browserRuntimeAttempted,
    inlineFallbackAuthorized,
    mcpUnavailable,
    webResearchRecorded,
    webSearchObserved,
    webOpenObserved,
    parallelPlanRecorded,
    plannedTaskCount,
    expectedInitialSpawnCount,
    subagentSpawnObserved,
    subagentSpawnCount,
    parallelDispatchObserved,
    subagentRegistrationCount,
    subagentRegistrationComplete,
    nonCanonicalRegistrations,
    goalCompletionPrepared,
    failures
  };
}

function expandCallPayload(payload, metadata = {}) {
  if (!["function_call", "custom_tool_call", "browser_call"].includes(payload?.type)) return [];
  const base = { ...payload, ...metadata };
  const expanded = [base];
  if (payload.type !== "custom_tool_call" || payload.name !== "exec") return expanded;
  const source = String(payload.input ?? payload.arguments ?? "");
  for (const match of source.matchAll(/mcp__directorx_production__(directorx_[A-Za-z0-9_]+)/g)) {
    expanded.push({ type: "function_call", name: match[1], input: source, nestedInExec: true, ...metadata });
  }
  for (const name of ["create_goal", "request_user_input", "update_goal", "wait_agent", "close_agent"]) {
    for (const match of source.matchAll(new RegExp(`tools\\.${name}\\s*\\(`, "g"))) {
      expanded.push({ type: "function_call", name, input: source, sourceOffset: match.index, nestedInExec: true, ...metadata });
    }
  }
  const spawnMatches = [...source.matchAll(/tools\.spawn_agent\s*\(/g)];
  for (const match of spawnMatches) {
    expanded.push({
      type: "function_call",
      name: "spawn_agent",
      input: source,
      sourceOffset: match.index,
      nestedInExec: true,
      concurrentExecBatch: spawnMatches.length > 1 && /Promise\.all\s*\(/.test(source),
      ...metadata
    });
  }
  if (/browser-client\.mjs|setupBrowserRuntime\s*\(|agent\.browsers\.get\s*\(|iab\.documentation\s*\(/.test(source)) {
    expanded.push({ type: "browser_runtime_attempt", input: source, ...metadata });
  }
  if (/\.goto\s*\(/.test(source)) expanded.push({ type: "browser_call", action: "navigate", input: source, ...metadata });
  if (/capabilities\.get\([\"']visibility[\"']\)[\s\S]*\.set\(true\)/.test(source)) expanded.push({ type: "browser_call", action: "visibility", input: source, visible: true, ...metadata });
  if (/tabs\.finalize\s*\(/.test(source)) {
    expanded.push({ type: "browser_call", action: "finalize", input: source, keep: /status\s*:\s*[\"']handoff[\"']/.test(source) ? [{ status: "handoff" }] : [], ...metadata });
  }
  return expanded;
}

function auditOrderedActions(callPayloads, expected) {
  let cursor = -1;
  const failures = [];
  const indices = {};
  for (const action of expected) {
    const index = callPayloads.findIndex((payload, candidateIndex) =>
      candidateIndex > cursor && payloadMatchesOrderedAction(payload, action)
    );
    indices[action] = index;
    if (index < 0) failures.push(`${action} did not occur after ${expected[Math.max(0, expected.indexOf(action) - 1)]}`);
    else cursor = index;
  }
  const firstDirectorXCall = callPayloads.findIndex((payload) => String(payload.name ?? "").startsWith("directorx_"));
  const preflightIndex = callPayloads.findIndex((payload) => payload.name === "directorx_capability_preflight");
  if (firstDirectorXCall >= 0 && firstDirectorXCall !== preflightIndex) failures.push("directorx_capability_preflight was not the first Director X action");
  return { ok: failures.length === 0, expected, indices, failures };
}

function payloadMatchesOrderedAction(payload, action) {
  if (action === "browser:navigate") return payload.type === "browser_call" && payload.action === "navigate";
  return payload.name === action;
}

function findBrowserCanvasUrls(value, seen = new Set()) {
  if (value === null || value === undefined || seen.has(value)) return [];
  if (typeof value === "string") return [];
  if (typeof value !== "object") return [];
  seen.add(value);
  const urls = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "browserCanvasUrl" && typeof child === "string") urls.push(child);
    else urls.push(...findBrowserCanvasUrls(child, seen));
  }
  return urls;
}

function browserCallTargetsUrl(payload, url) {
  const target = payload.url ?? payload.arguments?.url ?? payload.input?.url;
  if (typeof target === "string" && target === url) return true;
  return String(payload.input ?? payload.arguments ?? "").includes(url);
}

function browserCallTargetsDirectorXVariable(payload) {
  const source = String(payload.input ?? payload.arguments ?? "");
  const target = String(payload.url ?? payload.arguments?.url ?? "");
  return /browserCanvasUrl|canvasHostAction\.url/.test(source) || /\/directorx\/canvas/.test(target);
}

function browserCallSetsVisibility(payload) {
  return /capabilities\.get\([\"']visibility[\"']\)[\s\S]*\.set\(true\)/.test(String(payload.input ?? ""));
}

function parallelPlanTaskCount(payload) {
  const args = normalizeCallArguments(payload);
  return Array.isArray(args?.tasks) ? args.tasks.length : null;
}

function parallelPlanInitialWaveSize(payload) {
  const args = normalizeCallArguments(payload);
  if (!Array.isArray(args?.tasks) || args.tasks.length < 2) return 2;
  const stageOrder = ["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"];
  const dependencyFree = args.tasks.filter((task) => !Array.isArray(task.dependsOnTaskIds) || task.dependsOnTaskIds.length === 0);
  if (dependencyFree.length < 2) return 2;
  const earliestStageIndex = Math.min(...dependencyFree.map((task) => stageOrder.indexOf(task.stage)));
  const earliest = dependencyFree.filter((task) => stageOrder.indexOf(task.stage) === earliestStageIndex);
  const hostLimit = Number.isInteger(args.hostConcurrencyLimit) ? args.hostConcurrencyLimit : earliest.length;
  return Math.max(2, Math.min(earliest.length, hostLimit));
}

function normalizeCallArguments(payload) {
  const raw = payload?.arguments ?? payload?.args ?? payload?.input;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}

function observedParallelSpawnWave(callPayloads, spawnCalls, expectedCount) {
  if (spawnCalls.length < expectedCount) return false;
  if (spawnCalls.some((payload) => payload.concurrentExecBatch)) return true;
  const firstWaitIndex = callPayloads.findIndex((payload) => payload.name === "wait_agent");
  const spawnBeforeWait = spawnCalls.filter((payload) => firstWaitIndex < 0 || callPayloads.indexOf(payload) < firstWaitIndex);
  if (spawnBeforeWait.length < expectedCount) return false;
  const timestamps = new Set(spawnBeforeWait.slice(0, expectedCount).map((payload) => payload.timestamp).filter(Boolean));
  const recordIndices = new Set(spawnBeforeWait.slice(0, expectedCount).map((payload) => payload.recordIndex));
  return timestamps.size === 1 || recordIndices.size === 1;
}

function goalUpdateCompletes(payload) {
  const args = normalizeCallArguments(payload);
  if (args?.status === "complete") return true;
  return /status\s*:\s*[\"']complete[\"']|\"status\"\s*:\s*\"complete\"/.test(String(payload.input ?? payload.arguments ?? ""));
}

function isHostWebAction(payload, action) {
  if (payload?.name === `web.${action}` || payload?.name === `web_${action}` || payload?.name === `web__${action}`) return true;
  if (payload?.type === "browser_call" && payload?.action === action) return true;
  if (!["web__run", "web.run", "web_run"].includes(payload?.name)) return false;
  const argumentsText = JSON.stringify(payload.arguments ?? payload.input ?? payload.args ?? {});
  return action === "search" ? /"(search_query|image_query)"/.test(argumentsText) : /"open"/.test(argumentsText);
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: directorx-turn-audit.mjs <rollout.jsonl>");
  const result = auditDirectorXTurn((await readFile(path, "utf8")).split(/\r?\n/));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
