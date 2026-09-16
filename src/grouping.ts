/** The semantic presentation families supported by the extension. */
export type GroupKind = "read" | "search" | "list" | "write" | "edit" | "command" | "tool";

/** A row that has passed the adapter's eligibility checks. Singleton rows are valid groups too. */
export type Candidate = {
  kind: GroupKind;
  row: unknown;
};

export type NativeClassification = {
  type: "native";
  row: unknown;
};

/**
 * An invisible assistant component is the one exception to the normal boundary
 * rule. It has no terminal output, so tool rows on either side are visually
 * adjacent. The adapter is responsible for identifying it.
 */
export type InvisibleClassification = {
  type: "invisible";
  row: unknown;
};

export type CandidateClassification = Candidate & { type: "candidate" };

export type ChildClassification =
  | CandidateClassification
  | NativeClassification
  | InvisibleClassification;

export type Segment =
  | { type: "native"; row: unknown }
  | { type: "group"; kind: GroupKind; rows: unknown[] };

/**
 * Turn ordered transcript-child classifications into the visual segments used
 * by the adapter. Eligibility and boundary policy live here; no Pi objects are
 * inspected or changed by this module.
 */
export function segmentChildren(
  classifications: readonly ChildClassification[],
): Segment[] {
  const segments: Segment[] = [];
  let pendingKind: GroupKind | undefined;
  let pendingRows: unknown[] = [];

  const flushPending = (): void => {
    if (pendingRows.length > 0 && pendingKind !== undefined) {
      segments.push({
        type: "group",
        kind: pendingKind,
        rows: pendingRows,
      });
    } else {
      for (const row of pendingRows) {
        segments.push({ type: "native", row });
      }
    }
    pendingKind = undefined;
    pendingRows = [];
  };

  for (const classification of classifications) {
    if (classification.type === "invisible") {
      // It contributes no output and intentionally does not flush a run.
      continue;
    }

    if (classification.type === "candidate") {
      if (pendingKind !== classification.kind) {
        flushPending();
        pendingKind = classification.kind;
      }
      pendingRows.push(classification.row);
      continue;
    }

    flushPending();
    segments.push({ type: "native", row: classification.row });
  }

  flushPending();
  return segments;
}

/** Return whether segmentation produced at least one compact tool group. */
export function hasGroups(segments: readonly Segment[]): boolean {
  return segments.some((segment) => segment.type === "group");
}
