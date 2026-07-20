import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRenderPropsBindTransitionExecution,
  compileTransitionExecutionContract,
  createTransitionExecutionRenderBinding,
  preserveTransitionExecutionRenderEvidence
} from "./transition-execution-contract.mjs";

function dissolveInput(overrides = {}) {
  return {
    renderer: "remotion",
    durationSeconds: 10,
    required: true,
    visualClips: [
      { clipId: "clip-a", kind: "video", startSeconds: 0, endSeconds: 5.5 },
      { clipId: "clip-b", kind: "video", startSeconds: 5, endSeconds: 10 }
    ],
    transitions: [{
      fromClipId: "clip-a",
      toClipId: "clip-b",
      transitionBoundaryId: "S01->S02",
      directorMethod: "cross_dissolve",
      cutTrigger: "semantic_overlap",
      easing: "linear",
      kind: "crossfade",
      durationSeconds: 0.5,
      outgoingHandleSeconds: 0.5,
      incomingHandleSeconds: 0.5,
      audioBridge: { kind: "room_tone", overlapSeconds: 0.4 }
    }],
    transitionLanguagePlan: {
      planId: "transitions:demo",
      sequenceId: "sequence:demo",
      renderer: "remotion",
      fps: 30,
      status: "ready",
      shotOrder: ["S01", "S02"],
      boundaries: [{
        boundaryId: "S01->S02",
        fromShotId: "S01",
        toShotId: "S02",
        directorMethod: "cross_dissolve",
        renderKind: "crossfade",
        cutTrigger: "semantic_overlap",
        easing: "linear",
        rationale: "soft semantic migration",
        durationSeconds: 0.5,
        durationFrames: 15,
        actionOverlapSeconds: 0,
        audioBridge: { kind: "room_tone", overlapSeconds: 0.4 },
        boundaryFrames: { outgoingRequired: false, incomingRequired: false, bridgeFrameRequired: false },
        rendererRecipe: { engine: "remotion", operation: "crossfade", transition: "crossfade" },
        reviewCriteria: ["no double subject"]
      }]
    },
    ...overrides
  };
}

test("compiles exact visual overlap, handles, audio bridge, and Remotion instruction", () => {
  const contract = compileTransitionExecutionContract(dissolveInput());
  assert.equal(contract.status, "ready");
  assert.equal(contract.expectedBoundaryCount, 1);
  assert.equal(contract.boundBoundaryCount, 1);
  assert.match(contract.contractFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(contract.boundaries[0].observedTimelineOverlapSeconds, 0.5);
  assert.equal(contract.boundaries[0].rendererInstruction.component, "TransitionSeries.Transition");
  assert.equal(contract.boundaries[0].rendererInstruction.shortensTimelineByFrames, 15);
  assert.equal(contract.boundaries[0].rendererInstruction.audio.overlapFrames, 12);
  assert.match(contract.renderBinding.runtimeFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(contract.renderBinding.boundaryIds, ["S01->S02"]);
});

test("blocks timeline overlap drift and missing video handles", () => {
  const input = dissolveInput({
    visualClips: [
      { clipId: "clip-a", kind: "video", startSeconds: 0, endSeconds: 5.2 },
      { clipId: "clip-b", kind: "video", startSeconds: 5, endSeconds: 10 }
    ],
    transitions: [{
      ...dissolveInput().transitions[0],
      outgoingHandleSeconds: 0.1,
      incomingHandleSeconds: 0.1
    }]
  });
  const contract = compileTransitionExecutionContract(input);
  assert.equal(contract.status, "blocked");
  assert.ok(contract.blockers.some((item) => item.includes("timeline_overlap:0.5!=0.2")));
  assert.ok(contract.blockers.some((item) => item.includes("outgoing_handle:0.1<0.5")));
  assert.ok(contract.blockers.some((item) => item.includes("incoming_handle:0.1<0.5")));
});

test("blocks match action without boundary frames, source handles, or the planned L-cut", () => {
  const input = dissolveInput({
    visualClips: [
      { clipId: "clip-a", kind: "video", startSeconds: 0, endSeconds: 5 },
      { clipId: "clip-b", kind: "video", startSeconds: 5, endSeconds: 10 }
    ],
    transitions: [{
      fromClipId: "clip-a",
      toClipId: "clip-b",
      transitionBoundaryId: "S01->S02",
      directorMethod: "match_action",
      cutTrigger: "action_midpoint",
      easing: "linear",
      kind: "match_cut",
      durationSeconds: 0
    }],
    transitionLanguagePlan: {
      ...dissolveInput().transitionLanguagePlan,
      boundaries: [{
        boundaryId: "S01->S02",
        fromShotId: "S01",
        toShotId: "S02",
        directorMethod: "match_action",
        renderKind: "match_cut",
        cutTrigger: "action_midpoint",
        easing: "linear",
        rationale: "continue the same action at its midpoint",
        durationSeconds: 0,
        durationFrames: 0,
        actionOverlapSeconds: 0.2,
        audioBridge: { kind: "l_cut", tailSeconds: 0.35 },
        boundaryFrames: { outgoingRequired: true, incomingRequired: true, bridgeFrameRequired: false },
        rendererRecipe: { engine: "remotion", operation: "match_cut", transition: "match_cut" },
        reviewCriteria: ["action continues without restart"]
      }]
    }
  });
  const contract = compileTransitionExecutionContract(input);
  assert.equal(contract.status, "blocked");
  assert.ok(contract.blockers.some((item) => item.includes("outgoing_handle:0<0.2")));
  assert.ok(contract.blockers.some((item) => item.includes("incoming_boundary_frame_missing")));
  assert.ok(contract.blockers.some((item) => item.includes("audio_bridge_kind:l_cut!=none")));
});

test("accepts a match action only when the continuation evidence is executable", () => {
  const blocked = dissolveInput({
    visualClips: [
      { clipId: "clip-a", kind: "video", startSeconds: 0, endSeconds: 5 },
      { clipId: "clip-b", kind: "video", startSeconds: 5, endSeconds: 10 }
    ]
  });
  blocked.transitionLanguagePlan.boundaries[0] = {
    boundaryId: "S01->S02",
    fromShotId: "S01",
    toShotId: "S02",
    directorMethod: "match_action",
    renderKind: "match_cut",
    cutTrigger: "action_midpoint",
    easing: "linear",
    rationale: "continue the same action at its midpoint",
    durationSeconds: 0,
    durationFrames: 0,
    actionOverlapSeconds: 0.2,
    audioBridge: { kind: "l_cut", tailSeconds: 0.35 },
    boundaryFrames: { outgoingRequired: true, incomingRequired: true, bridgeFrameRequired: false },
    rendererRecipe: { engine: "remotion", operation: "match_cut", transition: "match_cut" },
    reviewCriteria: ["action continues without restart"]
  };
  blocked.transitions = [{
    fromClipId: "clip-a",
    toClipId: "clip-b",
    transitionBoundaryId: "S01->S02",
    directorMethod: "match_action",
    cutTrigger: "action_midpoint",
    easing: "linear",
    kind: "match_cut",
    durationSeconds: 0,
    outgoingHandleSeconds: 0.2,
    incomingHandleSeconds: 0.2,
    outgoingFrameRef: "frames/S01-last.png",
    incomingFrameRef: "frames/S02-first.png",
    audioBridge: { kind: "l_cut", tailSeconds: 0.35 }
  }];
  const contract = compileTransitionExecutionContract(blocked);
  assert.equal(contract.status, "ready");
  assert.equal(contract.boundaries[0].rendererInstruction.audio.tailFrames, 11);
});

test("requires render props to bind the current transition fingerprint and order", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-transition-props-"));
  const transitionExecution = compileTransitionExecutionContract(dissolveInput());
  const propsPath = join(projectPath, "render-props.json");
  await writeFile(propsPath, JSON.stringify({
    directorxRuntime: { runtimeId: "directorx-remotion-runtime-v1", compositionId: "DirectorXTimeline" },
    directorxTransitionExecution: createTransitionExecutionRenderBinding(transitionExecution),
    directorxAudioTracks: [{ boundaryId: "S01->S02", bridgeKind: "room_tone", fromFrame: 151, durationInFrames: 12, src: "room-tone.wav" }]
  }));
  const evidence = await assertRenderPropsBindTransitionExecution(
    { renderQualityContract: { transitionExecution } },
    { projectPath, propsPath, compositionId: "DirectorXTimeline" }
  );
  assert.equal(evidence.renderPropsBinding, "passed");
  assert.match(evidence.propsSha256, /^[a-f0-9]{64}$/);

  await writeFile(propsPath, JSON.stringify({
    directorxTransitionExecution: {
      ...createTransitionExecutionRenderBinding(transitionExecution),
      contractFingerprint: "0".repeat(64)
    },
    directorxRuntime: { runtimeId: "directorx-remotion-runtime-v1", compositionId: "DirectorXTimeline" },
    directorxAudioTracks: [{ boundaryId: "S01->S02", bridgeKind: "room_tone", fromFrame: 151, durationInFrames: 12, src: "room-tone.wav" }]
  }));
  await assert.rejects(
    assertRenderPropsBindTransitionExecution(
      { renderQualityContract: { transitionExecution } },
      { projectPath, propsPath, compositionId: "DirectorXTimeline" }
    ),
    /fingerprint/
  );

  const drifted = createTransitionExecutionRenderBinding(transitionExecution);
  drifted.boundaries[0].durationFrames = 12;
  await writeFile(propsPath, JSON.stringify({ directorxRuntime: { runtimeId: "directorx-remotion-runtime-v1", compositionId: "DirectorXTimeline" }, directorxTransitionExecution: drifted, directorxAudioTracks: [{ boundaryId: "S01->S02", bridgeKind: "room_tone", fromFrame: 151, durationInFrames: 12, src: "room-tone.wav" }] }));
  await assert.rejects(
    assertRenderPropsBindTransitionExecution(
      { renderQualityContract: { transitionExecution } },
      { projectPath, propsPath, compositionId: "DirectorXTimeline" }
    ),
    /instructions drifted/
  );

  await writeFile(propsPath, JSON.stringify({
    directorxRuntime: { runtimeId: "directorx-remotion-runtime-v1", compositionId: "DirectorXTimeline" },
    directorxTransitionExecution: createTransitionExecutionRenderBinding(transitionExecution),
    directorxAudioTracks: [{ boundaryId: "S01->S02", bridgeKind: "room_tone", fromFrame: 151, durationInFrames: 12, src: "room-tone.wav" }]
  }));
  await assert.rejects(
    assertRenderPropsBindTransitionExecution(
      { renderQualityContract: { transitionExecution } },
      { projectPath, propsPath, compositionId: "NeuralNetworkExplainer" }
    ),
    /DirectorXTimeline composition/
  );

  await writeFile(propsPath, JSON.stringify({
    directorxRuntime: { runtimeId: "directorx-remotion-runtime-v1", compositionId: "DirectorXTimeline" },
    directorxTransitionExecution: createTransitionExecutionRenderBinding(transitionExecution),
    directorxAudioTracks: []
  }));
  await assert.rejects(
    assertRenderPropsBindTransitionExecution(
      { renderQualityContract: { transitionExecution } },
      { projectPath, propsPath, compositionId: "DirectorXTimeline" }
    ),
    /room_tone audio track/
  );
});

test("preserves the exact transition props binding through final verification", () => {
  const transitionExecution = compileTransitionExecutionContract(dissolveInput());
  const binding = {
    required: true,
    status: "passed",
    renderPropsBinding: "passed",
    contractFingerprint: transitionExecution.contractFingerprint,
    planId: transitionExecution.planId,
    sequenceId: transitionExecution.sequenceId,
    boundaryIds: transitionExecution.boundaries.map((boundary) => boundary.boundaryId),
    runtimeFingerprint: transitionExecution.renderBinding.runtimeFingerprint,
    runtimeId: "directorx-remotion-runtime-v1",
    compositionId: "DirectorXTimeline",
    propsSha256: "a".repeat(64)
  };
  const preserved = preserveTransitionExecutionRenderEvidence({
    renderQualityContract: { transitionExecution },
    artifacts: { "render_report.json": { metadata: { transitionExecution: binding } } }
  });
  assert.equal(preserved.verification.renderEvidence, "passed");
  assert.equal(preserved.verification.boundaryCount, 1);
  assert.deepEqual(preserved.binding.boundaryIds, ["S01->S02"]);

  assert.throws(() => preserveTransitionExecutionRenderEvidence({
    renderQualityContract: { transitionExecution },
    artifacts: { "render_report.json": { metadata: { transitionExecution: { ...binding, contractFingerprint: "b".repeat(64) } } } }
  }), /lacks a validated Director transition props binding/);
});
