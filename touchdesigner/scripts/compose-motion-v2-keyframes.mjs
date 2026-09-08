// cspell:words keyframes

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(SCRIPT_DIRECTORY, "../..");
const KEYFRAME_ROOT = path.join(REPOSITORY, "images/source/about-motion/keyframes");
const V2_ROOT = path.join(KEYFRAME_ROOT, "v2");
const RAW_ROOT = path.join(V2_ROOT, "raw");

const POSES = [
  { frame: 0, source: path.join(KEYFRAME_ROOT, "frame-00.png") },
  { frame: 6, source: path.join(KEYFRAME_ROOT, "frame-02.png") },
  { frame: 9, source: path.join(RAW_ROOT, "mid-spoon.png") },
  { frame: 12, source: path.join(KEYFRAME_ROOT, "frame-03.png") },
  { frame: 18, source: path.join(KEYFRAME_ROOT, "frame-08.png") },
  { frame: 20, source: path.join(RAW_ROOT, "approach-close.png") },
  { frame: 21, source: path.join(RAW_ROOT, "contact.png") },
  { frame: 23, source: path.join(RAW_ROOT, "exit-close.png") },
  { frame: 24, source: path.join(RAW_ROOT, "withdrawal.png") },
  { frame: 25, source: path.join(RAW_ROOT, "withdrawal-between.png") },
  { frame: 26, source: path.join(RAW_ROOT, "withdrawal-mid.png") },
  { frame: 27, source: path.join(RAW_ROOT, "withdrawal-low.png") },
  { frame: 30, source: path.join(KEYFRAME_ROOT, "frame-05.png") },
  { frame: 36, source: path.join(KEYFRAME_ROOT, "frame-09.png") },
  { frame: 42, source: path.join(KEYFRAME_ROOT, "frame-06.png") },
  { frame: 45, source: path.join(KEYFRAME_ROOT, "frame-01.png") },
];

async function sha256(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

async function main() {
  const outputDirectory = path.join(V2_ROOT, "canonical");
  await fs.mkdir(outputDirectory, { recursive: true });

  const manifestPoses = await Promise.all(
    POSES.map(async (pose) => {
      const output = path.join(outputDirectory, `frame-${String(pose.frame).padStart(2, "0")}.png`);
      await fs.copyFile(pose.source, output);

      return {
        frame: pose.frame,
        output: path.relative(REPOSITORY, output),
        outputSha256: await sha256(output),
        source: path.relative(REPOSITORY, pose.source),
        sourceSha256: await sha256(pose.source),
      };
    }),
  );

  const manifest = {
    dimensions: { height: 1023, width: 1537 },
    notes:
      "Each selected pose is a complete, composition-locked frame. Keeping those accepted pixels intact reproduces the independently approved hand, spoon, glasses, and bite motion exactly; gelato continuity is applied later as a final-space prop patch.",
    poses: manifestPoses,
  };
  await fs.writeFile(
    path.join(V2_ROOT, "canonical-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

await main();
