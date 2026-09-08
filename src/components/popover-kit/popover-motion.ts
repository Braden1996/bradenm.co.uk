import { prefersReducedMotion } from "../lib/motion";

/** Animate the content plane; callers retain cancellation, lifecycle and focus ownership. */
export function enterPopover(surface: HTMLElement, spacious = true) {
  if (prefersReducedMotion() || matchMedia("(forced-colors: active)").matches) return undefined;
  return surface.animate(
    [
      {
        opacity: 0,
        transform: `translateY(${spacious ? 18 : 5}px) scale(${spacious ? 0.97 : 1})`,
        filter: "blur(2px)",
      },
      { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0px)" },
    ],
    { duration: spacious ? 420 : 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
}
