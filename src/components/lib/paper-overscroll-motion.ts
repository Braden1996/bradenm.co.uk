const pullResistance = 240;

/** Follow the dragged distance with steadily increasing resistance. */
export function paperPullForDistance(distance: number) {
  const positiveDistance = Math.max(0, distance);

  return positiveDistance / (positiveDistance + pullResistance);
}

/** Advance a critically damped spring without changing its speed between frame rates. */
export function advancePaperPull(
  position: number,
  velocity: number,
  target: number,
  elapsedSeconds: number,
) {
  const elapsed = Math.max(0, elapsedSeconds);
  // The sheet follows the hand gently, then returns with a firmer spring.
  const frequency = target === 0 ? 64 : 40;
  const displacement = position - target;
  const decay = Math.exp(-frequency * elapsed);
  const coefficient = velocity + frequency * displacement;

  return {
    position: target + (displacement + coefficient * elapsed) * decay,
    velocity: (velocity - frequency * coefficient * elapsed) * decay,
  };
}
