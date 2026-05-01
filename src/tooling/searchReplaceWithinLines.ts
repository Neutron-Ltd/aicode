/**
 * Pure helpers so search_replace line-window logic can be unit-tested without vscode.
 * Line breaks follow JS split semantics close to vscode: LF and CRLF counted as newline.
 */

export function oneBasedLineContainingOffset(text: string, offset: number): number {
  const pos = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let i = 0;
  while (i < pos) {
    const ch = text.charCodeAt(i);
    if (ch === 10) {
      line++;
      i++;
      continue;
    }
    if (ch === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        i += 2;
      } else {
        i++;
      }
      line++;
      continue;
    }
    i++;
  }
  return line;
}

/**
 * Keeps occurrences of `needle` whose start and inclusive end offsets lie fully inside
 * [startLineInclusive, endLineInclusive] (1-based, inclusive).
 */
export function filterOffsetsFullyWithinLineRange(
  text: string,
  needleLen: number,
  offsets: readonly number[],
  startLineInclusive: number,
  endLineInclusive: number
): number[] {
  if (needleLen === 0) {
    return [];
  }
  return offsets.filter((off) => {
    if (off < 0 || off + needleLen > text.length) {
      return false;
    }
    const lastCharIdx = off + needleLen - 1;
    const startLn = oneBasedLineContainingOffset(text, off);
    const endLn = oneBasedLineContainingOffset(text, lastCharIdx);
    return startLn >= startLineInclusive && endLn <= endLineInclusive;
  });
}

export function formatFileWithLineNumbers(fullText: string, lineEnding: "\n" | "\r\n" = "\n"): string {
  const lines = splitDocumentLinesPreserveEmpty(fullText);
  const width = Math.max(4, String(Math.max(lines.length, 1)).length);
  const header =
    "(Prefix format: whitespace-padded line number, then '|', then raw file content. Omit that prefix entirely when building search_replace.old_string. Use these line numbers with within_lines and write_file ranges.)";
  const body = lines.map((lineText, idx) => {
    const num = String(idx + 1).padStart(width, " ");
    return `${num}|${lineText}`;
  });
  return [header, ...body].join(lineEnding);
}

/** Mirrors typical editor line splitting (LF / CRLF / lone CR). */
export function splitDocumentLinesPreserveEmpty(text: string): string[] {
  if (text.length === 0) {
    return [""];
  }
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10) {
      out.push(cur);
      cur = "";
      continue;
    }
    if (ch === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        out.push(cur);
        cur = "";
        i++;
        continue;
      }
      out.push(cur);
      cur = "";
      continue;
    }
    cur += String.fromCharCode(ch);
  }
  out.push(cur);
  return out;
}
