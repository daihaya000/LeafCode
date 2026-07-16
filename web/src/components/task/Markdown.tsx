"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md min-w-0 max-w-full text-[0.925rem]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
});
