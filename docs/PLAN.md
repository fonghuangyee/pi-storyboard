# Plan: `pi-tool-groups`

> Status: the semantic tool-grouping baseline is complete. The approved next presentation phase is **Direction A — Story Spine** in [`STORYBOARD_PLAN.md`](./STORYBOARD_PLAN.md). All safety, privacy, native fallback, and presentation-only constraints in this document remain authoritative.

### Approved storyboard evolution

Story Spine may treat a validated `AssistantMessageComponent` as a scene header/parent row and nest only its exactly matched tool-call rows beneath it. This is a narrow TUI composition change, not a harness feature.

It must:

- operate only inside the existing guarded `Container.prototype.render` wrapper;
- derive scenes from the TUI components already being rendered;
- join assistant and tool rows only through validated source-order `toolCallId` values;
- call native assistant/tool renderers at most once per render pass and never mutate their state;
- use no agent, turn, message, tool-execution, tool-call, tool-result, context, or provider event hooks;
- use no `ctx.sessionManager`, custom messages, custom entries, model-facing tools, or parallel extension state;
- make a complete scene native when tools are expanded, an edit is running, ownership is incomplete, or any private shape is incompatible;
- preserve the existing minimal tool snapshots and never copy raw thinking, signatures, tool output, edit text, diffs, patches, or complete errors;
- preserve Pi's native output padding, spacer rows, width budgeting, interaction coordinates, and theme roles; add only the Story Spine marker/rail/indent;
- color the scene marker by aggregate state with `running > failed > complete-with-tools > settled-note`, never by unreliable last-completed-tool order;
- retain the same no-I/O, no-network, no-subprocess, no-timer, and no-background-work guarantees.

Where older wording below says that every visible assistant component is a hard group boundary, this approved scene-header exception supersedes it only when all Story Spine validation rules pass. Otherwise the older native-boundary behavior remains in force.

## 1. Objective

Build a small, presentation-only Pi extension that groups adjacent eligible tool rows and presents validated assistant/tool ownership as a Story Spine, while preserving Pi's native tools, execution, session data, and all non-grouped rendering.

> Render every eligible tool row, including failed calls, as a compact collapsed summary; adjacent rows of the same semantic group kind merge into one group. Failed rows use the same `●` marker in the theme's error color and show only a minimal sanitized error message separated by ` - `. This includes settled `edit` calls and all compatible built-in, custom, MCP, and subagent tools. Never replace or re-register a tool. When compatibility checks fail, render Pi's native transcript unchanged.

Example collapsed output:

```text
Read 4 files
  ● src/service/UserService.java
  ● src/service/UserRepository.java
  ● src/controller/UserController.java
  ● src/dto/UserDto.java

Search 3 times
  ● grep "findById" in src/
  ● grep "save" in src/
  ● find "*Repository.java" in src/

Edit 2 times
  ● src/service/UserService.java (1 replacement)
  ● src/service/UserRepository.java (2 replacements)
```

Settled edits, whether successful or failed, use compact summaries while collapsed. Running and expanded edits remain Pi's original component and renderer; global expansion restores Pi's complete native diffs and diagnostics. A failed edit with malformed arguments still groups using the safe label `edit` plus its minimal error message.

## 2. Confirmed platform constraints

As of the dependency review for this plan:

- Pi exposes custom tool renderers, but no public API for grouping existing transcript rows.
- `AssistantMessageComponent` and `ToolExecutionComponent` are publicly exported by `@earendil-works/pi-coding-agent`, but the state needed for Story Spine (`lastMessage`, streaming state, `toolCallId`, `toolName`, `args`, `result`, `isPartial`, and `expanded`) is private implementation detail.
- Pi's transcript is a `Container` whose direct children include native assistant and tool-execution components.
- Pi propagates the global tool-output expansion state to each tool row through `setExpanded()`.
- Extensions are loaded directly from TypeScript through Jiti; a production build step is not required.

Therefore the grouping baseline and Story Spine require one guarded private-API seam: wrapping `Container.prototype.render` and structurally reading native assistant/tool-row TUI state. All private knowledge must be isolated in `src/pi-adapter.ts`.

This is intentionally an interim design. Replace the patch if Pi adds a public transcript/group-rendering hook.

### Important transcript distinction

Pi renders assistant prose/thinking in an `AssistantMessageComponent` and tool rows as separate transcript children, so the native visual tree can flatten a text/tool interleave. The assistant message still preserves its ordered `content` array. Story Spine uses that array to compose native assistant children and tool groups in source order, while treating the assistant message—not an individual thinking paragraph—as the ownership unit. `toolCallId` joins each tool row/result without implying causal ownership.

## 3. Scope

### Group in collapsed mode

Singleton eligible rows are groups of one. This is intentional: every eligible collapsed tool uses the same compact presentation whether it appears alone or in a batch.

| Tool | Group kind | Minimum size |
|---|---|---:|
| `read` | Read | 1 |
| `grep`, `find` | Search | 1 |
| `ls` | List | 1 |
| `write` | Write | 1 |
| settled valid `edit` (successful or failed) | Edit | 1 |
| `bash`, `powershell` | Command | 1 |
| custom, unknown, MCP, and subagent tools | Tool | 1 |

Adjacent rows merge only when their semantic group kinds match. Generic Tool rows may contain different tool names; every item must retain its tool name so mixed generic groups remain understandable.

### Always leave native

- running or expanded `edit` calls
- rows whose error/result shape cannot be validated safely
- user text and pure final-answer assistant text
- assistant text/thinking unless it is reused through its native renderer as a validated Story Spine scene header
- compaction, branch, and custom-entry components
- all tool rows while global expanded mode is active

### Non-goals

The extension must not:

- call `pi.registerTool()` or override any built-in tool;
- call `pi.setActiveTools()`;
- modify tool arguments, execution, updates, or results;
- subscribe to agent, turn, message, tool-execution, tool-call, tool-result, context, provider, or `before_agent_start` hooks;
- read or write `ctx.sessionManager`, append entries, inject messages, or maintain a parallel transcript model;
- modify prompts, model selection, messages, compaction, or the agent loop;
- register model-facing tools or make LLM/network calls;
- write files, spawn processes, start timers, or run background work;
- patch `ToolExecutionComponent.render()` or `updateDisplay()` in v1;
- reproduce Pi's native detailed renderers, including edit, write, command, custom, MCP, or subagent output.

## 4. Grouping semantics

Grouping operates on the direct children of a rendered `Container`.

A row is eligible only when all of the following are true:

1. It is a Pi `ToolExecutionComponent`, whether it represents a built-in, custom, MCP, or subagent tool.
2. `expanded === false`.
3. Its runtime shape passes adapter validation.
4. If it failed, the adapter can extract a bounded minimal error summary without retaining the full result content.
5. If `toolName === "edit"`, it also has a settled final result. Successful edits require validated path and replacement count; failed edits use those fields only when safely available and otherwise use the label `edit`.

Image-producing rows are eligible while collapsed, but their result content is
never included in the summary. When expanded, Pi's native image renderer is
restored.

Adjacent eligible rows join only when their semantic group kinds match:

```text
read                              -> ReadGroup(1)
read + read                       -> ReadGroup(2)
grep + find + grep                -> SearchGroup(3)
ls + ls                           -> ListGroup(2)
write + write                     -> WriteGroup(2)
edit(success) + edit(failed)      -> EditGroup(2)
bash + powershell                 -> CommandGroup(2)
customA + mcpB + subagentC        -> ToolGroup(3)
read + bash                       -> ReadGroup(1) + CommandGroup(1)
read + edit(success) + read       -> ReadGroup(1) + EditGroup(1) + ReadGroup(1)
read + edit(running) + read       -> ReadGroup(1) + NativeEdit + ReadGroup(1)
```

Edit groups never merge with Write or generic Tool groups. A running, expanded, or incompatible edit is native and is a hard group boundary. Every validated settled failed edit remains in an Edit group even when its arguments are malformed.

A visible non-tool component breaks an action run in the source-order scene projection. The sole exception is a validated `AssistantMessageComponent` used as a Story Spine scene header: it may own only the contiguous direct tool-row window whose `toolCallId` set exactly matches its assistant message's source-order calls. The tool rows are then presented according to the assistant `content` array, not direct completion order. An assistant component that renders no visible lines may form a validated tool-only scene with the deterministic native-safe title `Tool step`; it is never used to expose hidden thinking. The adapter must never skip or absorb a user message, custom entry, spacer with meaningful separation, compaction/branch row, or unknown component. Any incomplete or mismatched scene is rendered entirely natively.

Every non-empty eligible run is replaced visually, including singleton and failed rows. This keeps each collapsed tool kind on the same compact presentation whether it appears alone or in a batch. Native rendering is restored whenever the row is expanded, incompatible, or otherwise outside the eligible scope. Edit rows additionally return to native rendering while running. A successful edit requires a validated path/count summary; a failed edit may fall back to the safe label `edit`.

### Failure behavior

Failed calls are not classified by error type. Every validated collapsed failure stays in its normal semantic group and uses the same `●` marker in the error color plus one minimal sanitized message extracted generically from its result text.

```text
bash(success)
bash(failed: "Command exited with code 1")
bash(success)
```

renders as one Command group of three rows. The failed row does not break the group:

```text
Run 3 commands
  ● npm test
  ● npm run check - Command exited with code 1
  ● git status
```

The adapter must not parse or depend on tool-specific error categories. It extracts the last non-empty line from text result blocks, sanitizes it, and stores only that bounded summary. If there is no usable text, it uses the deterministic label `Failed`. Full output and diagnostics remain in Pi's row state and return in expanded mode.

A running non-edit call, including a streaming Bash or PowerShell call, appears as a compact grouped row with a `syntaxKeyword`-colored running marker. If it later fails, the same grouped row changes to the error marker and minimal message. Running edits remain native so Pi's preview diff and preview errors stay visible; once settled, both successful and failed edits may group.

### Expanded behavior

When the user activates Pi's configured `app.tools.expand` action (normally
`Ctrl+O`), Pi sets every tool row's `expanded` property. The adapter treats
expanded state as a hard boundary: it does not create a group and delegates
every row to Pi's original native renderer.

```text
Collapsed: grouped summaries
Expanded:  ungrouped native Pi rows
```

This deliberately gives `Ctrl+O` one standard meaning: leave the compact group
presentation and preview the original Pi TUI for every tool, including live
command output and custom/MCP/subagent details. Under Story Spine, global
expansion also removes the scene rail and delegates the complete affected scene
to native assistant and tool rendering. Do not register a shortcut or hardcode
`Ctrl+O`; respect Pi's configured expansion state.

## 5. Rendering contract

Group rendering is a compact summary, not a replacement result viewer.

### Read

```text
Read 3 files
  ● src/a.ts
  ● src/b.ts (offset 80, limit 40)
  ● src/c.ts
```

### Search

```text
Search 3 times
  ● grep "UserService" in src/
  ● find "*Repository.java" in src/
  ● grep "save" in test/
```

### List

```text
List 2 directories
  ● src/
  ● test/
```

### Write

```text
Write 2 files
  ● dist/config.json
  ● tmp/report.txt
```

### Edit

```text
Edit 2 times
  ● src/a.ts (2 replacements)
  ● src/b.ts (1 replacement)
```

Settled successful and failed edits use this summary. It includes the destination path and validated replacement count when safely available; a failed edit may fall back to the label `edit` and additionally includes the generic minimal error message. It never retains `oldText`, `newText`, diff, patch, or full result content. Running and expanded edits use Pi's native edit renderer.

### Command

```text
Run 2 commands
  ● npm test
  ● git status
```

Bash and PowerShell share the Command group. A running command is summarized without reproducing or tailing its output; expansion delegates the complete live output to Pi's native renderer. When Pi's shell renderer exposes valid timing state, append its native-style `(elapsed 0.2s)` or `(took 1.5s)` suffix; when that state is absent, do not invent a duration.

### Generic tools

```text
Run 3 tools
  ● custom-tool {"target":"src"}
  ● mcp-server.lookup {"id":42}
  ● subagent {"task":"review"}
```

Generic summaries must always include the tool name. Arguments use a sanitized compact JSON representation and may be truncated to terminal width. Successful rows never include result contents. Failed rows include only the same generic minimal error message used by every other tool kind.

States:

- `●` completed successfully, using the theme's success color
- `●` pending/running, using the theme's `syntaxKeyword` color for non-edit tools
- `●` failed, using the theme's error color and a minimal error message
- running edits and all expanded rows are never summarized

Use only the active Pi theme supplied by the session UI:

- heading: `toolTitle`
- completed: `success`
- running: `syntaxKeyword`
- failed: `error`

Rendering requirements:

- preserve Pi's native one-line top spacer before each grouped tool block;
- sanitize all model/tool-provided values by removing display escape sequences and C0 control characters;
- flatten embedded newlines before placing values on one line;
- use `visibleWidth()` and `truncateToWidth()` from `@earendil-works/pi-tui`;
- never return a line wider than the supplied width;
- handle narrow widths without throwing;
- use deterministic labels and preserve source order;
- use a compact JSON fallback when recognized arguments are malformed or incomplete rather than guessing;
- for failed rows, inspect text blocks generically, select the last non-empty sanitized line, cap the stored summary at 512 Unicode code points, and use `Failed` when no usable text exists;
- when a failure suffix competes with the main value for width, truncate the diagnostic first and preserve a recognizable path/command prefix; never let a one-cell middle ellipsis appear as an ambiguous `.`;
- do not classify errors or parse tool-specific status formats;
- read the current theme at render time so theme switches do not retain stale ANSI codes.

Initial argument summaries:

- `read`: `path`, plus supplied `offset`/`limit`;
- `grep`: quoted `pattern`, optional `path`, `glob`, and `limit`;
- `find`: quoted `pattern`, optional `path` and `limit`;
- `ls`: `path`, defaulting to `.` only when that matches Pi's native argument semantics;
- `write`: destination `path` only; never include written content;
- `edit`: destination `path` and `edits.length` after settlement; never copy or include `oldText`, `newText`, result `diff`, or result `patch`; failed edits may additionally carry the generic bounded error summary;
- `bash`/`powershell`: command text, flattened and sanitized; include a working directory only when present in the actual arguments;
- custom, unknown, MCP, and subagent tools: tool name plus sanitized compact JSON arguments;
- image reads use the same path/status summary and never expose image data;
- malformed recognized arguments: tool name plus sanitized compact JSON rather than a guessed label.

Do not show successful tool result contents, written content, edit text/diffs/patches, command output, or custom-tool output in collapsed groups. For failures, show only the generic bounded error summary; never retain the full failed output. Expanded mode delegates to Pi's native renderer, which remains responsible for all detailed and live result rendering.

## 6. Architecture

```text
pi-tool-groups/
├── package.json
├── package-lock.json
├── tsconfig.json
├── README.md
├── LICENSE
├── src/
│   ├── index.ts          # Pi lifecycle; install/uninstall
│   ├── grouping.ts       # pure grouping state machine
│   ├── renderer.ts             # safe width-aware group summaries
│   ├── storyboard.ts           # pure scene ownership/state rules
│   ├── storyboard-renderer.ts  # responsive Story Spine rendering
│   ├── tui-preview.ts          # preview gallery
│   └── pi-adapter.ts           # the only private Pi/TUI knowledge
└── test/
    ├── grouping.test.ts
    ├── renderer.test.ts
    ├── storyboard.test.ts
    ├── storyboard-renderer.test.ts
    ├── pi-adapter.test.ts
    └── architecture.test.ts
```

### `index.ts`

- Export the default Pi extension factory.
- Do nothing outside TUI mode.
- Install the patch idempotently on `session_start`.
- Uninstall it on `session_shutdown`.
- Hold no session or transcript data after shutdown.

### `grouping.ts`

Pure code with no Pi imports:

```ts
type GroupKind = "read" | "search" | "list" | "write" | "edit" | "command" | "tool";
type Candidate = { kind: GroupKind; row: unknown };
type Segment =
  | { type: "native"; row: unknown }
  | { type: "group"; kind: GroupKind; rows: unknown[] };
```

Given ordered child classifications, produce native/group segments. Keep all boundary and minimum-size policy here.

### `renderer.ts`

- Convert validated row snapshots to display labels.
- Render headings, status markers, indentation, and truncation.
- Contain no prototype patching.
- Be independently testable with plain objects and a fake theme.

### `pi-adapter.ts`

The only module allowed to know that:

- transcript parents are `Container` instances;
- direct children can be `AssistantMessageComponent` or `ToolExecutionComponent` instances;
- validated assistant fields expose the current message/streaming state;
- validated tool fields expose call ID, arguments, result, and expansion state;
- runtime-private row fields exist;
- `Container.prototype.render` can be wrapped.

It must expose a small interface such as:

```ts
type PatchHandle = { uninstall(): void };

function installToolGroupingPatch(options: {
  getTheme(): ThemeLike;
  renderGroup(group: GroupSnapshot, width: number): string[];
}): PatchHandle | undefined;
```

The grouping layer receives immutable snapshots; it must never mutate Pi rows, arguments, results, or child arrays. Failed snapshots carry only `isError` and an optional bounded `errorSummary`, not copied result content or details. Edit snapshots must be minimal projections containing only tool name, path, replacement count, status, and optional bounded error summary. They must not deep-copy `oldText`, `newText`, result details, diff, patch, or full error output.

## 7. Defensive patch design

Installation must:

1. Feature-detect `Container.prototype.render`.
2. Confirm `ToolExecutionComponent` is constructible/exported.
3. Save the exact original render function.
4. use a project-specific `Symbol.for("pi-tool-groups.container.v1")` marker;
5. support owner counting so reloads/duplicate loads do not stack wrappers;
6. avoid installing when `ctx.mode !== "tui"`;
7. return `undefined` without user-visible failure when checks fail.

The wrapped render must:

1. Fast-path to the original renderer if there are no eligible tool groups or Story Spine note scenes.
2. Read but never modify `children`.
3. Call each native child renderer at most once per container render pass.
4. Wrap classification and custom rendering in `try/catch`.
5. On any exception, call the original `Container.render` for the entire container.
6. Preserve exact native child output for every non-grouped segment.

Uninstallation must:

- decrement the owner count;
- disable the wrapper when the final owner exits;
- restore the original function only if the prototype still points to this extension's wrapper;
- never overwrite a wrapper installed later by another extension;
- be idempotent.

### Extension composition risk

Prototype wrappers can shadow one another depending on load order. Before release, test with at least one extension known to patch `Container` (for example `@pi-kaush/pi-tool-call-markers`). If safe composition cannot be guaranteed, document the conflict and fail open rather than introducing an undocumented shared protocol in v1.

## 8. Dependencies and toolchain

### Runtime dependencies

None.

Pi already provides the core extension packages. Per Pi's package guidance, list imported core packages as wildcard peers and do not bundle them:

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

Wildcard peers are intentional: Pi owns these runtime modules. Compatibility is enforced by adapter feature detection and CI, not by causing npm to install a second Pi copy.

### Latest reviewed development versions

Registry versions checked while refining this plan:

| Package | Version | Purpose |
|---|---:|---|
| `@earendil-works/pi-coding-agent` | `0.85.1` | extension types and compatibility tests |
| `@earendil-works/pi-tui` | `0.85.1` | TUI types/utilities and compatibility tests |
| `typescript` | `7.0.2` | type checking |
| `vitest` | `5.0.1` | unit tests |
| `@types/node` | `26.5.1` | Node types |

Use exact versions in `devDependencies` and commit `package-lock.json` for reproducible CI. Before creating the manifest, re-run:

```bash
npm view @earendil-works/pi-coding-agent version engines --json
npm view @earendil-works/pi-tui version --json
npm view typescript version engines --json
npm view vitest version engines --json
npm view @types/node version engines --json
```

If the registry has newer stable versions, update the table, manifest, and lockfile together, then run the full compatibility suite. Do not use prerelease tags.

Pi `0.85.1` requires Node `>=22.19.0`; Vitest `5.0.1` supports Node `^22.12.0 || ^24.0.0 || >=26.0.0`. Set:

```json
{
  "engines": {
    "node": ">=22.19.0"
  }
}
```

### Planned manifest

```json
{
  "name": "pi-tool-groups",
  "version": "0.1.0",
  "description": "Group adjacent Pi tool rows without replacing tools or native detailed renderers.",
  "type": "module",
  "license": "MIT",
  "sideEffects": false,
  "keywords": ["pi-package", "pi-extension", "tui", "tool-calls"],
  "files": ["src", "README.md", "LICENSE"],
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true }
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "0.85.1",
    "@earendil-works/pi-tui": "0.85.1",
    "@types/node": "26.5.1",
    "typescript": "7.0.2",
    "vitest": "5.0.1"
  },
  "engines": {
    "node": ">=22.19.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run typecheck && npm test",
    "package:check": "npm pack --dry-run"
  }
}
```

## 9. Delivery phases

### Phase 0 — compatibility probe

Create a project-local diagnostic extension that:

- imports `Container` and `ToolExecutionComponent` only from public package entry points;
- detects tool rows without changing output;
- validates the expected runtime fields against Pi `0.85.1`;
- probes built-in, custom, MCP, and subagent calls to determine which are represented by compatible `ToolExecutionComponent` rows;
- confirms live commands, restored sessions, failures, expanded mode, custom renderers, and theme-switch behavior.

Exit criterion: every supported row category is identified reliably without patching `ToolExecutionComponent`; settled failure state and text result blocks can be read without classifying error types or reading renderer-internal state, and any incompatible shape is left native.

### Phase 1 — pure grouping core

Implement and test segmentation for Read, Search, List, Write, Edit, Command, and generic Tool groups, including singleton groups, failed rows that remain in matching groups, running edit boundaries, and native fallback policy.

Exit criterion: no Pi imports in `grouping.ts`, and all grouping matrix tests pass.

### Phase 2 — read-only Container patch

Install the guarded wrapper and group only adjacent `read` rows. Delegate all other rows unchanged; edit remains native during this incremental phase.

Exit criteria:

- `read + read` groups in collapsed mode;
- a single read uses the same compact Read group presentation;
- edit output is byte-for-byte native during this phase;
- expanded mode ungroups every tool and uses Pi's native renderer;
- uninstall restores native rendering.

### Phase 3 — all tool kinds and live state

Add `grep`/`find`, `ls`, `write`, settled `edit`, `bash`/`powershell`, and generic custom/unknown/MCP/subagent summaries. Add singleton and image summaries, compact running command markers, generic bounded failure summaries, argument sanitization, minimal edit snapshots, and narrow-width handling.

Exit criteria:

- every compatible eligible tool has a compact collapsed summary;
- settled successful and failed edits group using path, replacement count, status, and at most one bounded error summary;
- running and expanded edits remain native;
- settled failed edits remain grouped even when their arguments are malformed, using the safe label `edit` when needed;
- failed rows remain in their semantic groups without error-type classification;
- running commands group without copying or tailing output;
- full error output remains only in Pi's native row state and returns on expansion;
- all rendering and lifecycle tests pass with no line-width violations.

### Phase 4 — compatibility and performance

Test:

- current latest stable Pi;
- the oldest Pi version explicitly claimed in the README, if any;
- regular and fullscreen TUI modes;
- `/reload`, `/new`, `/resume`, `/fork`, and quit;
- theme switching;
- long transcripts and rapid live updates;
- coexistence with common transcript-patching extensions.

Start without a cross-render cache. Add a settled-group cache only if benchmarks show measurable input/render latency. Any cache must key on width, current theme identity, member identity, arguments, completion/error state, and result version; running groups must bypass it.

### Phase 5 — package and release

- Write README architecture/security guarantees and incompatibility fallback.
- Include `pi-package` keyword.
- Run `npm run check` and `npm run package:check`.
- Inspect the tarball contents.
- Test with `pi -e .` and a clean `pi install ./path` flow.
- Publish `0.1.0` only after native-rendering regression checks pass.

## 10. Test plan

### Pure grouping matrix

| Input | Expected |
|---|---|
| `read` | ReadGroup(1) |
| `read read` | ReadGroup(2) |
| `read read grep` | ReadGroup(2), SearchGroup(1) |
| `grep find grep` | SearchGroup(3) |
| `ls ls` | ListGroup(2) |
| `write write` | WriteGroup(2) |
| `edit(success) edit(failed)` | EditGroup(2), failed item has minimal error |
| `edit(running)` | native edit |
| `edit(failed, malformed args)` | EditGroup(1), label `edit`, minimal error |
| `bash powershell` | CommandGroup(2) |
| `customA mcpB subagentC` | ToolGroup(3), retaining each tool name |
| `read bash` | ReadGroup(1), CommandGroup(1) |
| `read edit(success) read` | ReadGroup(1), EditGroup(1), ReadGroup(1) |
| `bash edit(running) powershell` | CommandGroup(1), native edit, CommandGroup(1) |
| `read read text read` | ReadGroup(2), native text, ReadGroup(1) |
| `read(success) read(failed) read(success)` | ReadGroup(3), failed item has minimal error |
| `bash(running) bash(success)` | CommandGroup(2) |
| `bash(success) bash(failed) bash(success)` | CommandGroup(3), failed item has minimal error |
| `read(image) read` | ReadGroup(2) |
| expanded tools, including edit | all native tool rows |
| expanded `read(image)` | native image renderer |

Also test invisible assistant components between otherwise adjacent visual rows.

### Renderer tests

- exact headings and pluralization;
- partial and complete markers;
- malformed/missing arguments;
- offsets, limits, paths, globs, patterns, commands, and working directories;
- write summaries never expose written content;
- edit summaries show only path, replacement count, status, and optional bounded error summary and never copy or expose edit text, diff, patch, or full result details;
- failed summaries use `●` with the theme's error color, a literal ` - ` separator, and the generic last-non-empty-line extraction rule;
- error summaries default to `Failed`, are capped at 512 Unicode code points, and obey terminal width;
- command summaries never expose full stdout/stderr, including failed commands;
- generic summaries retain tool names and safely serialize arguments;
- embedded newline/tab/control bytes;
- CSI and OSC escape-sequence stripping;
- Unicode and double-width characters;
- widths from 1 through 200 columns;
- every rendered line satisfies `visibleWidth(line) <= width`;
- theme is resolved again after a theme change.

### Adapter tests

Use fake component classes/prototypes to verify:

- install/uninstall idempotence;
- owner counting;
- no-tool fast path;
- one render per child per pass;
- whole-container fallback on classifier/renderer failure;
- no mutation of child arrays or row objects;
- a later third-party wrapper is not overwritten on uninstall;
- malformed private row state stays native;
- running and expanded edits preserve their original renderer and break groups;
- settled failed edits with malformed arguments use the safe label `edit` and remain grouped;
- settled successful and failed edit snapshots contain no `oldText`, `newText`, diff, patch, full result details, or full error output;
- failed built-in/custom/MCP/subagent rows remain in their semantic groups when their result shape validates;
- error extraction does not parse or classify tool-specific messages;
- incompatible failed result shapes stay native;
- expanded custom/MCP/subagent rows preserve their original renderers.

Add integration smoke tests against the installed latest Pi package for each available row category to catch private-field drift.

### Architecture test

Fail CI if `src/` contains prohibited model/agent mutation APIs, including:

```text
registerTool
setActiveTools
before_agent_start
tool_call
tool_result
sendMessage
sendUserMessage
appendEntry
fetch(
child_process
spawn(
exec(
```

Also prohibit read-side harness coupling that Story Spine does not need:

```text
sessionManager
agent_start
agent_end
turn_start
turn_end
message_start
message_update
message_end
tool_execution_start
tool_execution_update
tool_execution_end
before_provider_request
before_provider_headers
after_provider_response
```

Allowlist imports, command registration for the static preview, and only the lifecycle events `session_start` and `session_shutdown`. This test enforces intent; it is not a security sandbox.

## 11. Acceptance criteria

Release v1 only when all of the following are true:

- Every compatible eligible collapsed tool, including a singleton, uses its compact semantic group presentation.
- A validated assistant work message and its exactly matched source-order tool rows render as one Story Spine scene with semantic action runs.
- Mixed Read/Edit/Command/etc. action runs remain under the same assistant scene without reordering.
- A no-tool thinking/work-note message may render as a note scene; pure final answers remain native.
- Expanded tools, running edits, incomplete ownership, and incompatible scene state restore the complete affected scene to native rendering.
- Story Spine uses no harness events, session reads, injected entries/messages, timers, or parallel transcript state.
- Adjacent `grep`/`find` calls merge into Search groups, and adjacent `bash`/`powershell` calls merge into Command groups.
- Custom, unknown, MCP, and subagent calls use generic Tool groups while retaining each tool name.
- Settled successful and failed edits use Edit groups containing only path, replacement count, status, and optional bounded error summary.
- Running and expanded edits remain byte-for-byte native for the same component state and width and break groups.
- Settled failed edits with malformed arguments remain grouped using the safe label `edit`.
- Edit snapshots and rendered output contain no `oldText`, `newText`, diff, patch, full result details, or full error output.
- Validated failed calls remain in their semantic groups and use an error-colored `●` plus one generic minimal message.
- Error handling never classifies errors or parses tool-specific status formats.
- Error summaries use the last non-empty sanitized text line, default to `Failed`, and are capped at 512 Unicode code points before width truncation.
- Running commands use compact running markers without copying or tailing output.
- Write summaries never show written content; successful command and generic summaries never show result contents; failed summaries show only the bounded error summary.
- Image-producing calls use compact path/status summaries while collapsed and Pi's native image renderer when expanded.
- Expanded mode ungroups every tool and uses the original native renderer.
- No built-in or custom tool is registered, replaced, removed, or modified.
- Session messages, model context, tool results, active tools, and token usage are unchanged.
- The extension performs no network calls, filesystem writes, subprocess execution, timers, or background work.
- Every output line respects terminal width and strips unsafe controls.
- `/reload` and all session replacement flows do not stack or leak patches.
- Unsupported Pi internals fail open to the native transcript.
- Removing the extension restores native behavior immediately after reload/restart.

## 12. Known risks and mitigations

| Risk | Mitigation |
|---|---|
| Pi private fields change | Isolate in adapter, validate shape, CI against latest Pi, fail open |
| Global `Container` patch affects unrelated containers | Fast-path unless direct children contain validated tool rows |
| Another extension patches the same prototype | Conservative restore, compatibility tests, document conflicts |
| Full failed output hidden while collapsed | Show one generic error-colored summary line; global expansion restores Pi's complete native diagnostics |
| Minimal message omits the most useful error context | Use a deterministic last-non-empty-line rule, retain no full output, and make expansion the source of complete diagnostics |
| Error messages vary by tool/version | Do not classify or parse error types; treat all validated failures identically |
| Edit preview or preview error hidden before execution | Keep every running edit native; group only after a final result settles |
| Large edit arguments/results duplicated by snapshots | Project only path, replacement count, status, and bounded error summary; never copy edit text, diff, patch, full result details, or full error output |
| Settled edit diff hidden while collapsed | Show path/replacement count/status; global expansion restores Pi's native edit diff or diagnostic renderer |
| Image content hidden in collapsed mode | Show path/status only; global expansion restores Pi's native image renderer |
| Live command output hidden while collapsed | Show command/running status in the `syntaxKeyword` color; global expansion restores Pi's native streaming renderer |
| Generic tool arguments are large or unfamiliar | Sanitize compact JSON, truncate to width, never include results, and restore native details on expansion |
| Sensitive values appear in tool arguments | The summary exposes no more argument data than the native call row, but documentation must warn that arguments are displayed; results and write content remain hidden |
| Terminal control injection through arguments | Strip display escapes/C0 controls and flatten newlines |
| Long transcript causes input lag | Render each child once/pass; benchmark before adding a bounded settled cache |
| Theme changes leave stale ANSI | Resolve theme at render time; avoid pre-baked persistent strings |
| Package installs a duplicate Pi runtime | Core packages are optional wildcard peers; exact copies are dev-only |

## 13. References

Implementation should be checked against the current versions of:

- Pi extension guide: `@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi TUI guide: `@earendil-works/pi-coding-agent/docs/tui.md`
- Pi package guide: `@earendil-works/pi-coding-agent/docs/packages.md`
- Native tool row implementation: `dist/modes/interactive/components/tool-execution.js`
- Interactive transcript assembly/expansion: `dist/modes/interactive/interactive-mode.js`
- Prior-art compatibility pattern: `@pi-kaush/pi-tool-call-markers`

## 14. One-line project brief

> Build a zero-runtime-dependency, pure-TUI Pi extension that presents each validated assistant work message and its exactly matched tool calls as a responsive Story Spine scene, reuses compact semantic tool groups and bounded failure summaries, preserves source order and native expanded/running-edit rendering, never subscribes to or mutates the harness/session pipeline, reads private transcript state through one guarded adapter, and fails open to Pi's original UI on any incompatibility.
