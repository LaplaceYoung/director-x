import React from "react";
import { Composition } from "remotion";
import { DirectorComposition } from "./composition.jsx";

const defaultProps = {
  title: "Director X Preview",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 90,
  clips: [],
  audio: null
};

export function DirectorXRoot() {
  return (
    <Composition
      id="DirectorXComposition"
      component={DirectorComposition}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames
      })}
    />
  );
}
