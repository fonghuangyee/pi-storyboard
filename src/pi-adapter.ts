import {
  AssistantMessageComponent,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  stripTerminalSequences,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  sanitizeDisplay,
  type GroupSnapshot,
  type ThemeLike,
  type ToolResultSnapshot,
  type ToolRowSnapshot,
  type ToolName,
} from "./renderer.ts";
import {
  segmentChildren,
  type ChildClassification,
  type GroupKind,
  type Segment,
} from "./grouping.ts";
import {
  buildEmptyThinkingContinuation,
  buildStoryboard,
  buildWorkSpan,
  type AssistantSceneSnapshot,
  type StoryboardAssistantContent,
  type StoryboardAssistantContentType,
  type StoryboardChild,
  type StoryboardSegment,
  type StoryboardSourceItem,
  type StoryboardWorkSpan,
} from "./storyboard.ts";
import {
  renderNativeThinkingMarkersLayout,
  renderStoryboardSceneLayout,
  renderStoryboardWorkSpanLayout,
  storyboardAssistantWidth,
  type StoryboardAssistantRenderRegion,
  type StoryboardGroupRenderer,
  type StoryboardThinkingMarkerColor,
} from "./storyboard-renderer.ts";
import {
  matchesProjectedTurn,
  type SessionProjection,
} from "./session-projection.ts";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type PresentationSettings,
} from "./presentation-settings.ts";

export const PATCH_MARKER = Symbol.for("pi-storyboard.container.v1");

export type PatchHandle = {
  uninstall(): void;
};

export type ToolGroupingPatchOptions = {
  getTheme(): ThemeLike;
  renderGroup: StoryboardGroupRenderer;
  /** Optional live presentation settings snapshot; absent means built-in defaults. */
  getSettings?(): PresentationSettings;
  /** Optional active-path projection used to validate settled restored turns. */
  getSessionProjection?(): SessionProjection | undefined;
};

type ContainerRender = (this: Container, width: number) => string[];

type MouseLayout = {
  width: number;
  children: Array<{ component: Component; height: number }>;
};

/**
 * Container keeps its mouse hit-test layout private. Rebuilding the equivalent
 * layout is necessary when a visual group replaces several direct children;
 * otherwise clicks on following native rows would use stale coordinates.
 */
function setMouseLayout(
  container: Container,
  width: number,
  children: Array<{ component: Component; height: number }>,
): void {
  (container as unknown as { mouseLayout?: MouseLayout }).mouseLayout = {
    width,
    children,
  };
}

/** A grouped summary is presentation-only and intentionally has no click action. */
const GROUP_MOUSE_SINK: Component = {
  render: () => [],
  invalidate: () => undefined,
  handleMouse: () => undefined,
};

type PatchState = {
  original: ContainerRender;
  originalDescriptor: PropertyDescriptor;
  wrapper: ContainerRender;
  owners: number;
  enabled: boolean;
  options?: ToolGroupingPatchOptions;
};

type CandidateClassification = {
  kind: GroupKind;
  snapshot: ToolRowSnapshot;
  toolCallId?: string;
};

type AssistantContentKind = StoryboardAssistantContentType;

type AssistantMetadata = Omit<AssistantSceneSnapshot, "renderedAssistantLines" | "assistantContent" | "sourceOrder"> & {
  readonly contentKinds: readonly AssistantContentKind[];
  readonly sourceOrder: readonly StoryboardSourceItem[];
  readonly hasVisibleContent: boolean;
};

type AssistantPresentation = {
  readonly parts: readonly StoryboardAssistantContent[];
};

function groupKindForTool(toolName: ToolName): GroupKind | undefined {
  switch (toolName) {
    case "edit":
      return "edit";
    case "read":
      return "read";
    case "grep":
    case "find":
      return "search";
    case "ls":
      return "list";
    case "write":
      return "write";
    case "bash":
    case "powershell":
      return "command";
    default:
      // ToolExecutionComponent also represents custom, MCP, and subagent
      // calls. They share a generic presentation while retaining toolName.
      return "tool";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function hasOnlyKnownKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const known = new Set(keys);
  return Object.keys(value).every((key) => known.has(key));
}

type ExpansionStatusGap = {
  readonly boundary: number;
  readonly rows: readonly Component[];
};

type ExpansionStatusProjection = {
  readonly children: readonly Component[];
  readonly gaps: readonly ExpansionStatusGap[];
  readonly toolOutputExpanded?: boolean;
};

/**
 * Pi can insert transient Spacer/Text status pairs into the transcript while
 * the next tool row is still being assembled. The expansion pair and the
 * interactive `/session` info pair are both transcript-neutral: if either
 * lands between an assistant and its tool, the tool would otherwise be
 * stranded outside its owner window. These exact, Pi-shaped rows are retained
 * for output after the atomic storyboard; every other native child remains a
 * hard ownership boundary.
 */
function piToolExpansionState(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const fields = value as Record<string, unknown>;
  if (
    typeof fields.text !== "string" ||
    fields.paddingX !== 1 ||
    fields.paddingY !== 0
  ) {
    return undefined;
  }
  const text = stripTerminalSequences(fields.text).trim();
  if (text === "Tool output: expanded") return true;
  if (text === "Tool output: collapsed") return false;
  return undefined;
}

function isPiStatusSpacer(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fields = value as Record<string, unknown>;
  return hasOwn(fields, "lines") && fields.lines === 1 && typeof fields.render === "function";
}

function isPiSessionInfoStatus(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fields = value as Record<string, unknown>;
  if (
    typeof fields.text !== "string" ||
    fields.paddingX !== 1 ||
    fields.paddingY !== 0 ||
    typeof fields.render !== "function"
  ) {
    return false;
  }

  // `handleSessionCommand()` creates this public pi-tui Text shape. Validate
  // stable headings rather than retaining or interpreting its dynamic values.
  const text = stripTerminalSequences(fields.text).trim();
  return (
    text.startsWith("Session Info") &&
    text.includes("Messages") &&
    text.includes("Tools:") &&
    text.includes("Tokens")
  );
}

function projectExpansionStatusGaps(
  children: readonly Component[],
): ExpansionStatusProjection {
  const projected: Component[] = [];
  const gaps: ExpansionStatusGap[] = [];
  let toolOutputExpanded: boolean | undefined;

  for (let index = 0; index < children.length;) {
    const spacer = children[index];
    const status = children[index + 1];
    const statusState = piToolExpansionState(status);
    const isSessionInfo = isPiSessionInfoStatus(status);
    if (
      status !== undefined &&
      isPiStatusSpacer(spacer) &&
      (statusState !== undefined || isSessionInfo)
    ) {
      if (statusState !== undefined) toolOutputExpanded = statusState;
      gaps.push(Object.freeze({
        boundary: projected.length,
        rows: Object.freeze([spacer, status]),
      }));
      index += 2;
      continue;
    }
    if (spacer !== undefined) projected.push(spacer);
    index++;
  }

  return Object.freeze({
    children: Object.freeze(projected),
    gaps: Object.freeze(gaps),
    ...(toolOutputExpanded === undefined ? {} : { toolOutputExpanded }),
  });
}

type ValidatedTextPhase = "commentary" | "final_answer";

/** Decode only Pi's documented TextSignatureV1 shape; all other metadata is opaque. */
function validatedTextPhase(value: unknown): ValidatedTextPhase | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.v !== 1 ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      return undefined;
    }
    return parsed.phase === "commentary" || parsed.phase === "final_answer"
      ? parsed.phase
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copy the JSON-like state exposed by a tool row. In particular, do not freeze
 * Pi's actual argument/result objects: a renderer supplied by another
 * extension must never be able to mutate the live transcript through us.
 */
function copySnapshot(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copySnapshot(item, seen));
    return Object.freeze(copy);
  }

  const copy = Object.create(null) as Record<string, unknown>;
  const object = value as Record<string, unknown>;
  seen.set(value, copy);
  for (const key of Object.keys(object)) {
    copy[key] = copySnapshot(object[key], seen);
  }
  return Object.freeze(copy);
}

function resultErrorState(value: unknown): boolean | undefined {
  if (!isRecord(value) || !Array.isArray(value.content) || typeof value.isError !== "boolean") {
    return undefined;
  }

  // Validate the result shape without copying potentially large edit details,
  // diffs, patches, or tool output into an edit snapshot.
  for (const rawBlock of value.content) {
    if (!isRecord(rawBlock) || typeof rawBlock.type !== "string") return undefined;
    if (hasOwn(rawBlock, "text") && rawBlock.text !== undefined && typeof rawBlock.text !== "string") {
      return undefined;
    }
    if (hasOwn(rawBlock, "data") && rawBlock.data !== undefined && typeof rawBlock.data !== "string") {
      return undefined;
    }
    if (hasOwn(rawBlock, "mimeType") && rawBlock.mimeType !== undefined && typeof rawBlock.mimeType !== "string") {
      return undefined;
    }
  }

  return value.isError;
}

const SUCCESSFUL_RESULT: ToolResultSnapshot = Object.freeze({
  content: Object.freeze([]),
  isError: false,
});

const FAILED_RESULT: ToolResultSnapshot = Object.freeze({
  content: Object.freeze([]),
  isError: true,
});

const MAX_ERROR_SUMMARY_CODE_POINTS = 512;

function minimalResult(isError: boolean): ToolResultSnapshot {
  return isError ? FAILED_RESULT : SUCCESSFUL_RESULT;
}

function isStructuralErrorLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (/^[()[\]{};,.:]+$/u.test(trimmed)) return true;
  // Do not mistake the tail of a serialized validation argument for the
  // diagnostic itself (for example, a final `}` or `"limit": 16`).
  return /^"[^"]+"\s*:/u.test(trimmed);
}

function isLikelyDiagnosticLine(line: string): boolean {
  return /\b(?:error|fail(?:ed|ure)?|invalid|cannot|could not|must|required|missing|not found|exited|denied|abort(?:ed)?|exception|timeout)\b/iu.test(line);
}

function extractErrorSummary(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return undefined;

  const lines: string[] = [];
  for (const rawBlock of value.content) {
    if (!isRecord(rawBlock) || typeof rawBlock.text !== "string") continue;
    for (const rawLine of rawBlock.text.split(/\r?\n|\r/u)) {
      const line = sanitizeDisplay(rawLine);
      if (!isStructuralErrorLine(line)) lines.push(line);
    }
  }

  // Prefer a generic diagnostic over a trailing context/header line, while
  // retaining the last useful line for tools whose output has no keywords.
  let selected: string | undefined;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (isLikelyDiagnosticLine(lines[index]!)) {
      selected = lines[index];
      break;
    }
  }
  selected ??= lines.at(-1);
  if (selected === undefined) return undefined;

  // Validation output commonly uses a bullet for its useful message. The row
  // already supplies its own separator, so avoid rendering ` - - message`.
  selected = selected.replace(/^[-*•]\s+/u, "");
  return Array.from(selected).slice(0, MAX_ERROR_SUMMARY_CODE_POINTS).join("");
}

type EditSummaryArgs = {
  readonly path: string;
  readonly replacementCount?: number;
};

type WriteSummaryArgs = {
  readonly path: string;
};

function summarizeEditPath(value: unknown): EditSummaryArgs | undefined {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) {
    return undefined;
  }
  return Object.freeze({ path: value.path });
}

function summarizeEditArgs(value: unknown): EditSummaryArgs | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["path", "edits"]) ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    !Array.isArray(value.edits)
  ) {
    return undefined;
  }

  // Inspect only the shape and count. Never retain oldText/newText references.
  for (const edit of value.edits) {
    if (
      !isRecord(edit) ||
      !hasOnlyKnownKeys(edit, ["oldText", "newText"]) ||
      typeof edit.oldText !== "string" ||
      typeof edit.newText !== "string"
    ) {
      return undefined;
    }
  }

  return Object.freeze({
    path: value.path,
    replacementCount: value.edits.length,
  });
}

function summarizeWritePath(value: unknown): WriteSummaryArgs | undefined {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) {
    return undefined;
  }
  // A write snapshot never retains content, even when the call fails.
  return Object.freeze({ path: value.path });
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && value.length > 0;
}

/**
 * Pi's shell renderer stores its timing state in rendererState. Read it only
 * when it is present and valid; never invent a duration for tools that do not
 * expose one.
 */
function elapsedFromPiState(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) {
    return undefined;
  }

  let end = Date.now();
  if (hasOwn(value, "endedAt")) {
    if (typeof value.endedAt !== "number" || !Number.isFinite(value.endedAt)) return undefined;
    end = value.endedAt;
  }

  const elapsed = end - value.startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : undefined;
}

function toolExpandedState(row: unknown): boolean | undefined {
  if (!(row instanceof ToolExecutionComponent) || !isRecord(row)) return undefined;
  const fields = row as unknown as Record<string, unknown>;
  return hasOwn(fields, "expanded") && typeof fields.expanded === "boolean"
    ? fields.expanded
    : undefined;
}

function inspectToolRow(row: unknown): CandidateClassification | undefined {
  if (!(row instanceof ToolExecutionComponent)) return undefined;
  if (!isRecord(row)) return undefined;
  const fields = row as unknown as Record<string, unknown>;

  // These are private implementation fields in Pi 0.85.x. Keep all access in
  // this function so a field change makes the row native rather than guessed.
  if (
    !hasOwn(fields, "toolName") ||
    !hasOwn(fields, "args") ||
    !hasOwn(fields, "result") ||
    !hasOwn(fields, "isPartial") ||
    !hasOwn(fields, "expanded") ||
    !isToolName(fields.toolName) ||
    typeof fields.isPartial !== "boolean" ||
    typeof fields.expanded !== "boolean"
  ) {
    return undefined;
  }

  const kind = groupKindForTool(fields.toolName);
  if (kind === undefined) return undefined;

  const toolCallId = fields.toolCallId;
  if (toolCallId !== undefined && (!isToolName(toolCallId))) return undefined;

  const resultError = fields.result === undefined ? undefined : resultErrorState(fields.result);
  if (fields.result !== undefined && resultError === undefined) return undefined;

  // Expanded rows remain native. Image results may use the compact path/status
  // summary while collapsed; expanded mode still delegates to Pi's native image
  // renderer. Failed rows use a minimal status result and error summary rather
  // than copying their complete output or details.
  if (fields.expanded) return undefined;

  if (kind === "edit") {
    // A collapsed running edit is a compact pending row. Retain at most its
    // validated path; Pi keeps the live preview state on its native component
    // for explicit expanded mode, but the storyboard never renders that Box.
    if (fields.isPartial || fields.result === undefined) {
      const snapshot: ToolRowSnapshot = Object.freeze({
        toolName: "edit",
        args: summarizeEditPath(fields.args),
        result: undefined,
        isPartial: true,
        expanded: false,
      });
      return {
        kind,
        snapshot,
        ...(toolCallId === undefined ? {} : { toolCallId }),
      };
    }

    // Once the final result settles, retain only the path/count projection
    // and, on failure, one generic error line.
    const args = resultError === true
      ? summarizeEditArgs(fields.args) ?? summarizeEditPath(fields.args)
      : summarizeEditArgs(fields.args);
    if (resultError === false && args === undefined) return undefined;

    const snapshot: ToolRowSnapshot = Object.freeze({
      toolName: fields.toolName,
      args,
      result: minimalResult(resultError === true),
      errorSummary: resultError === true ? extractErrorSummary(fields.result) : undefined,
      isPartial: false,
      expanded: false,
    });
    return {
      kind,
      snapshot,
      ...(toolCallId === undefined ? {} : { toolCallId }),
    };
  }

  const args = fields.toolName === "write"
    ? summarizeWritePath(fields.args)
    : copySnapshot(fields.args);
  if (fields.toolName === "write" && args === undefined) {
    // A failed write can still be grouped without exposing malformed content;
    // a successful write needs a safe destination path.
    if (resultError !== true) return undefined;
  }

  const elapsedMs = kind === "command" ? elapsedFromPiState(fields.rendererState) : undefined;
  const snapshot: ToolRowSnapshot = Object.freeze({
    toolName: fields.toolName,
    args,
    result: fields.result === undefined ? undefined : minimalResult(resultError === true),
    errorSummary: resultError === true ? extractErrorSummary(fields.result) : undefined,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    isPartial: fields.isPartial,
    expanded: fields.expanded,
  });

  return {
    kind,
    snapshot,
    ...(toolCallId === undefined ? {} : { toolCallId }),
  };
}

function isAssistant(row: unknown): row is AssistantMessageComponent {
  return typeof AssistantMessageComponent === "function" && row instanceof AssistantMessageComponent;
}

/**
 * Read only the assistant metadata needed by the pure turn-storyboard model. Raw
 * thinking, tool arguments, signatures, and results never leave this adapter.
 * The source-order references deliberately retain only content kinds, indexes,
 * and tool-call IDs.
 */
function inspectAssistantMetadata(row: unknown): AssistantMetadata | undefined {
  if (!isAssistant(row) || !isRecord(row)) return undefined;
  const fields = row as unknown as Record<string, unknown>;
  const message = fields.lastMessage;
  if (
    !isRecord(message) ||
    message.role !== "assistant" ||
    !Array.isArray(message.content) ||
    typeof message.stopReason !== "string" ||
    typeof fields.isStreaming !== "boolean"
  ) {
    return undefined;
  }

  const expectedToolCallIds: string[] = [];
  const contentKinds: AssistantContentKind[] = [];
  const sourceOrder: StoryboardSourceItem[] = [];
  let hasThinking = false;
  let hasText = false;
  let hasFinalAnswer = false;
  let hasUnknownText = false;
  let hasVisibleContent = false;

  const addAssistantContent = (kind: AssistantContentKind): void => {
    const contentIndex = contentKinds.length;
    contentKinds.push(kind);
    sourceOrder.push({ type: "assistant", contentIndex });
  };

  for (let index = 0; index < message.content.length; index++) {
    const rawBlock = message.content[index];
    if (!isRecord(rawBlock) || typeof rawBlock.type !== "string") return undefined;
    if (rawBlock.type === "text") {
      if (typeof rawBlock.text !== "string") return undefined;
      if (rawBlock.text.trim().length > 0) {
        const phase = validatedTextPhase(rawBlock.textSignature);
        hasText = true;
        hasVisibleContent = true;
        if (phase === "final_answer") hasFinalAnswer = true;
        if (phase === undefined) hasUnknownText = true;
        addAssistantContent(phase ?? "text");
      }
    } else if (rawBlock.type === "thinking") {
      const thinkingBlocks: string[] = [];
      for (; index < message.content.length; index++) {
        const thinkingContent = message.content[index];
        if (!isRecord(thinkingContent) || thinkingContent.type !== "thinking") break;
        if (typeof thinkingContent.thinking !== "string") return undefined;
        if (thinkingContent.thinking.trim().length > 0) thinkingBlocks.push(thinkingContent.thinking);
      }
      index--;
      if (thinkingBlocks.length > 0) {
        hasThinking = true;
        hasVisibleContent = true;
        addAssistantContent("thinking");

        // This is the native AssistantMessageComponent spacer policy: it
        // depends only on later visible assistant content, not on tool calls.
        const hasVisibleContentAfter = message.content
          .slice(index + 1)
          .some((content) =>
            isRecord(content) &&
            ((content.type === "text" && typeof content.text === "string" && content.text.trim().length > 0) ||
              (content.type === "thinking" && typeof content.thinking === "string" && content.thinking.trim().length > 0)),
          );
        if (hasVisibleContentAfter) addAssistantContent("native");
      }
    } else if (rawBlock.type === "toolCall") {
      if (!isToolName(rawBlock.id)) return undefined;
      expectedToolCallIds.push(rawBlock.id);
      sourceOrder.push({ type: "tool", toolCallId: rawBlock.id });
    } else {
      return undefined;
    }
  }

  return Object.freeze({
    assistantRow: row,
    expectedToolCallIds: Object.freeze(expectedToolCallIds),
    stopReason: message.stopReason,
    isStreaming: fields.isStreaming,
    hasThinking,
    hasText,
    hasFinalAnswer,
    hasUnknownText,
    contentKinds: Object.freeze(contentKinds),
    sourceOrder: Object.freeze(sourceOrder),
    hasVisibleContent,
  });
}

/**
 * Reuse the actual native content children after Pi has rendered the
 * AssistantMessageComponent. This is the only additional private shape we
 * inspect: it lets the presentation wrapper move MouseRegion/Markdown
 * children around tool groups without recreating Markdown or thinking text.
 */
function inspectAssistantPresentation(
  row: AssistantMessageComponent,
  metadata: AssistantMetadata,
  width: number,
  renderedAssistantLines: readonly string[],
): AssistantPresentation | undefined | null {
  if (!isRecord(row)) return undefined;
  const fields = row as unknown as Record<string, unknown>;
  // Test doubles and older compatible shapes may not expose the child
  // container. They retain the established whole-assistant fallback path.
  if (!hasOwn(fields, "contentContainer")) return null;
  const contentContainer = fields.contentContainer;
  if (!isRecord(contentContainer) || !Array.isArray(contentContainer.children)) return undefined;
  const layout = contentContainer.mouseLayout;
  if (
    !isRecord(layout) ||
    layout.width !== width ||
    !Array.isArray(layout.children) ||
    layout.children.length !== contentContainer.children.length
  ) return undefined;

  const children = contentContainer.children as unknown[];
  const layoutChildren = layout.children as unknown[];
  let childCursor = 0;
  let lineCursor = 0;
  const parts: StoryboardAssistantContent[] = [];

  const consumeChild = (): { child: unknown; lines: string[] } | undefined => {
    const child = children[childCursor];
    const layoutEntry = layoutChildren[childCursor];
    childCursor++;
    if (!child || !isRecord(layoutEntry) || layoutEntry.component !== child) return undefined;
    if (typeof layoutEntry.height !== "number" || !Number.isSafeInteger(layoutEntry.height) || layoutEntry.height < 0) {
      return undefined;
    }
    const end = lineCursor + layoutEntry.height;
    if (end > renderedAssistantLines.length) return undefined;
    const lines = [...renderedAssistantLines.slice(lineCursor, end)];
    lineCursor = end;
    return { child, lines };
  };

  // A visible assistant message starts with exactly one native Spacer(1).
  // Diagnostic-only messages do not have this leading spacer.
  if (metadata.hasVisibleContent) {
    const leading = consumeChild();
    if (leading === undefined || leading.lines.some((line) => visibleWidth(line) !== 0)) return undefined;
  }

  for (const kind of metadata.contentKinds) {
    const consumed = consumeChild();
    if (consumed === undefined) return undefined;
    parts.push(Object.freeze({
      type: kind,
      row: consumed.child,
      renderedLines: Object.freeze(consumed.lines),
    }));
  }

  // Pi appends length/abort/error diagnostics after the content children. They
  // are not message.content items, but retaining them as native parts keeps
  // native diagnostics visible in an ordered scene.
  while (childCursor < children.length) {
    const consumed = consumeChild();
    if (consumed === undefined) return undefined;
    parts.push(Object.freeze({
      type: "native",
      row: consumed.child,
      renderedLines: Object.freeze(consumed.lines),
    }));
  }

  return lineCursor === renderedAssistantLines.length ? { parts: Object.freeze(parts) } : undefined;
}

function widenCommentaryPresentation(
  presentation: AssistantPresentation,
  width: number,
): AssistantPresentation | undefined {
  const parts: StoryboardAssistantContent[] = [];
  for (const part of presentation.parts) {
    if (part.type !== "commentary") {
      parts.push(part);
      continue;
    }
    const rendered = (part.row as Component).render(width);
    if (!validRenderedLines(rendered)) return undefined;
    parts.push(Object.freeze({
      ...part,
      renderedLines: Object.freeze([...rendered]),
    }));
  }
  return { parts: Object.freeze(parts) };
}

function withAssistantLines(
  metadata: AssistantMetadata,
  renderedAssistantLines: readonly string[],
  presentation?: AssistantPresentation,
): AssistantSceneSnapshot {
  const base = {
    assistantRow: metadata.assistantRow,
    renderedAssistantLines: Object.freeze([...renderedAssistantLines]),
    expectedToolCallIds: metadata.expectedToolCallIds,
    stopReason: metadata.stopReason,
    isStreaming: metadata.isStreaming,
    hasThinking: metadata.hasThinking,
    hasText: metadata.hasText,
    hasFinalAnswer: metadata.hasFinalAnswer,
    hasUnknownText: metadata.hasUnknownText,
  };
  if (presentation === undefined) return Object.freeze(base);

  const assistantContent = presentation.parts;
  const sourceOrder = [...metadata.sourceOrder];
  for (let index = metadata.contentKinds.length; index < assistantContent.length; index++) {
    sourceOrder.push({ type: "assistant", contentIndex: index });
  }
  return Object.freeze({
    ...base,
    assistantContent,
    sourceOrder: Object.freeze(sourceOrder),
  });
}

function nativeClassification(row: unknown): ChildClassification {
  return { type: "native", row };
}

function candidateClassification(row: unknown, candidate: CandidateClassification): ChildClassification {
  return { type: "candidate", kind: candidate.kind, row };
}

function invisibleClassification(row: unknown): ChildClassification {
  return { type: "invisible", row };
}

/**
 * A mixed no-tool assistant occupies one mouse-layout entry. Thinking clicks
 * are translated to their native child; final/unknown text stays at native
 * coordinates and is delegated to the original assistant.
 */
class StoryboardThinkingMouseProxy implements Component {
  constructor(
    private readonly assistant: Component,
    private readonly regions: readonly StoryboardAssistantRenderRegion[],
  ) {}

  render(_width: number): string[] {
    return [];
  }

  invalidate(): void {}

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const region = this.regions.find(
      (candidate) => event.y >= candidate.start && event.y < candidate.start + candidate.height,
    );
    if (region !== undefined) {
      if (event.x < region.prefixWidth) return { handled: true };
      const result = (region.row as Component).handleMouse?.({
        ...event,
        x: event.x - region.prefixWidth,
        width: Math.max(1, event.width - region.prefixWidth),
        y: event.y - region.start + (region.sourceStart ?? 0),
        height: region.sourceHeight ?? region.height,
      });
      return result ?? { handled: true };
    }

    // Final/unknown text remains at its native x-coordinate and is delegated
    // to the original assistant component. Only thinking rows are shifted.
    return this.assistant.handleMouse?.(event) ?? { handled: true };
  }
}

class StoryboardSceneMouseProxy implements Component {
  constructor(
    private readonly assistant: Component,
    private readonly assistantWidth: number,
    private readonly assistantHeight: number,
    private readonly prefixWidth: number,
    private readonly regions: readonly StoryboardAssistantRenderRegion[] = [],
  ) {}

  render(_width: number): string[] {
    return [];
  }

  invalidate(): void {}

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const region = this.regions.find(
      (candidate) => event.y >= candidate.start && event.y < candidate.start + candidate.height,
    );
    if (region !== undefined) {
      const regionWidth = Math.max(1, event.width - region.prefixWidth);
      if (
        event.x < region.prefixWidth ||
        event.x >= region.prefixWidth + regionWidth
      ) {
        return { handled: true };
      }
      const result = (region.row as Component).handleMouse?.({
        ...event,
        x: event.x - region.prefixWidth,
        y: event.y - region.start + (region.sourceStart ?? 0),
        width: regionWidth,
        height: region.sourceHeight ?? region.height,
      });
      return result ?? { handled: true };
    }

    // Ordered scenes have explicit regions for every native assistant child.
    // Never feed a rail or compact-tool coordinate to the original assistant,
    // whose private mouse layout still reflects the unprojected component.
    if (this.regions.length > 0) return { handled: true };

    if (
      event.y < 0 ||
      event.y >= this.assistantHeight ||
      event.x < this.prefixWidth ||
      event.x >= this.prefixWidth + this.assistantWidth
    ) {
      return { handled: true };
    }

    const result = this.assistant.handleMouse?.({
      ...event,
      x: event.x - this.prefixWidth,
      width: this.assistantWidth,
      height: this.assistantHeight,
    });
    return result ?? { handled: true };
  }
}

function validRenderedLines(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((line) => typeof line === "string");
}

function nativeThinkingMarkerColor(
  snapshot: AssistantSceneSnapshot,
  settings: PresentationSettings,
): StoryboardThinkingMarkerColor {
  return snapshot.isStreaming || snapshot.stopReason === "pending"
    ? settings.colors.thinking.active
    : settings.colors.thinking.settled;
}

function invokeOriginal(container: Container, state: PatchState, width: number): string[] {
  return state.original.call(container, width);
}

type StoryboardAttempt = {
  requested: boolean;
  output?: string[];
};

function componentForStoryboardChild(child: StoryboardChild): Component | undefined {
  const row = child.type === "assistant"
    ? child.assistant.assistantRow
    : child.type === "tool"
      ? child.tool.toolRow
      : child.row;
  if (!row || typeof (row as Component).render !== "function") return undefined;
  return row as Component;
}

function makeStoryboardChild(
  child: Component,
  metadata: Map<AssistantMessageComponent, AssistantMetadata>,
  snapshots: Map<AssistantMessageComponent, AssistantSceneSnapshot>,
  candidates: Map<ToolExecutionComponent, CandidateClassification>,
): StoryboardChild {
  if (isAssistant(child)) {
    const snapshot = snapshots.get(child);
    if (snapshot !== undefined) return { type: "assistant", assistant: snapshot };
    const assistant = metadata.get(child);
    if (assistant !== undefined) return { type: "assistant", assistant: withAssistantLines(assistant, []) };
    return { type: "native", row: child };
  }

  if (child instanceof ToolExecutionComponent) {
    const candidate = candidates.get(child);
    if (candidate?.toolCallId !== undefined) {
      return {
        type: "tool",
        tool: {
          toolRow: child,
          toolCallId: candidate.toolCallId,
          kind: candidate.kind,
          snapshot: candidate.snapshot,
        },
      };
    }
  }
  return { type: "native", row: child };
}

type WorkSpanPlan = {
  readonly start: number;
  readonly end: number;
  readonly span: StoryboardWorkSpan;
};

type SessionSceneInfo = {
  readonly segment: Extract<ReturnType<typeof buildStoryboard>["segments"][number], { type: "scene" }>;
  readonly live: boolean;
  readonly turnIndex?: number;
};

/** Number of projected direct children consumed by one storyboard segment. */
function storyboardSegmentChildCount(segment: StoryboardSegment): number {
  if (segment.type === "native") return segment.children.length;
  return 1 + segment.actionRuns.reduce((count, run) => count + run.rows.length, 0);
}

function hasCommentary(segment: SessionSceneInfo["segment"]): boolean {
  return segment.assistant.assistantContent?.some((content) => content.type === "commentary") ?? false;
}

function canContinueEmptyThinking(
  previous: SessionSceneInfo,
  next: SessionSceneInfo,
  session: SessionProjection,
): boolean {
  if (
    previous.live ||
    next.live ||
    previous.turnIndex === undefined ||
    next.turnIndex === undefined ||
    next.turnIndex !== previous.turnIndex + 1 ||
    previous.segment.assistant.hasText ||
    next.segment.assistant.hasThinking ||
    next.segment.assistant.hasText ||
    next.segment.actionRuns.length === 0
  ) {
    return false;
  }

  const previousTurn = session.turns[previous.turnIndex];
  const nextTurn = session.turns[next.turnIndex];
  if (previousTurn === undefined || nextTurn === undefined) return false;
  return !previousTurn.boundaryAfter && !nextTurn.boundaryBefore;
}

/**
 * Plan ordinary one-turn storyboards plus the narrow visual continuation for
 * directly adjacent settled turns whose later thinking is empty/absent. The
 * session projection proves active-path ownership and hard boundaries; it does
 * not create or imply a durable agent-run identity.
 */
function planSessionWorkSpans(
  segments: ReturnType<typeof buildStoryboard>["segments"],
  session: SessionProjection,
): readonly WorkSpanPlan[] | undefined {
  const usedTurns = new Set<number>();
  const sceneInfo = new Map<number, SessionSceneInfo>();
  let hasToolScene = false;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment?.type !== "scene" || segment.assistant.expectedToolCallIds.length === 0) continue;
    hasToolScene = true;

    // A live assistant/tool scene is not complete in the public session path
    // yet: Pi has not written its toolResult while the tool is executing. The
    // direct TUI ownership checks above are still sufficient for this single
    // scene, so keep the storyboard visible while a blocking tool such as
    // ask_user_question owns the input overlay. The active-path index is only
    // needed to prove settled turns belong to the current branch.
    const live =
      segment.state === "running" ||
      segment.assistant.isStreaming ||
      segment.assistant.stopReason === "pending";
    let turnIndex: number | undefined;
    if (!live) {
      const matchingTurns = session.turns
        .map((turn, candidateIndex) => ({ turn, candidateIndex }))
        .filter(({ turn }) =>
          matchesProjectedTurn(turn, segment.assistant.expectedToolCallIds) &&
          turn.hasVisibleThinking === segment.assistant.hasThinking &&
          turn.hasCommentary === hasCommentary(segment),
        );
      if (matchingTurns.length !== 1) return undefined;
      turnIndex = matchingTurns[0]!.candidateIndex;
      if (usedTurns.has(turnIndex)) return undefined;
      usedTurns.add(turnIndex);
    }

    sceneInfo.set(index, Object.freeze({ segment, live, ...(turnIndex === undefined ? {} : { turnIndex }) }));
  }

  if (!hasToolScene) return Object.freeze([]);

  const plans: WorkSpanPlan[] = [];
  for (let index = 0; index < segments.length;) {
    const first = sceneInfo.get(index);
    if (first === undefined) {
      index++;
      continue;
    }

    const scenes: SessionSceneInfo["segment"][] = [first.segment];
    let end = index;
    let previous = first;
    // Only a visible-thinking scene can anchor a continuation. Empty scenes
    // without such an anchor remain truthful action roots on their own.
    if (
      !first.live &&
      first.segment.assistant.hasThinking &&
      !first.segment.assistant.hasText &&
      first.segment.actionRuns.length > 0
    ) {
      for (let nextIndex = index + 1; nextIndex < segments.length; nextIndex++) {
        const next = sceneInfo.get(nextIndex);
        if (next === undefined || !canContinueEmptyThinking(previous, next, session)) break;
        scenes.push(next.segment);
        end = nextIndex;
        previous = next;
      }
    }

    const span = scenes.length > 1
      ? buildEmptyThinkingContinuation(scenes)
      : buildWorkSpan([first.segment]);
    if (span === undefined) return undefined;
    plans.push(Object.freeze({ start: index, end, span }));
    index = end + 1;
  }

  return Object.freeze(plans);
}

/**
 * Attempt the turn-storyboard projection independently from the legacy
 * grouping path. Tool-bearing assistant responses with no visible thinking
 * use an action root in the active-path projection, or the legacy
 * presentation-only placeholder when no session projection is available.
 * A validated same-response commentary suffix receives the fixed
 * presentation-only `Thinking...` node before its eligible tool run.
 * Adjacent settled empty-thinking turns may continue under a validated
 * visible-thinking root; older/incomplete shapes still fall back unchanged.
 */
function renderStoryboardIfRequested(
  container: Container,
  width: number,
  options: ToolGroupingPatchOptions,
): StoryboardAttempt {
  const directChildren = container.children.slice();
  if (directChildren.length === 0) return { requested: false };
  const settings = options.getSettings?.() ?? DEFAULT_PRESENTATION_SETTINGS;

  // Only session-aware mode can safely bridge the exact Pi expansion or
  // `/session` status pair: the session projection still proves assistant/tool
  // ownership by call ID. The legacy adjacency grouper remains unchanged and
  // therefore fails open.
  const expansionStatus = options.getSessionProjection === undefined
    ? undefined
    : projectExpansionStatusGaps(directChildren);
  const children = expansionStatus?.children.slice() ?? directChildren;

  const candidates = new Map<ToolExecutionComponent, CandidateClassification>();
  const metadata = new Map<AssistantMessageComponent, AssistantMetadata>();
  for (const child of children) {
    if (child instanceof ToolExecutionComponent) {
      const candidate = inspectToolRow(child);
      if (candidate !== undefined) candidates.set(child, candidate);
    } else if (isAssistant(child)) {
      const assistant = inspectAssistantMetadata(child);
      if (assistant !== undefined) metadata.set(child, assistant);
    }
  }

  const storyboardRequested = [...metadata.values()].some(
    (assistant) => assistant.expectedToolCallIds.length > 0 || assistant.hasThinking,
  );
  // Pi's global expansion state also applies to no-tool assistant rows. Do not
  // leave storyboard-only thinking markers on those rows while any native tool
  // row (or the latest Pi status pair) says that native expansion is active.
  const nativeExpansionActive =
    expansionStatus?.toolOutputExpanded === true ||
    children.some((child) => toolExpandedState(child) === true);
  const thinkingDecorationOwners = new Set<AssistantMessageComponent>(
    nativeExpansionActive
      ? []
      : [...metadata.entries()]
        .filter(([, assistant]) => assistant.hasThinking && assistant.expectedToolCallIds.length === 0 && assistant.hasText)
        .map(([assistant]) => assistant),
  );
  if (!storyboardRequested) {
    // Once session-aware mode is installed, an unowned or incompatible tool
    // row must not fall through to the legacy adjacency grouper.
    if (options.getSessionProjection !== undefined && children.some((child) => child instanceof ToolExecutionComponent)) {
      return { requested: true };
    }
    return { requested: false };
  }

  const preSnapshots = new Map<AssistantMessageComponent, AssistantSceneSnapshot>();
  for (const [assistant, assistantMetadata] of metadata) {
    preSnapshots.set(assistant, withAssistantLines(assistantMetadata, []));
  }
  const preChildren = children.map((child) => makeStoryboardChild(child, metadata, preSnapshots, candidates));
  const preProjection = buildStoryboard(preChildren);
  const sceneOwners = new Set<unknown>();
  for (const segment of preProjection.segments) {
    if (segment.type === "scene") sceneOwners.add(segment.assistant.assistantRow);
  }

  const nativeLines = new Map<Component, string[]>();
  const assistantSnapshots = new Map<AssistantMessageComponent, AssistantSceneSnapshot>();
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  for (const child of children) {
    if (child instanceof ToolExecutionComponent) continue;
    if (!child || typeof child.render !== "function") return { requested: true };
    const assistantMetadata = isAssistant(child) ? metadata.get(child) : undefined;
    const renderWidth = assistantMetadata !== undefined && sceneOwners.has(child)
      ? storyboardAssistantWidth(safeWidth, settings)
      : safeWidth;
    const lines = child.render(renderWidth);
    if (!validRenderedLines(lines)) return { requested: true };
    nativeLines.set(child, lines);
    if (isAssistant(child) && assistantMetadata !== undefined) {
      let presentation: AssistantPresentation | undefined | null;
      if (sceneOwners.has(child) || thinkingDecorationOwners.has(child)) {
        presentation = inspectAssistantPresentation(child, assistantMetadata, renderWidth, lines);
        if (presentation === undefined) return { requested: true };
        if (
          options.getSessionProjection !== undefined &&
          presentation !== null &&
          assistantMetadata.expectedToolCallIds.length > 0
        ) {
          presentation = widenCommentaryPresentation(presentation, safeWidth);
          if (presentation === undefined) return { requested: true };
        }
      }
      // `null` means that this is an older/test-shaped assistant component
      // without the native content container; retain the established whole
      // assistant fallback for that shape.
      assistantSnapshots.set(child, withAssistantLines(assistantMetadata, lines, presentation ?? undefined));
    }
  }

  const storyboardChildren = children.map((child) => makeStoryboardChild(
    child,
    metadata,
    assistantSnapshots,
    candidates,
  ));
  const projection = buildStoryboard(storyboardChildren);
  const finalSceneOwners = new Set<unknown>();
  for (const segment of projection.segments) {
    if (segment.type === "scene") finalSceneOwners.add(segment.assistant.assistantRow);
  }
  // A scene owner that became incompatible after the native child extraction
  // must not be emitted with the reduced scene width. Re-run Pi's complete
  // container instead of accidentally narrowing a native fallback.
  for (const owner of sceneOwners) {
    if (!finalSceneOwners.has(owner)) return { requested: true };
  }
  const rendered: string[] = [];
  const mouseChildren: Array<{ component: Component; height: number }> = [];
  const theme = options.getTheme();
  const thinkingDecorations = new Map<Component, {
    readonly lines: readonly string[];
    readonly assistantRegions: readonly StoryboardAssistantRenderRegion[];
  }>();
  for (const owner of thinkingDecorationOwners) {
    const snapshot = assistantSnapshots.get(owner);
    if (snapshot?.assistantContent === undefined) continue;
    const decoration = renderNativeThinkingMarkersLayout(
      snapshot.renderedAssistantLines,
      snapshot.assistantContent,
      safeWidth,
      theme,
      nativeThinkingMarkerColor(snapshot, settings),
      settings,
    );
    thinkingDecorations.set(owner, decoration);
  }

  const renderNative = (child: StoryboardChild): string[] => {
    const component = componentForStoryboardChild(child);
    if (component === undefined) throw new Error("native storyboard child is not renderable");
    const decorated = thinkingDecorations.get(component);
    if (decorated !== undefined) return [...decorated.lines];
    const cached = nativeLines.get(component);
    if (cached !== undefined) return cached;
    const lines = component.render(safeWidth);
    if (!validRenderedLines(lines)) throw new Error("native child returned invalid lines");
    nativeLines.set(component, lines);
    return lines;
  };

  if (options.getSessionProjection !== undefined) {
    const session = options.getSessionProjection();
    if (session === undefined) return { requested: true };
    const plans = planSessionWorkSpans(projection.segments, session);
    if (plans === undefined) return { requested: true };

    const expansionGaps = expansionStatus?.gaps ?? [];
    const gapLayouts = new Map<ExpansionStatusGap, readonly {
      readonly component: Component;
      readonly lines: readonly string[];
    }[]>();
    for (const gap of expansionGaps) {
      const rows = gap.rows.map((component) => {
        const lines = component.render(safeWidth);
        if (!validRenderedLines(lines)) throw new Error("transient status returned invalid lines");
        return Object.freeze({ component, lines: Object.freeze([...lines]) });
      });
      gapLayouts.set(gap, Object.freeze(rows));
    }

    const planByStart = new Map(plans.map((plan) => [plan.start, plan]));
    const covered = new Set<number>();
    const workMembers = new Set<Component>();
    const workMouse = new Map<Component, { component: Component; height: number }>();
    const workLayouts = new Map<number, { readonly lines: readonly string[] }>();
    const nativeMouse = new Map<Component, { component: Component; height: number }>();
    // Normally the private Container mouse layout follows direct-child order.
    // A bridged status pair is rendered after its atomic scene, so use the
    // actual visual order only for that compatibility path.
    const visualMouseChildren: Array<{ component: Component; height: number }> | undefined =
      expansionGaps.length === 0 ? undefined : [];
    let nextExpansionGap = 0;

    const appendExpansionGap = (gap: ExpansionStatusGap): void => {
      const rows = gapLayouts.get(gap);
      if (rows === undefined) throw new Error("transient status layout missing");
      for (const row of rows) {
        rendered.push(...row.lines);
        visualMouseChildren?.push({ component: row.component, height: row.lines.length });
      }
    };

    const appendExpansionGapsBefore = (boundary: number): void => {
      while (nextExpansionGap < expansionGaps.length) {
        const gap = expansionGaps[nextExpansionGap];
        if (gap === undefined || gap.boundary !== boundary) break;
        appendExpansionGap(gap);
        nextExpansionGap++;
      }
    };

    const appendExpansionGapsAfter = (start: number, end: number): void => {
      while (nextExpansionGap < expansionGaps.length) {
        const gap = expansionGaps[nextExpansionGap];
        if (gap === undefined || gap.boundary <= start || gap.boundary > end) break;
        appendExpansionGap(gap);
        nextExpansionGap++;
      }
    };

    for (const plan of plans) {
      for (let index = plan.start; index <= plan.end; index++) {
        covered.add(index);
        const segment = projection.segments[index];
        if (segment?.type !== "scene") throw new Error("work span segment is not a scene");
        const assistant = componentForStoryboardChild({ type: "assistant", assistant: segment.assistant });
        if (assistant === undefined) throw new Error("work span assistant is not renderable");
        workMembers.add(assistant);
        if (index !== plan.start) continue;
        const layout = renderStoryboardWorkSpanLayout(
          plan.span,
          safeWidth,
          theme,
          options.renderGroup,
          settings,
        );
        workLayouts.set(plan.start, layout);
        const proxy = new StoryboardSceneMouseProxy(
          assistant,
          storyboardAssistantWidth(safeWidth, settings),
          nativeLines.get(assistant)?.length ?? 0,
          Math.max(0, safeWidth - storyboardAssistantWidth(safeWidth, settings)),
          layout.assistantRegions,
        );
        workMouse.set(assistant, { component: proxy, height: layout.lines.length });
      }
      for (let index = plan.start; index <= plan.end; index++) {
        const segment = projection.segments[index];
        if (segment?.type !== "scene") continue;
        const toolChildren = segment.orderedChildren === undefined
          ? segment.actionRuns.flatMap((run) => run.rows.map((row) => row.toolRow))
          : segment.orderedChildren
            .filter((child): child is Extract<typeof child, { type: "tool" }> => child.type === "tool")
            .map((child) => child.tool.toolRow);
        for (const row of toolChildren) {
          if (!row || typeof (row as Component).render !== "function") throw new Error("work span tool is not renderable");
          workMembers.add(row as Component);
        }
      }
    }

    let projectedChildCursor = 0;
    for (let index = 0; index < projection.segments.length; index++) {
      const plan = planByStart.get(index);
      if (plan !== undefined) {
        const segmentStart = projectedChildCursor;
        let segmentEnd = segmentStart;
        for (let segmentIndex = plan.start; segmentIndex <= plan.end; segmentIndex++) {
          const segment = projection.segments[segmentIndex];
          if (segment === undefined) throw new Error("work span segment missing");
          segmentEnd += storyboardSegmentChildCount(segment);
        }
        appendExpansionGapsBefore(segmentStart);

        const layout = workLayouts.get(index);
        if (layout === undefined) throw new Error("work span layout missing");
        rendered.push(...layout.lines);
        if (visualMouseChildren !== undefined) {
          const first = projection.segments[plan.start];
          if (first?.type !== "scene") throw new Error("work span anchor missing");
          const assistant = componentForStoryboardChild({ type: "assistant", assistant: first.assistant });
          if (assistant === undefined) throw new Error("work span assistant is not renderable");
          const mouse = workMouse.get(assistant);
          if (mouse === undefined) throw new Error("work span mouse layout missing");
          visualMouseChildren.push(mouse);
        }
        projectedChildCursor = segmentEnd;
        appendExpansionGapsAfter(segmentStart, segmentEnd);
        index = plan.end;
        continue;
      }
      if (covered.has(index)) continue;
      const segment = projection.segments[index];
      if (segment === undefined) throw new Error("storyboard segment missing");
      const segmentStart = projectedChildCursor;
      const segmentEnd = segmentStart + storyboardSegmentChildCount(segment);
      appendExpansionGapsBefore(segmentStart);

      if (segment.type === "scene") {
        const assistant = componentForStoryboardChild({ type: "assistant", assistant: segment.assistant });
        if (assistant === undefined) throw new Error("scene assistant is not renderable");
        const assistantLines = nativeLines.get(assistant);
        if (assistantLines === undefined) throw new Error("scene assistant output missing");
        const hasNativeLeadingSpacer = assistantLines.length > 0 && visibleWidth(assistantLines[0] ?? "") === 0;
        if (!hasNativeLeadingSpacer) {
          rendered.push("");
        }
        const sceneLayout = renderStoryboardSceneLayout(
          segment,
          assistantLines,
          safeWidth,
          theme,
          options.renderGroup,
          settings,
        );
        rendered.push(...sceneLayout.lines);
        const height = sceneLayout.lines.length + (hasNativeLeadingSpacer ? 0 : 1);
        nativeMouse.set(assistant, {
          component: new StoryboardSceneMouseProxy(
            assistant,
            storyboardAssistantWidth(safeWidth, settings),
            assistantLines.length,
            Math.max(0, safeWidth - storyboardAssistantWidth(safeWidth, settings)),
            sceneLayout.assistantRegions,
          ),
          height,
        });
        if (visualMouseChildren !== undefined) {
          visualMouseChildren.push(nativeMouse.get(assistant)!);
        }
      } else {
        for (const child of segment.children) {
          const lines = renderNative(child);
          rendered.push(...lines);
          const component = componentForStoryboardChild(child);
          if (component === undefined) throw new Error("native child is not renderable");
          const decoration = thinkingDecorations.get(component);
          const mouse = {
            component: decoration === undefined
              ? component
              : new StoryboardThinkingMouseProxy(component, decoration.assistantRegions),
            height: lines.length,
          };
          nativeMouse.set(component, mouse);
          visualMouseChildren?.push(mouse);
        }
      }

      projectedChildCursor = segmentEnd;
      appendExpansionGapsAfter(segmentStart, segmentEnd);
    }
    while (nextExpansionGap < expansionGaps.length) {
      const gap = expansionGaps[nextExpansionGap];
      if (gap === undefined) throw new Error("transient status gap missing");
      appendExpansionGap(gap);
      nextExpansionGap++;
    }

    // Rebuild the private container hit-test list in the original direct-child
    // order. A work span has one proxy anchor and zero-height member rows.
    if (visualMouseChildren !== undefined) {
      setMouseLayout(container, safeWidth, visualMouseChildren);
    } else {
      const spanMouseChildren: Array<{ component: Component; height: number }> = [];
      for (const child of children) {
        const component = child as Component;
        const anchor = workMouse.get(component);
        if (anchor !== undefined) {
          spanMouseChildren.push(anchor);
          continue;
        }
        if (workMembers.has(component)) {
          spanMouseChildren.push({ component: GROUP_MOUSE_SINK, height: 0 });
          continue;
        }
        const native = nativeMouse.get(component);
        if (native !== undefined) {
          spanMouseChildren.push(native);
          continue;
        }
        // Native tool rows outside a scene are not in nativeMouse until they are
        // rendered here; this path is also the conservative incompatible-row
        // fallback inside an otherwise valid session projection.
        const lines = component.render(safeWidth);
        if (!validRenderedLines(lines)) throw new Error("native child returned invalid lines");
        spanMouseChildren.push({ component, height: lines.length });
      }
      setMouseLayout(container, safeWidth, spanMouseChildren);
    }
    return { requested: true, output: rendered };
  }

  for (const segment of projection.segments) {
    if (segment.type === "scene") {
      const assistant = componentForStoryboardChild({ type: "assistant", assistant: segment.assistant });
      if (assistant === undefined) throw new Error("scene assistant is not renderable");
      const assistantLines = nativeLines.get(assistant);
      if (assistantLines === undefined) throw new Error("scene assistant output missing");
      // Pi's visible assistant component already contributes its native
      // leading Spacer(1). Use that row as the scene boundary instead of
      // adding a second blank row; tool-only assistants have no such native
      // spacer, so provide the preview's one-row boundary for them (and for
      // any compatible component that does not expose one).
      const hasNativeLeadingSpacer =
        assistantLines.length > 0 && visibleWidth(assistantLines[0] ?? "") === 0;
      if (!hasNativeLeadingSpacer) {
        rendered.push("");
        mouseChildren.push({ component: GROUP_MOUSE_SINK, height: 1 });
      }
      const sceneLayout = renderStoryboardSceneLayout(
        segment,
        assistantLines,
        safeWidth,
        theme,
        options.renderGroup,
        settings,
      );
      const sceneLines = [...sceneLayout.lines];
      rendered.push(...sceneLines);
      mouseChildren.push({
        component: new StoryboardSceneMouseProxy(
          assistant,
          storyboardAssistantWidth(safeWidth, settings),
          assistantLines.length,
          Math.max(0, safeWidth - storyboardAssistantWidth(safeWidth, settings)),
          sceneLayout.assistantRegions,
        ),
        height: sceneLines.length,
      });
      continue;
    }

    for (const child of segment.children) {
      const lines = renderNative(child);
      rendered.push(...lines);
      const component = componentForStoryboardChild(child);
      if (component === undefined) throw new Error("native storyboard child is not renderable");
      const decoration = thinkingDecorations.get(component);
      if (decoration !== undefined) {
        mouseChildren.push({
          component: new StoryboardThinkingMouseProxy(
            component,
            decoration.assistantRegions,
          ),
          height: lines.length,
        });
      } else {
        mouseChildren.push({ component, height: lines.length });
      }
    }
  }

  setMouseLayout(container, safeWidth, mouseChildren);
  return { requested: true, output: rendered };
}

function renderPatched(
  this: Container,
  width: number,
  state: PatchState,
): string[] {
  const options = state.options;
  if (!state.enabled || options === undefined) return invokeOriginal(this, state, width);

  try {
    const storyboard = renderStoryboardIfRequested(this, width, options);
    if (storyboard.requested) {
      return storyboard.output ?? invokeOriginal(this, state, width);
    }
  } catch {
    // The turn storyboard is an optional presentation layer. Any
    // incompatible shape or renderer failure leaves the complete container native.
    return invokeOriginal(this, state, width);
  }

  let fallback = false;
  let output: string[] | undefined;

  try {
    const children = this.children.slice();
    if (children.length === 0) {
      fallback = true;
    } else {
      const classifications: ChildClassification[] = [];
      // The grouping core sees immutable snapshots, never live Pi rows. This
      // reverse map is only needed when a singleton candidate must be rendered
      // natively after segmentation.
      const candidates = new Map<ToolRowSnapshot, ToolExecutionComponent>();
      let candidateCount = 0;

      for (const child of children) {
        const candidate = inspectToolRow(child);
        if (candidate?.snapshot !== undefined) {
          classifications.push(candidateClassification(candidate.snapshot, candidate));
          candidates.set(candidate.snapshot, child as ToolExecutionComponent);
          candidateCount++;
        } else if (child instanceof ToolExecutionComponent) {
          // A recognized class with an unexpected private shape is a hard native
          // boundary, not an opportunity to infer a newer shape.
          classifications.push(nativeClassification(child));
        } else {
          // Filled in below after the component is rendered once. This keeps an
          // empty AssistantMessageComponent from breaking visual adjacency.
          classifications.push(nativeClassification(child));
        }
      }

      // At least one eligible row is enough for a compact group. This keeps
      // singleton reads/searches/lists on the same presentation as batches.
      if (candidateCount === 0) {
        fallback = true;
      } else {
        const nativeLines = new Map<unknown, string[]>();
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child instanceof ToolExecutionComponent) continue;

          if (!child || typeof (child as Component).render !== "function") {
            fallback = true;
            break;
          }
          const lines = (child as Component).render(width);
          if (!validRenderedLines(lines)) {
            fallback = true;
            break;
          }
          nativeLines.set(child, lines);

          if (isAssistant(child) && lines.length === 0) {
            classifications[i] = invisibleClassification(child);
          }
        }

        if (!fallback) {
          const segments = segmentChildren(classifications);

          // Render custom groups before rendering any native tool row. If theme
          // or group rendering has drifted, the fallback can still be entirely
          // native.
          const groupLines = new Map<Segment, string[]>();
          const groupedTools = new Set<ToolExecutionComponent>();
          const groupAnchors = new Map<ToolExecutionComponent, number>();
          for (const segment of segments) {
            if (segment.type !== "group") continue;
            const rows: ToolRowSnapshot[] = [];
            const members: ToolExecutionComponent[] = [];
            for (const row of segment.rows) {
              const member = candidates.get(row as ToolRowSnapshot);
              if (!member) throw new Error("group member snapshot missing");
              rows.push(row as ToolRowSnapshot);
              members.push(member);
              groupedTools.add(member);
            }
            const group: GroupSnapshot = Object.freeze({
              kind: segment.kind,
              rows: Object.freeze(rows),
            });
            const lines = options.renderGroup(group, width, options.getTheme(), options.getSettings?.() ?? DEFAULT_PRESENTATION_SETTINGS);
            if (!validRenderedLines(lines)) throw new Error("group renderer returned invalid lines");
            groupLines.set(segment, lines);
            const anchor = members[0];
            if (!anchor) throw new Error("group has no members");
            groupAnchors.set(anchor, lines.length);
          }

          const rendered: string[] = [];
          for (const segment of segments) {
            if (segment.type === "group") {
              rendered.push(...(groupLines.get(segment) ?? []));
              continue;
            }

            const candidate = candidates.get(segment.row as ToolRowSnapshot);
            const component = candidate ?? (segment.row as Component);
            if (!component || typeof component.render !== "function") {
              throw new Error("native child is not renderable");
            }

            // Reuse the one native render performed during this pass. This is
            // important for live components with renderer state or caches.
            if (nativeLines.has(component)) {
              rendered.push(...nativeLines.get(component)!);
              continue;
            }

            const nativeOutput = component.render(width);
            if (!validRenderedLines(nativeOutput)) {
              throw new Error("native child returned invalid lines");
            }
            nativeLines.set(component, nativeOutput);
            rendered.push(...nativeOutput);
          }

          // Keep Container.handleMouse's coordinates consistent with the
          // grouped visual output. Group members receive zero height except
          // for a presentation-only sink at the first member's position.
          const mouseChildren: Array<{ component: Component; height: number }> = [];
          for (const child of children) {
            if (child instanceof ToolExecutionComponent && groupedTools.has(child)) {
              const groupHeight = groupAnchors.get(child);
              mouseChildren.push(
                groupHeight === undefined
                  ? { component: child, height: 0 }
                  : { component: GROUP_MOUSE_SINK, height: groupHeight },
              );
              continue;
            }
            const lines = nativeLines.get(child);
            if (lines === undefined) throw new Error("native child output missing");
            mouseChildren.push({ component: child, height: lines.length });
          }
          setMouseLayout(this, width, mouseChildren);
          output = rendered;
        }
      }
    }
  } catch {
    fallback = true;
  }

  // Keep calls to the original renderer outside the protected block. If Pi's
  // own renderer throws, do not invoke it a second time.
  return fallback || output === undefined ? invokeOriginal(this, state, width) : output;
}

function getPatchState(prototype: object): PatchState | undefined {
  const value = (prototype as Record<PropertyKey, unknown>)[PATCH_MARKER];
  if (!isRecord(value)) return undefined;
  if (
    typeof value.original !== "function" ||
    typeof value.wrapper !== "function" ||
    typeof value.originalDescriptor !== "object" ||
    typeof value.owners !== "number" ||
    typeof value.enabled !== "boolean"
  ) {
    return undefined;
  }
  return value as unknown as PatchState;
}

function canConstruct(value: unknown): value is new (...args: never[]) => unknown {
  if (typeof value !== "function" || !value.prototype) return false;
  try {
    // Use Object as the target so feature detection does not instantiate the
    // component or run any UI code.
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
}

function makeHandle(
  prototype: object,
  state: PatchState,
): PatchHandle {
  let uninstalled = false;
  return {
    uninstall(): void {
      if (uninstalled) return;
      uninstalled = true;
      if (state.owners > 0) state.owners--;
      if (state.owners !== 0) return;

      state.enabled = false;
      state.options = undefined;

      // A different extension may have wrapped or replaced us since install.
      // Never restore over that newer function.
      let canRemoveMarker = (prototype as { render?: unknown }).render !== state.wrapper;
      if (!canRemoveMarker) {
        try {
          Object.defineProperty(prototype, "render", state.originalDescriptor);
          canRemoveMarker = (prototype as { render?: unknown }).render !== state.wrapper;
        } catch {
          // Keep the disabled marker if restoration is impossible. That avoids
          // stacking another copy of this already-installed wrapper later.
        }
      }

      const markerValue = (prototype as Record<PropertyKey, unknown>)[PATCH_MARKER];
      if (canRemoveMarker && markerValue === state) {
        try {
          delete (prototype as Record<PropertyKey, unknown>)[PATCH_MARKER];
        } catch {
          // A non-configurable marker is harmless after the wrapper is disabled.
        }
      }
    },
  };
}

/**
 * Install the one private-API seam used by the extension. Any incompatible
 * shape returns undefined and leaves Pi's prototype untouched.
 */
export function installToolGroupingPatch(
  options: ToolGroupingPatchOptions,
): PatchHandle | undefined {
  let createdState: PatchState | undefined;
  try {
    if (
      !options ||
      typeof options.getTheme !== "function" ||
      typeof options.renderGroup !== "function"
    ) {
      return undefined;
    }

    const prototype = Container?.prototype;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "render") : undefined;
    const original = descriptor?.value;
    if (!prototype || descriptor === undefined || typeof original !== "function" || !canConstruct(ToolExecutionComponent)) {
      return undefined;
    }

    const existing = getPatchState(prototype);
    if (existing !== undefined) {
      if (existing.wrapper !== (prototype as { render?: unknown }).render || !existing.enabled) {
        return undefined;
      }
      existing.owners++;
      existing.options = options;
      return makeHandle(prototype, existing);
    }

    // An unrelated marker is treated as an incompatibility rather than being
    // overwritten.
    if (Object.getOwnPropertyDescriptor(prototype, PATCH_MARKER) !== undefined) {
      return undefined;
    }

    let state!: PatchState;
    const wrapper: ContainerRender = function (this: Container, width: number): string[] {
      return renderPatched.call(this, width, state);
    };
    state = {
      original: original as ContainerRender,
      originalDescriptor: descriptor,
      wrapper,
      owners: 1,
      enabled: true,
      options,
    };

    createdState = state;
    Object.defineProperty(prototype, PATCH_MARKER, {
      configurable: true,
      enumerable: false,
      value: state,
      writable: false,
    });
    Object.defineProperty(prototype, "render", { ...descriptor, value: wrapper });
    return makeHandle(prototype, state);
  } catch {
    // If installing the wrapper itself failed after the marker was created,
    // remove only our marker and leave the native prototype untouched.
    if (createdState) {
      const prototype = Container?.prototype;
      if (
        prototype &&
        (prototype as unknown as Record<PropertyKey, unknown>)[PATCH_MARKER] === createdState
      ) {
        try {
          delete (prototype as unknown as Record<PropertyKey, unknown>)[PATCH_MARKER];
        } catch {
          // There is no safe mutation left to make.
        }
      }
    }
    return undefined;
  }
}

/** Exposed for adapter-focused tests without exposing Pi's private field names elsewhere. */
export function classifyToolRowForTesting(row: unknown): ToolRowSnapshot | undefined {
  return inspectToolRow(row)?.snapshot;
}
