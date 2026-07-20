import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { attachFrameEvidenceToRepairPlan, attachFrameIdentityToAudit, collectFrameIdentityEvidence, extractFrameAuditEvidence, frameEvidenceCaptureIndices } from "./frame-identity-evidence.mjs";

test("persists streaming PTS identities and detects variable frame cadence", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-frame-identity-"));
  try {
    const videoPath = join(projectPath, "video.mp4");
    await writeFile(videoPath, "placeholder");
    const identity = await collectFrameIdentityEvidence({
      projectPath, runId: "dx-test", videoPath,
      stream: { time_base: "1/1000", avg_frame_rate: "25/1", r_frame_rate: "25/1" },
      auditedFrameCount: 4,
      captureFrameIndices: [0, 1, 3]
    }, { lines: [
      "key_frame=1|best_effort_timestamp=0|best_effort_timestamp_time=0.000000|pkt_duration=40|pkt_duration_time=0.040000|pict_type=I",
      "key_frame=0|best_effort_timestamp=40|best_effort_timestamp_time=0.040000|pkt_duration=40|pkt_duration_time=0.040000|pict_type=P",
      "key_frame=0|best_effort_timestamp=80|best_effort_timestamp_time=0.080000|pkt_duration=80|pkt_duration_time=0.080000|pict_type=P",
      "key_frame=0|best_effort_timestamp=160|best_effort_timestamp_time=0.160000|pkt_duration=40|pkt_duration_time=0.040000|pict_type=P"
    ] });
    assert.equal(identity.frameCount, 4);
    assert.equal(identity.frameCountParity, true);
    assert.equal(identity.variableFrameRateDetected, true);
    assert.deepEqual(identity.streamTimeBase, { num: 1, den: 1000 });
    assert.equal(identity.capturedFrames["3"].presentationTimestamp, 160);
    assert.equal(identity.capturedFrames["3"].bestEffortTimestampTicks, "160");
    assert.deepEqual(identity.observedPositivePtsDeltaTicks, ["40", "80"]);
    assert.equal(identity.passed, true);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("binds exact PTS and bounded before-trigger-after evidence to findings", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-frame-evidence-"));
  try {
    const videoPath = join(projectPath, "video.mp4");
    await writeFile(videoPath, "placeholder");
    const audit = {
      schemaVersion: "1.2", fps: 25, auditedFrameCount: 100,
      blockers: ["flash_frames:1"], technicalBlockers: [], reviewCandidateBlockers: ["flash_frames:1"], passed: false,
      defectIntervals: [{ code: "flash_frame", startFrame: 50, endFrame: 50, timeSeconds: 2, endSeconds: 2.04 }]
    };
    assert.deepEqual(frameEvidenceCaptureIndices(audit), [49, 50, 51]);
    const identity = await collectFrameIdentityEvidence({
      projectPath, runId: "dx-test", videoPath,
      stream: { time_base: "1/1000", avg_frame_rate: "25/1", r_frame_rate: "25/1" },
      auditedFrameCount: 3,
      captureFrameIndices: [0, 1, 2]
    }, { lines: [
      "key_frame=1|best_effort_timestamp=1960|best_effort_timestamp_time=1.960000|pkt_duration=40|pkt_duration_time=0.040000|pict_type=I",
      "key_frame=0|best_effort_timestamp=2000|best_effort_timestamp_time=2.000000|pkt_duration=40|pkt_duration_time=0.040000|pict_type=P",
      "key_frame=0|best_effort_timestamp=2040|best_effort_timestamp_time=2.040000|pkt_duration=40|pkt_duration_time=0.040000|pict_type=P"
    ] });
    identity.capturedFrames = { "49": identity.capturedFrames["0"], "50": identity.capturedFrames["1"], "51": identity.capturedFrames["2"] };
    const bound = attachFrameIdentityToAudit(audit, identity);
    assert.equal(bound.defectIntervals[0].startPresentationTimestamp, 2000);
    const plan = { findings: [{ findingId: "frame-audit:1", startFrame: 50, endFrame: 50, severity: "major", evidenceRefs: ["frame_audit_report.json"] }] };
    const evidence = await extractFrameAuditEvidence({ projectPath, runId: "dx-test", videoPath, repairPlan: plan, frameIdentity: identity, fps: 25 }, { extractor: async ({ outputPath }) => writeFile(outputPath, "png") });
    const updated = attachFrameEvidenceToRepairPlan(plan, evidence);
    assert.deepEqual(updated.findings[0].frameEvidence.map((item) => item.role), ["before", "trigger", "after"]);
    assert.ok(updated.findings[0].frameEvidence.every((item) => item.identityVerified));
    assert.equal(updated.evidenceFrameCount, 3);
    assert.ok(updated.findings[0].evidenceRefs.every((ref) => ref === "frame_audit_report.json" || ref.startsWith("frame_evidence/")));
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("preserves int64 PTS without JavaScript number rounding and permits duplicate timestamps", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-frame-int64-"));
  try {
    const videoPath = join(projectPath, "video.mp4");
    await writeFile(videoPath, "placeholder");
    const identity = await collectFrameIdentityEvidence({
      projectPath, runId: "dx-test", videoPath, sourceMediaSha256: "sha256:media",
      stream: { index: 2, time_base: "1/90000", avg_frame_rate: "30/1", r_frame_rate: "30/1" },
      auditedFrameCount: 2, captureFrameIndices: [0, 1]
    }, { lines: [
      "key_frame=1|best_effort_timestamp=9007199254740993|best_effort_timestamp_time=100079991719.34436|pkt_duration=3000|pkt_duration_time=0.033333|pict_type=I",
      "key_frame=0|best_effort_timestamp=9007199254740993|best_effort_timestamp_time=100079991719.34436|pkt_duration=3000|pkt_duration_time=0.033333|pict_type=P"
    ] });
    assert.equal(identity.capturedFrames["0"].bestEffortTimestampTicks, "9007199254740993");
    assert.equal(identity.capturedFrames["0"].presentationTimestamp, null);
    assert.equal(identity.capturedFrames["0"].sourceMediaSha256, "sha256:media");
    assert.equal(identity.capturedFrames["0"].streamIndex, 2);
    assert.equal(identity.duplicateTimestampCount, 1);
    assert.equal(identity.passed, true);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("treats frame identity parity and monotonicity failures as technical blockers", async () => {
  const audit = { blockers: [], technicalBlockers: [], defectIntervals: [], passed: true };
  const bound = attachFrameIdentityToAudit(audit, { artifactRef: "frame_identity.jsonl", blockers: ["frame_identity_count_delta:-1"], capturedFrames: {}, streamTimeBase: { num: 1, den: 90000 } });
  assert.equal(bound.passed, false);
  assert.deepEqual(bound.technicalBlockers, ["frame_identity_count_delta:-1"]);
});
