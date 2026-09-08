"""Build adjacent-frame particle correspondences from the packed portrait source.

The output has unique target cells, explicit unmatched endpoints, and opaque
RGB integer packing. The confidence report selects sharp source-frame cuts for
pairs that cannot be transported reliably. All computation is offline and CPU.
"""

from pathlib import Path
import argparse
import hashlib
import json
import time
import cv2
import numpy as np


def repository_root():
    for parent in Path(__file__).resolve().parents:
        if (parent / "package.json").is_file() and (parent / "touchdesigner").is_dir():
            return parent
    return Path.cwd()


parser = argparse.ArgumentParser(description=__doc__)
root = repository_root()
parser.add_argument(
    "--source", type=Path, default=root / "images/source/about-motion/packed/portrait-packed.mp4"
)
parser.add_argument("--out", type=Path, default=root / "artifacts/portrait-correspondence")
parser.add_argument(
    "--support", type=Path, help="Static prop matte; defaults to prop-support.png beside the source"
)
args = parser.parse_args()
SOURCE = args.source.resolve()
OUT = args.out.resolve()
SUPPORT = (args.support or SOURCE.with_name("prop-support.png")).resolve()
OUT.mkdir(parents=True, exist_ok=True)
source_sha = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
support_sha = hashlib.sha256(SUPPORT.read_bytes()).hexdigest()
cv2.setNumThreads(1)
cv2.setRNGSeed(0)
COLS, ROWS = 400, 207
N = COLS * ROWS
PITCH = np.array([3.6, 3.87])
SOURCE_PITCH = PITCH / 1.03
MAX_RESIDUAL = 1.5
INCOMING_BIT = 1 << 17
flow_parameters = {
    "algorithm": "OpenCV DIS",
    "preset": "MEDIUM",
    "width": 600,
    "height": 400,
    "finestScale": 0,
    "gradientDescentIterations": 40,
    "patchSize": 8,
    "patchStride": 3,
    "variationalRefinementIterations": 10,
    "variationalRefinementAlpha": 20.0,
    "variationalRefinementDelta": 5.0,
    "variationalRefinementGamma": 10.0,
    "useMeanNormalization": True,
    "useSpatialPropagation": True,
    "grayscaleBeforeResize": True,
    "resize": "INTER_AREA",
    "threads": 1,
}


def calculate_flow(a, b):
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setFinestScale(0)
    dis.setGradientDescentIterations(40)
    dis.setPatchSize(8)
    dis.setPatchStride(3)
    dis.setVariationalRefinementIterations(10)
    dis.setVariationalRefinementAlpha(20)
    dis.setVariationalRefinementDelta(5)
    dis.setVariationalRefinementGamma(10)
    dis.setUseMeanNormalization(True)
    dis.setUseSpatialPropagation(True)
    return dis.calc(a, b, None)


y, x = np.mgrid[:ROWS, :COLS]
cells = np.stack([x, y], axis=-1).reshape(-1, 2).astype(np.float32)
stage = (cells + 0.5) * PITCH
source = (stage - [720, 400]) / 1.03 + [590.4, 400]
inside = (stage[:, 0] >= 117.6) & (stage[:, 0] <= 1322.4)
ids = np.arange(N, dtype=np.int32)
# OpenCV uses integer pixel centres; renderer source coordinates use pixel edges.
source_cv = source - 0.5
flow_cv = source / 2 - 0.5


def sample(image, points):
    return cv2.remap(
        image.astype(np.float32),
        points[:, 0].astype(np.float32).reshape(ROWS, COLS),
        points[:, 1].astype(np.float32).reshape(ROWS, COLS),
        cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    ).reshape(N, *image.shape[2:])


cap = cv2.VideoCapture(str(SOURCE))
rgb = []
matte = []
source_images = []
source_mattes = []
gray = []
if not cap.isOpened():
    raise ValueError(f"Could not decode {SOURCE}")
if abs(cap.get(cv2.CAP_PROP_FPS) - 12) > 1e-5:
    raise ValueError("Expected 12 fps packed source")
prop = cv2.imread(str(SUPPORT), cv2.IMREAD_UNCHANGED)
if prop is None:
    raise ValueError(f"Could not decode {SUPPORT}")
if prop.ndim == 3:
    prop = prop[:, :, 0]
prop_sample = sample(prop, source_cv) / 255
while True:
    ok, image = cap.read()
    if not ok:
        break
    if image.shape != (800, 2400, 3):
        raise ValueError("Expected packed source dimensions 2400x800")
    source_images.append(image[:, :1200, :3].copy())
    source_mattes.append(cv2.resize(image[:, 1200:, 0], (600, 400)) > 128)
    gray.append(
        cv2.resize(
            cv2.cvtColor(image[:, :1200, :3], cv2.COLOR_BGR2GRAY),
            (600, 400),
            interpolation=cv2.INTER_AREA,
        )
    )
    rgb.append(sample(image[:, :1200, :3], source_cv) / 255)
    m = np.maximum(sample(image[:, 1200:, 0], source_cv) / 255, prop_sample)
    t = np.clip((m - 0.04) / 0.88, 0, 1)
    matte.append(t * t * (3 - 2 * t))
cap.release()
if len(gray) != 48:
    raise ValueError(f"Expected 48 frames, decoded {len(gray)}")
pairs = []
for frame in range(48):
    following = (frame + 1) % 48
    pairs.append(
        [calculate_flow(gray[frame], gray[following]), calculate_flow(gray[following], gray[frame])]
    )
    if frame % 8 == 7:
        print(f"Computed optical flow for {frame+1}/48 adjacent pairs", flush=True)
pairs = np.array(pairs)
dense_y, dense_x = np.mgrid[:400, :600].astype(np.float32)
rgb = np.array(rgb)
matte = np.array(matte)
visible = (matte > 0.002) & inside[None, :]
mapping = []
summaries = []
atlas = np.full((ROWS * 6, COLS * 8, 4), 255, np.uint8)
begin = time.time()
for frame in range(48):
    following = (frame + 1) % 48
    forward = sample(pairs[frame, 0], flow_cv) * 2
    backward = sample(pairs[frame, 1], flow_cv) * 2
    prediction = source + forward
    reverse = sample(pairs[frame, 1], prediction / 2 - 0.5) * 2
    fb = np.linalg.norm((forward + reverse) / SOURCE_PITCH, axis=-1)
    # RGB residual at the continuous flow endpoint, not quantized target cell.
    target_image = source_images[following]
    warped = sample(target_image, prediction - 0.5) / 255
    photo = np.mean(abs(warped - rgb[frame]), axis=-1)
    confidence = np.exp(-((fb / 1.0) ** 2)) * np.exp(-((photo / 0.18) ** 2))
    displacement = forward / SOURCE_PITCH
    predicted_cell = cells + displacement
    reverse_cell = cells + backward / SOURCE_PITCH
    target_for = np.full(N, -1, np.int32)
    source_for = np.full(N, -1, np.int32)
    background = (~visible[frame]) & (~visible[following])
    quiet = (
        visible[frame]
        & visible[following]
        & (np.linalg.norm(displacement, axis=-1) < 0.30)
        & (fb < 0.75)
        & (photo < 0.18)
    )
    identity = background | quiet
    target_for[identity] = ids[identity]
    source_for[identity] = ids[identity]
    active = np.flatnonzero(
        visible[frame] & (~identity) & (confidence > 0.08) & (fb < 1.5) & (photo < 0.25)
    )
    offsets = np.array([(dx, dy) for dy in range(-2, 3) for dx in range(-2, 3)], np.int32)
    candidate_cell = (
        np.rint(predicted_cell[active]).astype(np.int32)[:, None, :] + offsets[None, :, :]
    )
    valid = (
        (candidate_cell[:, :, 0] >= 0)
        & (candidate_cell[:, :, 0] < COLS)
        & (candidate_cell[:, :, 1] >= 0)
        & (candidate_cell[:, :, 1] < ROWS)
    )
    candidate_id = np.clip(candidate_cell[:, :, 1], 0, ROWS - 1) * COLS + np.clip(
        candidate_cell[:, :, 0], 0, COLS - 1
    )
    residual = np.linalg.norm(candidate_cell - predicted_cell[active, None, :], axis=-1)
    reverse_residual = np.linalg.norm(reverse_cell[candidate_id] - cells[active, None, :], axis=-1)
    endpoint_rgb = np.mean(abs(rgb[following, candidate_id] - rgb[frame, active, None, :]), axis=-1)
    valid &= (
        (residual <= MAX_RESIDUAL)
        & (reverse_residual <= 2.0)
        & visible[following, candidate_id]
        & (source_for[candidate_id] < 0)
    )
    candidates_a = np.broadcast_to(active[:, None], candidate_id.shape)[valid]
    candidates_b = candidate_id[valid]
    cost = (
        residual**2
        + 0.15 * reverse_residual**2
        + 0.40 * (1 - confidence[active, None])
        + 0.35 * endpoint_rgb
    )[valid]
    order = np.argsort(cost, kind="stable")
    for k in order:
        a, b = candidates_a[k], candidates_b[k]
        if target_for[a] < 0 and source_for[b] < 0:
            target_for[a] = b
            source_for[b] = a
    mapped = target_for >= 0
    incoming = source_for >= 0
    vmap = visible[frame] & mapped
    moving = vmap & (target_for != ids)
    active_visible = visible[frame] & (np.linalg.norm(displacement, axis=-1) > 0.5)
    target_ids = target_for[mapped]
    if len(np.unique(target_ids)) != len(target_ids):
        raise ValueError(f"Duplicate target in pair {frame}")
    actual_residual = np.linalg.norm(cells[target_for[vmap]] - predicted_cell[vmap], axis=-1)
    actual_motion = np.linalg.norm((cells[target_for[moving]] - cells[moving]) * PITCH, axis=-1)
    data = (
        np.maximum(target_for + 1, 0).astype(np.uint32)
        | (incoming.astype(np.uint32) * INCOMING_BIT)
    ).reshape(ROWS, COLS)
    tx = frame % 8 * COLS
    ty = frame // 8 * ROWS
    tile = atlas[ty : ty + ROWS, tx : tx + COLS]
    tile[:, :, 0] = data & 255
    tile[:, :, 1] = (data >> 8) & 255
    tile[:, :, 2] = (data >> 16) & 255
    row = {
        "pair": frame,
        "visibleSource": int(visible[frame].sum()),
        "visibleTarget": int(visible[following].sum()),
        "visibleMatched": int(vmap.sum()),
        "visibleMatchedFraction": float(vmap.sum() / visible[frame].sum()),
        "movingRegionMatchedFraction": float(
            (mapped & active_visible).sum() / max(1, active_visible.sum())
        ),
        "movingDots": int(moving.sum()),
        "backgroundIdentities": int(background.sum()),
        "quietVisibleIdentities": int(quiet.sum()),
        "fadeOutDots": int((visible[frame] & ~mapped).sum()),
        "fadeInDots": int((visible[following] & ~incoming).sum()),
        "endpointResidualCells": np.quantile(actual_residual, [0.5, 0.95, 0.99, 1]).tolist(),
        "movementStagePixels": (
            np.quantile(actual_motion, [0.5, 0.95, 0.99, 1]).tolist()
            if len(actual_motion)
            else [0] * 4
        ),
        "uniqueTargetCount": int(len(target_ids)),
        "mappedCount": int(mapped.sum()),
        "candidateEdges": len(order),
    }
    mx = dense_x + pairs[frame, 0, :, :, 0]
    my = dense_y + pairs[frame, 0, :, :, 1]
    dense_reverse = cv2.remap(
        pairs[frame, 1], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    dense_error = np.linalg.norm(pairs[frame, 0] + dense_reverse, axis=-1) * 2
    dense_a = cv2.resize(source_images[frame], (600, 400)).astype(float) / 255
    dense_b = cv2.resize(source_images[following], (600, 400)).astype(float) / 255
    dense_warped = cv2.remap(dense_b, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    dense_photo = np.mean(abs(dense_warped - dense_a), axis=-1)
    row["denseForwardBackwardP95SourcePixels"] = float(
        np.quantile(dense_error[source_mattes[frame]], 0.95)
    )
    row["densePhotometricResidual"] = float(dense_photo[source_mattes[frame]].mean())
    row["transport"] = (
        row["visibleMatchedFraction"] >= 0.90
        and row["movingRegionMatchedFraction"] >= 0.70
        and row["denseForwardBackwardP95SourcePixels"] <= 12
    )
    summaries.append(row)
    mapping.append(target_for)
    print(
        frame,
        "visible match",
        round(row["visibleMatchedFraction"], 3),
        "moving match",
        round(row["movingRegionMatchedFraction"], 3),
        "move",
        row["movingDots"],
        "fade",
        row["fadeOutDots"],
        row["fadeInDots"],
        flush=True,
    )
if not cv2.imwrite(
    str(OUT / "correspondence.png"),
    cv2.cvtColor(atlas, cv2.COLOR_RGBA2BGRA),
    [cv2.IMWRITE_PNG_COMPRESSION, 9],
):
    raise ValueError("Could not write correspondence atlas")
# Verify the encoded and decoded artifact, including the incoming target mask.
written = cv2.cvtColor(
    cv2.imread(str(OUT / "correspondence.png"), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA
)
for frame, target_for in enumerate(mapping):
    tile = written[
        frame // 8 * ROWS : (frame // 8 + 1) * ROWS, frame % 8 * COLS : (frame % 8 + 1) * COLS
    ]
    packed = (
        tile[:, :, 0].astype(np.uint32)
        + 256 * tile[:, :, 1].astype(np.uint32)
        + 65536 * tile[:, :, 2].astype(np.uint32)
    )
    decoded = (packed % INCOMING_BIT).astype(np.int32).ravel() - 1
    incoming = (packed // INCOMING_BIT % 2).ravel()
    expected = np.zeros(N, bool)
    expected[target_for[target_for >= 0]] = True
    if (
        not np.array_equal(decoded, target_for)
        or not np.array_equal(incoming, expected)
        or not np.all(tile[:, :, 3] == 255)
    ):
        raise ValueError(f"Atlas verification failed for pair {frame}")
metadata = {
    "version": 1,
    "sourceSHA256": source_sha,
    "supportSHA256": support_sha,
    "opencvVersion": cv2.__version__,
    "numpyVersion": np.__version__,
    "flowParameters": flow_parameters,
    "grid": [COLS, ROWS],
    "tileGrid": [8, 6],
    "atlasSize": [COLS * 8, ROWS * 6],
    "frameCount": 48,
    "fps": 12,
    "referenceFrame": 6,
    "pitchStagePixels": PITCH.tolist(),
    "sourceDimensions": [1200, 800],
    "sourceCoordinateFormula": "source=(stage-[720,400])/1.03+[590.4,400]",
    "encoding": {
        "channels": "opaque RGBA8",
        "integer": "R + 256*G + 65536*B",
        "targetCode": "integer % 131072; 0 unmatched, otherwise targetIndex+1",
        "incomingMatched": "floor(integer / 131072) % 2",
        "targetIndex": "targetRow*400+targetColumn",
        "alpha": 255,
    },
    "maximumPredictionResidualCells": MAX_RESIDUAL,
    "bytes": (OUT / "correspondence.png").stat().st_size,
    "elapsedSeconds": time.time() - begin,
    "pairs": summaries,
}
(OUT / "correspondence.json").write_text(json.dumps(metadata, indent=2) + "\n")
confidence_metadata = {
    "version": 1,
    "sourceSHA256": source_sha,
    "supportSHA256": support_sha,
    "thresholds": {
        "minimumVisibleMatchedFraction": 0.90,
        "minimumMovingRegionMatchedFraction": 0.70,
        "maximumDenseForwardBackwardP95SourcePixels": 12,
    },
    "sharpSourcePairs": [r["pair"] for r in summaries if not r["transport"]],
    "pairs": [
        {
            k: r[k]
            for k in [
                "pair",
                "transport",
                "visibleMatchedFraction",
                "movingRegionMatchedFraction",
                "denseForwardBackwardP95SourcePixels",
                "densePhotometricResidual",
            ]
        }
        for r in summaries
    ],
}
(OUT / "interpolation-confidence.json").write_text(json.dumps(confidence_metadata, indent=2) + "\n")
print("Sharp source pairs:", confidence_metadata["sharpSourcePairs"], flush=True)
print("done", metadata["bytes"], "bytes", metadata["elapsedSeconds"], "seconds", flush=True)
