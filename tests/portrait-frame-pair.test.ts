import { describe, expect, test } from "bun:test";
import { createFramePairLoader, framePairAt } from "../src/features/about/client/frame-pair-loader";

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
function fixture() {
  type Frame = { id: number; closed: boolean };
  const jobs = new Map<
    number,
    {
      slot: number;
      resolve: (frame: Frame) => void;
      reject: (error: Error) => void;
    }
  >();
  const started: number[] = [];
  const published: {
    index: number;
    first: Frame;
    second: Frame;
    phase: number;
  }[] = [];
  const phases: number[] = [];
  const closed: number[] = [];
  const errors: unknown[] = [];
  const loader = createFramePairLoader({
    decode: (id: number, slot: number) =>
      new Promise<Frame>((resolve, reject) => {
        started.push(id);
        jobs.set(id, { slot, resolve, reject });
      }),
    close(frame: Frame) {
      expect(frame.closed).toBe(false);
      frame.closed = true;
      closed.push(frame.id);
    },
    onPair(pair) {
      expect(pair.first.closed || pair.second.closed).toBe(false);
      published.push(pair);
    },
    onPhase(phase) {
      phases.push(phase);
    },
    onError(error) {
      errors.push(error);
    },
  });
  async function finish(id: number) {
    const job = jobs.get(id);
    if (!job) throw new Error(`No decode pending for ${id}`);
    job.resolve({ id, closed: false });
    await flush();
  }
  return { loader, jobs, started, published, phases, closed, errors, finish };
}

const time = (index: number, phase = 0) => (index + phase + 0.5) / 12;
describe("adjacent portrait frame ownership", () => {
  test("uses exact authored frame centres and wraps both sides of the loop", () => {
    expect(framePairAt(6.5 / 12)).toEqual({ index: 6, next: 7, phase: 0 });
    expect(framePairAt(time(47, 0.25))).toEqual({
      index: 47,
      next: 0,
      phase: 0.25,
    });
    expect(framePairAt(time(48, 0.25))).toEqual({
      index: 0,
      next: 1,
      phase: 0.25,
    });
    expect(framePairAt(time(-1, 0.25))).toEqual({
      index: 47,
      next: 0,
      phase: 0.25,
    });
  });
  test("publishes no half-decoded pair and uses the latest phase after both seeks", async () => {
    const f = fixture();
    f.loader.setTime(time(6, 0.1));
    await f.finish(7);
    expect(f.published).toHaveLength(0);
    f.loader.setTime(time(6, 0.8));
    expect(f.phases).toHaveLength(0);
    await f.finish(6);
    expect(f.published).toHaveLength(1);
    expect(f.published[0]?.first.id).toBe(6);
    expect(f.published[0]?.second.id).toBe(7);
    expect(f.published[0]?.phase).toBeCloseTo(0.8, 10);
    f.loader.setTime(time(6, 0.9));
    expect(f.phases[0]).toBeCloseTo(0.9, 10);
    f.loader.destroy();
  });
  test("skips stale playback positions instead of building a queue of obsolete seeks", async () => {
    const f = fixture();
    f.loader.setTime(time(6));
    for (let index = 7; index <= 30; index++) f.loader.setTime(time(index, 0.4));
    await f.finish(6);
    await f.finish(7);
    expect(f.started).toEqual([6, 7, 30, 31]);
    expect(f.published).toHaveLength(0);
    await f.finish(31);
    expect(f.published).toHaveLength(0);
    await f.finish(30);
    expect(f.published.map((pair) => pair.index)).toEqual([30]);
    expect(f.published[0]?.phase).toBeCloseTo(0.4, 10);
    f.loader.destroy();
  });
  test("retains the displayed pair until its replacement is complete and keeps four cached frames", async () => {
    const f = fixture();
    f.loader.setTime(time(6));
    await f.finish(6);
    await f.finish(7);
    await f.finish(8);
    f.loader.setTime(time(20));
    await f.finish(20);
    expect(f.closed).not.toContain(6);
    expect(f.closed).not.toContain(7);
    await f.finish(21);
    expect(f.published.map((pair) => pair.index)).toEqual([6, 20]);
    await f.finish(22);
    expect(f.loader.diagnostics().cached.length).toBeLessThanOrEqual(4);
    expect(f.loader.diagnostics().maximumCached).toBeLessThanOrEqual(4);
    expect(f.closed.length).toBeGreaterThan(0);
    f.loader.destroy();
  });
  test("closes a late bitmap after disposal without publishing it", async () => {
    const f = fixture();
    f.loader.setTime(time(6));
    await f.finish(6);
    f.loader.destroy();
    await f.finish(7);
    expect(f.closed.toSorted((a, b) => a - b)).toEqual([6, 7]);
    expect(f.published).toHaveLength(0);
    expect(f.loader.diagnostics().cached).toEqual([]);
  });
  test("reports failed required frames without retry loops", async () => {
    const f = fixture();
    f.loader.setTime(time(6));
    f.jobs.get(6)?.reject(new Error("Fixture decode failure"));
    await flush();
    await f.finish(7);
    expect(f.errors).toHaveLength(1);
    expect(f.started).toEqual([6, 7]);
    expect(f.published).toHaveLength(0);
    f.loader.destroy();
  });
});

describe("resting and hidden portrait lifecycle", () => {
  test("primes reference pixels without replacing the resting still", async () => {
    const f = fixture();
    f.loader.primeTime(time(6));
    await f.finish(6);
    await f.finish(7);
    await f.finish(8);
    expect(f.published).toHaveLength(0);
    f.loader.setTime(time(6, 0.1));
    expect(f.published).toHaveLength(1);
    expect(f.published[0]?.phase).toBeCloseTo(0.1, 10);
    f.loader.reset();
    f.loader.primeTime(time(6));
    expect(f.published).toHaveLength(1);
    f.loader.setTime(time(6, 0.2));
    expect(f.published).toHaveLength(2);
    f.loader.destroy();
  });
  test("holds completed seeks while hidden, then publishes once on resume", async () => {
    const f = fixture();
    f.loader.setTime(time(6));
    f.loader.pause();
    await f.finish(6);
    await f.finish(7);
    expect(f.published).toHaveLength(0);
    expect(f.started).toEqual([6, 7]);
    f.loader.setTime(time(6, 0.7));
    f.loader.resume();
    expect(f.published).toHaveLength(1);
    expect(f.published[0]?.phase).toBeCloseTo(0.7, 10);
    f.loader.setTime(time(6, 0.7));
    expect(f.phases).toHaveLength(0);
    f.loader.destroy();
  });
});

test("reports a failed prefetched frame when that frame becomes required", async () => {
  const f = fixture();
  f.loader.setTime(time(6));
  await f.finish(6);
  await f.finish(7);
  f.jobs.get(8)?.reject(new Error("Prefetch failed"));
  await flush();
  expect(f.errors).toHaveLength(0);
  f.loader.setTime(time(7));
  expect(f.errors).toHaveLength(1);
  f.loader.setTime(time(7, 0.5));
  expect(f.errors).toHaveLength(1);
  f.loader.destroy();
});
