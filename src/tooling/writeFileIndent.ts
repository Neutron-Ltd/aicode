/** Split replacement text without spurious trailing empty slice from terminal newline (`a\nb\n` → ["a","b"]). */
export function normalizeModelLinesForMerge(modelContent: string): string[] {
  const parts = modelContent.split(/\r?\n/);
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

const LEAD_WS = /^[\t ]*/;

function leadingWhitespace(line: string): string {
  return line.match(LEAD_WS)?.[0] ?? "";
}

/**
 * When `replaceCount` equals the number of model lines after trim, copy each replaced line's
 * leading indentation from the corresponding file snapshot and overwrite only trimmed body text.
 * Eliminates doubled indent when models nest snippets under a opener line that used `write_file`.
 *
 * Returns `null` when line counts mismatch — caller falls back to `normalizeReplacementIndent`.
 */
export function mergeWriteReplacementWithDocumentIndents(
  existingLinesInRange: readonly string[],
  modelContent: string
): string | null {
  const modelLines = normalizeModelLinesForMerge(modelContent);
  if (modelLines.length !== existingLinesInRange.length || modelLines.length === 0) {
    return null;
  }

  const outLines = modelLines.map((modelLine, k) => {
    const indent = leadingWhitespace(existingLinesInRange[k] ?? "");
    const body = modelLine.replace(/^[\t ]*/, "");
    return indent + body;
  });

  return outLines.join("\n");
}
