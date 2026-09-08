import { expect, test, type Locator } from "@playwright/test";

async function connectorGeometry(trigger: Locator) {
  return trigger.evaluate((element) => {
    const passage = document.querySelector("[data-about-passage]");
    const label = element.querySelector(".inline-entity__label");
    const path = document.querySelector<SVGPathElement>("[data-career-connector-line]");
    const matrix = path?.getScreenCTM();
    if (!passage || !label || !path || !matrix) {
      throw new Error("The selected note needs its label and a visible connector");
    }
    // The callback runs in the browser, so it cannot reference a helper outside it.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const bounds = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
    const textRects = [];
    const walker = document.createTreeWalker(passage, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) textRects.push(bounds(rect));
      }
    }
    const labelRange = document.createRange();
    labelRange.selectNodeContents(label);
    const text = bounds(labelRange.getBoundingClientRect());
    const paintedNeighbours = [...passage.querySelectorAll(".inline-entity__label")]
      .filter((neighbour) => neighbour !== label)
      .map((neighbour) => bounds(neighbour.getBoundingClientRect()))
      .filter((rect) => rect.top < text.bottom && rect.bottom > text.top);
    const length = path.getTotalLength();
    const sampleCount = Math.max(2, Math.ceil(length) + 1);
    const points = Array.from({ length: sampleCount }, (_, index) => {
      const point = path
        .getPointAtLength((index / (sampleCount - 1)) * length)
        .matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    return {
      column: bounds(passage.getBoundingClientRect()),
      label: bounds(label.getBoundingClientRect()),
      text,
      textRects,
      paintedNeighbours,
      points,
    };
  });
}

for (const viewport of [
  { width: 1350, height: 940 },
  { width: 1440, height: 1000 },
  { width: 1100, height: 800 },
]) {
  for (const { slug, placement } of [
    { slug: "cleo", placement: "left" },
    { slug: "isembard", placement: "right" },
  ]) {
    test(`${placement} career arrow follows whitespace at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      const trigger = page.locator(`[data-career-entity][href="#career-card-${slug}"]`);
      await trigger.click();
      const note = page.locator("[data-career-popover]");
      await expect(note).toHaveAttribute("data-state", "open");
      await expect(note).toHaveAttribute("data-placement", placement);
      const geometry = await connectorGeometry(trigger);
      const tip = geometry.points.at(-1);
      if (!tip) throw new Error("The connector needs an endpoint");
      expect(tip.x).toBeGreaterThan(geometry.label.left);
      expect(tip.x).toBeLessThan(geometry.label.right);
      expect(Math.abs(tip.y - (geometry.label.bottom - 2))).toBeLessThan(1);

      const route = geometry.points.filter((point) =>
        placement === "left"
          ? point.x < geometry.label.left - 2
          : point.x > geometry.label.right + 2,
      );
      const neighbouringText = geometry.textRects.filter(
        (rect) =>
          Math.abs(rect.top - geometry.text.top) < 1 &&
          (placement === "left"
            ? rect.right < geometry.label.left
            : rect.left > geometry.label.right),
      );
      const crossedText = neighbouringText.filter((rect) =>
        route.some((point) => point.x > rect.left + 1 && point.x < rect.right - 1),
      );
      expect(crossedText.length).toBeGreaterThan(0);
      for (const rect of [...crossedText, ...geometry.paintedNeighbours]) {
        const passing = route.filter(
          (point) => point.x > rect.left + 1 && point.x < rect.right - 1,
        );
        for (const point of passing) {
          expect(point.y - rect.bottom).toBeGreaterThanOrEqual(4);
        }
      }

      // Sampling the actual SVG catches curves which dip into the next row
      // even when their control points and endpoints sit in clear space.
      const collisions = geometry.points.filter((point) =>
        geometry.textRects.some(
          (rect) =>
            point.x > rect.left - 1 &&
            point.x < rect.right + 1 &&
            point.y > rect.top - 1 &&
            point.y < rect.bottom + 1,
        ),
      );
      expect(collisions).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(note).not.toHaveAttribute("data-state", "open");
    });
  }

  for (const { slug, placement } of [
    { slug: "theodo-uk", placement: "right" },
    { slug: "thought-machine", placement: "left" },
  ]) {
    test(`${placement} career arrow connects directly to a clear line edge at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      const trigger = page.locator(`[data-career-entity][href="#career-card-${slug}"]`);
      await trigger.click();
      const note = page.locator("[data-career-popover]");
      await expect(note).toHaveAttribute("data-state", "open");
      await expect(note).toHaveAttribute("data-placement", placement);
      const geometry = await connectorGeometry(trigger);
      const tip = geometry.points.at(-1);
      if (!tip) throw new Error("The connector needs an endpoint");
      const expectedX = placement === "right" ? geometry.label.right + 5 : geometry.label.left - 5;
      const underlineY = geometry.label.bottom - 2;
      expect(Math.abs(tip.x - expectedX)).toBeLessThan(0.1);
      expect(Math.abs(tip.y - underlineY)).toBeLessThan(0.1);

      // The open approach stays level through the column and reaches the
      // underline horizontally, including names which begin at the left edge.
      const withinColumn = geometry.points.filter(
        (point) => point.x >= geometry.column.left && point.x <= geometry.column.right,
      );
      if (placement === "right") expect(withinColumn.length).toBeGreaterThan(20);
      for (const point of [...withinColumn, ...geometry.points.slice(-4)]) {
        expect(Math.abs(point.y - underlineY)).toBeLessThan(0.1);
      }
    });
  }
}
