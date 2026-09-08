/** Square audiobook thumbnails retain the standard portrait binding. */
export function bookCoverAspect(width: number, height: number) {
  return width > 0 && height / width >= 1.15 ? width / height : 2 / 3;
}
