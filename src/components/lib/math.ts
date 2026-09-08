/** `value` held within [minimum, maximum]; a crossed range collapses to its minimum. */
export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(maximum, minimum));
}
