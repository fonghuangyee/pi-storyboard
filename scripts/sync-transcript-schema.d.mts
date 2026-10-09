export interface TranscriptDeclarationSource {
  id: string;
  packageName: string;
  file: string;
  declarations: Record<string, string>;
  missingDeclarations: string[];
}

export interface TranscriptTypeSnapshot {
  formatVersion: number;
  packages: Record<string, string>;
  sources: TranscriptDeclarationSource[];
}

export interface DeclarationChange {
  name: string;
  kind: "added" | "removed" | "changed";
  before: string;
  after: string;
}

export interface SnapshotComparison {
  changed: boolean;
  packageChanges: Array<{ name: string; before: string; after: string }>;
  sourceChanges: Array<{
    id: string;
    kind: "added" | "removed" | "changed";
    declarations: DeclarationChange[];
    missingBefore?: string;
    missingAfter?: string;
    layoutChanged?: boolean;
  }>;
}

export function collectSnapshot(root?: string): TranscriptTypeSnapshot;
export function compareSnapshots(previous: TranscriptTypeSnapshot, current: TranscriptTypeSnapshot): SnapshotComparison;
