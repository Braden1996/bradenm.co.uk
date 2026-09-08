import { describe, expect, test } from "bun:test";
import { createPortraitPrograms } from "../src/features/about/client/typogravure-renderer";

function setup(options: { parallel?: boolean; failAllocation?: number; signal?: AbortController }) {
  const events: string[] = [];
  const deletedPrograms: (number | undefined)[] = [];
  const deletedShaders: (number | undefined)[] = [];
  const programIds = new Map<WebGLProgram, number>();
  const shaderIds = new Map<WebGLShader, number>();
  let programCount = 0;
  let shaderCount = 0;
  const gl: Parameters<typeof createPortraitPrograms>[0] = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    LINK_STATUS: 35714,
    getExtension: () => (options.parallel ? { COMPLETION_STATUS_KHR: 4 } : null),
    isContextLost: () => false,
    createShader: () => {
      const shader = {};
      shaderIds.set(shader, ++shaderCount);
      return shader;
    },
    createProgram: () => {
      if (++programCount === options.failAllocation) return null;
      const program = {};
      programIds.set(program, programCount);
      return program;
    },
    shaderSource: () => {},
    compileShader: () => {},
    attachShader: () => {},
    detachShader: () => {},
    linkProgram: (program) => {
      const id = programIds.get(program);
      events.push(`link:${id}`);
      setTimeout(() => {
        events.push(`yield:${id}`);
        options.signal?.abort();
      }, 0);
    },
    getProgramParameter: (program, status) => {
      const id = programIds.get(program);
      events.push(`status:${id}:${status}`);
      // Complete polling immediately; fail the final link before allocation.
      return status === 4 || id !== 7;
    },
    deleteProgram: (program) => {
      if (program) deletedPrograms.push(programIds.get(program));
    },
    deleteShader: (shader) => {
      if (shader) deletedShaders.push(shaderIds.get(shader));
    },
  };
  return { gl, events, deletedPrograms, deletedShaders };
}

describe("portrait shader initialization", () => {
  test("yields before and between program compilation without the extension", async () => {
    const state = setup({});
    const initializing = createPortraitPrograms(state.gl);
    expect(state.events).toEqual([]);
    expect(await initializing).toBeUndefined();
    for (let program = 1; program < 7; program++) {
      expect(state.events.indexOf(`yield:${program}`)).toBeLessThan(
        state.events.indexOf(`link:${program + 1}`),
      );
    }
    expect(state.deletedPrograms).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(state.deletedShaders).size).toBe(14);
    expect(state.deletedShaders).toHaveLength(14);
  });

  test("submits the complete batch before checking parallel completion", async () => {
    const state = setup({ parallel: true });
    const initializing = createPortraitPrograms(state.gl);
    expect(state.events.slice(0, 7)).toEqual([
      "link:1",
      "link:2",
      "link:3",
      "link:4",
      "link:5",
      "link:6",
      "link:7",
    ]);
    expect(state.events[7]).toBe("status:1:4");
    expect(await initializing).toBeUndefined();
    expect(state.deletedPrograms).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(state.deletedShaders).toHaveLength(14);
  });

  test("cancellation between programs stops compilation and releases partial work", async () => {
    const signal = new AbortController();
    const state = setup({ signal });
    expect(await createPortraitPrograms(state.gl, signal.signal)).toBeUndefined();
    expect(state.events.filter((event) => event.startsWith("link:"))).toEqual(["link:1"]);
    expect(state.deletedPrograms).toEqual([1]);
    expect(state.deletedShaders).toEqual([1, 2]);
  });

  test("allocation failure releases previous programs and partially allocated shaders once", async () => {
    const state = setup({ failAllocation: 3 });
    expect(await createPortraitPrograms(state.gl)).toBeUndefined();
    expect(state.deletedPrograms).toEqual([1, 2]);
    expect(state.deletedShaders).toEqual([5, 6, 1, 2, 3, 4]);
  });
});
