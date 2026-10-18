export const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = shuffled[i];
    const random = shuffled[j];
    // Both indices are in range by construction, but `noUncheckedIndexedAccess`
    // cannot see the loop bounds and `T` may itself include `undefined`.
    if (current === undefined || random === undefined) continue;
    shuffled[i] = random;
    shuffled[j] = current;
  }
  return shuffled;
};
