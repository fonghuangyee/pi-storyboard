# pi-tool-groups

A presentation-only Pi extension that groups adjacent native tool rows and presents validated assistant/tool ownership as a Story Spine while they are collapsed.

- Every compatible tool is eligible, including built-ins, custom tools, MCP tools, and subagents.
- Semantic groups include Read, Search, List, Write, Edit, Command (`bash`/`powershell`), and generic Tool.
- Completed successful edits show only their path and replacement count; edit text and diffs are never copied into summaries.
- Running and expanded edits stay Pi-native so previews and diffs remain available; settled failed edits may be grouped with a minimal error summary.
- Failed rows use the same `●` marker in the active Pi theme's error color; only one bounded sanitized error line is shown.
- Group summaries never include successful tool-result contents, written file contents, command output, or generic tool output; failures include only the minimal error line.
- Group blocks preserve Pi's native one-line top spacer so they remain visually separated from the preceding tool or message.
- Story Spine scenes replay native thinking/text runs and contiguous tool groups in the assistant message's exact `content` order; a thinking/text block ends the current tool run.
- Arguments are sanitized and width-truncated using Pi's TUI utilities; long rows use a middle ellipsis so path beginnings and filenames remain visible.
- Grouped paths are rendered as plain text to avoid terminal-specific OSC 8 hyperlink decoration.
- Every row uses `●`; success uses `success`, running uses the distinct blue `syntaxKeyword` color, and failure uses `error`.
- Command rows show Pi's elapsed/took suffix when Pi exposes valid timing state; no duration is invented when it does not.
- The extension does not use the agent loop, session messages, network, filesystem, subprocesses, timers, or background work.

## Install

For a local checkout:

```bash
pi -e ./src/index.ts
```

As a Pi package:

```bash
pi install ./path/to/pi-tool-groups
```

## Preview

In interactive TUI mode, run `/tool-groups-preview` to open the gallery. It includes the current grouped-tool presentation, the approved Story Spine preview, a transcript-tail replay built from real Pi assistant/tool components, and the public `pi-tui` components used by the extension. Select `Storyboard / Spine` for the fixed visual reference or `Transcript replay` to inspect the supplied-session cases. Press `Tab` to enter the preview, then use `↑↓` or PageUp/PageDown to browse. Use `Tab`/`←`/`→` to switch panels, and `Esc` to close. See [`docs/TRANSCRIPT_ANALYSIS.md`](docs/TRANSCRIPT_ANALYSIS.md) for the session findings.

## Display

Collapsed eligible rows become one unified compact presentation, including singleton rows:

```text
Read 1 file
  ● src/a.ts

Read 3 files
  ● src/b.ts (offset 80, limit 40)
  ● src/c.ts

Search 1 time
  ● grep "UserService" in src/

Edit 2 times
  ● src/a.ts (2 replacements)
  ● src/b.ts (1 replacement)

Run 2 commands
  ● npm test (took 1.5s)
  ● git status (elapsed 0.2s)

Run 2 tools
  ● custom-tool {"target":"src"}
  ● mcp.lookup {"id":42}
```

```text
Run 1 command
  ● npm run check - Command exited with code 1
```

A source-ordered assistant message keeps native thinking runs around its
contiguous tool groups:

```text
 ◉  Inspecting the existing row shape                 2 actions
   │
   ├─ Read 1 file
   │  ● src/renderer.ts
   │
   │  Applying the settled replacement
   │
   ╰─ Edit 1 time
      ● src/renderer.ts (1 replacement)
```

Pi's configured tool expansion action controls expanded mode. When expanded, the wrapper delegates every row to Pi's original renderer, including live command output, complete errors, edit diffs, and custom/MCP/subagent details. Validated assistant work messages own their matching tool groups in the Story Spine, and native thinking/text runs remain at their source positions around those groups; plain final answers, incomplete ownership, and running/expanded edits remain native.

## Compatibility and fallback

Pi does not currently expose a public transcript grouping hook, so `src/pi-adapter.ts` contains one guarded private-API seam: a wrapper around `Container.prototype.render` that reads validated native tool-row state. It snapshots state without mutating Pi objects or child arrays.

Installation is feature-detected and idempotent. If Pi's classes, prototype, private fields, theme, group renderer, or child output do not match the expected shape, the complete container is rendered by Pi's original implementation. Uninstalling restores the exact original method unless another extension has replaced the wrapper in the meantime.

Prototype wrappers can conflict with other transcript-patching extensions depending on load order. The adapter never overwrites a later wrapper and fails open when its own wrapper is no longer active. Test combinations before enabling multiple transcript patches.

## Development

```bash
npm install
npm run check
npm run package:check
```

The package has no runtime dependencies; Pi's core packages are optional wildcard peers and exact versions are used only for development and compatibility tests.
