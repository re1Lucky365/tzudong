export type LatestSelection = Readonly<{
  begin: () => number;
  isCurrent: (generation: number) => boolean;
}>;

/** Rejects late async file preparation after a newer selection or clear action. */
export function createLatestSelection(): LatestSelection {
  let generation = 0;
  return {
    begin: () => ++generation,
    isCurrent: (candidate) => candidate === generation,
  };
}
