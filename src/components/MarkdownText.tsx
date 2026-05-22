/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  text: string;
  className?: string;
}

const COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-bold text-[#c1a067]">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-gray-200">{children}</em>
  ),
  del: ({ children }) => (
    <del className="line-through text-gray-500">{children}</del>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-2 space-y-1 marker:text-[#c1a067]/70">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-2 space-y-1 marker:text-[#c1a067]/70">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-[#c1a067] mt-3 mb-1.5">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold text-[#c1a067] mt-3 mb-1.5">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-bold text-[#c1a067] mt-2 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-gray-200 mt-2 mb-1">
      {children}
    </h4>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-l-[#10b981] pl-3 my-2 text-gray-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[#c1a067]/20" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[#10b981] underline hover:text-[#c1a067]"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /\n/.test(String(children));
    if (isBlock) {
      return (
        <pre className="bg-black/50 border border-gray-800 rounded p-3 my-2 overflow-x-auto custom-scrollbar text-xs">
          <code className="font-mono text-gray-200" {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code
        className="bg-black/50 border border-gray-800 rounded px-1 py-0.5 font-mono text-[0.85em] text-[#c1a067]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto custom-scrollbar">
      <table className="text-xs border-collapse border border-gray-800">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-black/40">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-gray-800 px-2 py-1 text-left font-semibold text-[#c1a067]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-800 px-2 py-1 text-gray-300">
      {children}
    </td>
  ),
};

export default function MarkdownText({ text, className }: MarkdownTextProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
