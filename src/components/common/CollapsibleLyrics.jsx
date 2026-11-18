"use client";

import React, { useState } from "react";
import { FiChevronDown, FiFileText, FiCopy, FiCheck } from "react-icons/fi";

export default function CollapsibleLyrics({ lyrics, title = "Song Lyrics", defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  if (!lyrics || typeof lyrics !== "string" || !lyrics.trim()) {
    return null;
  }

  const trimmedLyrics = lyrics.trim();

  const handleCopy = (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(trimmedLyrics);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 dark:border-gray-800 dark:bg-white/[0.02] overflow-hidden transition-colors duration-200">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100/70 dark:hover:bg-white/[0.04] transition cursor-pointer"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
            <FiFileText size={14} />
          </div>
          <span className="truncate">{title}</span>
          {!isOpen && (
            <span className="hidden sm:inline-block text-[11px] font-normal text-gray-400 dark:text-gray-500 truncate max-w-[280px]">
              — {trimmedLyrics.replace(/\n+/g, " ").substring(0, 50)}...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[11px] font-medium text-brand-600 dark:text-brand-400">
            {isOpen ? "Hide Lyrics" : "Show Lyrics"}
          </span>
          <FiChevronDown
            size={16}
            className={`text-gray-400 dark:text-gray-500 transition-transform duration-300 ease-in-out ${
              isOpen ? "rotate-180 text-brand-600 dark:text-brand-400" : ""
            }`}
          />
        </div>
      </button>

      {/* Smooth CSS Grid Accordion Transition */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-3.5 pb-3.5 pt-1 border-t border-gray-200/60 dark:border-gray-800/60 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 pt-1">
              <span>Database Lyrics:</span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition cursor-pointer"
              >
                {copied ? <FiCheck size={12} className="text-emerald-500" /> : <FiCopy size={12} />}
                <span>{copied ? "Copied!" : "Copy Lyrics"}</span>
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg bg-white p-3 border border-gray-200/80 text-xs font-sans text-gray-800 leading-relaxed whitespace-pre-wrap dark:bg-gray-900/60 dark:border-gray-800 dark:text-gray-200">
              {trimmedLyrics}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
