import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installToolGroupingPatch, type PatchHandle } from "./pi-adapter.ts";
import { renderToolGroup } from "./renderer.ts";
import { TuiPreview } from "./tui-preview.ts";
import { buildSessionProjection, type SessionProjection } from "./session-projection.ts";

/**
 * Presentation-only extension entry point. The renderer is installed only in
 * the interactive TUI; session replacement/reload gets a fresh handle.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("tool-groups-preview", {
    description: "Preview tool groups and available pi-tui components",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/tool-groups-preview is only available in interactive TUI mode", "warning");
        return;
      }

      await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
        new TuiPreview(tui, theme, () => done(undefined), ctx.cwd),
      );
    },
  });

  let patch: PatchHandle | undefined;
  let invalidateProjection: () => void = () => undefined;

  const invalidate = (): void => invalidateProjection();
  pi.on("message_end", invalidate);
  pi.on("turn_end", invalidate);
  pi.on("agent_end", invalidate);
  pi.on("agent_settled", invalidate);
  pi.on("tool_execution_end", invalidate);
  pi.on("session_compact", invalidate);
  pi.on("session_compact_failed", invalidate);
  pi.on("session_tree", invalidate);
  pi.on("session_before_switch", invalidate);
  pi.on("session_before_fork", invalidate);
  pi.on("session_before_tree", invalidate);

  pi.on("session_start", (_event, ctx) => {
    patch?.uninstall();
    patch = undefined;
    invalidateProjection = () => undefined;
    if (ctx.mode !== "tui") return;

    const sessionManager = ctx.sessionManager;
    let dirty = true;
    let projection: SessionProjection | undefined;
    invalidateProjection = () => {
      dirty = true;
      projection = undefined;
    };
    const getSessionProjection = (): SessionProjection | undefined => {
      if (!dirty) return projection;
      dirty = false;
      try {
        // `buildContextEntries()` is the active-path snapshot. Do not read the
        // manager's leaf in a second call: a triggerTurn custom message (for
        // example pi-web-access's content-ready notification) can advance the
        // leaf between those reads and make an otherwise valid snapshot look
        // malformed. The final entry is the leaf for this exact snapshot.
        const entries = sessionManager.buildContextEntries();
        const snapshotLeafId = entries.at(-1)?.id ?? null;
        projection = buildSessionProjection({
          entries,
          leafId: snapshotLeafId,
        });
      } catch {
        projection = undefined;
      }
      return projection;
    };

    patch = installToolGroupingPatch({
      getTheme: () => ctx.ui.theme,
      renderGroup: (group, width, theme) => renderToolGroup(group, width, theme),
      getSessionProjection,
    });
  });

  pi.on("session_shutdown", () => {
    patch?.uninstall();
    patch = undefined;
    invalidateProjection = () => undefined;
  });
}
