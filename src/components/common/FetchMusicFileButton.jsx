"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FiRefreshCw, FiUploadCloud, FiMusic, FiX, FiZap } from "react-icons/fi";
import { useToast } from "@/components/ui/toast/Toast";

export default function FetchMusicFileButton({
  orderId,
  shopifyOrderId,
  musicId,
  taskId,
  email,
  className = "",
  buttonText = "Fetch Music File from Suno / S3",
}) {
  const router = useRouter();
  const showToast = useToast();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationProgressText, setGenerationProgressText] = useState("AI is composing melody...");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [customAudioUrl, setCustomAudioUrl] = useState("");
  const fileInputRef = useRef(null);
  const pollingRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleFetch = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orders/music/sync-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          shopifyOrderId,
          musicId,
          taskId,
          email,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.status === "COMPLETED") {
        showToast(data.message || "Music file synced successfully!", "success");
        router.refresh();
      } else if (res.ok && data.status === "PENDING") {
        showToast("Suno AI is currently rendering this song. Please wait...", "info");
        setShowUploadModal(true);
      } else {
        showToast(data.error || "Could not find file on Suno AI. You can generate or upload a song.", "error");
        if (data.canUpload) {
          setShowUploadModal(true);
        }
      }
    } catch (err) {
      console.error("Fetch music file error:", err);
      showToast("Failed to fetch music file. Please try generation or upload.", "error");
      setShowUploadModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setGenerating(true);
    setGenerationProgressText("Starting AI generation with Suno AI...");

    try {
      // 1. Start generation
      const startRes = await fetch("/api/orders/music/sync-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start_generation",
          orderId,
          shopifyOrderId,
          musicId,
          taskId,
          email,
        }),
      });

      const startData = await startRes.json();
      if (!startRes.ok || !startData.success || !startData.taskId) {
        throw new Error(startData.error || "Failed to start Suno AI generation");
      }

      const activeTaskId = startData.taskId;
      const currentOrderId = startData.orderId || orderId;
      let secondsElapsed = 0;

      // 2. Poll until completion
      if (pollingRef.current) clearInterval(pollingRef.current);

      pollingRef.current = setInterval(async () => {
        secondsElapsed += 4;

        if (secondsElapsed < 20) {
          setGenerationProgressText(`Composing melody & generating lyrics... (${secondsElapsed}s)`);
        } else if (secondsElapsed < 45) {
          setGenerationProgressText(`Synthesizing vocals & both variations... (${secondsElapsed}s)`);
        } else {
          setGenerationProgressText(`Rendering audio & saving both tracks to S3... (${secondsElapsed}s)`);
        }

        try {
          const pollRes = await fetch("/api/orders/music/sync-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: currentOrderId,
              shopifyOrderId,
              musicId,
              taskId: activeTaskId,
              email,
            }),
          });

          const pollData = await pollRes.json();

          if (pollRes.ok && pollData.success && pollData.status === "COMPLETED") {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            setGenerating(false);
            showToast("New song generated with Suno AI and saved to S3 successfully!", "success");
            setShowUploadModal(false);
            router.refresh();
          } else if (!pollRes.ok || (!pollData.success && pollData.status !== "PENDING")) {
            // Only stop if an actual error occurred or timed out
            if (pollData?.status === "FAILED" || secondsElapsed > 240) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
              setGenerating(false);
              showToast(pollData?.error || "Music generation timed out or failed. Please try again or upload MP3.", "error");
              return;
            }
          }
        } catch (pollErr) {
          console.warn("Polling warning:", pollErr?.message);
        }
      }, 4000);

    } catch (err) {
      console.error("AI Generation error:", err);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setGenerating(false);
      showToast(err.message || "AI Generation failed. Please try again or upload MP3.", "error");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const presignRes = await fetch("/api/video-tool/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "audio/mpeg",
          fileType: "audio",
          orderId: orderId || shopifyOrderId || "music_manual",
        }),
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok || !presignData.uploadUrl) {
        throw new Error(presignData.error || "Failed to generate upload URL");
      }

      const uploadRes = await fetch(presignData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "audio/mpeg" },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload audio file to S3");
      }

      const attachRes = await fetch("/api/orders/music/sync-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          shopifyOrderId,
          musicId,
          taskId,
          email,
          customAudioKey: presignData.key,
          customTitle: file.name.replace(/\.[^/.]+$/, ""),
        }),
      });

      const attachData = await attachRes.json();
      if (attachRes.ok && attachData.success) {
        showToast("Audio file uploaded and saved to database successfully!", "success");
        setShowUploadModal(false);
        router.refresh();
      } else {
        throw new Error(attachData.error || "Failed to attach uploaded file to order");
      }
    } catch (err) {
      console.error("Manual audio upload error:", err);
      showToast(err.message || "Failed to upload audio file", "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!customAudioUrl || !customAudioUrl.startsWith("http")) {
      showToast("Please enter a valid HTTP/HTTPS audio URL", "error");
      return;
    }

    setUploading(true);
    try {
      const attachRes = await fetch("/api/orders/music/sync-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          shopifyOrderId,
          musicId,
          taskId,
          email,
          customAudioUrl,
          customTitle: "Imported Song",
        }),
      });

      const attachData = await attachRes.json();
      if (attachRes.ok && attachData.success) {
        showToast("Audio URL imported and saved successfully!", "success");
        setShowUploadModal(false);
        router.refresh();
      } else {
        throw new Error(attachData.error || "Failed to import audio URL");
      }
    } catch (err) {
      console.error("URL import error:", err);
      showToast(err.message || "Failed to import audio URL", "error");
    } finally {
      setUploading(false);
    }
  };

  const isBusy = loading || generating || uploading;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleFetch}
          disabled={isBusy}
          className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        >
          <FiRefreshCw className={`text-sm ${loading ? "animate-spin" : ""}`} />
          <span>{loading ? "Checking Suno AI / S3..." : buttonText}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowUploadModal(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition"
        >
          <FiZap className="text-sm text-brand-500" />
          <span>Generate / Attach File</span>
        </button>
      </div>

      {/* Modal with Async Generate AI & Manual Upload */}
      {showUploadModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                <FiMusic className="text-brand-500 text-lg" />
                <h3 className="text-base font-semibold">Generate or Attach Music</h3>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setShowUploadModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
              >
                <FiX size={18} />
              </button>
            </div>

            <div className="py-4 space-y-4">
              {/* OPTION 1: RE-GENERATE WITH AI (Asynchronous with live progress) */}
              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-950/20">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
                    <FiZap size={18} />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Generate Song with AI (Recommended)
                    </h4>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Automatically composes a fresh melody using the customer&apos;s saved lyrics, genre, and style.
                    </p>

                    {generating ? (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-brand-600 dark:text-brand-400">
                          <FiRefreshCw className="animate-spin text-sm" />
                          <span>{generationProgressText}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900/40">
                          <div className="h-full w-full animate-pulse bg-brand-500"></div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={handleRegenerate}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-brand-600 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <FiZap className="text-sm" />
                        <span>Generate Music with Suno AI</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-gray-200 dark:border-gray-800"></div>
                <span className="flex-shrink mx-3 text-xs text-gray-400 font-medium">OR UPLOAD EXISTING MP3</span>
                <div className="flex-grow border-t border-gray-200 dark:border-gray-800"></div>
              </div>

              {/* OPTION 2: DIRECT MP3 FILE UPLOAD */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/mp3,audio/mpeg,audio/wav,audio/m4a,audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 p-5 text-center hover:border-brand-500 hover:bg-brand-50/30 dark:border-gray-700 dark:hover:border-brand-500 dark:hover:bg-brand-950/20 transition cursor-pointer disabled:opacity-50"
                >
                  <FiUploadCloud className="text-2xl text-brand-500 mb-1" />
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                    {uploading ? "Uploading to S3..." : "Click to select MP3 file from computer"}
                  </span>
                  <span className="text-[11px] text-gray-400 mt-0.5">MP3, WAV, M4A up to 50MB</span>
                </button>
              </div>

              {/* OPTION 3: IMPORT VIA URL */}
              <form onSubmit={handleUrlSubmit} className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://example.com/song.mp3"
                    value={customAudioUrl}
                    disabled={isBusy}
                    onChange={(e) => setCustomAudioUrl(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800 focus:border-brand-500 focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                  <button
                    type="submit"
                    disabled={isBusy || !customAudioUrl}
                    className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800 dark:bg-brand-600 dark:hover:bg-brand-700 disabled:opacity-50 transition"
                  >
                    Import
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
