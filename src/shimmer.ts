import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

const foreground = /^(?:3[0-7]|9[0-7]|38;(?:5;\d+|2;\d+;\d+;\d+))$/u;
const sgr = (params: string): string => `\x1b[${params}m`;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type ShimmerFrame = {
  readonly time: number;
  readonly colors: readonly [dim: string, muted: string, accent: string];
};

/** Zentui Classic's dim base, soft shoulders and bold core, applied after layout. */
export function shimmerLines(lines: readonly string[], frame: ShimmerFrame, prefixWidth = 0): readonly string[] {
  const palette = frame.colors.map((color) => color.match(/^(\x1b\[([\d;]+)m)(?:\x1b\[2m)?$/u));
  if (palette.some((match) => !match || !foreground.test(match[2]!))) return lines;

  const windows = lines.map((line) => {
    const plain = stripTerminalSequences(line);
    const start = Math.max(prefixWidth, visibleWidth(plain) - visibleWidth(plain.trimStart()));
    return { start, length: Math.max(0, visibleWidth(plain.trimEnd()) - start) };
  });
  const length = windows.reduce((sum, window) => sum + window.length, 0);
  if (length === 0) return lines;
  const center = Math.floor(frame.time / 60) % (length + 8) - 4;
  let offset = 0;
  return lines.map((line, index) => {
    const { start, length } = windows[index]!;
    const localCenter = center - offset + start;
    offset += length;
    if (length === 0) return line;

    // Accept native SGR, hyperlinks and Pi's shell-integration zones only.
    const tokens = line.split(/(\x1b\[[\d;]*m|\x1b\](?:8|133);[^\x00-\x1f\x7f-\x9f]*(?:\x07|\x1b\\))/u);
    let restore = sgr("39");
    let bold = false;
    let faint = false;
    let column = 0;
    let output = "";
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (i % 2 === 1) {
        if (token.startsWith("\x1b[")) {
          const params = token.slice(2, -1).split(";");
          for (let j = 0; j < params.length; j++) {
            const param = params[j]!;
            if (param === "" || param === "0") {
              restore = sgr("39");
              bold = faint = false;
            } else if (param === "39") restore = sgr("39");
            else if (param === "1") bold = true;
            else if (param === "2") faint = true;
            else if (param === "22") bold = faint = false;
            else if (param === "38" || param === "48" || param === "58") {
              const count = params[j + 1] === "5" ? 2 : params[j + 1] === "2" ? 4 : 0;
              if (count === 0 || j + count >= params.length) return line;
              if (param === "38") restore = sgr(params.slice(j, j + count + 1).join(";"));
              j += count;
            } else if (foreground.test(param)) restore = sgr(param);
          }
        }
        output += token;
        continue;
      }
      if (/[\x00-\x1f\x7f-\x9f]/u.test(token)) return line;
      let tier = -1;
      const endTier = (): string => tier < 0 ? "" : restore + (
        tier === 2 ? sgr("22") + (bold ? sgr("1") : "") + (faint ? sgr("2") : "") : ""
      );
      for (const { segment } of segmenter.segment(token)) {
        const width = visibleWidth(segment);
        const distance = Math.abs(column + Math.max(0, width - 1) / 2 - localCenter);
        const next = column < start || column >= start + length ? -1 : distance <= 1 ? 2 : distance <= 4 ? 1 : 0;
        if (tier !== next) {
          output += endTier();
          tier = next;
          if (tier >= 0) output += palette[tier]![1]! + (tier === 2 ? sgr("22;1") : "");
        }
        output += segment;
        column += width;
      }
      output += endTier();
    }
    return output;
  });
}
