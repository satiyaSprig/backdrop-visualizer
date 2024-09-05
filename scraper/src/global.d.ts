declare module "@seregpie/k-means-plus-plus" {
  const KMeans: <T>(
    values: T[],
    means: T[] | number,
    opts?: {
      map?: (arg: T) => number[];
      random?: () => number;
      maxIterations?: number;
      mean?: (...args: number[][]) => number[];
      distance?: (v1: number[], v2: number[]) => number;
    }
  ) => T[][];
  export default KMeans;
}
