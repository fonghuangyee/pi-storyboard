import {
  sliceByColumn,
  Spacer,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { GroupKind } from "./grouping.ts";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type PresentationSettings,
  type StoryboardColorName,
} from "./presentation-settings.ts";

/** Pi tool names are open-ended because extensions can add custom tools. */
export type ToolName = string;

export type ResultContentBlock = {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
};

export type ToolResultSnapshot = {
  readonly content: readonly ResultContentBlock[];
  readonly details?: unknown;
  readonly isError: boolean;
};

/** The immutable, display-only view of a native tool row. */
export type ToolRowSnapshot = {
  readonly toolName: ToolName;
  readonly args: unknown;
  readonly result?: ToolResultSnapshot;
  /** Bounded, generic text extracted from a failed result; full output is never copied. */
  readonly errorSummary?: string;
  /** Pi's shell renderer timing, when it exposes a valid start/end clock. */
  readonly elapsedMs?: number;
  readonly isPartial: boolean;
  readonly expanded: boolean;
};

export type GroupSnapshot = {
  readonly kind: GroupKind;
  readonly rows: readonly ToolRowSnapshot[];
};

export interface ThemeLike {
  fg(color: StoryboardColorName, text: string): string;
  bold?(text: string): string;
  italic?(text: string): string;
}

const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const ANSI_C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const ANSI_C1_OSC = /\u009d[\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;
const ANSI_STRING = /\u001b(?:P|X|\^|_)[\s\S]*?(?:\u0007|\u001b\\)/g;
const ANSI_C1_STRING = /[\u0090\u0098\u009e\u009f][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;
const ANSI_OTHER = /\u001b(?:[()][0-2A-Z]|[0-9A-Z=><]|\\)/g;

/**
 * Make model-controlled text safe to put in a terminal line. Newlines and
 * tabs become spaces so a single summary item remains a single display line.
 */
export function sanitizeDisplay(value: string): string {
  return value
    .replace(ANSI_OSC, "")
    .replace(ANSI_C1_OSC, "")
    .replace(ANSI_STRING, "")
    .replace(ANSI_C1_STRING, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_C1_CSI, "")
    .replace(ANSI_OTHER, "")
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f]/gu, (character) =>
      character === "\n" || character === "\r" || character === "\t" ? " " : "",
    )
    .replace(/[\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validOptionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined | null {
  if (!hasOwn(args, key)) return undefined;
  return typeof args[key] === "string" ? args[key] : null;
}

function validOptionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined | null {
  if (!hasOwn(args, key)) return undefined;
  return typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] : null;
}

function validOptionalBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined | null {
  if (!hasOwn(args, key)) return undefined;
  return typeof args[key] === "boolean" ? args[key] : null;
}

function hasOnlyKnownKeys(args: Record<string, unknown>, keys: readonly string[]): boolean {
  const known = new Set(keys);
  return Object.keys(args).every((key) => known.has(key));
}

function compactJson(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    return sanitizeDisplay(result === undefined ? String(value) : result);
  } catch {
    return "[unserializable arguments]";
  }
}

function quote(value: string): string {
  return JSON.stringify(sanitizeDisplay(value));
}

function numberText(value: number): string {
  return sanitizeDisplay(String(value));
}

type ToolRowParts = {
  readonly main: string;
  readonly detail?: string;
  readonly mainTrim?: "fileNames" | "commands";
  readonly detailTrim?: "fileNames";
  /** Recognized tool arguments were malformed, so the caller must show the tool name. */
  readonly fallback?: boolean;
};

function fallbackParts(args: unknown): ToolRowParts {
  return { main: compactJson(args), fallback: true };
}

function formatReadParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["path", "offset", "limit"]) ||
    typeof args.path !== "string" ||
    args.path.length === 0
  ) {
    return fallbackParts(args);
  }

  const offset = validOptionalNumber(args, "offset");
  const limit = validOptionalNumber(args, "limit");
  if (offset === null || limit === null) return fallbackParts(args);

  const range: string[] = [];
  if (offset !== undefined) range.push(`offset=${numberText(offset)}`);
  if (limit !== undefined) range.push(`limit=${numberText(limit)}`);
  return {
    main: sanitizeDisplay(args.path),
    mainTrim: "fileNames",
    detail: range.length > 0 ? ` (${range.join(", ")})` : undefined,
  };
}

function formatGrepParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, [
      "pattern",
      "path",
      "glob",
      "ignoreCase",
      "literal",
      "context",
      "limit",
    ]) ||
    typeof args.pattern !== "string" ||
    args.pattern.length === 0
  ) {
    return fallbackParts(args);
  }

  const path = validOptionalString(args, "path");
  const glob = validOptionalString(args, "glob");
  const optionalValidity = [
    path,
    glob,
    validOptionalBoolean(args, "ignoreCase"),
    validOptionalBoolean(args, "literal"),
    validOptionalNumber(args, "context"),
    validOptionalNumber(args, "limit"),
  ];
  if (optionalValidity.some((value) => value === null)) return fallbackParts(args);
  const safePath = path === null ? undefined : path === "" ? "." : path;
  const safeGlob = glob as string | undefined;
  const limit = optionalValidity[5] as number | undefined;

  let label = `grep ${quote(args.pattern)}`;
  if (safePath !== undefined) label += ` in ${sanitizeDisplay(safePath)}`;
  const options: string[] = [];
  if (safeGlob !== undefined) options.push(`glob ${quote(safeGlob)}`);
  if (limit !== undefined) options.push(`limit ${numberText(limit)}`);
  if (options.length > 0) label += ` (${options.join(", ")})`;
  return { main: label, mainTrim: "fileNames" };
}

function formatFindParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["pattern", "path", "limit"]) ||
    typeof args.pattern !== "string" ||
    args.pattern.length === 0
  ) {
    return fallbackParts(args);
  }

  const path = validOptionalString(args, "path");
  const limit = validOptionalNumber(args, "limit");
  if (path === null || limit === null) return fallbackParts(args);

  let label = `find ${quote(args.pattern)}`;
  if (path !== undefined) label += ` in ${sanitizeDisplay(path === "" ? "." : path)}`;
  if (limit !== undefined) label += ` (limit ${numberText(limit)})`;
  return { main: label, mainTrim: "fileNames" };
}

function formatLsParts(args: unknown): ToolRowParts {
  if (!isRecord(args) || !hasOnlyKnownKeys(args, ["path", "limit"])) {
    return fallbackParts(args);
  }

  const path = validOptionalString(args, "path");
  const limit = validOptionalNumber(args, "limit");
  if (path === null || limit === null) return fallbackParts(args);

  // Pi's native ls treats an omitted or empty path as the current directory.
  return {
    main: sanitizeDisplay(path === undefined || path === "" ? "." : path),
    mainTrim: "fileNames",
    detail: limit === undefined ? undefined : ` (limit ${numberText(limit)})`,
  };
}

function formatWriteParts(args: unknown): ToolRowParts {
  if (
    isRecord(args) &&
    hasOnlyKnownKeys(args, ["path"]) &&
    typeof args.path === "string" &&
    args.path.length > 0
  ) {
    return { main: sanitizeDisplay(args.path), mainTrim: "fileNames" };
  }
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["path", "content"]) ||
    typeof args.path !== "string" ||
    args.path.length === 0 ||
    typeof args.content !== "string"
  ) {
    return fallbackParts(args);
  }

  // Never display the content being written.
  return { main: sanitizeDisplay(args.path), mainTrim: "fileNames" };
}

function formatEditParts(args: unknown): ToolRowParts {
  // Pending edits may not have streamed a valid path yet. Keep their compact
  // row generic instead of exposing partial edit arguments or showing
  // `undefined` as if it were meaningful tool input.
  if (args === undefined) return { main: "edit" };

  if (
    isRecord(args) &&
    hasOnlyKnownKeys(args, ["path"]) &&
    typeof args.path === "string" &&
    args.path.length > 0
  ) {
    return { main: sanitizeDisplay(args.path), mainTrim: "fileNames" };
  }
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["path", "replacementCount"]) ||
    typeof args.path !== "string" ||
    args.path.length === 0 ||
    typeof args.replacementCount !== "number" ||
    !Number.isSafeInteger(args.replacementCount) ||
    args.replacementCount < 0
  ) {
    return fallbackParts(args);
  }

  return {
    main: sanitizeDisplay(args.path),
    mainTrim: "fileNames",
    detail: ` (${args.replacementCount} ${args.replacementCount === 1 ? "replacement" : "replacements"})`,
  };
}

function formatShellParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["command", "timeout", "cwd"]) ||
    typeof args.command !== "string" ||
    args.command.length === 0
  ) {
    return fallbackParts(args);
  }

  const timeout = validOptionalNumber(args, "timeout");
  const cwd = validOptionalString(args, "cwd");
  if (timeout === null || cwd === null) return fallbackParts(args);

  const detail = cwd === undefined ? undefined : ` (cwd ${sanitizeDisplay(cwd)})`;
  return {
    main: sanitizeDisplay(args.command),
    mainTrim: "commands",
    detail,
    detailTrim: cwd === undefined ? undefined : "fileNames",
  };
}

function formatGenericParts(row: ToolRowSnapshot): ToolRowParts {
  return {
    main: `${sanitizeDisplay(row.toolName)} ${compactJson(row.args)}`,
  };
}

function formatRowParts(row: ToolRowSnapshot): ToolRowParts {
  switch (row.toolName) {
    case "read":
      return formatReadParts(row.args);
    case "grep":
      return formatGrepParts(row.args);
    case "find":
      return formatFindParts(row.args);
    case "ls":
      return formatLsParts(row.args);
    case "write":
      return formatWriteParts(row.args);
    case "edit":
      return formatEditParts(row.args);
    case "bash":
    case "powershell":
      return formatShellParts(row.args);
    default:
      return formatGenericParts(row);
  }
}

function mainTextForRow(row: ToolRowSnapshot, parts: ToolRowParts): string {
  if (!parts.fallback) return parts.main;
  if (row.result?.isError === true && (row.toolName === "edit" || row.toolName === "write")) {
    // Malformed edit/write arguments must not leak their content into an error
    // summary. The generic error text remains the useful diagnostic.
    return sanitizeDisplay(row.toolName);
  }
  return `${sanitizeDisplay(row.toolName)} ${parts.main}`;
}

const MAX_ERROR_SUMMARY_CODE_POINTS = 512;

function errorText(row: ToolRowSnapshot): string | undefined {
  if (row.result?.isError !== true) return undefined;
  const text = sanitizeDisplay(row.errorSummary ?? "Failed");
  if (text.length === 0) return "Failed";
  return Array.from(text).slice(0, MAX_ERROR_SUMMARY_CODE_POINTS).join("");
}

function elapsedText(row: ToolRowSnapshot): string | undefined {
  if (row.elapsedMs === undefined || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0) {
    return undefined;
  }
  const label = row.result === undefined || row.isPartial ? "elapsed" : "took";
  return `${label} ${(row.elapsedMs / 1000).toFixed(1)}s`;
}

function elapsedDetail(row: ToolRowSnapshot): string {
  const elapsed = elapsedText(row);
  return elapsed === undefined ? "" : ` (${elapsed})`;
}

function formatRow(row: ToolRowSnapshot): string {
  const parts = formatRowParts(row);
  const main = mainTextForRow(row, parts);
  const error = errorText(row);
  return `${main}${parts.detail ?? ""}${elapsedDetail(row)}${error === undefined ? "" : ` - ${error}`}`;
}

function fitFailureDetails(
  theme: ThemeLike,
  normalDetail: string,
  failure: string,
  width: number,
  prefixWidth: number,
  mainWidthHint: number,
  failureColor: StoryboardColorName,
): { detail: string; mainWidth: number } {
  const separator = " - ";
  const separatorWidth = visibleWidth(separator);
  // Keep enough room for a recognizable path/command, but never reserve more
  // than the value actually needs. Long diagnostics should be truncated before
  // the main value collapses to an ambiguous single dot.
  const desiredMainWidth = Math.min(40, Math.max(0, Math.floor(mainWidthHint)));
  const availableMainWidth = Math.max(0, width - prefixWidth - separatorWidth);
  const minimumMainWidth = Math.min(desiredMainWidth, availableMainWidth);

  const fullErrorDetail = styled(theme, failureColor, `${separator}${failure}`);
  const fullDetail = `${normalDetail}${fullErrorDetail}`;
  const fullMainWidth = width - prefixWidth - visibleWidth(fullDetail);
  if (fullMainWidth >= minimumMainWidth) {
    return { detail: fullDetail, mainWidth: fullMainWidth };
  }

  // Keep the separator visible whenever the terminal is wide enough for the
  // prefix, one main character, and the separator. Error text is the part that
  // gets truncated, never the delimiter itself.
  const suffixWidth = Math.max(0, width - prefixWidth - minimumMainWidth);
  const normalBudget = Math.max(0, suffixWidth - separatorWidth - 1);
  const fittedNormalDetail = fit(normalDetail, normalBudget);
  const errorBudget = Math.max(0, suffixWidth - visibleWidth(fittedNormalDetail) - separatorWidth);
  const fittedFailure = truncateToWidth(failure, errorBudget, "");
  const errorDetail = styled(theme, failureColor, `${separator}${fittedFailure}`);
  const detail = `${fittedNormalDetail}${errorDetail}`;
  return {
    detail,
    mainWidth: Math.max(0, width - prefixWidth - visibleWidth(detail)),
  };
}

function heading(kind: GroupKind, count: number): string {
  switch (kind) {
    case "read":
      return `Read ${count} ${count === 1 ? "file" : "files"}`;
    case "search":
      return `Search ${count} ${count === 1 ? "time" : "times"}`;
    case "list":
      return `List ${count} ${count === 1 ? "directory" : "directories"}`;
    case "write":
      return `Write ${count} ${count === 1 ? "file" : "files"}`;
    case "edit":
      return `Edit ${count} ${count === 1 ? "time" : "times"}`;
    case "command":
      return `Run ${count} ${count === 1 ? "command" : "commands"}`;
    case "tool":
      return `Run ${count} ${count === 1 ? "tool" : "tools"}`;
  }
}

function normaliseWidth(width: number): number {
  if (!Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

function fit(line: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(line, width);
  // This second check is deliberately cheap insurance for unusual ANSI or
  // grapheme sequences supplied by a theme implementation.
  return visibleWidth(truncated) <= width
    ? truncated
    : truncateToWidth(line, width, "");
}

/**
 * Truncate from the middle so a long path keeps both its leading directories
 * and its filename. The input may contain ANSI styling from the active theme.
 */
function fitMiddle(line: string, width: number): string {
  if (width <= 0 || visibleWidth(line) <= width) return width <= 0 ? "" : line;

  const ellipsis = "...";
  const ellipsisWidth = visibleWidth(ellipsis);
  // At very narrow widths, show the source prefix instead of a single dot
  // from the ellipsis. A lone dot is ambiguous with a real current-directory
  // path, especially on a failed row with a long diagnostic suffix.
  if (ellipsisWidth >= width) return truncateToWidth(line, width, "");

  const contentWidth = width - ellipsisWidth;
  const leftWidth = Math.ceil(contentWidth / 2);
  const rightWidth = Math.floor(contentWidth / 2);
  const lineWidth = visibleWidth(line);
  const left = sliceByColumn(line, 0, leftWidth, true);
  const right = sliceByColumn(line, lineWidth - rightWidth, rightWidth, true);
  const result = `${left}${ellipsis}${right}`;
  // The right slice cannot include a reset that occurs after the source text.
  // Close ANSI styling explicitly so a truncated row cannot bleed into the
  // following transcript line.
  const safeResult = line.includes("\u001b") ? `${result}\u001b[0m` : result;

  // This second check is deliberately cheap insurance for unusual ANSI or
  // grapheme sequences supplied by a theme implementation.
  return visibleWidth(safeResult) <= width
    ? safeResult
    : truncateToWidth(line, width, "");
}

function styled(
  theme: ThemeLike,
  color: StoryboardColorName,
  text: string,
): string {
  return theme.fg(color, text);
}

function configuredMainFit(
  value: string,
  width: number,
  trimMode: "fileNames" | "commands" | undefined,
  settings: PresentationSettings,
): string {
  const middle = trimMode === undefined ||
    (trimMode === "fileNames" ? settings.trimming.fileNames : settings.trimming.commands);
  return middle ? fitMiddle(value, width) : fit(value, width);
}

function configuredDetailFit(
  value: string,
  width: number,
  trimMode: "fileNames" | undefined,
  settings: PresentationSettings,
): string {
  return trimMode === "fileNames" && settings.trimming.fileNames
    ? fitMiddle(value, width)
    : fit(value, width);
}

/** Render one compact group with only minimal failure text, never full result contents. */
export function renderToolGroup(
  group: GroupSnapshot,
  width: number,
  theme: ThemeLike,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): string[] {
  const safeWidth = normaliseWidth(width);
  const title = theme.bold ? theme.bold(heading(group.kind, group.rows.length)) : heading(group.kind, group.rows.length);
  // Native ToolExecutionComponent adds Spacer(1) before every tool row. Keep
  // that same one-line vertical rhythm when several rows become one group.
  // The leading space is Pi's normal one-cell horizontal output padding.
  const lines = new Spacer(1).render(safeWidth);
  lines.push(fit(` ${styled(theme, "toolTitle", title)}`, safeWidth));

  for (const row of group.rows) {
    const failed = row.result?.isError === true;
    const complete = !failed && row.result !== undefined && !row.isPartial;
    const color = failed
      ? settings.colors.status.failed
      : complete
        ? settings.colors.status.complete
        : settings.colors.status.running;
    const parts = formatRowParts(row);
    const main = styled(theme, "text", mainTextForRow(row, parts));
    const normalDetailText = `${parts.detail ?? ""}${elapsedDetail(row)}`;
    const normalDetail = normalDetailText === "" ? "" : styled(theme, "muted", normalDetailText);
    const failure = errorText(row);
    const marker = settings.symbols.toolDots[group.kind] ?? settings.symbols.toolDot;
    const prefix = styled(theme, color, `  ${marker} `);
    const layout = failure === undefined
      ? (() => {
          const available = Math.max(0, safeWidth - visibleWidth(prefix));
          const minimumMainWidth = Math.min(
            visibleWidth(main),
            Math.max(1, Math.min(20, available)),
          );
          const detailBudget = Math.max(0, available - minimumMainWidth);
          const detail = visibleWidth(normalDetail) > detailBudget
            ? styled(
              theme,
              "muted",
              configuredDetailFit(normalDetailText, detailBudget, parts.detailTrim, settings),
            )
            : normalDetail;
          return {
            detail,
            mainWidth: Math.max(0, available - visibleWidth(detail)),
          };
        })()
      : fitFailureDetails(
        theme,
        normalDetail,
        failure,
        safeWidth,
        visibleWidth(prefix),
        visibleWidth(main),
        settings.colors.status.failed,
      );
    const detail = layout.detail;
    const rowLine = `${prefix}${configuredMainFit(main, layout.mainWidth, parts.mainTrim, settings)}${detail}`;
    lines.push(visibleWidth(rowLine) <= safeWidth ? rowLine : fit(rowLine, safeWidth));
  }

  return lines;
}

// Exported for focused tests and for callers that want to inspect the pure
// argument presentation without constructing a group.
export const formatToolRow = formatRow;
