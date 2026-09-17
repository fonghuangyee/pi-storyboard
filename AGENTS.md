# AGENTS.md

## Project instructions

`pi-storyboard` is a presentation-only Pi extension. Before changing code, read [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md); it is the authoritative source of truth for the architecture, behavior, safety rules, compatibility assumptions, and verification requirements.

### Documentation is part of the implementation

- Update `docs/DEVELOPMENT.md` in the same change whenever behavior, architecture, ownership rules, fallback behavior, lifecycle handling, dependencies, supported Pi versions, preview fixtures, tests, packaging, or future work changes.
- Keep examples, module descriptions, acceptance criteria, and test matrices aligned with the code.
- Treat stale documentation as a defect, not as a follow-up task.
- Keep `README.md` reserved for concise Pi extension marketplace usage: what the extension does, installation, user-facing preview/features, compatibility, and links to development documentation. Do not move internal design history or maintainer procedures into it.
- Do not recreate the retired split documents in `docs/`; use `docs/DEVELOPMENT.md` as the single development document.

### Architecture boundaries

- Keep all private Pi/TUI component inspection and `Container.prototype.render` patching in `src/pi-adapter.ts`.
- Keep pure projection/grouping logic independent of Pi imports where the module design requires it.
- Preserve exact assistant-content source order and exact `toolCallId` ownership.
- Treat `StoryboardScene` as one assistant response plus its matched tools. The only permitted multi-scene visual composition is the explicitly validated settled empty/absent-thinking continuation; never infer an agent run from adjacency, timestamps, text, or private harness IDs.
- Fail open to Pi's original native renderer on ambiguity, incompatible shapes, expanded rows, invalid phases, hard session boundaries, or renderer errors.
- Never mutate Pi messages, components, tool calls, arguments, results, session entries, prompts, model settings, or context.
- Never register/replace tools or add model-facing behavior.
- Do not add network calls, filesystem writes, subprocesses, timers, background work, or session-file parsing.
- Keep collapsed summaries minimal: no successful result output, write content, command output, image data, edit text/diffs/patches, provider payloads, or full errors.

### Working tree and edits

- Inspect `git status` and existing diffs before editing; preserve unrelated user work.
- Prefer focused edits. Do not reformat or rewrite unrelated source.
- Add regression tests for behavior changes, especially native fallback and width/ownership edge cases.
- Update preview fixtures when the visible contract changes.

### Required verification

Run before completing a change:

```bash
npm run check
```

For package, README, manifest, dependency, or publish changes, also run:

```bash
npm run package:check
```

Review `git diff` afterward and confirm the implementation, tests, `docs/DEVELOPMENT.md`, and `README.md` tell the same story.
