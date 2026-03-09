"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check, Copy, User, Bot } from "lucide-react";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

function CodeBlock({ className, children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1] ?? "";
  const code = String(children).replace(/\n$/, "");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  if (!className) {
    // Inline code
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted/80 text-[12px] font-mono text-foreground/90" {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className="group relative my-3 rounded-lg overflow-hidden border border-border/30 bg-[#0d1117]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-border/20">
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground/80 transition-colors"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed">
        <code className={cn("font-mono", className)} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export function MessageBubble({ role, content, streaming }: MessageBubbleProps) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5">
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
            {content}
          </div>
        </div>
        <div className="flex items-start pt-0.5">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex items-start pt-0.5">
        <div className="w-7 h-7 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
          <Bot className="h-3.5 w-3.5 text-violet-500" />
        </div>
      </div>
      <div className="flex-1 min-w-0 max-w-[90%]">
        <div className="prose prose-sm dark:prose-invert prose-pre:p-0 prose-pre:m-0 prose-pre:bg-transparent prose-code:before:content-[''] prose-code:after:content-[''] max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock,
              p: ({ children }) => (
                <p className="text-[13px] leading-relaxed text-foreground/90 mb-2 last:mb-0">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="text-[13px] leading-relaxed list-disc pl-4 mb-2 space-y-1 text-foreground/90">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="text-[13px] leading-relaxed list-decimal pl-4 mb-2 space-y-1 text-foreground/90">{children}</ol>
              ),
              a: ({ children, href }) => (
                <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-primary/30 pl-3 text-muted-foreground italic my-2">
                  {children}
                </blockquote>
              ),
              h1: ({ children }) => <h1 className="text-lg font-semibold mt-4 mb-2">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1.5">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
              table: ({ children }) => (
                <div className="overflow-x-auto my-2">
                  <table className="text-xs border-collapse w-full">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-border/30 px-2 py-1 bg-muted/30 text-left font-medium">{children}</th>
              ),
              td: ({ children }) => (
                <td className="border border-border/30 px-2 py-1">{children}</td>
              ),
              hr: () => <hr className="border-border/30 my-3" />,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        {streaming && (
          <span className="inline-block w-2 h-4 bg-violet-500 rounded-sm animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
}
