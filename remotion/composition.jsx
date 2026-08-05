import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

export function DirectorComposition({ title, clips, audio }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#11100e", color: "#f5f0e8" }}>
      {clips.map((clip, index) => (
        <Sequence
          key={`${clip.type}-${index}`}
          from={clip.startFrame}
          durationInFrames={clip.durationInFrames}
          name={clip.title}
        >
          <Clip clip={clip} projectTitle={title} />
        </Sequence>
      ))}
      {audio?.src ? <Audio src={staticFile(audio.src)} volume={audio.volume ?? 1} /> : null}
    </AbsoluteFill>
  );
}

function Clip({ clip, projectTitle }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeFrames = Math.min(Math.round(fps * 0.25), Math.floor(clip.durationInFrames / 3));
  const opacity = interpolate(
    frame,
    [0, fadeFrames, clip.durationInFrames - fadeFrames, clip.durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const scale = interpolate(frame, [0, clip.durationInFrames], [1.015, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  if (clip.type === "text") {
    return (
      <AbsoluteFill style={{ ...baseFrameStyle(opacity), padding: 72 }}>
        <div style={{ maxWidth: "78%", fontSize: 64, lineHeight: 1.18, fontWeight: 650 }}>
          {clip.text || clip.title || projectTitle}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ ...baseFrameStyle(opacity), transform: `scale(${scale})` }}>
      {clip.type === "image" ? (
        <Img src={staticFile(clip.src)} style={mediaStyle} />
      ) : (
        <OffthreadVideo src={staticFile(clip.src)} muted={clip.muted} style={mediaStyle} />
      )}
      {clip.title ? (
        <div style={captionStyle}>{clip.title}</div>
      ) : null}
    </AbsoluteFill>
  );
}

function baseFrameStyle(opacity) {
  return {
    alignItems: "center",
    justifyContent: "center",
    opacity,
    overflow: "hidden",
    boxSizing: "border-box"
  };
}

const mediaStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
};

const captionStyle = {
  position: "absolute",
  left: 56,
  bottom: 44,
  maxWidth: "70%",
  padding: "12px 18px",
  backgroundColor: "rgba(17,16,14,0.78)",
  color: "#f5f0e8",
  fontSize: 28,
  lineHeight: 1.2
};
