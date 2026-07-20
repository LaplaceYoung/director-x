import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileRenderQualityContract } from "./render-quality-contract.mjs";
import {
  assertRenderPropsBindRemotionProjection,
  compileRemotionRenderProjection
} from "./remotion-render-projection.mjs";

const TIMELINE_SHA = "1".repeat(64);
const QUALITY_SHA = "2".repeat(64);
const TRANSITION_SHA = "3".repeat(64);
const AUDIO_SHA = "4".repeat(64);
const VOICE_SHA = "5".repeat(64);
const MUSIC_SHA = "6".repeat(64);

function fixture() {
  const semanticTimeline = {
    semantic_timeline_id: "ST-DEMO",
    duration_seconds: 10,
    tracks: [
      {
        track_id: "video-main",
        track_type: "video",
        clips: [
          { clip_id: "clip-a", shot_id: "S01", start_seconds: 0, end_seconds: 5.5 },
          { clip_id: "clip-b", shot_id: "S02", start_seconds: 5, end_seconds: 10 }
        ]
      },
      {
        track_id: "dialogue-main",
        track_type: "dialogue",
        clips: [{ clip_id: "voice-main", start_seconds: 0, end_seconds: 9.5 }]
      },
      {
        track_id: "music-main",
        track_type: "music",
        clips: [{
          clip_id: "music-bed",
          start_seconds: 0,
          end_seconds: 10,
          volume_envelope: [{ start_seconds: 0, end_seconds: 9.5, volume: 0.25 }, { start_seconds: 9.5, end_seconds: 10, volume: 0.6 }]
        }]
      },
      {
        track_id: "captions-main",
        track_type: "captions",
        clips: [{ clip_id: "caption-1", start_seconds: 0, end_seconds: 9.5, text: "让每一个镜头都来自同一条时间线" }]
      }
    ],
    beats: [
      { beat_id: "B01", shot_id: "S01", start_seconds: 0, end_seconds: 5.5, intent: "建立问题" },
      { beat_id: "B02", shot_id: "S02", start_seconds: 5, end_seconds: 10, intent: "完成回应" }
    ],
    transition_strategy: [],
    export_versions: [],
    platform_safe_area: { subtitle_region: "lower_third" }
  };
  const transitionLanguagePlan = {
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
  };
  const renderQualityContract = compileRenderQualityContract({
    renderer: "remotion",
    durationSeconds: 10,
    narration: { startSeconds: 0, endSeconds: 9.5, language: "zh", text: "让每一个镜头都来自同一条经过确认的时间线，并保持完整的导演意图。" },
    captions: [{ startSeconds: 0, endSeconds: 9.5, text: "让每一个镜头都来自同一条时间线" }],
    visualClips: [
      { clipId: "clip-a", kind: "video", startSeconds: 0, endSeconds: 5.5 },
      { clipId: "clip-b", kind: "image", startSeconds: 5, endSeconds: 10 }
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
    transitionLanguagePlan,
    requireDirectorPlan: true
  });
  assert.equal(renderQualityContract.status, "ready");
  return { semanticTimeline, renderQualityContract };
}

function projectionArgs(input) {
  return {
    ...input,
    semanticTimelineSha256: TIMELINE_SHA,
    renderQualityContractSha256: QUALITY_SHA,
    transitionLanguagePlanSha256: TRANSITION_SHA,
    audioCueSheetSha256: AUDIO_SHA,
    width: 1920,
    height: 1080,
    mediaBindings: [
      { clipId: "clip-a", kind: "video", src: "clips/a.mp4", muted: true },
      { clipId: "clip-b", kind: "image", src: "images/b.png" }
    ],
    timelineAudioBindings: [
      { clipId: "voice-main", src: "audio/voice.wav", sourceArtifactRef: "voiceover.audio", sourceSha256: VOICE_SHA, sourceDurationSeconds: 9.5 },
      { clipId: "music-bed", src: "audio/music.wav", sourceArtifactRef: "music.audio", sourceSha256: MUSIC_SHA, sourceDurationSeconds: 10, volume: 0.8 }
    ],
    captionBindings: [{ clipId: "caption-1", emphasisTokens: ["同一条时间线"] }],
    audioBridgeBindings: [{ boundaryId: "S01->S02", src: "audio/room.wav" }]
  };
}

test("projects the canonical timeline into exact DirectorXTimeline props", () => {
  const input = fixture();
  const projection = compileRemotionRenderProjection(projectionArgs(input));
  assert.equal(projection.status, "ready");
  assert.equal(projection.props.scenes[0].fromFrame, 0);
  assert.equal(projection.props.scenes[0].durationInFrames, 165);
  assert.equal(projection.props.scenes[1].fromFrame, 150);
  assert.deepEqual(projection.props.directorxTransitionExecution.boundaryIds, ["S01->S02"]);
  assert.deepEqual(projection.props.directorxAudioTracks[0], {
    boundaryId: "S01->S02",
    bridgeKind: "room_tone",
    fromFrame: 151,
    durationInFrames: 12,
    src: "audio/room.wav",
    startFromFrame: 0,
    volume: 1
  });
  assert.equal(projection.props.directorxTimelineAudioTracks.length, 2);
  assert.deepEqual(projection.props.directorxTimelineAudioTracks.find((track) => track.id === "music-bed").volumeEnvelope, [
    { fromFrame: 0, toFrame: 285, volume: 0.25 },
    { fromFrame: 285, toFrame: 300, volume: 0.6 }
  ]);
  assert.deepEqual(projection.props.directorxCaptions[0], {
    id: "caption-1",
    fromFrame: 0,
    durationInFrames: 285,
    text: "让每一个镜头都来自同一条时间线",
    position: "lower_third",
    maxLines: 2,
    emphasisTokens: ["同一条时间线"]
  });
  assert.match(projection.projectionFingerprint, /^[a-f0-9]{64}$/);
  assert.match(projection.propsFingerprint, /^[a-f0-9]{64}$/);
});

test("blocks timing drift and extra visual bindings", () => {
  const input = fixture();
  input.semanticTimeline.tracks[0].clips[1].start_seconds = 5.2;
  assert.throws(() => compileRemotionRenderProjection(projectionArgs(input)), /timing drifted/);
});

test("projects nonzero audio envelopes in absolute composition frames", () => {
  const input = fixture();
  const musicClip = input.semanticTimeline.tracks.find((track) => track.track_type === "music").clips[0];
  musicClip.start_seconds = 2;
  musicClip.volume_envelope = [
    { start_seconds: 2, end_seconds: 9.5, volume: 0.25 },
    { start_seconds: 9.5, end_seconds: 10, volume: 0.6 }
  ];
  const projection = compileRemotionRenderProjection(projectionArgs(input));
  assert.deepEqual(projection.props.directorxTimelineAudioTracks.find((track) => track.id === "music-bed").volumeEnvelope, [
    { fromFrame: 60, toFrame: 285, volume: 0.25 },
    { fromFrame: 285, toFrame: 300, volume: 0.6 }
  ]);
});

test("blocks narration audio tails and caption timing drift", () => {
  const narrationTail = fixture();
  narrationTail.semanticTimeline.tracks.find((track) => track.track_type === "dialogue").clips[0].end_seconds = 8;
  assert.throws(
    () => compileRemotionRenderProjection(projectionArgs(narrationTail)),
    /ends before the approved narration/
  );

  const shortSource = fixture();
  const shortSourceArgs = projectionArgs(shortSource);
  shortSourceArgs.timelineAudioBindings[0].sourceDurationSeconds = 8;
  assert.throws(
    () => compileRemotionRenderProjection(shortSourceArgs),
    /source audio ends before its canonical timeline window/
  );

  const captionDrift = fixture();
  captionDrift.semanticTimeline.tracks.find((track) => track.track_type === "captions").clips[0].end_seconds = 9.3;
  assert.throws(
    () => compileRemotionRenderProjection(projectionArgs(captionDrift)),
    /caption timing drifted/
  );
});

test("render preflight rejects stale or edited projection props", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-remotion-projection-"));
  const input = fixture();
  const voicePath = join(projectPath, "voice.wav");
  const musicPath = join(projectPath, "music.wav");
  const voiceBytes = Buffer.from("voice-source");
  const musicBytes = Buffer.from("music-source");
  await writeFile(voicePath, voiceBytes);
  await writeFile(musicPath, musicBytes);
  const args = projectionArgs(input);
  args.timelineAudioBindings[0].sourceSha256 = createHash("sha256").update(voiceBytes).digest("hex");
  args.timelineAudioBindings[1].sourceSha256 = createHash("sha256").update(musicBytes).digest("hex");
  const projection = compileRemotionRenderProjection(args);
  const propsPath = join(projectPath, "props.json");
  await writeFile(propsPath, JSON.stringify(projection.props));
  const run = {
    remotionRenderProjection: projection,
    artifacts: {
      "semantic_timeline.json": { sha256: TIMELINE_SHA },
      "render_quality_contract.json": { sha256: QUALITY_SHA },
      "transition_language_plan.json": { sha256: TRANSITION_SHA },
      "audio_cue_sheet.json": { sha256: AUDIO_SHA },
      "voiceover.audio": { mediaKind: "audio", path: voicePath, sha256: args.timelineAudioBindings[0].sourceSha256 },
      "music.audio": { mediaKind: "audio", path: musicPath, sha256: args.timelineAudioBindings[1].sourceSha256 }
    }
  };
  const evidence = await assertRenderPropsBindRemotionProjection(run, { projectPath, propsPath, compositionId: "DirectorXTimeline" });
  assert.equal(evidence.status, "passed");

  run.artifacts["audio_cue_sheet.json"].sha256 = "5".repeat(64);
  await assert.rejects(
    assertRenderPropsBindRemotionProjection(run, { projectPath, propsPath, compositionId: "DirectorXTimeline" }),
    /audio cue sheet changed/
  );
  run.artifacts["audio_cue_sheet.json"].sha256 = AUDIO_SHA;

  await writeFile(voicePath, "changed-voice-source");
  await assert.rejects(
    assertRenderPropsBindRemotionProjection(run, { projectPath, propsPath, compositionId: "DirectorXTimeline" }),
    /audio source file changed/
  );
  await writeFile(voicePath, voiceBytes);

  projection.props.scenes[0].durationInFrames = 120;
  await writeFile(propsPath, JSON.stringify(projection.props));
  await assert.rejects(
    assertRenderPropsBindRemotionProjection(run, { projectPath, propsPath, compositionId: "DirectorXTimeline" }),
    /drifted/
  );

  run.artifacts["semantic_timeline.json"].sha256 = "4".repeat(64);
  await writeFile(propsPath, JSON.stringify({ ...projection.props, scenes: [{ ...projection.props.scenes[0], durationInFrames: 165 }, projection.props.scenes[1]] }));
  await assert.rejects(
    assertRenderPropsBindRemotionProjection(run, { projectPath, propsPath, compositionId: "DirectorXTimeline" }),
    /semantic timeline changed/
  );
});
