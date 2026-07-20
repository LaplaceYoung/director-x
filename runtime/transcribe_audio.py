#!/usr/bin/env python3
"""Emit a stable Director X transcript JSON document using faster-whisper."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--word-timestamps", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.input)
    if not source.is_file():
        print(f"Input media does not exist: {source}", file=sys.stderr)
        return 2
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("The managed Director X Whisper runtime is incomplete. Run: pnpm install:runtime", file=sys.stderr)
        return 3

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        str(source),
        language=args.language,
        word_timestamps=args.word_timestamps,
        vad_filter=True,
    )
    output_segments = []
    for index, segment in enumerate(segments, start=1):
        words = []
        for word in segment.words or []:
            words.append(
                {
                    "start_seconds": word.start,
                    "end_seconds": word.end,
                    "text": word.word,
                    "probability": word.probability,
                }
            )
        output_segments.append(
            {
                "segment_id": f"SEG-{index:04d}",
                "start_seconds": segment.start,
                "end_seconds": segment.end,
                "text": segment.text.strip(),
                "words": words,
            }
        )
    result = {
        "provider": "faster-whisper",
        "model": args.model,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration_seconds": info.duration,
        "segments": output_segments,
    }
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
