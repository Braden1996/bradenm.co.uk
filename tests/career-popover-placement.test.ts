import { describe, expect, test } from "bun:test";
import { placeCareerPopover } from "../src/features/about/lib/career-popover-placement";

const viewport = { viewportHeight: 900, viewportWidth: 1440 };
const popover = { popoverHeight: 160, popoverWidth: 230 };
const column = { columnLeft: 350, columnRight: 1010 };
const trigger = { height: 26, left: 852, top: 458, width: 68 };
const desktop = { ...viewport, ...popover, ...column, triggerRect: trigger };

describe("placeCareerPopover", () => {
  test("places a right-hand link's note in the right gutter with room for its connector", () => {
    const placement = placeCareerPopover(desktop);
    expect(placement).toMatchObject({
      caret: 45,
      height: 160,
      placement: "right",
      top: 426,
      width: 230,
    });
    expect(placement.left).toBeCloseTo(1128.849, 3);
  });

  test("places a left-hand link's note in the left gutter", () => {
    const placement = placeCareerPopover({ ...desktop, triggerRect: { ...trigger, left: 380 } });
    expect(placement).toMatchObject({
      caret: 45,
      height: 160,
      placement: "left",
      top: 426,
      width: 230,
    });
    expect(placement.left).toBeCloseTo(31.708, 3);
  });

  test("lets wider notes grow with either gutter while preserving connector and edge space", () => {
    for (const viewportWidth of [1280, 1440, 1790, 2560]) {
      const columnLeft = (viewportWidth - 680) / 2;
      const columnRight = columnLeft + 680;

      for (const side of ["left", "right"] as const) {
        const placement = placeCareerPopover({
          ...desktop,
          columnLeft,
          columnRight,
          popoverWidth: 384,
          railGap: 64,
          triggerRect: { ...trigger, left: side === "left" ? columnLeft : columnRight - 68 },
          viewportWidth,
        });

        expect(placement.placement).toBe(side);
        expect(placement.width).toBe(Math.min(384, columnLeft - 28 - 64));
        expect(placement.left).toBeGreaterThanOrEqual(28);
        expect(placement.left + placement.width).toBeLessThanOrEqual(viewportWidth - 28);
        const gap =
          side === "left"
            ? columnLeft - placement.left - placement.width
            : placement.left - columnRight;
        if (placement.width < 384) {
          expect(gap).toBe(64);
        } else {
          expect(gap).toBeGreaterThan(64);
          expect(gap).toBeLessThanOrEqual(160);
        }
      }
    }
  });

  test("shares spare gutter space asymmetrically and mirrors the balance on both sides", () => {
    const viewportWidth = 2032;
    const columnLeft = 676;
    const columnRight = 1356;
    const input = {
      ...desktop,
      columnLeft,
      columnRight,
      popoverWidth: 384,
      railGap: 64,
      viewportWidth,
    };
    const left = placeCareerPopover({ ...input, triggerRect: { ...trigger, left: columnLeft } });
    const right = placeCareerPopover({
      ...input,
      triggerRect: { ...trigger, left: columnRight - trigger.width },
    });
    const innerGap = right.left - columnRight;
    const outerGap = viewportWidth - 28 - right.left - right.width;

    expect(right.width).toBe(384);
    expect(innerGap).toBeCloseTo(140.393, 3);
    expect(innerGap - 64).toBeLessThan(outerGap);
    expect(columnLeft - left.left - left.width).toBeCloseTo(innerGap);
    expect(left.left + right.left + right.width).toBeCloseTo(viewportWidth);
  });

  test("grows to full width before moving outward and stays continuous as the viewport widens", () => {
    const placements = Array.from({ length: 701 }, (_, index) => {
      const viewportWidth = 1500 + index;
      const columnLeft = (viewportWidth - 680) / 2;
      const columnRight = columnLeft + 680;
      return placeCareerPopover({
        ...desktop,
        columnLeft,
        columnRight,
        popoverWidth: 384,
        railGap: 64,
        triggerRect: { ...trigger, left: columnRight - trigger.width },
        viewportWidth,
      });
    });

    for (const [index, placement] of placements.entries()) {
      const columnRight = (1500 + index + 680) / 2;
      expect(placement.placement).toBe("right");
      expect(placement.width).toBeLessThanOrEqual(384);
      if (placement.width < 384) expect(placement.left - columnRight).toBe(64);
      const previous = placements[index - 1];
      if (!previous) continue;
      expect(placement.width).toBeGreaterThanOrEqual(previous.width);
      expect(placement.left - previous.left).toBeGreaterThan(0);
      expect(placement.left - previous.left).toBeLessThan(1);
    }
  });

  test("limits the outward offset on ultrawide screens", () => {
    const placement = placeCareerPopover({
      ...desktop,
      columnLeft: 2160,
      columnRight: 2840,
      popoverWidth: 384,
      railGap: 64,
      triggerRect: { ...trigger, left: 2700 },
      viewportWidth: 5000,
    });

    expect(placement.placement).toBe("right");
    expect(placement.width).toBe(384);
    expect(placement.left - 2840).toBe(160);
    expect(placement.left + placement.width).toBeLessThan(4972);
  });

  test("uses the opposite gutter when the nearest gutter is too narrow", () => {
    const right = placeCareerPopover({
      ...desktop,
      columnLeft: 220,
      triggerRect: { ...trigger, left: 240 },
    });
    const left = placeCareerPopover({ ...desktop, columnRight: 1250 });

    expect(right.placement).toBe("right");
    expect(left.placement).toBe("left");
  });

  test("reduces the connector gap only when needed to keep a gutter readable", () => {
    const regular = placeCareerPopover({ ...desktop, columnRight: 1118 });
    const reduced = placeCareerPopover({ ...desktop, columnRight: 1119 });
    const minimum = placeCareerPopover({ ...desktop, columnRight: 1156 });

    expect(regular.left - 1118).toBe(86);
    expect(reduced.left - 1119).toBe(85);
    expect(minimum.left - 1156).toBe(48);
    for (const placement of [regular, reduced, minimum]) {
      expect(placement.placement).toBe("right");
      expect(placement.width).toBe(208);
      expect(placement.left + placement.width).toBe(1412);
    }
  });

  test("uses a modal when neither gutter has a readable width", () => {
    expect(placeCareerPopover({ ...desktop, columnLeft: 283, columnRight: 1157 })).toEqual({
      caret: 0,
      height: 160,
      left: 605,
      placement: "modal",
      top: 370,
      width: 230,
    });
  });

  test("never overlaps the text column or the trigger in either gutter", () => {
    for (const left of [350, 500, 650, 800, 942]) {
      const triggerRect = { ...trigger, left };
      const placement = placeCareerPopover({ ...desktop, triggerRect });

      expect(placement.placement).not.toBe("modal");
      if (placement.placement === "right") {
        expect(placement.left).toBeGreaterThanOrEqual(column.columnRight + 48);
        expect(placement.left).toBeGreaterThanOrEqual(left + trigger.width);
      } else {
        expect(placement.left + placement.width).toBeLessThanOrEqual(column.columnLeft - 48);
        expect(placement.left + placement.width).toBeLessThanOrEqual(left);
      }
    }
  });

  test("rejects a gutter that would overlap a trigger outside the reported text column", () => {
    const placement = placeCareerPopover({
      ...desktop,
      columnLeft: 220,
      columnRight: 700,
    });

    expect(placement.placement).toBe("modal");
  });

  test("preserves heading alignment when a different note has more content", () => {
    expect(placeCareerPopover(desktop).top).toBe(
      placeCareerPopover({ ...desktop, popoverHeight: 300 }).top,
    );
  });

  test("lifts a long gutter note to show all its content near a low trigger", () => {
    for (const left of [380, 852]) {
      const input = { ...desktop, triggerRect: { ...trigger, left, top: 591 } };
      const short = placeCareerPopover({ ...input, popoverHeight: 160 });
      const long = placeCareerPopover({ ...input, popoverHeight: 420 });

      expect(long.placement).not.toBe("modal");
      expect(long.top).toBe(452);
      expect(long.top).toBeLessThan(short.top);
      expect(long.top + long.caret).toBe(604);
      expect(long.height).toBe(420);
      expect(long.top + long.height).toBe(872);
      expect(short.top).toBe(559);
      expect(short.caret).toBe(45);
      expect(short.height).toBe(160);
    }
  });

  test("moves upward smoothly before shrinking only when the full viewport is too short", () => {
    const placements = [1008, 1007, 1006, 829, 477, 476, 475].map((viewportHeight) =>
      placeCareerPopover({
        ...desktop,
        popoverHeight: 420,
        triggerRect: { ...trigger, top: 591 },
        viewportHeight,
      }),
    );

    expect(placements.map(({ height }) => height)).toEqual([420, 420, 420, 420, 420, 420, 419]);
    expect(placements.map(({ top }) => top)).toEqual([559, 559, 558, 381, 29, 28, 28]);
    for (const placement of placements) {
      expect(placement.placement).toBe("right");
      expect(placement.top + placement.caret).toBe(604);
    }
  });

  test("keeps each note's natural height near the bottom edge without stretching shorter notes", () => {
    for (const popoverHeight of [120, 240, 420]) {
      const placement = placeCareerPopover({
        ...desktop,
        popoverHeight,
        triggerRect: { ...trigger, top: 860 },
      });

      expect(placement.height).toBe(popoverHeight);
      expect(placement.top + placement.height).toBe(872);
      expect(placement.top + placement.caret).toBe(873);
    }
  });

  test("keeps the full height and centred position of a modal with a low trigger", () => {
    const placement = placeCareerPopover({
      ...desktop,
      popoverHeight: 420,
      triggerRect: { ...trigger, top: 700 },
      viewportWidth: 375,
      viewportBottomInset: 64,
      viewportTopInset: 100,
    });

    expect(placement.placement).toBe("modal");
    expect(placement.height).toBe(420);
    expect(placement.top).toBe(240);
  });

  test("reserves the footer clearance without reducing a note that fits above it", () => {
    const placement = placeCareerPopover({
      ...desktop,
      popoverHeight: 420,
      triggerRect: { ...trigger, top: 860 },
      viewportBottomInset: 64,
    });

    expect(placement.height).toBe(420);
    expect(placement.top + placement.height).toBe(836);
    expect(placement.top + placement.caret).toBe(873);
  });

  test("scrolls within the clear space between header and footer on a short screen", () => {
    const placement = placeCareerPopover({
      ...desktop,
      popoverHeight: 420,
      viewportHeight: 400,
      viewportBottomInset: 64,
      viewportTopInset: 100,
    });

    expect(placement.top).toBe(100);
    expect(placement.height).toBe(236);
    expect(placement.top + placement.height).toBe(336);
  });

  test("keeps the connector on the trigger line when viewport edges move a gutter note", () => {
    for (const top of [-100, -12, 800, 888, 1000]) {
      for (const left of [380, 852]) {
        const placement = placeCareerPopover({
          ...desktop,
          triggerRect: { ...trigger, left, top },
        });

        expect(placement.placement).not.toBe("modal");
        expect(placement.top).toBeGreaterThanOrEqual(28);
        expect(placement.top + placement.height).toBeLessThanOrEqual(872);
        expect(placement.top + placement.caret).toBe(top + trigger.height / 2);
      }
    }
  });

  test("uses a centred modal on mobile even when a gutter happens to have room", () => {
    const placement = placeCareerPopover({
      ...desktop,
      columnLeft: 200,
      columnRight: 500,
      triggerRect: { ...trigger, left: 400 },
      viewportWidth: 999,
    });

    expect(placement.placement).toBe("modal");
    expect(placement.left).toBe((999 - popover.popoverWidth) / 2);
    expect(placement.top).toBe((900 - popover.popoverHeight) / 2);
  });

  test("centres a phone modal independently of the trigger's position", () => {
    for (const top of [-100, 210, 690, 900]) {
      for (const left of [-100, 70, 360, 500]) {
        const placement = placeCareerPopover({
          ...popover,
          columnLeft: 28,
          columnRight: 347,
          triggerRect: { ...trigger, left, top },
          viewportHeight: 700,
          viewportWidth: 375,
        });

        expect(placement).toEqual({
          caret: 0,
          height: 160,
          left: 72.5,
          placement: "modal",
          top: 270,
          width: 230,
        });
      }
    }
  });

  test("limits both modal and gutter content to a short viewport", () => {
    for (const viewportWidth of [375, 1440]) {
      for (const popoverHeight of [160, 420, 900]) {
        const placement = placeCareerPopover({
          ...desktop,
          popoverHeight,
          viewportHeight: 120,
          viewportWidth,
        });

        expect(placement.placement).toBe(viewportWidth === 375 ? "modal" : "right");
        expect(placement.height).toBe(64);
        expect(placement.top).toBe(28);
        expect(placement.top + placement.height).toBe(92);
      }
    }
  });

  test("switches from a gutter to a safe modal after the viewport shrinks", () => {
    const phone = placeCareerPopover({
      ...desktop,
      viewportHeight: 700,
      viewportWidth: 375,
    });

    expect(placeCareerPopover(desktop).placement).toBe("right");
    expect(phone.placement).toBe("modal");
    expect(phone.left).toBeGreaterThanOrEqual(28);
    expect(phone.left + phone.width).toBeLessThanOrEqual(347);
    expect(phone.top + phone.height).toBeLessThanOrEqual(672);
  });

  test("keeps tiny and zero-sized viewports finite without negative dimensions", () => {
    for (const [viewportWidth, viewportHeight] of [
      [0, 0],
      [24, 40],
      [55, 55],
      [56, 56],
      [57, 57],
      [90, 72],
    ] as const) {
      const placement = placeCareerPopover({ ...desktop, viewportHeight, viewportWidth });

      expect(placement.placement).toBe("modal");
      for (const value of [
        placement.caret,
        placement.height,
        placement.left,
        placement.top,
        placement.width,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(placement.left).toBeGreaterThanOrEqual(0);
      expect(placement.top).toBeGreaterThanOrEqual(0);
      expect(placement.width).toBeGreaterThanOrEqual(0);
      expect(placement.height).toBeGreaterThanOrEqual(0);
      expect(placement.left + placement.width).toBeLessThanOrEqual(viewportWidth);
      expect(placement.top + placement.height).toBeLessThanOrEqual(viewportHeight);
    }
  });
});
