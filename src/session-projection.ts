import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * The only session data retained by the presentation layer. These records are
 * deliberately independent of Pi's messages and are safe to discard at any
 * lifecycle boundary.
 */
export type ProjectedAssistantTurn = {
  readonly entryId: string;
  readonly toolCallIds: readonly string[];
  readonly resultEntryIds: readonly string[];
  readonly hasVisibleThinking: boolean;
  readonly hasCommentary: boolean;
  readonly hasFinalAnswer: boolean;
  readonly hasUnknownText: boolean;
  readonly valid: boolean;
  readonly boundaryBefore: boolean;
  readonly boundaryAfter: boolean;
};

export type SessionProjection = {
  readonly leafId: string | null;
  readonly turns: readonly ProjectedAssistantTurn[];
};

export type SessionProjectionInput = {
  readonly entries: readonly SessionEntry[];
  readonly leafId: string | null;
};

type RecordLike = Record<string, unknown>;

type MutableTurn = {
  entryId: string;
  toolCallIds: string[];
  resultEntryIds: string[];
  hasVisibleThinking: boolean;
  hasCommentary: boolean;
  hasFinalAnswer: boolean;
  hasUnknownText: boolean;
  invalid: boolean;
  boundaryBefore: boolean;
  boundaryAfter: boolean;
  expectedResults: number;
};

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const KNOWN_ENTRY_TYPES = new Set([
  "message",
  "thinking_level_change",
  "model_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
  // Context-edit checkpoints are not part of Pi's public SessionEntry union
  // in every supported release, but newer/extension-authored snapshots may
  // expose this exact non-visual deletion marker at runtime.
  "context_edit",
]);

const CONTEXT_EDIT_KEYS = new Set([
  "type",
  "id",
  "parentId",
  "timestamp",
  "targetId",
  "replacement",
]);

function textPhase(value: unknown): "commentary" | "final_answer" | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.v !== 1 || !isNonEmptyString(parsed.id)) return undefined;
    return parsed.phase === "commentary" || parsed.phase === "final_answer"
      ? parsed.phase
      : undefined;
  } catch {
    return undefined;
  }
}

function inspectAssistant(message: RecordLike): Omit<MutableTurn, "entryId" | "resultEntryIds" | "boundaryBefore" | "boundaryAfter" | "invalid" | "expectedResults"> | undefined {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;

  const toolCallIds: string[] = [];
  let hasVisibleThinking = false;
  let hasCommentary = false;
  let hasFinalAnswer = false;
  let hasUnknownText = false;

  for (const block of message.content) {
    if (!isRecord(block) || typeof block.type !== "string") return undefined;
    if (block.type === "thinking") {
      if (typeof block.thinking !== "string") return undefined;
      if (block.thinking.trim().length > 0) hasVisibleThinking = true;
      continue;
    }
    if (block.type === "text") {
      if (typeof block.text !== "string") return undefined;
      if (block.text.trim().length === 0) continue;
      const phase = textPhase(block.textSignature);
      if (phase === "commentary") hasCommentary = true;
      else if (phase === "final_answer") hasFinalAnswer = true;
      else hasUnknownText = true;
      continue;
    }
    if (block.type === "toolCall") {
      if (!isNonEmptyString(block.id) || toolCallIds.includes(block.id)) return undefined;
      toolCallIds.push(block.id);
      continue;
    }
    return undefined;
  }

  return {
    toolCallIds,
    hasVisibleThinking,
    hasCommentary,
    hasFinalAnswer,
    hasUnknownText,
  };
}

function isContextEditEntry(entry: RecordLike): boolean {
  if (entry.type !== "context_edit") return false;
  // This is the observed non-visual form: a context edit removes the targeted
  // entry from model context. Do not accept replacement payloads or extra
  // fields, since they could carry an unclassified visible/message shape.
  const keys = Object.keys(entry);
  return (
    keys.length === CONTEXT_EDIT_KEYS.size &&
    keys.every((key) => CONTEXT_EDIT_KEYS.has(key)) &&
    typeof entry.timestamp === "string" &&
    (entry.parentId === null || isNonEmptyString(entry.parentId)) &&
    isNonEmptyString(entry.targetId) &&
    entry.replacement === null
  );
}

function isTransparentEntry(entry: RecordLike): boolean {
  if (entry.type === "thinking_level_change" || entry.type === "model_change" || entry.type === "label" || entry.type === "session_info") {
    return true;
  }
  // A hidden custom message is not a visual transcript row. A visible custom
  // message remains a hard boundary even when it happens to be extension-owned.
  return entry.type === "custom" || (entry.type === "custom_message" && entry.display === false);
}

function isHardEntry(entry: RecordLike): boolean {
  if (entry.type === "compaction" || entry.type === "branch_summary") return true;
  if (entry.type === "context_edit") return true;
  if (entry.type === "message") {
    const message = entry.message as unknown;
    if (!isRecord(message)) return true;
    return message.role !== "toolResult";
  }
  return !isTransparentEntry(entry);
}

function activePathEntries(entries: readonly SessionEntry[], leafId: string | null): readonly RecordLike[] | undefined {
  const records = entries as unknown as readonly RecordLike[];
  const byId = new Map<string, RecordLike>();
  for (const entry of records) {
    if (
      !isRecord(entry) ||
      !isNonEmptyString(entry.id) ||
      typeof entry.type !== "string" ||
      !KNOWN_ENTRY_TYPES.has(entry.type) ||
      byId.has(entry.id)
    ) return undefined;
    byId.set(entry.id, entry);
  }
  if (leafId === null) return records;
  if (!byId.has(leafId)) return undefined;

  const chain: RecordLike[] = [];
  const seen = new Set<string>();
  let current: string | null = leafId;
  while (current !== null) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    const entry = byId.get(current);
    if (entry === undefined) {
      // `buildContextEntries()` intentionally omits entries hidden by a
      // compaction boundary. In that public projection, retain its supplied
      // order rather than treating the omitted parent as malformed.
      return records.some((candidate) => candidate.type === "compaction") ? records : undefined;
    }
    chain.push(entry);
    const parent = entry.parentId;
    if (parent !== null && !isNonEmptyString(parent)) return records;
    current = parent as string | null;
  }
  chain.reverse();
  const chainIds = new Set(chain.map((entry) => entry.id));
  if (records.some((entry) => entry.parentId === null && !chainIds.has(entry.id))) return undefined;
  return chain;
}

function finalizeTurn(turn: MutableTurn): ProjectedAssistantTurn {
  const complete = turn.resultEntryIds.length === turn.expectedResults;
  return Object.freeze({
    entryId: turn.entryId,
    toolCallIds: Object.freeze([...turn.toolCallIds]),
    resultEntryIds: Object.freeze([...turn.resultEntryIds]),
    hasVisibleThinking: turn.hasVisibleThinking,
    hasCommentary: turn.hasCommentary,
    hasFinalAnswer: turn.hasFinalAnswer,
    hasUnknownText: turn.hasUnknownText,
    valid: !turn.invalid && complete && !turn.hasFinalAnswer && !turn.hasUnknownText,
    boundaryBefore: turn.boundaryBefore,
    boundaryAfter: turn.boundaryAfter,
  });
}

/**
 * Build a minimal, active-path-only session index. The input is normally the
 * result of `ReadonlySessionManager.buildContextEntries()`. No message or
 * provider object is retained in the result.
 */
export function buildSessionProjection(input: SessionProjectionInput): SessionProjection | undefined {
  if (!input || !Array.isArray(input.entries)) return undefined;
  if (input.leafId !== null && !isNonEmptyString(input.leafId)) return undefined;

  const pathEntries = activePathEntries(input.entries, input.leafId);
  if (pathEntries === undefined) return undefined;

  const turns: MutableTurn[] = [];
  let active: MutableTurn | undefined;
  let boundaryPending = false;

  const breakBoundary = (): void => {
    if (active !== undefined) {
      active.boundaryAfter = true;
      active = undefined;
    }
    boundaryPending = true;
  };

  for (const entry of pathEntries) {
    if (!isRecord(entry) || !isNonEmptyString(entry.id)) return undefined;

    if (entry.type === "message" && isRecord(entry.message) && entry.message.role === "toolResult") {
      const toolCallId = entry.message.toolCallId;
      if (!isNonEmptyString(toolCallId) || active === undefined) {
        breakBoundary();
        continue;
      }
      const callIndex = active.toolCallIds.indexOf(toolCallId);
      if (callIndex < 0 || active.resultEntryIds.includes(entry.id)) {
        active.invalid = true;
        active.boundaryAfter = true;
        active = undefined;
        boundaryPending = true;
        continue;
      }
      active.resultEntryIds.push(entry.id);
      continue;
    }

    if (entry.type === "message") {
      const inspected = isRecord(entry.message) ? inspectAssistant(entry.message) : undefined;
      if (inspected === undefined || inspected.toolCallIds.length === 0) {
        breakBoundary();
        continue;
      }
      if (active !== undefined) {
        if (active.resultEntryIds.length !== active.expectedResults) active.invalid = true;
        active.boundaryAfter = active.invalid;
      }
      const turn: MutableTurn = {
        entryId: entry.id,
        ...inspected,
        resultEntryIds: [],
        invalid: false,
        boundaryBefore: boundaryPending,
        boundaryAfter: false,
        expectedResults: inspected.toolCallIds.length,
      };
      turns.push(turn);
      active = turn;
      boundaryPending = false;
      continue;
    }

    if (entry.type === "context_edit") {
      // A valid context edit is invisible, but it changes the model-context
      // boundary. Keep exact scene ownership valid while preventing a visual
      // continuation from crossing it. Any newer/incompatible shape fails
      // open instead of being treated as transparent.
      if (!isContextEditEntry(entry)) return undefined;
      breakBoundary();
      continue;
    }

    if (isHardEntry(entry)) breakBoundary();
  }

  if (active !== undefined) {
    // A still-running turn is valid only when every result already exists. The
    // component adapter separately decides whether a live row is safe to show.
    active.boundaryAfter = boundaryPending;
  }

  const projected = turns.map(finalizeTurn);
  return Object.freeze({
    leafId: input.leafId,
    turns: Object.freeze(projected),
  });
}

/** Return true only for an exact, unique tool-call ownership match. */
export function matchesProjectedTurn(
  turn: ProjectedAssistantTurn,
  toolCallIds: readonly string[],
): boolean {
  if (!turn.valid || toolCallIds.length === 0 || turn.toolCallIds.length !== toolCallIds.length) return false;
  const expected = new Set(turn.toolCallIds);
  if (expected.size !== toolCallIds.length) return false;
  return toolCallIds.every((id) => expected.has(id));
}
