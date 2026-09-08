/** Whether the reader has asked interfaces to avoid non-essential motion. */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
