import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installToolGroupingPatch, type PatchHandle } from "./pi-adapter.ts";
import { renderToolGroup } from "./renderer.ts";
import { TuiPreview } from "./tui-preview.ts";

/**
 * Presentation-only extension entry point. Nothing is installed outside the
 * interactive TUI, and session replacement/reload gets a fresh handle.
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

  pi.on("session_start", (_event, ctx) => {
    patch?.uninstall();
    patch = undefined;
    if (ctx.mode !== "tui") return;

    patch = installToolGroupingPatch({
      getTheme: () => ctx.ui.theme,
      renderGroup: (group, width, theme) => renderToolGroup(group, width, theme),
    });
  });

  pi.on("session_shutdown", () => {
    patch?.uninstall();
    patch = undefined;
  });
}
