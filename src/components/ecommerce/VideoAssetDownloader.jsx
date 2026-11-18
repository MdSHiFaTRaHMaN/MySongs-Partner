"use client";

import React, { useState } from "react";
import { FiMusic, FiDownload, FiImage, FiVideo, FiCheckCircle, FiLoader, FiX, FiFolder, FiLayers, FiArrowRight } from "react-icons/fi";
import ForceDownloadButton from "@/components/common/ForceDownloadButton";
import Button from "@/components/ui/button/Button";
import JSZip from "jszip";
import { saveAs } from "file-saver";

// Smart filename truncation preserving extension: e.g. "my-very-long-filename-mixkit...mp4"
function truncateFileName(filename, maxLen = 28) {
  if (!filename || typeof filename !== "string") return "";
  if (filename.length <= maxLen) return filename;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot < filename.length - 8) {
    return filename.slice(0, maxLen - 3) + "...";
  }
  const ext = filename.slice(lastDot);
  const nameWithoutExt = filename.slice(0, lastDot);
  const keepBase = maxLen - ext.length - 3;
  if (keepBase <= 4) {
    return nameWithoutExt.slice(0, 8) + "..." + ext;
  }
  return nameWithoutExt.slice(0, keepBase) + "..." + ext;
}

export default function VideoAssetDownloader({ audioFile, mediaFiles = [], orderNumber = "", videoFormat = "9:16" }) {
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [progressState, setProgressState] = useState({
    active: false,
    percent: 0,
    currentFile: 0,
    totalFiles: 0,
    currentFileName: "",
    phase: "", // "downloading" | "zipping" | "completed"
  });

  const imageFiles = mediaFiles.filter(
    (m) => m.type === "image" || (!m.type && m.mimeType?.startsWith("image"))
  );
  const videoFiles = mediaFiles.filter(
    (m) => m.type === "video" || (!m.type && m.mimeType?.startsWith("video"))
  );
  const otherFiles = mediaFiles.filter(
    (m) =>
      m.type !== "image" &&
      m.type !== "video" &&
      !m.mimeType?.startsWith("image") &&
      !m.mimeType?.startsWith("video")
  );

  const handleDownloadAll = async () => {
    const allFiles = [];
    if (audioFile?.url) {
      allFiles.push({
        url: audioFile.url,
        filename: `Order_${orderNumber}_Audio_${audioFile.name || "track.mp3"}`,
        displayName: audioFile.name || "Audio Track",
      });
    }
    mediaFiles.forEach((m, idx) => {
      if (m.url) {
        const isVid = m.type === "video" || (!m.type && m.mimeType?.startsWith("video"));
        const typePrefix = isVid ? "Video" : "Photo";
        const paddedOrder = String(idx + 1).padStart(2, "0");
        allFiles.push({
          url: m.url,
          filename: `Order_${orderNumber}_#${paddedOrder}_${typePrefix}_${m.name || "file"}`,
          displayName: `#${idx + 1} ${typePrefix}: ${m.name || "Asset"}`,
        });
      }
    });

    if (allFiles.length === 0) return;

    setDownloadingAll(true);
    setProgressState({
      active: true,
      percent: 0,
      currentFile: 0,
      totalFiles: allFiles.length,
      currentFileName: "Starting download...",
      phase: "downloading",
    });

    try {
      const zip = new JSZip();
      let completedCount = 0;

      // Download all assets with individual progress increments (0% to 75%)
      await Promise.all(
        allFiles.map(async (file, index) => {
          try {
            setProgressState((prev) => ({
              ...prev,
              currentFile: index + 1,
              currentFileName: file.displayName,
            }));

            const proxyUrl = `/api/video-tool/download-proxy?url=${encodeURIComponent(file.url)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error(`Failed to fetch ${file.filename}`);
            const blob = await response.blob();
            zip.file(file.filename, blob);

            completedCount++;
            const fetchProgress = Math.round((completedCount / allFiles.length) * 75);
            setProgressState((prev) => ({
              ...prev,
              percent: fetchProgress,
              currentFile: completedCount,
              currentFileName: file.displayName,
            }));
          } catch (e) {
            console.error("Error downloading file for zip:", file.filename, e);
          }
        })
      );

      // Zipping phase (75% to 100%)
      setProgressState((prev) => ({
        ...prev,
        phase: "zipping",
        currentFileName: "Compressing into ZIP archive...",
      }));

      const content = await zip.generateAsync(
        { type: "blob" },
        (metadata) => {
          const zipPercent = Math.round(75 + (metadata.percent * 0.25));
          setProgressState((prev) => ({
            ...prev,
            percent: Math.min(zipPercent, 99),
          }));
        }
      );

      // Trigger browser file save
      saveAs(content, `Order_${orderNumber}_All_Assets.zip`);

      setProgressState((prev) => ({
        ...prev,
        percent: 100,
        phase: "completed",
        currentFileName: "Download ready!",
      }));

      // Auto dismiss progress after 3.5 seconds
      setTimeout(() => {
        setProgressState((prev) => ({ ...prev, active: false }));
      }, 3500);

    } catch (e) {
      console.error("Error generating zip:", e);
      setProgressState((prev) => ({ ...prev, active: false }));
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Quick Action */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Uploaded Customer Assets
            </h3>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              videoFormat === "16:9"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40"
                : "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40"
            }`}>
              {videoFormat === "16:9" ? "16:9 Landscape ▭" : "9:16 Vertical ▯"}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Download raw customer assets to produce the custom music video (Canvas: {videoFormat === "16:9" ? "16:9 1080p Landscape" : "9:16 1080p Vertical"})
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={handleDownloadAll}
          disabled={downloadingAll || (!audioFile?.url && mediaFiles.length === 0)}
          startIcon={downloadingAll ? <FiLoader className="animate-spin" size={15} /> : <FiDownload size={15} />}
        >
          {downloadingAll ? `Zipping (${progressState.percent}%)` : "Download All Assets"}
        </Button>
      </div>

      {/* Google Drive Style Floating Download Progress Modal / Toast */}
      {progressState.active && (
        <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-2xl backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/95 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                progressState.phase === "completed"
                  ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                  : "bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400"
              }`}>
                {progressState.phase === "completed" ? (
                  <FiCheckCircle size={22} className="animate-bounce" />
                ) : (
                  <FiFolder size={20} className="animate-pulse" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {progressState.phase === "completed"
                    ? "Archive Ready & Downloaded"
                    : progressState.phase === "zipping"
                    ? "Compressing Archive..."
                    : `Downloading Assets (${progressState.currentFile}/${progressState.totalFiles})`}
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 font-mono" title={progressState.currentFileName}>
                  {truncateFileName(progressState.currentFileName, 28)}
                </p>
              </div>
            </div>

            {progressState.phase === "completed" && (
              <button
                onClick={() => setProgressState((prev) => ({ ...prev, active: false }))}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                <FiX size={16} />
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex justify-between items-center text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
              <span>
                {progressState.phase === "completed"
                  ? "Complete"
                  : progressState.phase === "zipping"
                  ? "Creating ZIP..."
                  : `File ${progressState.currentFile} of ${progressState.totalFiles}`}
              </span>
              <span className="font-mono text-brand-600 dark:text-brand-400">{progressState.percent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  progressState.phase === "completed"
                    ? "bg-emerald-500"
                    : "bg-gradient-to-r from-brand-500 to-orange-500"
                }`}
                style={{ width: `${progressState.percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 1. Audio Track Section */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
            <FiMusic size={20} />
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 dark:text-white/90 text-sm">
              1. Audio Track: {audioFile?.name || "Customer Audio"}
            </h4>
            <p className="text-xs text-gray-500">
              {audioFile?.size ? `${(audioFile.size / (1024 * 1024)).toFixed(2)} MB` : "Audio File"}
            </p>
          </div>
        </div>

        {audioFile?.url ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-gray-50 dark:bg-white/[0.02] p-3 rounded-lg border border-gray-100 dark:border-white/[0.05]">
            <audio
              controls
              src={audioFile.url}
              className="h-10 w-full min-w-0"
            />
            <ForceDownloadButton
              url={audioFile.url}
              filename={`Order_${orderNumber}_Audio_${audioFile.name || "song.mp3"}`}
              className="inline-flex items-center justify-center font-medium gap-2 rounded-lg transition px-4 py-2 text-sm bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600 disabled:bg-brand-300 shrink-0 whitespace-nowrap"
            >
              <FiDownload size={15} />
              Download Audio
            </ForceDownloadButton>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No audio file uploaded.</p>
        )}
      </div>

      {/* 2. Customer Media Timeline & Sequence (Editor Order) */}
      <div className="rounded-xl border border-brand-200/80 bg-white p-5 dark:border-brand-900/40 dark:bg-white/[0.03] shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
              <FiLayers size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-gray-800 dark:text-white/90 text-sm">
                  2. Video Timeline &amp; Sequence ({mediaFiles.length} files)
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  CUSTOMER ORDER
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Exact sequence arranged by the customer for photos &amp; videos to appear in the music video
              </p>
            </div>
          </div>
        </div>

        {/* Quick Timeline Flow Chain */}
        {mediaFiles.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 dark:bg-white/[0.02] rounded-lg border border-gray-100 dark:border-white/[0.05]">
            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-wider block mb-2">
              Timeline Flow Sequence:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {mediaFiles.map((m, idx) => {
                const isVid = m.type === "video" || (!m.type && m.mimeType?.startsWith("video"));
                return (
                  <React.Fragment key={`flow-${m.key || idx}`}>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${
                        isVid
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                      }`}
                    >
                      <span className="font-mono font-bold">#{idx + 1}</span>
                      <span>{isVid ? "Video" : "Photo"}</span>
                    </span>
                    {idx < mediaFiles.length - 1 && (
                      <FiArrowRight size={12} className="text-gray-400 shrink-0" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {mediaFiles.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No media assets uploaded.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {mediaFiles.map((m, idx) => {
              const isVid = m.type === "video" || (!m.type && m.mimeType?.startsWith("video"));
              const typeLabel = isVid ? "Video" : "Photo";
              const paddedOrder = String(idx + 1).padStart(2, "0");

              return (
                <div
                  key={m.key || `seq-${idx}`}
                  className={`group relative rounded-xl border overflow-hidden bg-gray-100 dark:bg-gray-800 aspect-square flex flex-col justify-between shadow-theme-xs transition-all duration-200 hover:shadow-md ${
                    isVid
                      ? "border-purple-200 dark:border-purple-800/60"
                      : "border-blue-200 dark:border-blue-800/60"
                  }`}
                >
                  {/* Sequence & Type Badge */}
                  <div className="absolute top-2 left-2 z-10">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-extrabold shadow-sm ${
                        isVid
                          ? "bg-purple-600 text-white"
                          : "bg-blue-600 text-white"
                      }`}
                    >
                      <span>#{idx + 1}</span>
                      <span className="text-[9px] uppercase tracking-wider font-semibold opacity-90">{typeLabel}</span>
                    </span>
                  </div>

                  {/* Media Preview */}
                  {isVid ? (
                    <video
                      src={m.url}
                      className="w-full h-full object-cover bg-black"
                      controls
                      controlsList="nodownload"
                    />
                  ) : (
                    <img
                      src={m.url}
                      alt={m.name || `Asset ${idx + 1}`}
                      className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-200"
                    />
                  )}

                  {/* Overlay Controls */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2.5 pointer-events-none">
                    <span className="text-[11px] text-white font-medium truncate font-mono mb-1.5" title={m.name}>
                      {m.name || `${typeLabel} #${idx + 1}`}
                    </span>
                    <div className="pointer-events-auto flex justify-end">
                      <ForceDownloadButton
                        url={m.url}
                        filename={`Order_${orderNumber}_#${paddedOrder}_${typeLabel}_${m.name || "asset"}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/95 dark:bg-gray-900/95 text-gray-800 dark:text-white hover:bg-white dark:hover:bg-gray-800 text-xs font-semibold backdrop-blur shadow-theme-xs transition"
                      >
                        <FiDownload size={13} />
                        <span>Download</span>
                      </ForceDownloadButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Customer Images Section (Filtered) */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
              <FiImage size={20} />
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-white/90 text-sm">
                3. Customer Photos Only ({imageFiles.length})
              </h4>
              <p className="text-xs text-gray-500">Filtered view of photos uploaded by customer</p>
            </div>
          </div>
        </div>

        {imageFiles.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No images uploaded.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {imageFiles.map((img, idx) => (
              <div
                key={img.key || idx}
                className="group relative rounded-lg border border-gray-200 dark:border-white/[0.05] overflow-hidden bg-gray-100 dark:bg-gray-800 aspect-square flex flex-col justify-between"
              >
                <img
                  src={img.url}
                  alt={img.name || `Photo ${idx + 1}`}
                  className="w-full h-full object-cover group-hover:scale-101 transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                  <span className="text-[10px] text-white/90 truncate font-mono">{img.name || `Image #${idx + 1}`}</span>
                  <ForceDownloadButton
                    url={img.url}
                    filename={`Order_${orderNumber}_Photo_${idx + 1}_${img.name || "image.jpg"}`}
                    className="self-end inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 dark:bg-gray-900/90 text-gray-800 dark:text-white hover:bg-white dark:hover:bg-gray-800 text-xs font-medium backdrop-blur shadow-theme-xs transition"
                  >
                    <FiDownload size={13} />
                    <span>Download</span>
                  </ForceDownloadButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Customer Video Clips Section */}
      {videoFiles.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400">
              <FiVideo size={20} />
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-white/90 text-sm">
                3. Customer Video Clips ({videoFiles.length})
              </h4>
              <p className="text-xs text-gray-500">Short video footage to incorporate into music video</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {videoFiles.map((vid, idx) => (
              <div
                key={vid.key || idx}
                className="rounded-lg border border-gray-200 dark:border-white/[0.05] p-3 bg-gray-50 dark:bg-white/[0.02]"
              >
                <video
                  controls
                  controlsList="nodownload"
                  disablePictureInPicture
                  src={vid.url}
                  className="w-full aspect-video rounded object-cover bg-black mb-2 hover-video-controls"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[150px]">
                    {vid.name || `Clip #${idx + 1}`}
                  </span>
                  <ForceDownloadButton
                    url={vid.url}
                    filename={`Order_${orderNumber}_Clip_${idx + 1}_${vid.name || "video.mp4"}`}
                    className="inline-flex items-center justify-center font-medium gap-1.5 rounded-lg transition px-2.5 py-1 text-xs bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700 dark:hover:bg-white/[0.03] dark:hover:text-gray-300 shadow-theme-xs"
                  >
                    <FiDownload size={13} /> Download
                  </ForceDownloadButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
