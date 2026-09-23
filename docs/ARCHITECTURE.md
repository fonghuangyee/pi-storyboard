# pi-storyboard development documentation

> **Authoritative project document.** This file is the source of truth for how the extension works, what it is allowed to do, and how it must be verified. Update it in the same change as any behavioral, architectural, compatibility, dependency, preview, or workflow change. `README.md` is intentionally reserved for Pi extension marketplace users.
>
> This document consolidates the former `PLAN.md`, `STORYBOARD_PLAN.md`, `STORYBOARD_GROUPING_OPTIMIZATION_PLAN.md`, and `TRANSCRIPT_ANALYSIS.md` documents. It describes the implemented design unless a section is explicitly marked as future work.

## 1. Project identity and status

`pi-storyboard` is a zero-runtime-dependency, presentation-only Pi extension. It replaces eligible collapsed tool rows with compact summaries and composes validated assistant responses into source-ordered visual storyboards. Pi remains the owner of tools, execution, messages, context, session storage, native rendering, expansion, and interaction.

The implementation is complete for the current design:

- semantic grouping covers built-in, custom, MCP, and subagent tool rows;
- a validated assistant response and its exact tool rows form one storyboard scene;
- native thinking, commentary, and tool-call source order is preserved;
- a narrow active-path continuation can hide directly adjacent empty/absent-thinking roots without merging ownership;
- a same-response commentary-to-tool suffix can receive a fixed presentation-only `Thinking...` placeholder;
- expanded or ambiguous content falls back to Pi's original renderer;
- `/storyboard-settings [global|project]` opens the interactive presentation-settings page and saves only the validated dedicated `pi-storyboard.json` file;
- the guarded private adapter, settings validation/storage, and pure projection layers are covered by unit tests.

Remaining release work is interactive verification against live streaming, expansion, theme changes, session replacement, and coexistence with other transcript-patching extensions. Optional long-span UI windowing is deliberately not shipped.

### The central distinction

The extension has two different kinds of grouping:

1. **Semantic ownership:** a `StoryboardScene` represents exactly one Pi assistant response and its exactly matched tool rows.
2. **Visual composition:** a `StoryboardWorkSpan` may arrange one scene, or a narrowly validated sequence of scenes, as one visual layout.

A work span is never a persisted Pi identity, an agent run, a context record, or a synthetic parent message. No assistant messages, tool calls, results, thinking signatures, or session entries are merged or rewritten.

## 2. Pi model and constraints

This section records the platform facts that the implementation relies on. Private implementation details are treated as compatibility probes, not contracts.

### 2.1 Sessions are active-path trees

Pi session storage is append-only JSONL with tree-linked entries. An entry normally has:

```ts
{
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}
```

Raw append order includes abandoned branches. The displayed conversation is the selected root-to-leaf path, not necessarily the file order. Compaction and branch-summary entries are presentation boundaries even when the native TUI happens to place adjacent components next to one another.

The live extension reads the public session projection supplied by `ctx.sessionManager.buildContextEntries()`. It does not parse session files. The current implementation derives the snapshot leaf from the final entry returned by that one call so the entries and leaf cannot become inconsistent between separate reads.

The public session methods have different purposes:

| Method | Meaning | Used by the extension |
|---|---|---|
| `getEntries()` | all entries in append order, including abandoned branches | no |
| `getBranch()` | current root-to-leaf path without compaction filtering | no |
| `buildContextEntries()` | active, compaction-aware path used for context/rendering | yes |
| `buildSessionContext()` | model-facing messages and restored settings | no |

Relevant entry categories include:

- `message` entries containing user, assistant, or tool-result messages;
- `custom_message` entries, which may participate in model context;
- `custom` entries, which are context-neutral but may still have a visible renderer;
- `compaction` and `branch_summary` entries;
- `model_change`, `thinking_level_change`, `label`, and `session_info` entries;
- additional schema entries introduced by later Pi versions.

Known transparent state entries are safe for ownership continuity only when they are not visible transcript rows. User messages, system messages, visible custom messages, summaries, compaction, branch changes, unknown entries, and malformed parent chains are hard boundaries. A validated runtime `context_edit` deletion marker (`targetId` plus `replacement: null`) is also non-visual, but is treated as a hard boundary so exact scene ownership can continue without visually composing across a model-context edit. Replacement payloads or extra fields remain incompatible and fail open. If the projection cannot classify an entry safely, storyboard continuation fails open.

### 2.2 Assistant content is ordered; tool results are separate

One `AssistantMessage` contains an ordered `content` array:

```ts
AssistantMessage.content = [
  ThinkingContent,
  TextContent,
  ToolCall,
];
```

The actual sequence may be interleaved, for example:

```text
thinking → toolCall → commentary → thinking → toolCall
thinking → commentary → toolCall → toolCall
thinking → final_answer
```

Tool results are separate `toolResult` messages/components. Ownership is proven by exact equality between `ToolCall.id` and `ToolResultMessage.toolCallId`; timestamps, array positions, tool names, and `parentId` are not ownership proofs. Parallel tools can finish out of order, so completion order must not determine presentation order.

The storyboard first validates the contiguous direct tool-row window belonging to an assistant component, then reorders those validated rows by the assistant content's call IDs. Nothing is silently dropped, duplicated, or guessed.

### 2.3 A Pi turn is not an agent run

Pi documents a turn as one LLM response plus its tool calls. One agent run can contain many turns:

```text
agent_start
├─ turn_start
│  ├─ assistant response
│  ├─ tool executions/results
│  └─ turn_end
├─ turn_start
│  └─ ...
└─ agent_end
```

The public session format does not persist a durable agent-run ID. Provider response IDs, stop reasons, timestamps, adjacency, similar thinking, and private harness run IDs are not substitutes. Consequently, the extension does not reconstruct arbitrary historical agent runs and does not aggregate arbitrary assistant responses.

The sole cross-response visual exception is the constrained empty/absent-thinking continuation described in [Section 4](#4-storyboard-projection).

### 2.4 Native TUI behavior

Pi's interactive transcript contains native assistant and tool-execution components as separate children. `AssistantMessageComponent` renders visible thinking and text but skips tool-call blocks; `ToolExecutionComponent` rows are rendered separately and later updated by matching tool results. This can flatten an interleaved assistant content array.

The extension therefore reuses native assistant children and reconstructs only the presentation order around validated compact tool summaries. It never recreates Markdown, thinking text, diagnostics, diffs, or images.

Pi's native thinking renderer skips empty thinking runs. An empty `thinking: ""` block may still carry an opaque provider signature required for replay, so visual omission is permitted but message/content/signature mutation is not.

Pi's global `app.tools.expand` action also appends a native spacer/status-text pair such as `Tool output: expanded` while the toggle is being reported. The interactive `/session` command can similarly append a `Text` status pair headed `Session Info` while a response is still streaming. If either pair lands between a still-streaming assistant component and the tool component created by a later message update, it is not transcript content and can otherwise strand the tool outside its owner window. In session-aware mode the adapter recognizes only these exact Pi-shaped pairs, proves the owner with the active-path tool-call IDs, and keeps each pair visible after the atomic scene. All other native children remain ownership boundaries; legacy adjacency mode does not bridge either pair.

## 3. Marketplace-facing behavior

The public README contains the short installation and feature description. The complete contract is here.

### 3.1 Visual grammar

A normal thinking-led scene looks like:

```text
 ◉ Inspecting the existing row shape
 │
 ├─ Read 1 file
 │   ● src/renderer.ts
 │
 │ Native commentary remains complete and source ordered.
 │
 │ Applying the settled replacement
 │
 ╰─ Edit 1 time
     ● src/renderer.ts (1 replacement)
```

Markers mean:

- `◉` — thinking that starts a visual turn with actions;
- `○` — a thinking-only note or a later visible thinking step;
- `├─` — an action run with another meaningful child following;
- `╰─` — the final meaningful child in the scene/chapter;
- `●` — one compact tool row;
- `│` — muted structural continuation.

The hierarchy communicates presentation membership only. It never claims that a thought or commentary caused, planned, or semantically owns a tool call.

Thinking markers use the configured assistant lifecycle colors: active thinking defaults to `syntaxKeyword`, settled thinking defaults to `success`. They never turn red because a tool failed. The top-level action marker follows aggregate scene state, and each tool row retains its own configured success/running/error state.

### 3.2 Tool groups

Every compatible collapsed eligible row is a group, including a singleton. Adjacent rows merge only when their semantic kinds match.

| Tool name(s) | Group kind | Compact heading |
|---|---|---|
| `read` | `read` | `Read N file(s)` |
| `grep`, `find` | `search` | `Search N time(s)` |
| `ls` | `list` | `List N director(ies)` |
| `write` | `write` | `Write N file(s)` |
| `edit` | `edit` | `Edit N time(s)` |
| `bash`, `powershell` | `command` | `Run N command(s)` |
| custom, unknown, MCP, subagent | `tool` | `Run N tool(s)` |

Examples:

```text
Read 2 files
  ● src/a.ts
  ● src/b.ts (offset=80, limit=40)

Search 2 times
  ● grep "UserService" in src/
  ● find "*.test.ts" in test/

Edit 1 time
  ● src/index.ts (2 replacements)

Run 2 commands
  ● npm test (took 1.5s)
  ● git status

Run 2 tools
  ● custom-tool {"target":"src"}
  ● mcp.lookup {"id":42}
```

`read + edit + read` produces three action runs. `grep + find + grep` produces one Search group. Within a scene, same-kind tools separated by thinking, commentary, or native content do not merge. A validated empty/absent-thinking continuation may visually coalesce adjacent same-kind action runs across its scene boundaries, while retaining separate scene ownership.

### 3.3 Tool summary data

Collapsed summaries expose only the minimum safe display data:

- `read`: path and supplied `offset`/`limit`;
- `grep`: quoted pattern, optional path/glob/limit;
- `find`: quoted pattern, optional path/limit;
- `ls`: path, defaulting to `.` only where that matches native behavior;
- `write`: destination path only, never content;
- `edit`: destination path and settled `edits.length`; running edits retain at most a validated path;
- `bash`/`powershell`: command and an actual `cwd` when present, never output;
- generic tools: tool name plus sanitized compact JSON arguments;
- image-producing calls: path/status only, never image data.

The adapter validates recognized argument shapes. Malformed recognized arguments use the tool name and sanitized compact JSON rather than an invented label. A failed malformed edit may still use the safe label `edit` and its bounded failure line.

Command timing is shown only when Pi exposes valid `startedAt`/`endedAt` state. No duration is invented.

### 3.4 Failure and running behavior

Failures remain in their normal semantic group. They use an error-colored `●` and one generic bounded diagnostic, separated from the main value by the literal ` - `:

```text
Run 1 command
  ● npm run check - Command exited with code 1
```

The adapter does not classify tool-specific error formats. It scans text result blocks, sanitizes lines, skips empty/structural tails such as `}` and serialized property lines, prefers the last generic diagnostic-looking line, and otherwise uses the last useful line. The stored summary is capped at 512 Unicode code points; if no usable text exists, it is `Failed`. Full output remains owned by Pi and is available through native expansion.

Every running call, including a running edit, is compact while collapsed. A running edit never copies `oldText`, `newText`, diff, patch, preview, or full result details. If it later settles or fails, its compact row updates without invoking the native edit renderer in collapsed mode.

### 3.5 Text phases and commentary

The adapter accepts a text phase only when its serialized signature is valid `TextSignatureV1` data: `v === 1`, a non-empty `id`, and `phase` equal to `commentary` or `final_answer`.

| Text state | Presentation |
|---|---|
| validated `commentary` | complete native Markdown, full width, exact source position |
| validated `final_answer` | complete native Pi rendering; the affected tool-bearing response is native |
| missing, invalid, or unknown phase | native; never guessed from wording or position |

Commentary is narrative, not a short thinking title. It may contain headings, lists, links, tables, code, multiple paragraphs, OSC sequences, and other native Markdown behavior. It is never summarized, relabeled, moved, or truncated to make room for a rail.

When one validated response has:

```text
visible thinking → validated commentary → eligible collapsed tool calls
```

the renderer emits:

```text
 ◉ Planning the handler
 │
 The complete native commentary remains here at full width.

 ◉ Thinking...
 ╰─ Run 3 commands
     ● npm test
     ● npm run typecheck
     ● npx eslint ...
```

`Thinking...` is a fixed presentation-only node. It is not model reasoning, a recovered hidden block, a session entry, a message, a native assistant child, or context. It is allowed only for this same-response suffix. Commentary-only responses, separate turns, final/unknown text, expanded rows, incomplete ownership, and incompatible private shapes do not receive it.

### 3.6 Empty thinking and tool-only turns

Empty or absent thinking is semantically retained but visually empty:

- a validated active-path tool-bearing turn with no visible thinking promotes its first observable action to the root;
- a settled empty/absent-thinking turn may continue beneath the immediately preceding visible-thinking root only when all continuation checks pass;
- a leading empty-thinking turn has no invented prose and uses its observable action as the root;
- the legacy per-turn fallback, when no session projection is available, may use a presentation-only `Thinking...` header for a tool-only response;
- the commentary-suffix placeholder is a separate, same-response exception and does not change this policy.

A continuous thinking block longer than four paragraphs shows the first two and last two, with an explicit presentation-only hidden count such as `↳ 2 thinking steps behind the scenes`. The native thinking component and full content remain available through Pi's normal thinking toggle. Commentary is never collapsed.

### 3.7 Presentation settings

`/storyboard-settings` is an interactive TUI command. With no argument it asks whether to edit global or trusted project settings; `/storyboard-settings global` and `/storyboard-settings project` select a scope directly. The page exposes independent file/path and command trimming modes, the default and per-kind tool dots, thinking/rail/branch symbols, status/thinking/structure color tokens, reset-to-defaults, and Save and reload.

The command buffers edits until Save. Saving atomically replaces the selected dedicated settings file, `~/.pi/agent/pi-storyboard.json` for global scope or `.pi/pi-storyboard.json` for project scope. Pi's unrelated `settings.json` files are never changed. The project scope is unavailable when `ctx.isProjectTrusted()` is false. A successful save runs Pi's reload flow so the new immutable snapshot is active immediately; cancelling writes nothing. Non-TUI modes show a warning and perform no I/O.

Settings are read from `~/.pi/agent/pi-storyboard.json` and, for trusted projects, `.pi/pi-storyboard.json`. Project values override global values; an invalid project field falls back to the corresponding validated global field so one bad project value cannot erase unrelated global customization. Invalid global values fall back independently to built-in defaults. Symbols cannot contain terminal controls or line breaks, and colors are allowlisted Pi theme tokens. The editor accepts short text input for symbols and cycles through the allowlisted color names. Theme ANSI strings are still generated at render time.

Each trimming field accepts one of three values: `none` preserves the complete relevant collapsed-row text, including bounded error diagnostics, by wrapping it across lines; `middle` keeps both the beginning and end with a middle ellipsis; and `end` keeps the beginning with an end ellipsis. The default is `middle`. The previous boolean schema remains readable for migration (`true` maps to `middle`, `false` maps to `none`); settings saved by the editor use the string modes.

The settings page is presentation-only: it does not change ownership, grouping, source order, native expansion, messages, session entries, tools, prompts, or model behavior.

### 3.8 State, closure, and expansion

Scene state follows:

```text
running > failed > complete > note
```

- `running`: assistant streaming, stop reason pending, partial tool, or missing tool result;
- `failed`: settled failure stop reason (`error`, `aborted`, `length`) or failed tool result;
- `complete`: settled scene with tools and no failure;
- `note`: thinking content without tools.

The final meaningful source child gets `╰─`; earlier action runs get `├─`. If native content is the final child, its terminal marker closes the scene instead.

Pi's configured global tool expansion state is authoritative. Expanded mode is a hard boundary: all affected tool rows and storyboard decoration return to Pi's complete native rendering, including live output, edit diffs, images, custom details, diagnostics, and no-tool thinking markers. The extension does not register a shortcut or assume a particular key binding.

## 4. Storyboard projection

The pure storyboard model lives in `src/storyboard.ts`. It has no Pi imports and is intentionally fail-open.

### 4.1 Projection layers

```text
active path / native children
└─ validated assistant response
   ├─ native assistant content in source order
   ├─ exact tool-call ownership by ID
   └─ compact action runs within that response
```

The main types are:

```ts
type StoryboardScene = {
  type: "scene";
  assistant: AssistantSceneSnapshot;
  actionRuns: readonly StoryboardActionRun[];
  orderedChildren?: readonly StoryboardOrderedChild[];
  state: SceneState;
};

type StoryboardWorkSpan = {
  type: "work-span";
  scenes: readonly StoryboardScene[];
  parts: readonly StoryboardWorkSpanPart[];
  chapters: readonly StoryboardChapter[];
  state: SceneState;
};
```

`StoryboardScene` is the ownership unit. `StoryboardWorkSpan` is a presentation composition. `StoryboardChapter` contains thinking/action items; `StoryboardBreakout` contains full-width commentary. Synthetic placeholder nodes are presentation-only and never become native or session data.

### 4.2 Building one scene

`buildStoryboard()` processes direct transcript-child snapshots:

1. recognize an assistant component and inspect its ordered content metadata;
2. collect only its contiguous following tool-row window;
3. require unique assistant call IDs and unique tool-row IDs;
4. require the complete direct window to have exactly the assistant's call-ID set;
5. reorder validated rows by assistant source call order;
6. reject expanded or malformed rows, final/unknown text with tools, extra rows, missing rows, or unsupported children;
7. make a native segment for every rejected affected region;
8. otherwise create one scene and split adjacent same-kind tools into action runs.

When no tool calls exist, only a thinking-only assistant can become a quiet scene. Ordinary final answers and unrelated assistant messages remain native.

Native children and diagnostic children are never silently absorbed. A visible native child is a boundary. An invisible assistant component may be skipped by the legacy grouping state machine only when it has no rendered output; it does not justify semantic ownership guessing.

### 4.3 Source-order content

When native child extraction is available, `orderedChildren` contains:

```ts
{ type: "assistant", content: StoryboardAssistantContent }
{ type: "tool", tool: StoryboardToolSnapshot }
```

The renderer uses that order, not direct child order or tool completion order. Each native assistant child remains the original component and rendered line set. Text phase metadata is reduced to a validated enum; raw signatures never leave the adapter.

A source sequence such as:

```text
thinking → read → read → commentary → read → edit
```

becomes:

```text
◉ thinking
├─ Read(2)
│ commentary at full width
◉ Thinking...
├─ Read(1)
╰─ Edit(1)
```

A visible thinking block between two calls breaks action runs but does not create a new assistant-message ownership unit.

### 4.4 Active-path continuation

`buildEmptyThinkingContinuation()` is the only multi-scene work-span builder. It accepts a first scene with visible thinking, actions, no text, and no final/unknown phase, followed only by scenes with settled actions and no visible thinking or text. Each scene retains its own assistant and tool ownership.

The adapter additionally requires:

- both scenes are settled and uniquely matched to `SessionProjection.turns`;
- projected turns are consecutive;
- the first scene has no text/commentary and the later scene has no text/thinking;
- the previous projected turn has no `boundaryAfter` and the next has no `boundaryBefore`;
- direct component order is adjacent;
- no expanded, incompatible, native, visible custom, summary, compaction, branch, or unresolved streaming boundary occurs;
- consecutive empty-thinking scenes may continue, and adjacent same-kind action runs may be visually coalesced across those scene boundaries; each original scene and its exact tool ownership remain separate.

This removes an empty visual root, not an ownership boundary:

```text
◉ Applying the validated fix
├─ Edit 2 files
╰─ Run 1 command
```

If any check fails, the scenes stay separate or the affected region is native.

### 4.5 Session projection

`src/session-projection.ts` retains only immutable presentation metadata:

```ts
type ProjectedAssistantTurn = {
  entryId: string;
  toolCallIds: readonly string[];
  resultEntryIds: readonly string[];
  hasVisibleThinking: boolean;
  hasCommentary: boolean;
  hasFinalAnswer: boolean;
  hasUnknownText: boolean;
  valid: boolean;
  boundaryBefore: boolean;
  boundaryAfter: boolean;
};
```

The module:

- validates active-path entry IDs, parent links, known entry shapes, and duplicate IDs;
- accepts only the exact non-visual `context_edit` deletion shape at runtime and marks it as a hard boundary;
- inspects assistant content only for block kinds, visible-thinking presence, text phase, and tool-call IDs;
- joins tool results by exact call ID;
- marks incomplete or duplicate ownership invalid;
- treats model/thinking-level/label/session-info entries and hidden custom state as transparent;
- treats user/assistant/non-tool messages, compaction, branch summaries, and visible custom state as boundaries;
- returns `undefined` on ambiguity rather than guessing.

It retains no full message, provider payload, thinking signature, tool argument, output, diff, patch, or result detail.

### 4.6 Commentary chapters

Within a validated scene/work span:

- visible thinking starts or continues a chapter;
- validated commentary flushes the chapter and renders as a full-width native breakout;
- eligible action after a same-response commentary breakout receives the fixed placeholder only when a visible thinking root already exists;
- final/unknown/native diagnostic content cannot safely be placed in a cross-turn rail and causes the affected scene to remain native;
- action runs merge within their original validated scene; a validated empty/absent-thinking continuation may additionally coalesce adjacent same-kind runs for presentation without merging scene ownership.

The renderer never turns commentary into a synthetic title and never moves it after tools.

## 5. Tool grouping implementation

The pure grouping state machine is `src/grouping.ts`. It accepts immutable classifications and returns native/group segments:

```ts
type GroupKind =
  | "read" | "search" | "list" | "write"
  | "edit" | "command" | "tool";
```

Eligibility and grouping are separate from rendering:

1. `src/pi-adapter.ts` validates a native row and creates a minimal `ToolRowSnapshot`.
2. `grouping.ts` merges adjacent matching kinds and preserves native boundaries.
3. `src/renderer.ts` formats and width-checks the immutable group snapshot.

The legacy grouping path allows an empty assistant component between visually adjacent tool rows without flushing a run. It does not skip visible assistant output or incompatible components. Singleton groups are intentional so one collapsed row has the same compact presentation as a batch.

### 5.1 Renderer guarantees

`src/renderer.ts`:

- uses the active theme at render time;
- uses `visibleWidth()`, `sliceByColumn()`, and `truncateToWidth()` from `pi-tui`;
- strips ANSI CSI/OSC and C0/C1 control sequences from model/tool-controlled display values;
- flattens newlines, tabs, and other line-breaking controls;
- uses independent `none`, `middle`, or `end` modes for long path/file-name and command values, defaulting to `middle`;
- wraps complete affected row text, including bounded error diagnostics, when a mode is `none`, while keeping every returned line within the requested width;
- reserves width for the literal failure separator before truncating the diagnostic;
- never returns a line wider than the requested width, including widths from 1 through 200;
- falls back to compact JSON for malformed recognized arguments without guessing;
- never renders successful result contents, write content, command output, diffs, patches, image data, or generic tool output;
- never stores complete failed output—only a bounded generic error summary.

The compact renderer is a summary, not a result viewer. Native expansion is the source of complete details.

## 6. Runtime architecture

```text
pi-storyboard/
├── package.json
├── package-lock.json
├── tsconfig.json
├── README.md                 # marketplace-facing usage only
├── AGENTS.md                 # contributor/agent workflow rules
├── LICENSE
├── docs/
│   └── ARCHITECTURE.md       # authoritative implementation document
├── src/
│   ├── index.ts              # extension command, lifecycle, projection cache
│   ├── grouping.ts           # pure semantic grouping state machine
│   ├── renderer.ts           # safe compact group summaries
│   ├── storyboard.ts         # pure scene/work-span/order validation
│   ├── session-projection.ts  # pure public active-path index
│   ├── storyboard-renderer.ts # rails, markers, chapters, width, closure
│   ├── pi-adapter.ts         # all private Pi/TUI inspection and patching
│   ├── presentation-settings.ts       # pure defaults, validation, and snapshots
│   ├── presentation-settings-store.ts # Pi settings read/write boundary
│   ├── presentation-settings-ui.ts    # interactive settings page
│   ├── transcript-replay.ts  # fixed native-component replay fixture
│   └── tui-preview.ts        # interactive preview gallery, including settings fixtures
└── test/
    ├── architecture.test.ts
    ├── grouping.test.ts
    ├── renderer.test.ts
    ├── storyboard.test.ts
    ├── storyboard-renderer.test.ts
    ├── session-projection.test.ts
    ├── work-span.test.ts
    ├── pi-adapter.test.ts
    ├── transcript-replay.test.ts
    ├── presentation-settings.test.ts
    └── tui-preview.test.ts
```

### 6.1 Extension entry point

`src/index.ts`:

- exports the default Pi extension factory;
- registers `/storyboard-preview`, which is available only in interactive TUI mode;
- registers `/storyboard-settings [global|project]`, which is available only in interactive TUI mode;
- listens to public lifecycle notifications only to invalidate the ephemeral session projection;
- installs a fresh guarded patch on `session_start` in TUI mode;
- reads a fresh validated presentation-settings snapshot at the same lifecycle boundary;
- uninstalls it on `session_shutdown` and clears projection callbacks;
- reads `ctx.sessionManager.buildContextEntries()` only inside a lazy, invalidated cache;
- performs no session writes, tool registration, context mutation, or model-facing work; the settings command is the only user-initiated filesystem write and is limited to its validated dedicated settings file.

Projection invalidation currently responds to message/turn/agent/tool completion, compaction, tree, switch, and fork lifecycle notifications. Invalidating is the only purpose of those listeners.

### 6.2 The one private integration seam

Pi has no public transcript grouping hook, so `src/pi-adapter.ts` guards one private seam: a wrapper around `Container.prototype.render`. All private field knowledge is isolated there.

The adapter feature-detects:

- `Container.prototype.render` and its original property descriptor;
- constructibility of `ToolExecutionComponent`;
- native assistant/tool private fields needed for validation;
- native assistant child and mouse-layout shapes;
- the exact native spacer/status shape used by Pi's expansion feedback;
- valid theme and group-renderer output.

It reads native components but never mutates their messages, arguments, results, child arrays, or rendering state. The only extension-owned private marker is:

```ts
Symbol.for("pi-storyboard.container.v1")
```

### 6.3 Render flow

A patched container render follows this flow:

1. Copy the direct child array for this pass; in session-aware mode, project only the exact Pi expansion or `/session` status pair out of ownership matching while retaining its native rows for output.
2. Inspect assistant metadata and tool-row snapshots without retaining unsafe payloads.
3. Build a preliminary storyboard to identify owners.
4. Render each native non-tool child once at the correct width.
5. Reconstruct native assistant child regions from Pi's own `contentContainer` and mouse layout.
6. Rebuild the final storyboard from validated snapshots.
7. In session-aware mode, uniquely match settled scenes to the active-path projection.
8. Build ordinary work spans or the restricted empty-thinking continuation.
9. Render compact groups and native children in source order.
10. Rebuild the container's mouse layout with storyboard proxies and zero-height grouped members.
11. Return the projected output.
12. On any incompatibility, exception, invalid child output, ambiguous ownership, or renderer failure, call Pi's original container renderer once for the complete affected container.

The adapter never embeds a native tool renderer inside a valid collapsed storyboard. A collapsed running edit remains a compact row; explicit expansion restores the original native component.

### 6.4 Native components and mouse interaction

Native assistant children remain the actual Pi components. Storyboard layout subtracts the measured assistant/branch gutter before asking native children to render. Native content is not recreated, so Markdown styling, links, OSC behavior, code blocks, diagnostics, and thinking toggles remain Pi-owned.

Because the storyboard changes visible heights and prefixes, the adapter rebuilds the private container mouse layout. It uses:

- an inert mouse sink for compact group blocks;
- a scene proxy that translates storyboard coordinates back to native assistant children;
- a thinking proxy for mixed no-tool responses where only thinking markers move and final/unknown text stays at native coordinates;
- zero-height entries for hidden grouped tool members.

Branches and summaries are presentation-only mouse sinks. Native expansion and thinking toggles remain active.

### 6.5 Presentation-settings boundary

`src/presentation-settings.ts` has no Pi imports. It owns the settings schema, defaults, layered field validation, immutable snapshots, theme-token allowlist, and symbol safety checks. `src/presentation-settings-store.ts` is the only filesystem boundary: it uses Pi's public `SettingsManager` for trust detection and reads the dedicated global/project files with the validated precedence rules, then performs an atomic user-requested replacement of only the selected `pi-storyboard.json` file. It never writes Pi's `settings.json`, session data, or unrelated files. The public settings factory is feature-detected through a namespace import; if it is unavailable, lifecycle loading keeps built-in defaults and the renderer remains installed. The interactive settings UI is dynamically imported only when its command is invoked.

`src/presentation-settings-ui.ts` owns only the TUI editor. It edits a mutable draft, exposes text submenus for symbols and cycling lists for color tokens, and returns a validated snapshot to the command. It does not change the active renderer directly; `/reload` creates the new lifecycle snapshot. Renderer and storyboard code receive settings as data and never use them for ownership or fallback decisions.

## 7. Defensive patch and compatibility rules

### Installation

Installation must:

1. verify the original `Container.prototype.render` is an own data property with a callable value;
2. verify `ToolExecutionComponent` is constructible without instantiating it;
3. save the exact original descriptor and function;
4. refuse an unrelated existing marker;
5. use the project marker above;
6. support owner counting for duplicate/reloaded extension loads;
7. avoid installation outside TUI mode;
8. return `undefined` silently when compatibility checks fail.

### Uninstallation

Handles are idempotent. The final owner disables the wrapper and restores the exact original descriptor only if the prototype still points at this extension's wrapper. If another extension replaced or wrapped `render` later, this adapter never overwrites it. A disabled marker may remain when safe removal is impossible, preventing accidental stacking.

### Native fallback triggers

The complete affected region remains native when any of the following occurs:

- missing, duplicate, extra, or mismatched call IDs;
- a missing result after a settled response;
- expanded rows or global expansion;
- final-answer, unknown, malformed, or in-progress text that cannot be safely classified;
- unsupported assistant content or entry type;
- session mapping ambiguity, active-path uncertainty, compaction/branch uncertainty, or a hard boundary;
- a visible custom/native child between candidate scenes (except the exact session-proven Pi expansion or `/session` status pair described in [Section 2.4](#24-native-tui-behavior));
- incompatible private component fields or mouse layout;
- invalid native child/group output;
- an exception in classification, projection, layout, or rendering;
- a third-party wrapper conflict that makes ownership unsafe.

Failing open is more important than preserving a compact presentation.

### Extension composition

Prototype wrappers can conflict by load order. The adapter preserves a later wrapper on uninstall and does not silently overwrite it. Before release, test against a known transcript-patching extension such as `@pi-kaush/pi-tool-call-markers`. If safe composition is not possible, document the conflict and keep the native fallback; do not invent an undocumented shared protocol.

## 8. Safety and privacy invariants

The extension must never:

- register, replace, remove, or modify a built-in/custom tool;
- call `registerTool()` or `setActiveTools()`;
- modify tool arguments, execution, updates, results, or ordering;
- mutate `AssistantMessage.content` or any Pi message/component object;
- append session/custom entries or inject messages/context;
- modify prompts, model selection, compaction, branching, thinking level, or token usage;
- use private harness run/turn IDs as ownership proof;
- read session JSONL files from the renderer;
- copy raw thinking, signatures, provider payloads, successful result content, written content, command output, edit text, diffs, patches, or full errors into extension state;
- make network calls or LLM calls;
- perform filesystem writes outside the explicit user-initiated settings save boundary, subprocess work, timers, or background work.

Allowed state is limited to immutable extension-owned snapshots and minimal ephemeral active-path IDs/boundary flags needed for presentation validation. All state is session-local, discarded on invalidation/shutdown, and never sent back to Pi's model or session.

Display values remain model/tool-controlled and may contain sensitive arguments. The renderer sanitizes terminal controls and bounds failure summaries, but it does not claim to redact arguments. Results and write content are intentionally excluded from collapsed summaries.

## 9. Verification and development workflow

### 9.1 Commands

Use the repository's scripts:

```bash
npm install
npm run typecheck
npm test
npm run check
npm run package:check
```

`npm run check` is the normal pre-commit validation. `npm run package:check` must be inspected to ensure the marketplace package contains the intended files and does not accidentally include development-only material.

Pi loads the extension directly from TypeScript through Jiti; there is no required production build step.

### 9.2 Test responsibilities

- `grouping.test.ts`: semantic adjacency, singleton groups, invisible assistant boundaries, and native segments.
- `renderer.test.ts`: labels, argument summaries, sanitization, errors, timing, safe edit/write behavior, independent `none`/`middle`/`end` modes, wrapping, truncation, and widths 1–200;
- `presentation-settings.test.ts`: defaults, validation, trust-aware precedence, immutability, dedicated-file paths, and atomic settings writes without Pi settings mutation.
- `storyboard.test.ts`: scene ownership, exact IDs, source order, action runs, phases, state precedence, and native fallback.
- `storyboard-renderer.test.ts`: markers, rails, closure, commentary layout, thinking cap, configured symbols/colors, state colors, width budgets, and placeholder styling.
- `session-projection.test.ts`: active path, exact result ownership, transparent metadata, validated context-edit boundaries, compaction, boundaries, and text phases.
- `work-span.test.ts`: empty-thinking continuation, adjacent same-kind cross-scene visual grouping, action roots, commentary suffix, source order, and no-placeholder cases.
- `pi-adapter.test.ts`: private-shape validation, no mutation, one render per child, compact running edits, failure summaries, settings threading, expansion/status restoration, native thinking-marker restoration, mouse translation, fallback, owner counting, and wrapper composition.
- `transcript-replay.test.ts`: native Pi components in the fixed diagnostic replay.
- `tui-preview.test.ts`: current preview gallery, settings defaults/custom fixture, and public `pi-tui` component coverage.
- `architecture.test.ts`: prohibited model/mutation/process APIs remain absent from the renderer/adapter path; the explicit settings-store write boundary remains isolated.

### 9.3 Required semantic matrix

At minimum, preserve tests for:

- one or many adjacent same-kind tools;
- mixed Read/Search/List/Write/Edit/Command/Tool order;
- source order differing from completion/direct-row order;
- duplicate, missing, extra, and malformed ownership IDs;
- running, successful, failed, and malformed-argument edits;
- generic custom/MCP/subagent rows retaining tool names;
- image rows collapsed versus expanded;
- thinking → tool, thinking → commentary → tool, and thinking → tool → thinking → tool;
- rich commentary with headings, lists, code, links, tables, multiline text, and OSC;
- final-answer and unknown text native fallback;
- thinking-only notes;
- tool-only leading action roots;
- same-response commentary-suffix placeholder;
- adjacent settled empty/absent-thinking continuation;
- visible thinking on every turn staying separate;
- hard boundaries from user/custom/native/compaction/branch/context-edit content;
- streaming before and after settlement;
- thinking toggles, expanded tools, theme changes, narrow widths, and mouse coordinates;
- session reload, resume, fork, tree navigation, new session, and compaction;
- original `Container.render` restoration and coexistence with later wrappers.

### 9.4 Architecture guard

The architecture test must continue to reject model/session mutation and I/O APIs, including:

```text
registerTool
setActiveTools
before_agent_start
sendMessage
sendUserMessage
appendEntry
fetch(
child_process
spawn(
exec(
```

It also rejects unnecessary harness lifecycle coupling. Public session/message notifications used solely for projection invalidation and the static preview command are explicitly allowed. This is an intent guard, not a security sandbox.

## 10. Dependencies, packaging, and compatibility

There are no runtime dependencies. Pi packages are optional wildcard peers because Pi owns the runtime modules:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true }
  }
}
```

Current development versions reviewed by the project:

| Package | Version |
|---|---:|
| `@earendil-works/pi-coding-agent` | `0.85.1` |
| `@earendil-works/pi-tui` | `0.85.1` |
| `typescript` | `7.0.2` |
| `vitest` | `5.0.1` |
| `@types/node` | `26.5.1` |

The package targets Node `>=22.19.0`. Exact development versions and `package-lock.json` provide reproducible checks; wildcard peers avoid installing a second Pi runtime.

The package manifest intentionally publishes:

```json
"files": ["src", "README.md", "LICENSE"]
```

The authoritative development document and `AGENTS.md` are repository maintainer material, not marketplace package content.

When changing a reviewed dependency or claiming a new Pi version:

1. review the installed/public extension, TUI, session, and package APIs;
2. update this document's compatibility table and constraints;
3. update manifest and lockfile together;
4. add or update compatibility tests;
5. run the full check and package dry run;
6. perform interactive native-rendering verification.

## 11. Evidence and compatibility notes

The design was checked against Pi extension/session/TUI documentation, installed implementation and type declarations, and a local session corpus. The corpus is evidence for edge cases, not a schema contract; it must never be used to infer behavior for all providers or future Pi versions.

Observed historical patterns included:

- assistant content with tools is commonly separated from tool-result messages;
- empty thinking can carry an opaque reasoning signature;
- commentary commonly appears after visible thinking and before tools, but future providers may interleave it elsewhere;
- active sessions contain many assistant/tool cycles and can contain compaction/custom state;
- raw session append order is not sufficient for branch-aware rendering.

A historical local scan, frozen at the time of the original analysis, measured 15 session files, 4,952 active-path entries, 1,952 assistant messages, 2,568 tool-result messages, 1,824 tool-bearing assistant responses, 1,822 validated completed tool turns, 126 maximal work spans, 106 multi-turn spans, 175 custom entries, 12 compaction entries, 32 model-change entries, and 75 thinking-level-change entries. The later diagnostic session also exposed two runtime `context_edit` deletion markers; these are now recognized only in their exact non-visual form and remain hard boundaries. It also found 278 tool-bearing turns with empty or absent visible thinking, 274 of which followed visible thinking earlier in their validated span. These counts are diagnostic evidence only; they are not assumptions the renderer may use for ownership.

Reference material reviewed includes:

- Pi session format: <https://pi.dev/docs/latest/session-format>
- installed Pi extension, SDK, and session-format documentation;
- installed `SessionManager`, assistant-message, and tool-execution declarations/implementations;
- the installed `pi-ai` text-signature and OpenAI Responses adapter types;
- the installed interactive transcript assembly and lifecycle implementation;
- the prior-art `@pi-kaush/pi-tool-call-markers` transcript patch pattern.

Important version rule: a session file's version number is not a complete feature flag. Newer Pi versions may add system messages, deferred stop reasons, response metadata, compaction checkpoints, or multiple roots. Unknown or incompatible shapes must be preserved natively rather than forced into this model.

## 12. Known risks and future work

| Risk | Mitigation |
|---|---|
| Pi private fields change | Keep all inspection in `pi-adapter.ts`, validate every shape, test against supported versions, fail open. |
| Prototype wrapper conflict | Owner-counted guarded patch, conservative uninstall, composition tests, native fallback. |
| Native output becomes stale after theme change | Resolve theme at render time; do not cache ANSI-rendered strings across themes. |
| Long transcripts cause render cost | Render each child once per pass; benchmark before adding a bounded settled cache. |
| Sensitive argument values appear | Document argument visibility; never include result data or write content; sanitize terminal controls. |
| Compact presentation hides complete diagnostics | Show one bounded generic failure line; global expansion restores Pi's native details. |
| Empty thinking is mistaken for absent semantics | Suppress only visual output; retain original message/signature untouched. |

### Not currently shipped: long-span windowing

Historical transcripts can contain very long sequences of tool turns. Arbitrary aggregation is intentionally disabled. A future optional UI window could collapse only settled, successful middle chapters while retaining exact counts, first/latest context, ephemeral state, and native expansion. It must never hide running, failed, aborted, truncated, commentary-adjacent, unknown, or ambiguous content. Do not implement this without updating this document and its acceptance tests first.

### Public API replacement

If Pi adds a public transcript grouping/composition hook, replace the private `Container.prototype.render` seam rather than expanding private-field dependencies. The adapter remains the compatibility boundary until then.

## 13. Change checklist

Before changing code:

- read `AGENTS.md` and this document;
- identify whether the change affects the user-visible contract, ownership, native fallback, lifecycle, compatibility, package metadata, preview, or tests;
- preserve any unrelated worktree changes.

While changing code:

- keep Pi/model/session behavior unchanged;
- keep private Pi inspection inside `src/pi-adapter.ts`;
- keep pure projection logic free of Pi imports where specified;
- add or update focused tests for new behavior and fallback cases;
- do not use tool output, thinking signatures, or private run IDs as unsupported ownership signals.

Before completing a change:

- update this document whenever implementation truth changed;
- update examples, module descriptions, compatibility notes, test matrix, and future-work status affected by the change;
- keep `README.md` concise and marketplace-facing—link to this document instead of copying development detail;
- run `npm run check` and, for package-facing changes, `npm run package:check`;
- verify `git diff` contains no accidental code, generated-file, or documentation regressions.

## 14. Acceptance criteria

The implementation remains acceptable only when:

- every validated assistant response keeps its own scene and tool ownership;
- exact source order and exact call-ID matching are preserved;
- only the explicit settled empty-thinking continuation can place multiple scenes in one visual span;
- commentary remains complete native Markdown at its original position;
- the fixed commentary-suffix placeholder remains same-response and presentation-only;
- empty/absent thinking does not create fake model content;
- expanded, ambiguous, incompatible, or unsafe cases render through Pi natively;
- compact rows never expose successful output, write content, edit text/diffs, image data, or full errors;
- all output respects terminal width and strips unsafe display controls; `none` trimming preserves complete relevant row text, including bounded error diagnostics, by wrapping it across lines;
- no tools, messages, context, session entries, prompts, model settings, or agent behavior are changed;
- `/storyboard-settings` writes only the validated dedicated `pi-storyboard.json` file after explicit user Save, never changing Pi settings or session data;
- no network, subprocess, timer, or background work is introduced;
- patch installation/uninstallation is idempotent and does not overwrite later wrappers;
- tests and package validation pass;
- this document and `AGENTS.md` remain aligned with the implementation.
