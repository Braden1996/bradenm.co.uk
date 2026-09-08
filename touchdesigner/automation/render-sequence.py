"""Render an exact, deterministic transparent PNG sequence inside TouchDesigner."""

from pathlib import Path
import json
import os
import traceback


REPO_ROOT = Path(
    os.environ.get("CODEX_TD_REPO_ROOT", "/Users/braden/Development/bradenm.co.uk")
).resolve()
TD_ROOT = REPO_ROOT / "touchdesigner"
BUILDER = TD_ROOT / "build-project.py"
RUN_DIR = Path(os.environ.get("CODEX_TD_RUN_DIR", "/private/tmp/braden-touchdesigner-sequence"))
FRAMES = RUN_DIR / "frames"
STATUS = RUN_DIR / "sequence-status.json"

FRAME_COUNT = 48
START_FRAME = int(os.environ.get("CODEX_TD_START_FRAME", "0"))
FRAME_INDICES_TEXT = os.environ.get("CODEX_TD_FRAME_INDICES", "").strip()
DIAGNOSTIC_MODE = bool(FRAME_INDICES_TEXT)
FRAME_INDICES = (
    tuple(int(value.strip()) for value in FRAME_INDICES_TEXT.split(",") if value.strip())
    if DIAGNOSTIC_MODE
    else tuple(range(START_FRAME, FRAME_COUNT))
)
POLL_FRAMES = 6
MAX_POLLS = 100


def write_status(result, **details):
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    payload = (
        json.dumps(
            {
                "result": result,
                "touchdesigner_version": str(app.version),
                "touchdesigner_build": str(app.build),
                **details,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    temporary = STATUS.with_suffix(".tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(STATUS)


def quit_process():
    # Saving a 16-bit PNG is synchronous, so it is safe to terminate immediately after status.
    # A direct quit also prevents a delayed Run from being stranded when the last frame cook
    # leaves the project timeline paused.
    project.quit(force=True)


def fail(stage):
    write_status("failure", stage=stage, traceback=traceback.format_exc())
    quit_process()


def resolve_network():
    return op("/ABOUT_PORTRAIT") or op("/project1")


def media_state(node):
    return {
        "is_open": bool(node.isOpen),
        "is_opening": bool(node.isOpening or node.isFileOpening),
        "is_invalid": bool(node.isInvalid),
        "is_fully_pre_read": bool(node.isFullyPreRead),
        "last_index_uploaded": float(node.lastIndexUploaded),
        "num_images": float(node.numImages),
        "width": int(node.width),
        "height": int(node.height),
    }


def media_ready(source, matte, atlas, prop_support):
    return all(
        node.isOpen and not node.isInvalid and node.lastIndexUploaded >= 0
        for node in (source, matte, atlas, prop_support)
    )


def wait_for_media(attempt=0):
    try:
        network = resolve_network()
        source = network.op("SOURCE_VIDEO")
        matte = network.op("SUBJECT_MATTE")
        atlas = network.op("GLYPH_ATLAS")
        prop_support = network.op("PROP_SUPPORT")
        for node in (source, matte, atlas, prop_support):
            node.cook(force=True)

        if not media_ready(source, matte, atlas, prop_support):
            if attempt >= MAX_POLLS:
                raise TimeoutError(
                    f"Media did not decode after {MAX_POLLS * POLL_FRAMES} frames: "
                    f"source={media_state(source)!r}, matte={media_state(matte)!r}, "
                    f"atlas={media_state(atlas)!r}, "
                    f"prop_support={media_state(prop_support)!r}"
                )
            run(wait_for_media, attempt + 1, delayFrames=POLL_FRAMES)
            return

        specify_index = list(source.par.playmode.menuNames).index("specify")
        source.par.playmode.menuIndex = specify_index
        matte.par.playmode.menuIndex = specify_index
        source.par.indexunit.menuIndex = 0
        matte.par.indexunit.menuIndex = 0
        write_status(
            "running",
            stage="render",
            playmode={
                "source": source.par.playmode.eval(),
                "source_names": list(source.par.playmode.menuNames),
                "matte": matte.par.playmode.eval(),
                "matte_names": list(matte.par.playmode.menuNames),
            },
            indexunit={
                "source": source.par.indexunit.eval(),
                "source_names": list(source.par.indexunit.menuNames),
                "matte": matte.par.indexunit.eval(),
                "matte_names": list(matte.par.indexunit.menuNames),
            },
            source=media_state(source),
            matte=media_state(matte),
            atlas=media_state(atlas),
            prop_support=media_state(prop_support),
        )
        run(render_frame, 0, delayFrames=2)
    except Exception:
        fail("wait_for_media")


def render_frame(position=0, attempt=0):
    try:
        index = FRAME_INDICES[position]
        network = resolve_network()
        source = network.op("SOURCE_VIDEO")
        matte = network.op("SUBJECT_MATTE")
        shader = network.op("TYPOGRAVURE")
        output = network.op("FINAL_RGBA")

        if attempt == 0:
            source.par.index = index
            matte.par.index = index
        source.cook(force=True)
        matte.cook(force=True)

        # Movie File In uploads a newly specified frame asynchronously. Continue polling until
        # both streams report that exact index so source and matte cannot drift by one frame.
        source_uploaded = int(round(source.lastIndexUploaded))
        matte_uploaded = int(round(matte.lastIndexUploaded))
        if source_uploaded != index or matte_uploaded != index:
            if attempt >= MAX_POLLS:
                raise TimeoutError(
                    f"Frame {index} did not upload after {MAX_POLLS} polls: "
                    f"source={media_state(source)!r}, matte={media_state(matte)!r}"
                )
            if attempt % 30 == 0:
                write_status(
                    "running",
                    stage="wait_for_frame",
                    frame=index,
                    attempt=attempt,
                    playmode={
                        "source": source.par.playmode.eval(),
                        "matte": matte.par.playmode.eval(),
                    },
                    index={"source": float(source.par.index), "matte": float(matte.par.index)},
                    source=media_state(source),
                    matte=media_state(matte),
                )
            run(render_frame, position, attempt + 1, delayFrames=1)
            return

        output.cook(force=True, recurse=True)
        output.save(
            str(FRAMES / f"frame-{index + 1:03d}.png"),
            asynchronous=False,
            createFolders=True,
        )

        if position + 1 < len(FRAME_INDICES):
            # A synchronous 16-bit PNG write can occasionally pause for minutes while the GPU
            # and macOS image encoder drain. Report each completed frame so the shell can tell
            # slow forward progress from a genuinely hung TouchDesigner process.
            write_status(
                "running",
                stage="render",
                frame_completed=index,
                frames_written=position + 1,
                frames_expected=len(FRAME_INDICES),
                frame_indices=FRAME_INDICES,
                source=media_state(source),
                matte=media_state(matte),
            )
            # Continue in the active callback while the app is awake. A delayed frame callback
            # can be suspended indefinitely when macOS applies App Nap to this background-only
            # TouchDesigner instance. Media that is not ready still takes the polling path above.
            render_frame(position + 1)
            return

        network_errors = network.errors(recurse=True)
        script_errors = network.scriptErrors(recurse=True)
        shader_errors = shader.errors(recurse=True)
        rendered = sorted(FRAMES.glob("frame-*.png"))
        expected_indices = FRAME_INDICES if DIAGNOSTIC_MODE else tuple(range(FRAME_COUNT))
        expected = [f"frame-{index + 1:03d}.png" for index in expected_indices]
        sequence_errors = []
        if [frame.name for frame in rendered] != expected:
            sequence_errors.append(
                f"Expected frames {expected!r}; found "
                f"{[frame.name for frame in rendered]!r}"
            )
        result = (
            "success"
            if not (network_errors or script_errors or shader_errors or sequence_errors)
            else "failure"
        )
        write_status(
            result,
            stage="complete" if result == "success" else "validate_network",
            frames=len(rendered),
            frame_indices=FRAME_INDICES,
            first_frame=rendered[0].name if rendered else None,
            last_frame=rendered[-1].name if rendered else None,
            width=int(output.width),
            height=int(output.height),
            source=media_state(source),
            matte=media_state(matte),
            network_errors=network_errors,
            script_errors=script_errors,
            shader_errors=shader_errors,
            sequence_errors=sequence_errors,
        )
        quit_process()
    except Exception:
        fail("render_frame")


def start():
    try:
        if START_FRAME < 0 or START_FRAME >= FRAME_COUNT:
            raise ValueError(
                f"CODEX_TD_START_FRAME must be in [0, {FRAME_COUNT - 1}], got {START_FRAME}"
            )
        if not FRAME_INDICES:
            raise ValueError("CODEX_TD_FRAME_INDICES must contain at least one frame")
        if len(set(FRAME_INDICES)) != len(FRAME_INDICES):
            raise ValueError("CODEX_TD_FRAME_INDICES must not contain duplicates")
        invalid_indices = [index for index in FRAME_INDICES if index < 0 or index >= FRAME_COUNT]
        if invalid_indices:
            raise ValueError(
                f"CODEX_TD_FRAME_INDICES values must be in [0, {FRAME_COUNT - 1}], "
                f"got {invalid_indices!r}"
            )
        write_status(
            "running",
            stage="build",
            start_frame=START_FRAME,
            frame_indices=FRAME_INDICES,
        )
        scope = dict(globals())
        scope["__name__"] = "touchdesigner_portrait_builder"
        source = BUILDER.read_text(encoding="utf-8")
        exec(compile(source, str(BUILDER), "exec"), scope)
        scope["build"](save_project=False)
        run(wait_for_media, 0, delayFrames=POLL_FRAMES)
    except Exception:
        fail("build")


def create():
    return


def frameStart(frame):
    return


def frameEnd(frame):
    return
