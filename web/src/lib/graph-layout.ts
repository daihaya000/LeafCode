import type { GraphCommit } from "./types";

export type GraphEdge = {
  fromLane: number;
  toLane: number;
  /** color index follows the source lane */
  color: number;
  /** true = connect into this row's commit (from above) */
  kind: "pass" | "merge" | "fork";
};

export type GraphRow = {
  commit: GraphCommit;
  /** lane of this commit's node */
  lane: number;
  /** color index for this commit's lane */
  color: number;
  /** active lane count at this row (for width) */
  laneCount: number;
  /** vertical lines passing through this row */
  passes: { lane: number; color: number }[];
  /** edges drawn in the upper half of the row (from previous → this) */
  edges: GraphEdge[];
};

const LANE_COLORS = 6;

/**
 * Assign swimlanes for commits listed newest-first (git log --date-order).
 * First parent stays on the same lane; additional parents fork new lanes.
 */
export function layoutGraph(commits: GraphCommit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  // lanes[i] = hash we expect next on this lane (going downward / older)
  let lanes: (string | null)[] = [];
  const colorOf = new Map<number, number>();
  let nextColor = 0;

  const colorFor = (lane: number) => {
    if (!colorOf.has(lane)) {
      colorOf.set(lane, nextColor % LANE_COLORS);
      nextColor += 1;
    }
    return colorOf.get(lane)!;
  };

  for (const commit of commits) {
    let lane = lanes.findIndex((h) => h === commit.hash);
    if (lane < 0) {
      lane = lanes.findIndex((h) => h === null);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(null);
      }
      colorFor(lane);
    }

    const edges: GraphEdge[] = [];
    const passes: { lane: number; color: number }[] = [];

    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] && lanes[i] !== commit.hash) {
        passes.push({ lane: i, color: colorFor(i) });
      }
    }

    // Incoming: previous row expected this hash on `lane`
    // (edges from children are implicit via passes + node)

    const next: (string | null)[] = lanes.map((h) =>
      h === commit.hash ? null : h,
    );
    while (next.length <= lane) next.push(null);

    const firstParent = commit.parents[0] ?? null;
    next[lane] = firstParent;

    for (let pi = 1; pi < commit.parents.length; pi++) {
      const parent = commit.parents[pi];
      let pl = next.findIndex((h) => h === parent);
      if (pl < 0) {
        pl = next.findIndex((h) => h === null);
        if (pl < 0) {
          pl = next.length;
          next.push(parent);
        } else {
          next[pl] = parent;
        }
        colorFor(pl);
      }
      edges.push({
        fromLane: pl,
        toLane: lane,
        color: colorFor(pl),
        kind: "merge",
      });
    }

    // Trim trailing empty lanes
    while (next.length > 0 && next[next.length - 1] === null) next.pop();

    rows.push({
      commit,
      lane,
      color: colorFor(lane),
      laneCount: Math.max(lanes.length, next.length, lane + 1),
      passes,
      edges,
    });

    lanes = next;
  }

  return rows;
}

export { LANE_COLORS };
