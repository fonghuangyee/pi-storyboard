const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const ANSI_C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const ANSI_C1_OSC = /\u009d[\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;
const ANSI_STRING = /\u001b(?:P|X|\^|_)[\s\S]*?(?:\u0007|\u001b\\)/g;
const ANSI_C1_STRING = /[\u0090\u0098\u009e\u009f][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;
const ANSI_OTHER = /\u001b(?:[()][0-2A-Z]|[0-9A-Z=><]|\\)/g;

/**
 * Make model-controlled text safe to put in a terminal line. Newlines and
 * tabs become spaces so a single summary item remains a single display line.
 */
export function sanitizeDisplay(value: string): string {
  return value
    .replace(ANSI_OSC, "")
    .replace(ANSI_C1_OSC, "")
    .replace(ANSI_STRING, "")
    .replace(ANSI_C1_STRING, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_C1_CSI, "")
    .replace(ANSI_OTHER, "")
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f]/gu, (character) =>
      character === "\n" || character === "\r" || character === "\t" ? " " : "",
    )
    .replace(/[\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
