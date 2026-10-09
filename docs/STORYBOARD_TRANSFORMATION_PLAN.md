# Transcript → storyboard transformation: implementation record

**Status: root-policy implementation complete; proposal retired. Interactive release verification remains pending.** Final behavior, ownership, fallback, and acceptance criteria are authoritative in [ARCHITECTURE.md](ARCHITECTURE.md), especially Sections 3.6, 4.4, 4.6, 9, and 12. The version-pinned persisted-record reference remains in [TRANSCRIPT_SCHEMA.md](TRANSCRIPT_SCHEMA.md).

## Incident and decision

Session `01a11e5e-3df5-7180-9d24-1a976a258c67` showed four legitimate leading responses with absent or signed-empty thinking. The former presentation promoted their first actions to roots. A schema could confirm those shapes but could not fix that visual contract.

The implemented choice is the fixed **`Thinking...` UI caption**, not generated reasoning. Eligible standalone source-empty tool scenes now have an explicit root above their branches. Consecutive tool-only responses remain separate scenes. Only the existing settled continuation anchored in genuine source thinking can remove later redundant roots.

## Implemented safety boundary

```text
Pi public selected entries + native children
  → minimal immutable metadata and exact ownership checks
  → one response per semantic scene, source-ordered tools
  → explicit pure synthetic root / native content / action chapters
  → width-safe native-compatible layout, or original native fallback
```

- `thinkingPresence` distinguishes absent, empty, and genuine non-empty source reasoning without retaining signatures or payloads.
- `synthetic-scene-root` records only its scene and reason; the commentary-suffix node stays distinct.
- Source-empty scene/work-span/legacy/preview rendering uses the same pure root policy. Render-hidden real reasoning retains Pi's native semantics.
- Roots are inert UI; they have no fabricated source content index, tool ID, provider signature, native thinking child, or model/session entry.
- Exact call IDs, original source order, ownership completeness, hard boundaries, expansion, and renderer failures remain authoritative.
- Leading commentary stays full-width before the root; incompatible shapes without source-order extraction remain native.
- No runtime schema loading, session-file parsing, networking, subprocesses, timers, execution, or model-facing behavior was added.

## Completed automated work

- Version-pinned schema reference and sanitized structural incident fixture.
- Pure root reasons, source-empty/whitespace cases, separate scenes, no synthetic continuation anchors, scene/work-span parity, lifecycle colors, and widths 1–200.
- Fixed synthetic native-component replay of four response shapes and eleven tools, with reversed result completion and invisible custom-state positions.
- Native replay coverage for empty signed/redacted/whitespace thinking, full-width leading commentary, running-to-failed settlement, native thinking-toggle mouse translation after inert roots, expansion/collapse, projection replacement/invalidation, visible native interruption, and original renderer fallback on compact-render errors.
- Production-policy preview fixtures for signed-empty, leading-commentary, running-tool-only, and failed-tool-only cases, plus the incident in Transcript replay.
- Architecture and concise marketplace documentation aligned with implementation.

This does not make the open-ended Pi schema or private TUI seam universally compatible. Schema validation cannot prove branch selection, source/native correspondence, call ownership, or safe rendering. Unknown/incompatible shapes still fail open rather than being forced into a storyboard.

## Remaining manual release gate

The automated native replay uses installed development Pi `0.85.1`. The transcript does not record the user's producer package version, extension settings, or private component shapes. No verification of that exact live environment is claimed.

Before release, record interactive checks for:

- actual streaming → tool updates → results → settlement;
- global expansion/collapse, thinking toggle, mouse links/targets, narrow resize, and theme changes;
- reload/resume/fork/tree/new-session/compaction and older still-visible native rows;
- coexistence with another transcript patcher;
- the supplied incident's four eligible scenes showing roots without invented thought text or changed tool counts.

Run `npm run check` and `npm run package:check`, inspect the diff and package contents, and retain native fallback wherever proof fails. Passing automated checks is not a substitute for these interactive release gates.
