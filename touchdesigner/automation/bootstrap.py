"""Execute DAT callbacks for an isolated TouchDesigner rebuild/render process.

This module runs inside TouchDesigner. The shell launcher creates a disposable .toe whose
startup Execute DAT points here. The builder and render outputs remain external, which keeps
the automation reviewable and prevents the authoring .toe or website assets being overwritten.
"""

from pathlib import Path
import json
import os
import traceback


# Execute DAT evaluates an external file with its operator path as ``__file__`` (for example
# ``/CODEX_AUTOMATION``), so repository discovery must not rely on that special variable.
REPO_ROOT = Path(
    os.environ.get("CODEX_TD_REPO_ROOT", "/Users/braden/Development/bradenm.co.uk")
).resolve()
TD_ROOT = REPO_ROOT / "touchdesigner"
BUILDER = TD_ROOT / "build-project.py"

RUN_DIR = Path(os.environ.get("CODEX_TD_RUN_DIR", "/private/tmp/braden-touchdesigner-run"))
OUTPUT = RUN_DIR / "preview.png"
PROJECT_COPY = RUN_DIR / "about-portrait.generated.toe"
STATUS = RUN_DIR / "status.json"

POLL_FRAMES = 6
MAX_POLLS = 100


def write_status(result, **details):
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(
        json.dumps(
            {
                "result": result,
                "touchdesigner_version": str(app.version),
                "touchdesigner_build": str(app.build),
                "project_copy": str(PROJECT_COPY),
                "preview": str(OUTPUT),
                **details,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def quit_process():
    run("project.quit(force=True)", delayFrames=2)


def fail(stage, error=None):
    details = {"stage": stage, "traceback": traceback.format_exc()}
    if error is not None:
        details["error"] = str(error)
    write_status("failure", **details)
    quit_process()


def resolve_network():
    return op("/ABOUT_PORTRAIT") or op("/project1")


def media_state(source, matte, atlas, prop_support):
    def state(node):
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

    return {
        "source": state(source),
        "matte": state(matte),
        "atlas": state(atlas),
        "prop_support": state(prop_support),
    }


def media_ready(source, matte, atlas, prop_support):
    return all(
        node.isOpen and not node.isInvalid and node.lastIndexUploaded >= 0
        for node in (source, matte, atlas, prop_support)
    )


def export_when_ready(attempt=0):
    try:
        network = resolve_network()
        if network is None:
            raise RuntimeError("Expected /ABOUT_PORTRAIT or /project1 after build")

        source = network.op("SOURCE_VIDEO")
        matte = network.op("SUBJECT_MATTE")
        atlas = network.op("GLYPH_ATLAS")
        prop_support = network.op("PROP_SUPPORT")
        shader = network.op("TYPOGRAVURE")
        output = network.op("FINAL_RGBA")
        missing = [
            name
            for name, node in (
                ("SOURCE_VIDEO", source),
                ("SUBJECT_MATTE", matte),
                ("GLYPH_ATLAS", atlas),
                ("PROP_SUPPORT", prop_support),
                ("TYPOGRAVURE", shader),
                ("FINAL_RGBA", output),
            )
            if node is None
        ]
        if missing:
            raise RuntimeError("Missing generated nodes: " + ", ".join(missing))

        for node in (source, matte, atlas, prop_support):
            node.cook(force=True)

        if not media_ready(source, matte, atlas, prop_support):
            if attempt >= MAX_POLLS:
                raise TimeoutError(
                    f"Media did not decode after {MAX_POLLS * POLL_FRAMES} frames: "
                    f"{media_state(source, matte, atlas, prop_support)!r}"
                )
            run(export_when_ready, attempt + 1, delayFrames=POLL_FRAMES)
            return

        # Give the shader two cooks after every input reports a GPU-uploaded frame.
        run(save_outputs, delayFrames=2)
    except Exception:
        fail("wait_for_decode")


def save_outputs():
    try:
        network = resolve_network()
        source = network.op("SOURCE_VIDEO")
        matte = network.op("SUBJECT_MATTE")
        atlas = network.op("GLYPH_ATLAS")
        prop_support = network.op("PROP_SUPPORT")
        shader = network.op("TYPOGRAVURE")
        output = network.op("FINAL_RGBA")

        output.cook(force=True, recurse=True)
        sample_points = {
            "center": list(output.sample(u=0.5, v=0.5)),
            "upper_left": list(output.sample(u=0.25, v=0.75)),
            "lower_right": list(output.sample(u=0.75, v=0.25)),
        }
        output.save(str(OUTPUT), asynchronous=False, createFolders=True)
        project.save(str(PROJECT_COPY))

        network_errors = network.errors(recurse=True)
        script_errors = network.scriptErrors(recurse=True)
        shader_errors = shader.errors(recurse=True)
        if network_errors or script_errors or shader_errors:
            write_status(
                "failure",
                stage="validate_network",
                network_errors=network_errors,
                script_errors=script_errors,
                shader_errors=shader_errors,
                media=media_state(source, matte, atlas, prop_support),
                sample_points=sample_points,
            )
        else:
            write_status(
                "success",
                stage="complete",
                output={"width": int(output.width), "height": int(output.height)},
                media=media_state(source, matte, atlas, prop_support),
                sample_points=sample_points,
                network_errors="",
                script_errors="",
                shader_errors="",
            )
    except Exception:
        fail("save_outputs")
        return
    quit_process()


def start():
    try:
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        write_status("running", stage="build")

        # Execute the same reviewable builder used by the authoring project, but suppress
        # its normal save. save_outputs() writes only the disposable project copy.
        source = BUILDER.read_text(encoding="utf-8")
        scope = dict(globals())
        scope["__name__"] = "touchdesigner_portrait_builder"
        exec(compile(source, str(BUILDER), "exec"), scope)
        scope["build"](save_project=False)
        run(export_when_ready, 0, delayFrames=POLL_FRAMES)
    except Exception:
        fail("build")


def create():
    return


def frameStart(frame):
    return


def frameEnd(frame):
    return
