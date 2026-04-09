import React, { useMemo } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { usePrefersDark } from "../../hooks/usePrefersDark";

SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("html", markup);
SyntaxHighlighter.registerLanguage("xml", markup);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("py", python);

export interface CodeBlockProps {
  language: string;
  code: string;
  onApply?: (code: string) => void;
}

function normalizeLanguage(lang: string): string {
  const l = lang.toLowerCase().trim();
  const map: Record<string, string> = {
    ts: "typescript",
    "c++": "cpp",
    yml: "yaml",
  };
  return map[l] ?? l;
}

export function CodeBlock({
  language,
  code,
  onApply,
}: CodeBlockProps): React.ReactElement {
  const prefersDark = usePrefersDark();
  const style = prefersDark ? oneDark : oneLight;

  const lang = useMemo(() => {
    const n = normalizeLanguage(language || "text");
    const supported = [
      "tsx",
      "typescript",
      "javascript",
      "json",
      "bash",
      "css",
      "html",
      "xml",
      "markdown",
      "python",
    ];
    if (supported.includes(n)) return n;
    if (n === "text" || n === "plaintext") return "javascript";
    return "javascript";
  }, [language]);

  const handleApply = (): void => {
    if (onApply) {
      onApply(code);
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border transition-colors duration-200" style={{ borderColor: "color-mix(in srgb, var(--vscode-widget-border, #444) 45%, transparent)" }}>
      <div className="absolute right-1 top-1 z-10 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={handleApply}
          title="Apply this code to the active editor (replaces selection if any)"
          aria-label="Apply code to editor"
          className="rounded-md border border-indigo-500/35 bg-slate-800/90 px-2.5 py-1 text-[10px] font-semibold leading-tight text-indigo-200 shadow-sm backdrop-blur-sm transition-all duration-200 ease-out hover:border-indigo-400/45 hover:bg-slate-700/95 hover:text-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1 focus:ring-offset-slate-950"
        >
          Apply
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={style}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "0.75rem 0.875rem",
          paddingTop: "1.75rem",
          borderRadius: "0.5rem",
          fontSize: "11px",
          lineHeight: 1.45,
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--vscode-editor-font-family, monospace)",
          },
        }}
        showLineNumbers={false}
      >
        {code.replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
}
