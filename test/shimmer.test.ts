import { expect, it } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { shimmerLines } from "../src/shimmer.ts";

it("preserves Markdown styling and hyperlinks, including wide and combining graphemes", () => {
  const accent = "\x1b[95m";
  const colors = ["\x1b[90m", "\x1b[36m", accent] as const;
  const open = "\x1b]8;;https://example.com\x1b\\";
  const close = "\x1b]8;;\x1b\\";
  const fg = "\x1b[38;2;21;90;120m";
  const lines = [` \x1b[3m${fg}${open}👩‍💻\x1b[2me\u0301${close}\x1b[23m\x1b[39m`];
  const [shiny] = shimmerLines(lines, { time: 360, colors });
  expect(shiny).toContain(`${accent}\x1b[22;1me\u0301${fg}\x1b[22m\x1b[2m${close}`);
  expect(shiny).toContain(`\x1b[3m${fg}${open}`);
  expect(stripTerminalSequences(shiny!)).toEqual(stripTerminalSequences(lines[0]!));
  expect(visibleWidth(shiny!)).toEqual(visibleWidth(lines[0]!));
  const unsupported = ["\x1b[2Jplain text"];
  expect(shimmerLines(unsupported, { time: 1000, colors })).toEqual(unsupported);
});

it("renders a dim base, muted shoulders, and a bold accent core", () => {
  const colors = ["\x1b[90m", "\x1b[36m", "\x1b[95m"] as const;
  const [line] = shimmerLines(["abcdefghijklmnop"], { time: 660, colors });
  expect(line).toContain(`${colors[0]}abc`);
  expect(line).toContain(`${colors[1]}def`);
  expect(line).toContain(`${colors[2]}\x1b[22;1mghi`);
  expect(line).toContain(`${colors[1]}jkl`);
  expect(line).toContain(`${colors[0]}mnop`);
});
