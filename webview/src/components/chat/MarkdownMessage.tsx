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
}: {
  content: string;
  onApplyCode: (code: string) => void;
}): React.ReactElement {
  return (
    <div className="prose prose-mirror prose-sm max-w-none">
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
                className="rounded bg-mirror-code-bg px-1 py-0.5 font-mono text-[0.9em] text-mirror-code-fg"
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
