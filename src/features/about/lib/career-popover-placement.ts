import { clamp } from "../../../components/lib/math";

export type CareerPopoverPlacement = {
  /** Trigger line centre from a gutter note's top; unused for a modal. */
  caret: number;
  /** The note may shorten to fit the viewport. */
  height: number;
  left: number;
  placement: "left" | "modal" | "right";
  top: number;
  /** The note may narrow to fit a readable gutter. */
  width: number;
};

type Rect = { height: number; left: number; top: number; width: number };

export type CareerPopoverPlacementInput = {
  columnLeft: number;
  columnRight: number;
  popoverHeight: number;
  popoverWidth: number;
  triggerRect: Rect;
  viewportHeight: number;
  viewportWidth: number;
  /** Preferred space between the text column and note for the drawn connector. */
  railGap?: number;
  /** Smallest readable width of a margin note. */
  minimumRailWidth?: number;
  /** Space reserved between the note and the viewport edge. */
  viewportInset?: number;
  /** Extra gutter clearance above the page's painted footer. */
  viewportBottomInset?: number;
  /** Extra gutter clearance below the page's header fade. */
  viewportTopInset?: number;
};

const DEFAULT_RAIL_GAP = 86;
const MINIMUM_RAIL_GAP = 48;
const DEFAULT_MINIMUM_RAIL_WIDTH = 208;
const DEFAULT_VIEWPORT_INSET = 28;
const MINIMUM_GUTTER_VIEWPORT_WIDTH = 1000;
const HEADING_OFFSET = 45;
// Give the connector the smaller golden-ratio share of any spare gutter.
const OUTWARD_SPACE_SHARE = (3 - Math.sqrt(5)) / 2;
const MAXIMUM_OUTWARD_OFFSET = 96;

/**
 * Use the closest readable gutter, keeping the entire note outside the prose.
 * When neither gutter fits, or on a mobile viewport, centre a modal instead.
 */
export function placeCareerPopover(input: CareerPopoverPlacementInput): CareerPopoverPlacement {
  const railGap = Math.max(0, input.railGap ?? DEFAULT_RAIL_GAP);
  const minimumGap = Math.min(railGap, MINIMUM_RAIL_GAP);
  const minimumRailWidth = Math.max(0, input.minimumRailWidth ?? DEFAULT_MINIMUM_RAIL_WIDTH);
  const inset = Math.max(0, input.viewportInset ?? DEFAULT_VIEWPORT_INSET);
  const viewportWidth = Math.max(0, input.viewportWidth);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const horizontalInset = Math.min(inset, viewportWidth / 2);
  const verticalInset = Math.min(inset, viewportHeight / 2);
  const viewportRight = viewportWidth - horizontalInset;
  const viewportBottom = viewportHeight - verticalInset;
  const width = clamp(input.popoverWidth, 0, viewportRight - horizontalInset);
  const height = clamp(input.popoverHeight, 0, viewportBottom - verticalInset);
  const readableWidth = Math.min(minimumRailWidth, width);
  const triggerRight = input.triggerRect.left + input.triggerRect.width;
  const triggerCentreX = input.triggerRect.left + input.triggerRect.width / 2;
  const lineCentreY = input.triggerRect.top + input.triggerRect.height / 2;
  const columnCentreX = (input.columnLeft + input.columnRight) / 2;

  const gutter = (placement: "left" | "right"): CareerPopoverPlacement | undefined => {
    const space =
      placement === "right"
        ? viewportRight - input.columnRight
        : input.columnLeft - horizontalInset;
    const gap = clamp(space - readableWidth, minimumGap, railGap);
    const availableWidth = space - gap;
    const gutterWidth = Math.min(width, availableWidth);
    const spareSpace = Math.max(0, availableWidth - gutterWidth);
    const offset = Math.min(MAXIMUM_OUTWARD_OFFSET, spareSpace * OUTWARD_SPACE_SHARE);
    const left =
      placement === "right"
        ? input.columnRight + gap + offset
        : input.columnLeft - gap - gutterWidth - offset;

    if (
      availableWidth < readableWidth ||
      left < horizontalInset ||
      left + gutterWidth > viewportRight ||
      (placement === "right" ? left < triggerRight : left + gutterWidth > input.triggerRect.left)
    ) {
      return undefined;
    }

    // Use the full available height before making the note scroll.
    const gutterTop = clamp(input.viewportTopInset ?? inset, verticalInset, viewportBottom);
    const bottomInset = clamp(
      input.viewportBottomInset ?? inset,
      verticalInset,
      viewportHeight - gutterTop,
    );
    const gutterBottom = viewportHeight - bottomInset;
    const gutterHeight = Math.min(height, gutterBottom - gutterTop);
    const top = clamp(lineCentreY - HEADING_OFFSET, gutterTop, gutterBottom - gutterHeight);

    return {
      caret: lineCentreY - top,
      height: gutterHeight,
      left,
      placement,
      top,
      width: gutterWidth,
    };
  };

  if (viewportWidth >= MINIMUM_GUTTER_VIEWPORT_WIDTH && width > 0 && height > 0) {
    const nearest = triggerCentreX < columnCentreX ? "left" : "right";
    const placement = gutter(nearest) ?? gutter(nearest === "right" ? "left" : "right");
    if (placement) return placement;
  }

  return {
    caret: 0,
    height,
    left: (viewportWidth - width) / 2,
    placement: "modal",
    top: (viewportHeight - height) / 2,
    width,
  };
}
