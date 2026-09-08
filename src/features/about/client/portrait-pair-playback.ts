import { createFramePairLoader, type FramePair } from "./frame-pair-loader";
import { createVideoFrameDecoder } from "./video-frame-decoder";

type PairedRenderer = {
  uploadPair: (first: TexImageSource, second: TexImageSource, pairIndex: number) => void;
  setInterpolation: (phase: number) => void;
};

/** Call after the renderer has uploaded and displayed its ordinary packed still. */
export function createPortraitPairPlayback(
  renderer: PairedRenderer,
  sourceURL: string,
  callbacks: {
    // Schedule or perform the usual render after all pair state is consistent.
    redraw: () => void;
    onPair?: (pair: FramePair<ImageBitmap>) => void;
    onError?: (error: Error) => void;
  },
) {
  let referenceTime = 6.5 / 12;
  let playing = false;
  const decoder = createVideoFrameDecoder(sourceURL, 12);
  const loader = createFramePairLoader<ImageBitmap>({
    decode: (frame, slot) => decoder.decode(frame, slot),
    close: (bitmap) => bitmap.close(),
    onPair(pair) {
      renderer.uploadPair(pair.first, pair.second, pair.index);
      renderer.setInterpolation(pair.phase);
      callbacks.onPair?.(pair);
      callbacks.redraw();
    },
    onPhase(phase) {
      renderer.setInterpolation(phase);
      callbacks.redraw();
    },
    onError(error) {
      callbacks.onError?.(error);
    },
  });
  return {
    isReady() {
      return loader.isReady();
    },
    setTime(seconds: number) {
      if (!playing && Math.abs(seconds - referenceTime) < 0.00000001) {
        loader.primeTime(seconds);
      } else {
        playing = true;
        loader.setTime(seconds);
      }
    },
    reset(seconds = 6.5 / 12) {
      referenceTime = seconds;
      playing = false;
      loader.reset();
      loader.primeTime(seconds);
    },
    pause() {
      loader.pause();
    },
    resume() {
      loader.resume();
    },
    diagnostics() {
      return loader.diagnostics();
    },
    destroy() {
      loader.destroy();
      decoder.destroy();
    },
  };
}
