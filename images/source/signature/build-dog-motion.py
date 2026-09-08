"""Measure small mesh deformations between the existing dog drawings.

This is numeric image analysis, not artwork generation or a raster export. The
three input atlases are only read. See dog-motion-readme.md for setup and format.
"""

from hashlib import sha256
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "public/about/signature"
WIDTH, HEIGHT, STEP, QUANTIZATION = 150, 180, 10, 16
MAX_FRACTION = 0.62
MAX_DEFORMATION_NORM = 0.35
DIRECTIONS = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
X, Y = np.meshgrid(np.arange(0, WIDTH + 1, STEP), np.arange(0, HEIGHT + 1, STEP))
GRID = np.stack([X, Y], axis=-1).reshape(-1, 2).astype(np.float32)
INDICES = np.arange(len(GRID)).reshape(19, 16)
TRIANGLES = np.concatenate(
    [
        np.stack([INDICES[:-1, :-1], INDICES[:-1, 1:], INDICES[1:, :-1]], axis=-1).reshape(-1, 3),
        np.stack([INDICES[1:, 1:], INDICES[1:, :-1], INDICES[:-1, 1:]], axis=-1).reshape(-1, 3),
    ]
)
SOURCE_TRIANGLES = GRID[TRIANGLES]
INVERSE_EDGES = np.linalg.inv(
    np.stack(
        [SOURCE_TRIANGLES[:, 1] - SOURCE_TRIANGLES[:, 0], SOURCE_TRIANGLES[:, 2] - SOURCE_TRIANGLES[:, 0]],
        axis=-1,
    )
)
GRADIENT = np.zeros((len(TRIANGLES), 2, len(GRID)), dtype=np.float64)
for triangle, corners in enumerate(TRIANGLES):
    GRADIENT[triangle, :, corners[1]] = INVERSE_EDGES[triangle, 0]
    GRADIENT[triangle, :, corners[2]] = INVERSE_EDGES[triangle, 1]
    GRADIENT[triangle, :, corners[0]] = -INVERSE_EDGES[triangle].sum(axis=0)


def candidate_weights(count, body=False):
    weights = list(MAX_FRACTION * np.eye(count))
    if not body:
        for horizontal in [-1, 1]:
            for vertical in [-1, 1]:
                weight = np.zeros(count)
                weight[DIRECTIONS.index((horizontal, 0))] = MAX_FRACTION * (1 - MAX_FRACTION)
                weight[DIRECTIONS.index((0, vertical))] = MAX_FRACTION * (1 - MAX_FRACTION)
                weight[DIRECTIONS.index((horizontal, vertical))] = MAX_FRACTION**2
                weights.append(weight)
    return np.stack(weights)


def regularize(fields, body=False):
    """Keep measured movement while limiting excessive local stretch and squash.

    Solve the closest displacement fields whose candidate triangle gradients
    have spectral norm <= 0.33. This is a local convex constraint: translations
    cost nothing, unlike scaling each complete head's motion towards zero.
    Fixed body vertices and unavailable directions are excluded from the solve.
    Direction-specific pins are exact equalities in each quadratic update.
    """
    weights = candidate_weights(len(fields), body)
    active = np.any(fields != 0, axis=(1, 2))
    free = np.any(fields != 0, axis=(0, 2))
    if not np.any(active) or not np.any(free):
        return fields, {"regularized": False, "maximumCorrection": 0, "rmsCorrection": 0}
    weights = weights[:, active]
    gradient = GRADIENT[:, :, free].reshape(-1, np.count_nonzero(free))
    original = fields[active][:, free].astype(np.float64)

    def apply(values):
        measured = np.einsum("tn,fnc->ftc", gradient, values, optimize=True)
        measured = measured.reshape(len(original), len(TRIANGLES), 2, 2).swapaxes(2, 3)
        return np.einsum("gf,ftci->gtci", weights, measured, optimize=True)

    def transpose(values):
        measured = np.einsum("gf,gtci->ftci", weights, values, optimize=True)
        measured = measured.swapaxes(2, 3).reshape(len(original), -1, 2)
        return np.einsum("tn,ftc->fnc", gradient, measured, optimize=True)

    measured = apply(original)
    if np.linalg.svd(measured, compute_uv=False).max() <= 0.33:
        return fields, {"regularized": False, "maximumCorrection": 0, "rmsCorrection": 0}

    # The quadratic update separates into direction and spatial eigenvectors.
    # These small dense solves need only NumPy, without another build dependency.
    direction_values, direction_vectors = np.linalg.eigh(weights.T @ weights)
    space_values, space_vectors = np.linalg.eigh(gradient.T @ gradient)
    penalty = 400
    denominator = 1 + penalty * direction_values[:, None] * space_values[None, :]

    def solve(right):
        transformed = np.einsum(
            "fi,fnc,nj->ijc", direction_vectors, right, space_vectors, optimize=True
        )
        return np.einsum(
            "fi,ijc,nj->fnc", direction_vectors,
            transformed / denominator[:, :, None], space_vectors, optimize=True
        )

    # Spatial eigenvectors are shared across directions, but a target angle may
    # pin a vertex that another target needs for its jaw. Enforce these exact
    # equalities inside the quadratic solve via its small Schur complement.
    # Zeroing them afterwards would create new gradients and force a global
    # reduction of otherwise useful head movement at the final safety pass.
    pinned = ~np.any(original != 0, axis=-1)
    pin_indices = np.flatnonzero(pinned.reshape(-1))
    pin_correction = None
    if len(pin_indices):
        basis = np.zeros((*original.shape[:2], len(pin_indices)))
        basis.reshape(-1, len(pin_indices))[pin_indices, np.arange(len(pin_indices))] = 1
        inverse_basis = solve(basis)
        covariance = inverse_basis.reshape(-1, len(pin_indices))[pin_indices]
        pin_correction = np.einsum(
            "fnk,kl->fnl", inverse_basis, np.linalg.inv(covariance), optimize=True
        )

    projected = measured.copy()
    dual = np.zeros_like(measured)
    result = original.copy()
    for iteration in range(300):
        right = original + penalty * transpose(projected - dual)
        result = solve(right)
        if pin_correction is not None:
            result -= np.einsum(
                "fnk,kc->fnc", pin_correction, result.reshape(-1, 2)[pin_indices], optimize=True
            )
            result[pinned] = 0
        measured = apply(result)
        left, singular, right = np.linalg.svd(measured + dual, full_matrices=False)
        projected = (left * np.minimum(singular, 0.33)[..., None, :]) @ right
        dual += measured - projected
        if iteration % 10 == 9 and np.max(np.abs(measured - projected)) < 0.0005:
            break

    output = np.zeros_like(fields)
    for index, direction in enumerate(np.flatnonzero(active)):
        output[direction, free] = result[index]
    correction = np.linalg.norm(output - fields, axis=-1)
    return output, {
        "regularized": True,
        "iterations": iteration + 1,
        "maximumCorrection": round(float(correction.max()), 6),
        "rmsCorrection": round(float(np.sqrt(np.mean(correction**2))), 6),
    }


def grayscale(image):
    alpha = image[:, :, 3:4] / 255
    opaque = np.uint8(np.round(image[:, :, :3] * alpha + 255 * (1 - alpha)))
    return cv2.cvtColor(opaque, cv2.COLOR_BGR2GRAY)


def read_head_weights():
    """Use the compositor's ownership mask over each vertex's complete support.

    A vertex affects triangles up to STEP pixels away, so pin it when any part
    of that support belongs to the canonical chest. Reading the actual mask
    through Bun avoids a second implementation of its pitch and jaw boundaries.
    """
    script = """
import { headWeight } from "./images/source/signature/rig-dog.mjs";
const poses = ["seated", "lying"].map((pose) =>
  Array.from({ length: 35 }, (_, frame) =>
    Array.from({ length: 304 }, (_, vertex) => {
      const x = (vertex % 16) * 10;
      const y = Math.floor(vertex / 16) * 10;
      let weight = 1;
      for (let dy = -10; dy <= 10 && weight; dy++) {
        for (let dx = -10; dx <= 10 && weight; dx++) {
          weight = Math.min(weight, headWeight((x + dx) * 2, (y + dy) * 2, pose, frame));
        }
      }
      return weight;
    }),
  ),
);
process.stdout.write(JSON.stringify(poses));
"""
    result = subprocess.run(
        ["bun", "--eval", script], cwd=ROOT, check=True, capture_output=True, text=True
    )
    weights = np.array(json.loads(result.stdout), dtype=np.float32)
    assert weights.shape == (2, 35, len(GRID))
    assert np.all(np.isfinite(weights)) and np.all((weights >= 0) & (weights <= 1))
    return weights


def measure(source, target, pose, ownership=None):
    estimator = cv2.DISOpticalFlow_create(cv2.DISOpticalFlow_PRESET_MEDIUM)
    estimator.setFinestScale(0)
    estimator.setGradientDescentIterations(50)
    estimator.setVariationalRefinementIterations(10)
    flow = estimator.calc(grayscale(source), grayscale(target), None)
    # Follow facial shapes rather than every individual tuft of fur.
    flow = cv2.GaussianBlur(flow, (0, 0), 1.8)
    y, x = np.mgrid[:HEIGHT, :WIDTH]
    if pose == "body":
        # Feet and ground remain on the common baseline while the body lowers.
        weight = np.clip((170 - y) / 20, 0, 1)
    else:
        weight = 1
    limit = 42 if pose == "body" else 28
    magnitude = np.linalg.norm(flow, axis=2)
    flow *= (np.minimum(1, limit / np.maximum(magnitude, 1e-9)) * weight)[:, :, None]
    sampled = cv2.remap(flow, GRID[:, 0:1], GRID[:, 1:2], cv2.INTER_LINEAR)[:, 0]
    if ownership is not None:
        sampled *= ownership[:, None]
    return sampled


def jacobian(vectors):
    points = vectors[TRIANGLES]
    edges = np.stack([points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]], axis=-1)
    return edges @ INVERSE_EDGES


def deformation_norm(vectors):
    return float(np.linalg.svd(jacobian(vectors), compute_uv=False).max())


def area_ratio(vectors):
    points = (GRID + vectors)[TRIANGLES]
    first, second = points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]
    return float((first[:, 0] * second[:, 1] - first[:, 1] * second[:, 0]).min() / STEP**2)


def limiting_deformations(fields, body=False):
    # Bilinear weights are used relative to whichever texture is selected:
    # u(1-v) toward horizontal, v(1-u) toward vertical, and uv toward diagonal.
    # Each triangle's deformation Jacobian is bilinear in u,v. The spectral
    # norm is convex, so its maximum over the square occurs at a corner.
    candidates = [MAX_FRACTION * field for field in fields]
    if not body:
        for horizontal in [-1, 1]:
            for vertical in [-1, 1]:
                side = fields[DIRECTIONS.index((horizontal, 0))]
                above = fields[DIRECTIONS.index((0, vertical))]
                diagonal = fields[DIRECTIONS.index((horizontal, vertical))]
                candidates.append(
                    MAX_FRACTION * (1 - MAX_FRACTION) * (side + above)
                    + MAX_FRACTION**2 * diagonal
                )
    return candidates


def safe_quantized(fields, body=False):
    fields, regularization = regularize(fields, body)
    # ||deformation Jacobian|| <= 0.35 bounds local linear size to 0.65..1.35,
    # which prevents awkward squashing as well as triangle inversions. The
    # local solve leaves room for quantization; scaling here is only a guard.
    maximum = max(map(deformation_norm, limiting_deformations(fields, body)))
    scale = min(1, 0.34 / max(maximum, 1e-9))
    while True:
        quantized = np.round(fields * scale * QUANTIZATION).astype("<i2")
        decoded = quantized.astype(np.float32) / QUANTIZATION
        candidates = limiting_deformations(decoded, body)
        maximum = max(map(deformation_norm, candidates))
        if maximum <= MAX_DEFORMATION_NORM:
            break
        scale *= 0.98
    minimum = min(map(area_ratio, candidates))
    assert minimum > 0, "A measured deformation folds a mesh triangle"
    return quantized, {"scale": round(scale, 6), "maximumNorm": round(maximum, 6), "minimumAreaRatio": round(minimum, 6), **regularization}


def read_frames(name, columns, rows):
    path = OUTPUT / name
    atlas = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    assert atlas is not None and atlas.shape == (rows * HEIGHT, columns * WIDTH, 4), path
    return [
        atlas[row * HEIGHT : (row + 1) * HEIGHT, column * WIDTH : (column + 1) * WIDTH].copy()
        for row in range(rows)
        for column in range(columns)
    ]


def main():
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    seated = read_frames("dog-seated.webp", 7, 5)
    lying = read_frames("dog-lying.webp", 7, 5)
    transition = read_frames("dog-sprites.webp", 5, 3)
    head_weights = read_head_weights()
    gaze = []
    validation = []
    for pose_index, (pose, frames) in enumerate([("seated", seated), ("lying", lying)]):
        for index, source in enumerate(frames):
            row, column = divmod(index, 7)
            fields = []
            for dx, dy in DIRECTIONS:
                if 0 <= column + dx < 7 and 0 <= row + dy < 5:
                    target = (row + dy) * 7 + column + dx
                    ownership = np.minimum(
                        head_weights[pose_index, index], head_weights[pose_index, target]
                    )
                    fields.append(measure(source, frames[target], pose, ownership))
                else:
                    fields.append(np.zeros_like(GRID))
            quantized, metrics = safe_quantized(np.stack(fields))
            gaze.append(quantized)
            validation.append({"pose": pose, "frame": index, **metrics})
    body_frames = [seated[15], *transition[5:10], lying[15]]
    body = []
    for index, source in enumerate(body_frames):
        fields = [
            measure(source, body_frames[target], "body") if 0 <= target < 7 else np.zeros_like(GRID)
            for target in [index - 1, index + 1]
        ]
        quantized, metrics = safe_quantized(np.stack(fields), body=True)
        body.append(quantized)
        validation.append({"pose": "body", "frame": index, **metrics})
    gaze_bytes = np.stack(gaze).astype("<i2").tobytes()
    body_bytes = np.stack(body).astype("<i2").tobytes()
    binary = gaze_bytes + body_bytes
    # Use an ordinary same-origin image request under the site's existing CSP.
    # RGB channels hold sequential payload bytes; alpha is implicitly opaque.
    # OpenCV writes unprofiled PNG data, so browser decoding preserves bytes.
    image_width = 512
    image_height = (len(binary) + image_width * 3 - 1) // (image_width * 3)
    padding = image_width * image_height * 3 - len(binary)
    pixels = np.frombuffer(binary + bytes(padding), dtype=np.uint8).reshape(image_height, image_width, 3)
    cv2.imwrite(str(OUTPUT / "dog-motion.png"), pixels[:, :, ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
    metadata = {
        "version": 1,
        "encoding": "little-endian-int16",
        "unitsPerPixel": QUANTIZATION,
        "frameWidth": WIDTH,
        "frameHeight": HEIGHT,
        "gridStep": STEP,
        "gridColumns": 16,
        "gridRows": 19,
        "maxFraction": MAX_FRACTION,
        "gaze": {"byteOffset": 0, "byteLength": len(gaze_bytes), "poses": ["seated", "lying"], "framesPerPose": 35, "directions": DIRECTIONS},
        "body": {"byteOffset": len(gaze_bytes), "byteLength": len(body_bytes), "frames": 7, "directions": [-1, 1], "restingColumn": 1, "restingRow": 2},
        "byteLength": len(binary),
        "image": {"width": image_width, "height": image_height, "encoding": "sequential RGB bytes with zero padding"},
        "sha256": sha256(binary).hexdigest(),
        "sources": {
            name: sha256((OUTPUT / name).read_bytes()).hexdigest()
            for name in ["dog-seated.webp", "dog-lying.webp", "dog-sprites.webp"]
        },
        "ownership": {
            "source": "images/source/signature/rig-dog.mjs",
            "sha256": sha256((ROOT / "images/source/signature/rig-dog.mjs").read_bytes()).hexdigest(),
            "supportRadius": STEP,
            "samplingStep": 1,
            "rule": "minimum compositor ownership across each vertex support in both drawings",
        },
        "generator": {"opencv": cv2.__version__, "numpy": np.__version__, "method": "DIS medium", "smoothingSigma": 1.8, "maximumDeformationNorm": MAX_DEFORMATION_NORM, "regularization": "local gradient projection"},
        "validation": {
            "scaledFrames": sum(entry["scale"] < 1 for entry in validation),
            "minimumScale": min(entry["scale"] for entry in validation),
            "maximumDeformationNorm": max(entry["maximumNorm"] for entry in validation),
            "minimumTriangleAreaRatio": min(entry["minimumAreaRatio"] for entry in validation),
            "foldedTriangles": 0,
            "regularizedFrames": sum(entry["regularized"] for entry in validation),
            "maximumLocalCorrection": max(entry["maximumCorrection"] for entry in validation),
            "frames": validation,
        },
    }
    (OUTPUT / "dog-motion.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"bytes": len(binary), "sha256": metadata["sha256"], **{key: value for key, value in metadata["validation"].items() if key != "frames"}}, indent=2))


if __name__ == "__main__":
    main()
