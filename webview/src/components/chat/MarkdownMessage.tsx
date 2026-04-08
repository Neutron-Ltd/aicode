import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

type CodeProps = React.HTMLAttributes<HTMLElement> & {
  node?: unknown;
};

function isInlineCode(
  className: string | undefined,
  raw: string
): boolean {
  const hasLang = /language-(\w+)/.exec(className || "");
  if (hasLang) return false;
  return !raw.includes("\n");
}

export function MarkdownMessage({
  content,
  onApplyCode,
  variant = "default",
}: {
  content: string;
  onApplyCode: (code: string) => void;
  /** `flush`: assistant turn — no card. `inline`: compact user bubble. */
  variant?: "default" | "flush" | "inline";
}): React.ReactElement {
  const rootClass =
    variant === "flush"
      ? "prose prose-mirror prose-sm max-w-none [&_p]:my-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_li]:my-0.5"
      : variant === "inline"
        ? "prose prose-mirror prose-sm max-w-none [&_p]:my-0 [&_p+_p]:mt-2"
        : "prose prose-mirror prose-sm max-w-none";

  return (
    <div className={rootClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }: CodeProps) => {
            const codeText = String(children).replace(/\n$/, "");
            const match = /language-(\w+)/.exec(className || "");
            if (!isInlineCode(className, codeText)) {
              const language = match ? match[1] : "text";
              return (
                <CodeBlock
                  language={language}
                  code={codeText}
                  onApply={onApplyCode}
                />
              );
            }
            return (
              <code
                className="rounded px-1 py-0.5 font-mono text-[0.9em]"
                style={{
                  backgroundColor: "var(--vscode-textCodeBlock-background, var(--vscode-editor-background))",
                  color: "var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground))",
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
