#!/usr/bin/env python3
"""Build the registered v2 loop from closely spaced canonical pose edits.

# cspell:ignore opencv RIFE safetensors xcrun
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import cv2
from huggingface_hub import snapshot_download
import numpy as np
from PIL import Image
import rife_mlx
from rife_mlx.pipeline_mlx import interpolate_pair
from rife_mlx.utils.weights import build_model


RIFE_SOURCE_REVISION = "764b89be56497fb26243d1de75f2957f3889e5d3"
RIFE_MODEL_REVISION = "6b650eaa5664aab280119511fe944861491aa15e"
FPS = 12
FRAME_COUNT = 48
WIDTH = 1200
HEIGHT = 800
AFFINE = np.array([[1.3, 0.0, -253.0], [0.0, 1.1, -12.0]], dtype=np.float32)
SCHEDULE = [0, 6, 9, 12, 18, 20, 21, 23, 24, 25, 26, 27, 30, 36, 42, 45, 48]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def verify_rife_source_revision() -> None:
    source_repository = Path(rife_mlx.__file__).resolve().parents[1]
    result = subprocess.run(
        ["git", "-C", str(source_repository), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    installed_revision = result.stdout.strip()
    if installed_revision != RIFE_SOURCE_REVISION:
        raise RuntimeError(
            "RIFE-MLX source revision mismatch: expected "
            f"{RIFE_SOURCE_REVISION}, found {installed_revision}."
        )


def resolve_rife_model() -> Path:
    model_directory = Path(
        snapshot_download(
            repo_id="mlx-community/RIFE-4.25",
            revision=RIFE_MODEL_REVISION,
        )
    ).resolve()
    if model_directory.name != RIFE_MODEL_REVISION:
        raise RuntimeError(
            "RIFE model revision mismatch: expected "
            f"{RIFE_MODEL_REVISION}, resolved {model_directory.name}."
        )
    return model_directory


def parse_arguments() -> argparse.Namespace:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--keyframes",
        type=Path,
        default=repository / "images/source/about-motion/keyframes/v2/canonical",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/private/tmp/braden-clean-motion-v2"),
    )
    return parser.parse_args()


def load_keyframe(directory: Path, frame: int) -> np.ndarray:
    source_frame = 0 if frame == FRAME_COUNT else frame
    path = directory / f"frame-{source_frame:02d}.png"
    if not path.is_file():
        raise FileNotFoundError(f"Missing canonical keyframe: {path}")
    return np.asarray(
        Image.open(path).convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    )


def build_sequence(keyframe_directory: Path) -> tuple[list[np.ndarray], dict[str, str]]:
    verify_rife_source_revision()
    model = build_model("4.25", weights_dir=str(resolve_rife_model()))
    keyframes = {frame: load_keyframe(keyframe_directory, frame) for frame in SCHEDULE}
    sequence: list[np.ndarray | None] = [None] * FRAME_COUNT

    for start, end in zip(SCHEDULE[:-1], SCHEDULE[1:], strict=True):
        first = keyframes[start]
        second = keyframes[end]
        gap = end - start
        sequence[start] = first
        for offset in range(1, gap):
            sequence[start + offset] = interpolate_pair(
                model,
                first,
                second,
                offset / gap,
                scale=1.0,
            )

    if any(frame is None for frame in sequence):
        raise RuntimeError("The v2 schedule did not populate every output frame")

    paths = {
        f"frame-{frame:02d}.png": digest(
            keyframe_directory / f"frame-{(0 if frame == FRAME_COUNT else frame):02d}.png"
        )
        for frame in SCHEDULE
    }
    return [frame for frame in sequence if frame is not None], paths


def main() -> None:
    arguments = parse_arguments()
    output = arguments.output_dir.resolve()
    source_frames = output / "source-frames"
    matte_frames = output / "matte-frames"
    shutil.rmtree(source_frames, ignore_errors=True)
    shutil.rmtree(matte_frames, ignore_errors=True)
    source_frames.mkdir(parents=True, exist_ok=True)
    matte_frames.mkdir(parents=True, exist_ok=True)

    sequence, keyframe_hashes = build_sequence(arguments.keyframes.resolve())
    for index, frame in enumerate(sequence, start=1):
        transformed = cv2.warpAffine(
            cv2.cvtColor(frame, cv2.COLOR_RGB2BGR),
            AFFINE,
            (WIDTH, HEIGHT),
            flags=cv2.INTER_LANCZOS4,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
        cv2.imwrite(str(source_frames / f"frame-{index:03d}.png"), transformed)

    script_directory = Path(__file__).resolve().parent
    mask_binary = output / "foreground-mask"
    run(
        [
            "xcrun",
            "swiftc",
            "-O",
            str(script_directory / "foreground-mask.swift"),
            "-o",
            str(mask_binary),
        ]
    )

    def render_mask(source: Path) -> None:
        run([str(mask_binary), str(source), str(matte_frames / source.name)])

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(render_mask, sorted(source_frames.glob("frame-*.png"))))

    source_video = output / "braden-gelato-clean-loop-v2.mp4"
    matte_video = output / "braden-gelato-clean-matte-loop-v2.mp4"
    for pattern, target, crf in [
        (source_frames / "frame-%03d.png", source_video, "8"),
        (matte_frames / "frame-%03d.png", matte_video, "0"),
    ]:
        run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-framerate",
                str(FPS),
                "-i",
                str(pattern),
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-crf",
                crf,
                "-g",
                "1",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-y",
                str(target),
            ]
        )

    manifest = {
        "affine": AFFINE.tolist(),
        "fps": FPS,
        "frame_count": FRAME_COUNT,
        "height": HEIGHT,
        "keyframes": keyframe_hashes,
        "matte_video": {"file": matte_video.name, "sha256": digest(matte_video)},
        "method": "piecewise RIFE with dense canonical local-edit anchors around occlusions",
        "rife_model_revision": RIFE_MODEL_REVISION,
        "rife_source_revision": RIFE_SOURCE_REVISION,
        "schedule": SCHEDULE,
        "source_frames": {
            frame.name: digest(frame) for frame in sorted(source_frames.glob("frame-*.png"))
        },
        "source_video": {"file": source_video.name, "sha256": digest(source_video)},
        "width": WIDTH,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(output)


if __name__ == "__main__":
    main()
