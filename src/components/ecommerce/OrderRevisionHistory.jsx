"use client";

import React, { useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import { FiClock, FiMusic, FiVideo, FiChevronDown, FiChevronUp, FiDownload, FiFileText, FiUser, FiCheckCircle } from "react-icons/fi";
import ForceDownloadButton from "@/components/common/ForceDownloadButton";

export default function OrderRevisionHistory({
  revisions = [],
  currentVersion = 1,
  activeAudioUrl = "",
  activeVideoUrl = "",
  activeLyrics = "",
  orderTitle = "Custom Song",
}) {
  // Deduplicate revisions by version so duplicate keys and entries never occur
  const uniqueRevisionsMap = new Map();
  (revisions || []).forEach((r) => {
    if (!r) return;
    const v = r.version || 1;
    uniqueRevisionsMap.set(v, r);
  });
  const sortedRevisions = Array.from(uniqueRevisionsMap.values()).sort((a, b) => (b.version || 0) - (a.version || 0));
  const latestVer = currentVersion || sortedRevisions[0]?.version || 1;

  // Initialize with the latest version expanded by default
  const [expandedVersions, setExpandedVersions] = useState({
    [latestVer]: true,
  });

  const toggleVersion = (vNum) => {
    setExpandedVersions((prev) => {
      const currentVal = prev[vNum] !== undefined ? prev[vNum] : (vNum === latestVer);
      return {
        ...prev,
        [vNum]: !currentVal,
      };
    });
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] space-y-4">
      <div className="border-b border-gray-100 dark:border-gray-800 pb-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
              <FiClock size={15} />
            </div>
            <h4 className="text-sm font-bold text-gray-800 dark:text-white/90 truncate">
              Version &amp; Revision History
            </h4>
          </div>

          <Badge size="sm" color="success" className="shrink-0">
            <span className="flex items-center gap-1 font-mono text-xs">
              <FiCheckCircle size={12} /> Active: v{currentVersion || (sortedRevisions[0]?.version || 1)}
            </span>
          </Badge>
        </div>

        <div className="flex items-center justify-between text-[11px] text-gray-500 pl-9">
          <span>Track of delivered revisions</span>
          {sortedRevisions.length > 0 && (
            <span className="font-medium text-gray-400 font-mono shrink-0">
              ({sortedRevisions.length} {sortedRevisions.length === 1 ? "revision" : "revisions"})
            </span>
          )}
        </div>
      </div>

      {sortedRevisions.length === 0 ? (
        <div className="text-xs text-gray-400 py-3 italic">
          No previous revision recorded. Current delivery is Version 1 (Initial Release).
        </div>
      ) : (
        <div className="space-y-3">
          {sortedRevisions.map((rev, idx) => {
            const isLatest = rev.version === latestVer;
            const isExpanded = expandedVersions[rev.version] !== undefined
              ? expandedVersions[rev.version]
              : isLatest;
            
            const rawAudio = rev.audioUrl || (isLatest ? activeAudioUrl : "") || (rev.version === 1 ? activeAudioUrl : "");
            const rawVideo = rev.videoUrl || (isLatest ? activeVideoUrl : "") || (rev.version === 1 ? activeVideoUrl : "");
            const revLyrics = rev.lyrics || (isLatest ? activeLyrics : "") || (rev.version === 1 ? activeLyrics : "");

            const isValidUrl = (url) => Boolean(url && typeof url === "string" && url.trim().length > 10 && !url.includes("undefined") && !url.includes("null"));
            const hasAudio = isValidUrl(rawAudio);
            const hasVideo = isValidUrl(rawVideo);

            return (
              <div
                key={rev._id ? String(rev._id) : `rev-v${rev.version}-${idx}`}
                className={`rounded-xl border transition-all duration-300 overflow-hidden ${
                  isLatest
                    ? "border-brand-300 bg-brand-50/20 dark:border-brand-500/30 dark:bg-brand-500/[0.03]"
                    : "border-gray-200/80 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/40"
                }`}
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleVersion(rev.version)}
                  className="w-full text-left p-3 flex items-center justify-between cursor-pointer hover:bg-gray-100/60 dark:hover:bg-white/[0.04] transition-colors duration-200 select-none"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono font-bold shrink-0 transition-colors ${
                        isLatest
                          ? "bg-brand-500 text-white"
                          : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      }`}
                    >
                      v{rev.version}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-800 dark:text-white">
                          {(rev.title && !rev.title.match(/^Revision\s+v\d+$/i)) ? rev.title : `Revision v${rev.version}`}
                        </span>
                        {isLatest && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                            &bull; Final Delivered Version
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                        {rev.createdAt ? new Date(rev.createdAt).toLocaleString() : ""} {rev.updatedBy ? `by ${rev.updatedBy}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-gray-400 shrink-0 ml-2">
                    <span
                      className={`inline-flex items-center justify-center h-6 w-6 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-transform duration-300 ease-out ${
                        isExpanded ? "rotate-180" : "rotate-0"
                      }`}
                    >
                      <FiChevronDown size={17} />
                    </span>
                  </div>
                </button>

                {/* Collapsible Details with Smooth Animation */}
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="p-3 pt-3 border-t border-gray-100 dark:border-gray-800/80 space-y-2.5 text-xs">
                    {/* Note */}
                    {rev.note && (
                      <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/60 text-gray-600 dark:text-gray-300">
                        <span className="font-semibold text-gray-800 dark:text-white">Note: </span>
                        {rev.note}
                      </div>
                    )}

                    {/* Audio Player Card (Stacked Layout for Responsive Sidebar) */}
                    {hasAudio && (
                      <div className="bg-white dark:bg-gray-800/90 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400 font-semibold text-xs">
                            <FiMusic size={13} /> Audio Track v{rev.version}
                          </span>
                          <ForceDownloadButton
                            url={rawAudio}
                            filename={`${orderTitle} - v${rev.version}.mp3`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-brand-500 text-white hover:bg-brand-600 transition shrink-0"
                          >
                            <FiDownload size={12} /> Download
                          </ForceDownloadButton>
                        </div>
                        <audio controls preload="metadata" src={rawAudio} className="h-8 w-full" />
                      </div>
                    )}

                    {/* Video Player Card (Stacked Layout for Responsive Sidebar) */}
                    {hasVideo && (
                      <div className="bg-white dark:bg-gray-800/90 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-semibold text-xs">
                            <FiVideo size={13} /> Music Video v{rev.version}
                          </span>
                          <ForceDownloadButton
                            url={rawVideo}
                            filename={`${orderTitle} - video - v${rev.version}.mp4`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-purple-600 text-white hover:bg-purple-700 transition shrink-0"
                          >
                            <FiDownload size={12} /> Download Video
                          </ForceDownloadButton>
                        </div>
                        <div className="aspect-video w-full rounded-md bg-black overflow-hidden max-h-56">
                          <video controls preload="metadata" playsInline src={rawVideo} className="w-full h-full object-contain" />
                        </div>
                      </div>
                    )}

                    {/* Fallback if revision only contains text/custom files */}
                    {!hasAudio && !hasVideo && (
                      <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 text-center text-[11px]">
                        Text / Metadata revision (no separate audio/video file modified in this version)
                      </div>
                    )}

                    {/* Lyrics Preview */}
                    {revLyrics && (
                      <details className="bg-white dark:bg-gray-800 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700">
                        <summary className="cursor-pointer font-medium text-brand-600 dark:text-brand-400 flex items-center gap-1">
                          <FiFileText size={13} /> View Lyrics for Version {rev.version}
                        </summary>
                        <pre className="mt-2 text-[11px] whitespace-pre-wrap font-mono max-h-36 overflow-y-auto text-gray-700 dark:text-gray-300 p-2 bg-gray-50 dark:bg-gray-900 rounded">
                          {revLyrics}
                        </pre>
                      </details>
                    )}

                    {/* Custom Files */}
                    {rev.customFiles && rev.customFiles.length > 0 && (
                      <div className="space-y-1">
                        <span className="font-semibold text-gray-700 dark:text-gray-300 block text-[11px]">
                          Attached Deliverable Files:
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {rev.customFiles.map((file, fIdx) => (
                            <a
                              key={fIdx}
                              href={file.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-brand-500 hover:underline text-[11px]"
                            >
                              <FiDownload size={11} /> {file.name || `File ${fIdx + 1}`}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
