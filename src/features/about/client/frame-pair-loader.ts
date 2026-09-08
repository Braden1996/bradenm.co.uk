/** Adjacent frames are published atomically; each published pair owns its phase. */
export type FramePair<T> = {
  index: number;
  first: T;
  second: T;
  phase: number;
};
export type FramePairOptions<T> = {
  decode: (frame: number, slot: number) => Promise<T>;
  close: (frame: T) => void;
  onPair: (pair: FramePair<T>) => void;
  onPhase: (phase: number) => void;
  onError?: (error: Error) => void;
  frameCount?: number;
  fps?: number;
};

export function framePairAt(seconds: number, frameCount = 48, fps = 12) {
  const time = Number.isFinite(seconds) ? seconds : 6.5 / 12;
  const position = (((time * fps - 0.5) % frameCount) + frameCount) % frameCount;
  const index = Math.floor(position);
  return { index, next: (index + 1) % frameCount, phase: position - index };
}

export function createFramePairLoader<T>(options: FramePairOptions<T>) {
  const count = options.frameCount ?? 48;
  const fps = options.fps ?? 12;
  if (!Number.isInteger(count) || count < 2 || !Number.isFinite(fps) || fps <= 0)
    throw new RangeError("Invalid portrait sequence timing");
  const cache = new Map<number, { frame: T; used: number }>();
  const inFlight = new Map<number, number>();
  const failed = new Map<number, Error>();
  const reportedFailures = new Set<number>();
  const busy = [false, false];
  let clock = 0;
  let destroyed = false;
  let active = true;
  let allowPublication = true;
  let requested: ReturnType<typeof framePairAt> | undefined;
  let displayed: number | undefined;
  let displayedPhase: number | undefined;
  let generation = 0;
  let maximumCached = 0;
  const decoded: number[] = [];

  function pinned(index: number) {
    return (
      index === displayed ||
      (displayed !== undefined && index === (displayed + 1) % count) ||
      index === requested?.index ||
      index === requested?.next
    );
  }

  function evict() {
    // At most four complete bitmaps: the visible pair and its replacement.
    while (cache.size > 4) {
      const candidate = [...cache.entries()]
        .filter(([index]) => !pinned(index))
        .toSorted((a, b) => a[1].used - b[1].used)[0];
      if (!candidate) throw new Error("Portrait cache exceeded its four-frame ownership bound");
      cache.delete(candidate[0]);
      options.close(candidate[1].frame);
    }
    maximumCached = Math.max(maximumCached, cache.size);
  }

  function publish() {
    if (!requested || destroyed || !active || !allowPublication) return;
    const first = cache.get(requested.index);
    const second = cache.get(requested.next);
    if (!first || !second) return;
    first.used = ++clock;
    second.used = ++clock;
    if (displayed === requested.index) {
      if (displayedPhase !== requested.phase) {
        displayedPhase = requested.phase;
        options.onPhase(requested.phase);
      }
      return;
    }
    // The latest requested phase is read here, never captured before an await.
    displayed = requested.index;
    displayedPhase = requested.phase;
    options.onPair({
      index: displayed,
      first: first.frame,
      second: second.frame,
      phase: requested.phase,
    });
  }

  function reportFailure(index: number) {
    const error = failed.get(index);
    if (destroyed || !error || reportedFailures.has(index)) return;
    if (index !== requested?.index && index !== requested?.next) return;
    reportedFailures.add(index);
    options.onError?.(error);
  }

  function pump() {
    if (!requested || destroyed || !active) return;
    const wanted = [requested.index, requested.next];
    // Only prefetch once the requested pair is ready. A stale decode finishes
    // without spawning more stale work; the next free slot always serves now.
    if (cache.has(requested.index) && cache.has(requested.next)) {
      wanted.push((requested.next + 1) % count);
    }
    for (let slot = 0; slot < 2; slot++) {
      if (busy[slot]) continue;
      const index = wanted.find(
        (frame) => !cache.has(frame) && !inFlight.has(frame) && !failed.has(frame),
      );
      if (index === undefined) continue;
      busy[slot] = true;
      inFlight.set(index, slot);
      void options
        .decode(index, slot)
        .then((frame) => {
          if (destroyed) {
            options.close(frame);
            return undefined;
          }
          decoded.push(index);
          if (decoded.length > 64) decoded.shift();
          cache.set(index, { frame, used: ++clock });
          publish();
          evict();
          return undefined;
        })
        // eslint-disable-next-line anti-slop/no-unknown-parameters -- Normalize untrusted promise rejections at the decoder boundary.
        .catch((reason: unknown) => {
          if (destroyed) return;
          const error =
            reason instanceof Error
              ? reason
              : new Error("Portrait frame decode failed", { cause: reason });
          failed.set(index, error);
          reportFailure(index);
        })
        .finally(() => {
          busy[slot] = false;
          inFlight.delete(index);
          pump();
        });
    }
  }

  function requestTime(seconds: number, publishNow: boolean) {
    if (destroyed) return;
    const next = framePairAt(seconds, count, fps);
    if (
      requested?.index === next.index &&
      requested.phase === next.phase &&
      allowPublication === publishNow
    )
      return;
    requested = next;
    allowPublication = publishNow;
    generation++;
    reportFailure(requested.index);
    reportFailure(requested.next);
    publish();
    evict();
    pump();
  }

  return {
    isReady() {
      return requested !== undefined && cache.has(requested.index) && cache.has(requested.next);
    },
    setTime(seconds: number) {
      requestTime(seconds, true);
    },
    primeTime(seconds: number) {
      requestTime(seconds, false);
    },
    pause() {
      active = false;
    },
    resume() {
      if (destroyed) return;
      active = true;
      publish();
      evict();
      pump();
    },
    reset() {
      requested = undefined;
      displayed = undefined;
      displayedPhase = undefined;
      allowPublication = false;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const { frame } of cache.values()) options.close(frame);
      cache.clear();
      displayed = undefined;
    },
    diagnostics() {
      return {
        generation,
        requested: requested?.index,
        displayed,
        cached: [...cache.keys()],
        inFlight: [...inFlight.keys()],
        maximumCached,
        decoded: [...decoded],
        failed: [...failed.keys()],
      };
    },
  };
}
