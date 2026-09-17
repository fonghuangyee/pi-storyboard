# pi-tool-groups

A presentation-only Pi extension that groups collapsed native tool rows and renders validated active-path work turns as source-ordered storyboards.

- Every compatible tool is eligible, including built-ins, custom tools, MCP tools, and subagents.
- Semantic groups include Read, Search, List, Write, Edit, Command (`bash`/`powershell`), and generic Tool.
- Collapsed running edits use compact pending rows containing at most their validated path; completed edits add the replacement count, while edit text and diffs are never copied into summaries.
- Expanded edits remain fully native, and settled failed edits may be grouped with a minimal error summary.
- Failed rows use the same `●` marker in the active Pi theme's error color; only one bounded sanitized error line is shown.
- Group summaries never include successful tool-result contents, written file contents, command output, or generic tool output; failures include only the minimal error line.
- Group blocks preserve Pi's native one-line top spacer so they remain visually separated from the preceding tool or message.
- Native thinking starts a visual turn block (`◉` with tools, `○` for a note); thinking markers use the running color while the assistant is active and the success color once settled, independent of tool outcomes. Source-ordered child action runs use `├─`, and `╰─` explicitly closes the final child.
- Each storyboard normally corresponds to one validated Pi “assistant response + tool calls” turn. A narrow visual continuation may attach immediately adjacent validated empty/absent-thinking tool turns to the previous visible-thinking root; ownership is never merged.
- Empty/absent thinking does not create fake thinking content; an adjacent validated turn continues under the previous visible-thinking root, while a leading tool-only turn promotes its first observable action to `◉`. A commentary-suffix placeholder exception is documented below.
- Validated `commentary` text breaks out at full native width in exact source order; `final_answer` and unknown text remain native, while any thinking paragraphs in a mixed no-tool response still receive their `○` start markers.
- Arguments are sanitized and width-truncated using Pi's TUI utilities; long rows use a middle ellipsis so path beginnings and filenames remain visible.
- Grouped paths are rendered as plain text to avoid terminal-specific OSC 8 hyperlink decoration.
- Every row uses `●`; success uses `success`, running uses the distinct blue `syntaxKeyword` color, and failure uses `error`.
- Command rows show Pi's elapsed/took suffix when Pi exposes valid timing state; no duration is invented when it does not.
- The extension does not use the agent loop, mutate messages, persist entries, use the network, filesystem, subprocesses, timers, or background work. Its optional session index reads only public active-path APIs and retains minimal ephemeral IDs/boundaries.

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

In interactive TUI mode, run `/tool-groups-preview` to open the gallery. It includes the current grouped-tool presentation, the approved turn-storyboard preview, a transcript-tail replay built from real Pi assistant/tool components, and the public `pi-tui` components used by the extension. Select `Turn storyboard` for the fixed visual reference or `Transcript replay` to inspect the supplied-session cases. Press `Tab` to enter the preview, then use `↑↓` or PageUp/PageDown to browse. Use `Tab`/`←`/`→` to switch panels, and `Esc` to close. See [`docs/TRANSCRIPT_ANALYSIS.md`](docs/TRANSCRIPT_ANALYSIS.md) for the session findings.

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

A source-ordered storyboard preserves turn ownership without inventing a persisted master record:

```text
 ◉ Inspecting the existing row shape
 │
 ╰─ Read 1 file
     ● src/renderer.ts

 The file confirms **native commentary** can remain in order.

 ◉ Applying the settled replacement
 ├─ Edit 1 time
     ● src/renderer.ts (1 replacement)
 ├─ Read 1 file
     ● docs/extensions.md
 ╰─ Run 1 command
     ● npm test
```

`◉` marks the root of one thinking-led turn, `○` marks an additional thinking block within that turn, `├─` a child with more source-ordered content following, `╰─` the final child, and `●` the existing per-tool status. Thinking dots use the thinking lifecycle color: running blue while the assistant is active and success green once settled; they do not reflect tool failures. Tool-row dots retain their individual running/success/error colors. Rails and branch glyphs remain muted structure. An immediately adjacent validated empty/absent-thinking turn may continue beneath the previous visible-thinking root, but the hierarchy remains presentation-only and never claims that one thought caused a later tool call.

### Commentary-suffix placeholder

For one validated response whose source order is `thinking → commentary → eligible tool calls`, commentary can be long, so it remains a full-width native block rather than being carried inside the earlier rail. The renderer inserts the existing fixed `Thinking...` presentation placeholder immediately before the orphan tool run:

```text
 ◉ Planning handler with effect for default config
 │
 The default `shipping_location` value is now populated on enable.

 ◉ Thinking...
 ╰─ Run 3 commands
     ● npm test
     ● npm run typecheck
     ● npx eslint ...
```

This placeholder is presentation-only: it is not added to Pi's message, session, model context, or native component tree, and it does not claim to reproduce hidden reasoning. It is used only when validated commentary is followed by eligible tool calls in the same response; final/unknown text, incompatible ownership, expanded tools, and separate turns remain native or follow the existing fallback rules.

When one continuous thinking block contains more than four paragraphs, the storyboard keeps the first two and last two and inserts `↳ 2 thinking steps behind the scenes` (with the exact hidden count). Commentary is never collapsed. Pi's native thinking row remains behind the normal thinking toggle, so this only trims the visible projection.

Pi's configured tool expansion action controls expanded mode. When expanded, the wrapper delegates every row to Pi's original renderer, including live command output, complete errors, edit diffs, and custom/MCP/subagent details. The assistant-message boundary supplies ordering and validated call IDs only. Final/unknown text itself and incomplete ownership remain native. A collapsed running edit stays compact; Pi's native preview remains available after explicit expansion. Mixed no-tool responses may decorate only their thinking starts. The commentary-suffix placeholder does not change expanded behavior or native fallback.

## Compatibility and fallback

Pi does not currently expose a public transcript grouping hook, so `src/pi-adapter.ts` contains one guarded private-API seam: a wrapper around `Container.prototype.render` that reads validated native tool-row state. `src/session-projection.ts` separately reads the public active session path and retains only immutable IDs and boundary flags. Neither path mutates Pi objects or child arrays.

Installation is feature-detected and idempotent. If Pi's classes, prototype, private fields, theme, group renderer, or child output do not match the expected shape, the complete container is rendered by Pi's original implementation. Uninstalling restores the exact original method unless another extension has replaced the wrapper in the meantime.

Prototype wrappers can conflict with other transcript-patching extensions depending on load order. The adapter never overwrites a later wrapper and fails open when its own wrapper is no longer active. Test combinations before enabling multiple transcript patches.

## Development

```bash
npm install
npm run check
npm run package:check
```

The package has no runtime dependencies; Pi's core packages are optional wildcard peers and exact versions are used only for development and compatibility tests.
