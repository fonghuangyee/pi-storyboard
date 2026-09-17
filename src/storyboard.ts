import type { GroupKind } from "./grouping.ts";
import type { ToolRowSnapshot } from "./renderer.ts";

export type StoryboardAssistantContentType =
  | "thinking"
  | "commentary"
  | "final_answer"
  | "text"
  | "native";

/**
 * One native assistant child. Text phases are retained only as a small
 * validated enum: raw provider signatures never leave the Pi adapter.
 */
export type StoryboardAssistantContent = {
  readonly type: StoryboardAssistantContentType;
  readonly row: unknown;
  readonly renderedLines: readonly string[];
};

/** The source-order references extracted from AssistantMessage.content. */
export type StoryboardSourceItem =
  | { readonly type: "assistant"; readonly contentIndex: number }
  | { readonly type: "tool"; readonly toolCallId: string };

/**
 * The small, immutable view of an assistant component needed for ownership.
 * The native component itself is retained only as an opaque row reference; the
 * model never reads Pi objects and never renders or mutates them.
 *
 * `assistantContent` and `sourceOrder` are optional for compatibility with
 * older/incomplete component shapes. When present together they allow the
 * renderer to put native assistant children and tool groups back into the
 * exact order of the assistant message's content array.
 */
export type AssistantSceneSnapshot = {
  readonly assistantRow: unknown;
  readonly renderedAssistantLines: readonly string[];
  readonly expectedToolCallIds: readonly string[];
  readonly stopReason: string;
  readonly isStreaming: boolean;
  readonly hasThinking: boolean;
  readonly hasText: boolean;
  /** A validated TextSignatureV1 phase was `final_answer`. */
  readonly hasFinalAnswer: boolean;
  /** At least one visible text block had no validated portable phase. */
  readonly hasUnknownText: boolean;
  readonly assistantContent?: readonly StoryboardAssistantContent[];
  readonly sourceOrder?: readonly StoryboardSourceItem[];
};

/** A validated tool row plus the call ID used to prove scene ownership. */
export type StoryboardToolSnapshot = {
  readonly toolRow: unknown;
  readonly toolCallId: string;
  readonly kind: GroupKind;
  readonly snapshot: ToolRowSnapshot;
};

export type StoryboardChild =
  | { readonly type: "assistant"; readonly assistant: AssistantSceneSnapshot }
  | { readonly type: "tool"; readonly tool: StoryboardToolSnapshot }
  | { readonly type: "native"; readonly row: unknown };

export type StoryboardActionRun = {
  readonly kind: GroupKind;
  readonly rows: readonly StoryboardToolSnapshot[];
};

export type StoryboardOrderedChild =
  | { readonly type: "assistant"; readonly content: StoryboardAssistantContent }
  | { readonly type: "tool"; readonly tool: StoryboardToolSnapshot };

export type SceneState = "running" | "complete" | "failed" | "note";

export type StoryboardScene = {
  readonly type: "scene";
  readonly assistant: AssistantSceneSnapshot;
  readonly actionRuns: readonly StoryboardActionRun[];
  /** Present when native assistant children can be composed in source order. */
  readonly orderedChildren?: readonly StoryboardOrderedChild[];
  readonly state: SceneState;
};

/** Children in this segment must be rendered entirely by Pi's native path. */
export type StoryboardNativeSegment = {
  readonly type: "native";
  readonly children: readonly StoryboardChild[];
};

export type StoryboardSegment = StoryboardScene | StoryboardNativeSegment;

export type StoryboardProjection = {
  readonly segments: readonly StoryboardSegment[];
};

const GROUP_KINDS: ReadonlySet<GroupKind> = new Set([
  "read",
  "search",
  "list",
  "write",
  "edit",
  "command",
  "tool",
]);

const FAILURE_STOP_REASONS = new Set(["error", "aborted", "length"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasUniqueStrings(values: unknown): values is readonly string[] {
  if (!Array.isArray(values)) return false;
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

function isAssistantContent(value: unknown): value is StoryboardAssistantContent {
  if (
    !isRecord(value) ||
    (value.type !== "thinking" &&
      value.type !== "commentary" &&
      value.type !== "final_answer" &&
      value.type !== "text" &&
      value.type !== "native")
  ) {
    return false;
  }
  return Array.isArray(value.renderedLines) && value.renderedLines.every((line) => typeof line === "string");
}

function isSourceItem(value: unknown): value is StoryboardSourceItem {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "assistant") {
    return typeof value.contentIndex === "number" && Number.isSafeInteger(value.contentIndex) && value.contentIndex >= 0;
  }
  return value.type === "tool" && typeof value.toolCallId === "string" && value.toolCallId.length > 0;
}

function isAssistantSnapshot(value: unknown): value is AssistantSceneSnapshot {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.renderedAssistantLines) ||
    !value.renderedAssistantLines.every((line) => typeof line === "string") ||
    !hasUniqueStrings(value.expectedToolCallIds) ||
    typeof value.stopReason !== "string" ||
    typeof value.isStreaming !== "boolean" ||
    typeof value.hasThinking !== "boolean" ||
    typeof value.hasText !== "boolean" ||
    typeof value.hasFinalAnswer !== "boolean" ||
    typeof value.hasUnknownText !== "boolean"
  ) {
    return false;
  }
  if (value.assistantContent !== undefined &&
      (!Array.isArray(value.assistantContent) || !value.assistantContent.every(isAssistantContent))) {
    return false;
  }
  if (value.sourceOrder !== undefined &&
      (!Array.isArray(value.sourceOrder) || !value.sourceOrder.every(isSourceItem))) {
    return false;
  }
  return true;
}

function isToolSnapshot(value: unknown): value is StoryboardToolSnapshot {
  if (!isRecord(value) || typeof value.toolCallId !== "string" || value.toolCallId.length === 0) {
    return false;
  }
  if (typeof value.kind !== "string" || !GROUP_KINDS.has(value.kind as GroupKind)) return false;
  if (!isRecord(value.snapshot)) return false;
  if (
    typeof value.snapshot.toolName !== "string" ||
    value.snapshot.toolName.length === 0 ||
    typeof value.snapshot.isPartial !== "boolean" ||
    typeof value.snapshot.expanded !== "boolean" ||
    value.snapshot.expanded
  ) {
    return false;
  }
  if (value.snapshot.result !== undefined) {
    if (!isRecord(value.snapshot.result) || typeof value.snapshot.result.isError !== "boolean") {
      return false;
    }
  }
  return true;
}

function isToolChild(value: StoryboardChild | undefined): value is Extract<StoryboardChild, { type: "tool" }> {
  return value?.type === "tool" && isToolSnapshot(value.tool);
}

function pushNative(segments: StoryboardSegment[], children: readonly StoryboardChild[]): void {
  if (children.length === 0) return;
  const previous = segments[segments.length - 1];
  if (previous?.type === "native") {
    segments[segments.length - 1] = Object.freeze({
      type: "native",
      children: Object.freeze([...previous.children, ...children]),
    });
    return;
  }
  segments.push(Object.freeze({
    type: "native",
    children: Object.freeze([...children]),
  }));
}

function hasPendingTool(tools: readonly StoryboardToolSnapshot[]): boolean {
  return tools.some((tool) => tool.snapshot.isPartial || tool.snapshot.result === undefined);
}

function hasFailedTool(tools: readonly StoryboardToolSnapshot[]): boolean {
  return tools.some((tool) => tool.snapshot.result?.isError === true);
}

/**
 * Derive one scene state using the documented running > failed > complete >
 * note precedence. In particular, this does not use completion order: tool
 * rows may finish in parallel and out of source order.
 */
export function deriveSceneState(
  assistant: AssistantSceneSnapshot,
  tools: readonly StoryboardToolSnapshot[],
): SceneState {
  if (assistant.isStreaming || assistant.stopReason === "pending" || hasPendingTool(tools)) return "running";
  if (FAILURE_STOP_REASONS.has(assistant.stopReason) || hasFailedTool(tools)) return "failed";
  if (tools.length > 0) return "complete";
  return "note";
}

function buildActionRunsFromChildren(
  children: readonly StoryboardOrderedChild[],
): readonly StoryboardActionRun[] {
  const runs: StoryboardActionRun[] = [];
  let previousTool: StoryboardToolSnapshot | undefined;
  for (const child of children) {
    if (child.type === "assistant") {
      previousTool = undefined;
      continue;
    }
    const tool = child.tool;
    const previousRun = runs[runs.length - 1];
    if (previousTool !== undefined && previousRun?.kind === tool.kind) {
      runs[runs.length - 1] = Object.freeze({
        kind: previousRun.kind,
        rows: Object.freeze([...previousRun.rows, tool]),
      });
    } else {
      runs.push(Object.freeze({
        kind: tool.kind,
        rows: Object.freeze([tool]),
      }));
    }
    previousTool = tool;
  }
  return Object.freeze(runs);
}

function buildActionRuns(tools: readonly StoryboardToolSnapshot[]): readonly StoryboardActionRun[] {
  return buildActionRunsFromChildren(tools.map((tool) => ({ type: "tool", tool })));
}

function ownershipMatches(
  assistant: AssistantSceneSnapshot,
  followingTools: readonly StoryboardToolSnapshot[],
): boolean {
  const expected = assistant.expectedToolCallIds;
  if (expected.length !== followingTools.length) return false;
  const actual = new Set<string>();
  for (const tool of followingTools) {
    if (actual.has(tool.toolCallId)) return false;
    actual.add(tool.toolCallId);
  }
  return expected.every((callId) => actual.has(callId));
}

function orderedTools(
  assistant: AssistantSceneSnapshot,
  followingTools: readonly StoryboardToolSnapshot[],
): readonly StoryboardToolSnapshot[] | undefined {
  const byId = new Map<string, StoryboardToolSnapshot>();
  for (const tool of followingTools) byId.set(tool.toolCallId, tool);
  const ordered = assistant.expectedToolCallIds.map((id) => byId.get(id));
  return ordered.every((tool): tool is StoryboardToolSnapshot => tool !== undefined)
    ? Object.freeze(ordered)
    : undefined;
}

function buildOrderedChildren(
  assistant: AssistantSceneSnapshot,
  tools: readonly StoryboardToolSnapshot[],
): readonly StoryboardOrderedChild[] | undefined {
  if (assistant.assistantContent === undefined || assistant.sourceOrder === undefined) return undefined;

  const byId = new Map<string, StoryboardToolSnapshot>();
  for (const tool of tools) {
    if (byId.has(tool.toolCallId)) return undefined;
    byId.set(tool.toolCallId, tool);
  }

  const usedTools = new Set<string>();
  const usedContent = new Set<number>();
  const children: StoryboardOrderedChild[] = [];
  for (const item of assistant.sourceOrder) {
    if (item.type === "assistant") {
      const content = assistant.assistantContent[item.contentIndex];
      if (content === undefined || usedContent.has(item.contentIndex)) return undefined;
      usedContent.add(item.contentIndex);
      children.push({ type: "assistant", content });
      continue;
    }
    const tool = byId.get(item.toolCallId);
    if (tool === undefined || usedTools.has(item.toolCallId)) return undefined;
    usedTools.add(item.toolCallId);
    children.push({ type: "tool", tool });
  }

  // Every tool and every assistant part must have an unambiguous source-order
  // position. A mismatch fails open rather than silently dropping content.
  if (usedTools.size !== tools.length || usedTools.size !== assistant.expectedToolCallIds.length) return undefined;
  if (usedContent.size !== assistant.assistantContent.length) return undefined;
  if (!assistant.expectedToolCallIds.every((id) => usedTools.has(id))) return undefined;
  return Object.freeze(children);
}

function makeScene(
  assistant: AssistantSceneSnapshot,
  tools: readonly StoryboardToolSnapshot[],
): StoryboardScene {
  const orderedChildren = buildOrderedChildren(assistant, tools);
  return Object.freeze({
    type: "scene",
    assistant,
    actionRuns: orderedChildren === undefined ? buildActionRuns(tools) : buildActionRunsFromChildren(orderedChildren),
    ...(orderedChildren === undefined ? {} : { orderedChildren }),
    state: deriveSceneState(assistant, tools),
  });
}

/**
 * Build a render-time turn-storyboard projection from ordered,
 * already-inspected snapshots. This function has no Pi dependency and is deliberately
 * conservative: a missing, extra, reordered, expanded, or malformed owned
 * tool produces a native segment rather than a guessed scene.
 *
 * Tool rows are still required to occupy the contiguous direct-child window
 * after an assistant component, which proves scene ownership in Pi's current
 * transcript tree. Their presentation order is then rebuilt from the
 * assistant message's source-order tool-call IDs, not from completion order or
 * from the native row order.
 */
export function buildStoryboard(
  children: readonly StoryboardChild[],
): StoryboardProjection {
  const segments: StoryboardSegment[] = [];

  for (let index = 0; index < children.length;) {
    const child = children[index];
    if (child?.type !== "assistant" || !isAssistantSnapshot(child.assistant)) {
      pushNative(segments, child === undefined ? [] : [child]);
      index++;
      continue;
    }

    const assistant = child.assistant;
    const followingTools: StoryboardToolSnapshot[] = [];
    let end = index + 1;
    while (end < children.length) {
      const next = children[end];
      if (!isToolChild(next)) break;
      followingTools.push(next.tool);
      end++;
    }

    const validAssistant = hasUniqueStrings(assistant.expectedToolCallIds);
    const validTools = followingTools.every(isToolSnapshot);
    const hasExpectedTools = assistant.expectedToolCallIds.length > 0;
    const hasUnclassifiedOrFinalText = assistant.hasFinalAnswer || assistant.hasUnknownText;

    if (!validAssistant || !validTools || (hasExpectedTools && !ownershipMatches(assistant, followingTools))) {
      // Keep the assistant and every contiguous tool row in the affected
      // region native. Nothing in a mismatched run may be silently regrouped.
      pushNative(segments, children.slice(index, end));
      index = end;
      continue;
    }

    if (!hasExpectedTools && followingTools.length > 0) {
      // Tool rows cannot become children of an assistant that claims no calls.
      pushNative(segments, children.slice(index, end));
      index = end;
      continue;
    }

    if (hasExpectedTools && hasUnclassifiedOrFinalText) {
      // A final answer is ordinary Pi output, while an absent/unknown phase is
      // not safe to reinterpret as commentary. Keep the complete response and
      // its tool rows native rather than guessing from position or stopReason.
      pushNative(segments, children.slice(index, end));
      index = end;
      continue;
    }

    if (hasExpectedTools) {
      const tools = orderedTools(assistant, followingTools);
      if (tools === undefined) {
        pushNative(segments, children.slice(index, end));
      } else {
        segments.push(makeScene(assistant, tools));
      }
      index = end;
      continue;
    }

    if (assistant.hasThinking && !assistant.hasText) {
      segments.push(makeScene(assistant, []));
    } else {
      // A final answer or another non-work assistant message stays native.
      pushNative(segments, [child]);
    }
    index++;
  }

  return Object.freeze({ segments: Object.freeze(segments) });
}
