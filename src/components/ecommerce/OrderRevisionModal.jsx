"use client";

import React, { useState, useRef } from "react";
import { Modal } from "@/components/ui/modal";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import { useToast } from "@/components/ui/toast/Toast";
import { useRouter } from "next/navigation";
import {
  FiEdit3,
  FiUploadCloud,
  FiMusic,
  FiVideo,
  FiFileText,
  FiPlus,
  FiTrash2,
  FiLoader,
  FiZap,
  FiRefreshCw,
  FiCheckCircle,
} from "react-icons/fi";

const GENRE_PRESETS = ["Pop", "Acoustic", "Blues", "Country", "Rock", "R&B", "Piano Ballad", "Jazz"];
const MOOD_PRESETS = ["Emotional", "Romantic", "Uplifting", "Happy", "Energetic", "Melancholic", "Heartfelt"];
const VOICE_PRESETS = ["Male", "Female", "Duet"];

export default function OrderRevisionModal({
  orderId,
  orderType = "music", // "music" | "video"
  currentLyrics = "",
  currentAudioUrl = "",
  currentVideoUrl = "",
  customerEmail = "",
  shopifyOrderId = "",
  shopifyOrderNumber = "",
  musicId = "",
  songTitle = "",
  currentVersion = 1,
  revisionsCount = 0,
  defaultGenre = "Pop",
  defaultVoice = "Male",
  defaultMood = "Emotional",
  onSuccess,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [revisionMode, setRevisionMode] = useState("ai"); // "ai" | "upload"
  const [saving, setSaving] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiProgressText, setAiProgressText] = useState("");
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  // AI Review/Preview State
  const [isReviewingTracks, setIsReviewingTracks] = useState(false);
  const [generatedTracks, setGeneratedTracks] = useState([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState([]);
  const [newVersionNumber, setNewVersionNumber] = useState(2);
  const [savingSelected, setSavingSelected] = useState(false);

  // AI Provider & Custom Style States
  const [aiProvider, setAiProvider] = useState("suno"); // "suno" | "mureka"
  const [customStyle, setCustomStyle] = useState("");

  const [revisionTitle, setRevisionTitle] = useState("");
  const [lyrics, setLyrics] = useState(currentLyrics || "");
  const [genre, setGenre] = useState(defaultGenre || "Pop");
  const [voice, setVoice] = useState(defaultVoice || "Male");
  const [mood, setMood] = useState(defaultMood || "Emotional");
  const [audioUrl, setAudioUrl] = useState(currentAudioUrl || "");
  const [audioKey, setAudioKey] = useState("");
  const [videoUrl, setVideoUrl] = useState(currentVideoUrl || "");
  const [videoKey, setVideoKey] = useState("");
  const [note, setNote] = useState("");
  const [customFiles, setCustomFiles] = useState([]);
  const [newFileName, setNewFileName] = useState("");
  const [newFileUrl, setNewFileUrl] = useState("");

  const audioInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const showToast = useToast();
  const router = useRouter();

  const cleanSongTitle = (songTitle && !String(songTitle).toLowerCase().includes("undefined"))
    ? songTitle.trim()
    : "Custom Song";
  const cleanOrderNumber = String(shopifyOrderNumber || shopifyOrderId || "Music").replace(/^#+/, "");

  // Reset states when opening modal
  const handleOpen = () => {
    setLyrics(currentLyrics || "");
    setAudioUrl(currentAudioUrl || "");
    setVideoUrl(currentVideoUrl || "");
    setRevisionMode(orderType === "video" ? "upload" : "ai");
    setIsReviewingTracks(false);
    setGeneratedTracks([]);
    setSelectedTrackIds([]);
    setSavingSelected(false);
    setIsOpen(true);
  };

  // Toggle Track Selection (Up to 2 Songs for revision mail)
  const handleToggleTrackSelection = (trackId) => {
    setSelectedTrackIds((prev) => {
      if (prev.includes(trackId)) {
        // Unselect if already selected (unless it's the only one selected)
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== trackId);
      }
      if (prev.length >= 2) {
        // If 2 already selected, replace the 2nd one
        return [prev[0], trackId];
      }
      return [...prev, trackId];
    });
  };

  // AI Revision Generator
  const handleAiGenerateRevision = async () => {
    if (!lyrics || !lyrics.trim()) {
      showToast({ variant: "warning", title: "Lyrics Required", message: "Please provide the revised lyrics." });
      return;
    }

    setGeneratingAi(true);
    const providerLabel = aiProvider === "mureka" ? "Mureka AI" : "Suno AI";
    setAiProgressText(`✨ Starting AI revision with ${providerLabel}...`);

    try {
      let seconds = 0;
      const progressTimer = setInterval(() => {
        seconds += 3;
        const currentStyle = customStyle.trim() || genre;
        if (seconds < 15) {
          setAiProgressText(`✨ Composing melody with ${currentStyle} style via ${providerLabel}... (${seconds}s)`);
        } else if (seconds < 35) {
          setAiProgressText(`🎵 Synthesizing ${voice} vocals & instrumentation... (${seconds}s)`);
        } else {
          setAiProgressText(`⚡ Rendering audio & generating preview versions... (${seconds}s)`);
        }
      }, 3000);

      const res = await fetch("/api/orders/music/revision-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          shopifyOrderId,
          musicId,
          lyrics,
          genre,
          customStyle: customStyle.trim(),
          voice,
          mood,
          provider: aiProvider,
          songTitle: cleanSongTitle,
          revisionTitle: revisionTitle.trim() || `Revision v${(Number(currentVersion) || Number(revisionsCount) || 1) + 1}`,
          note: note || `AI generated revision with ${customStyle.trim() || genre} style & ${voice} vocals (${providerLabel})`,
          customerEmail,
        }),
      });

      clearInterval(progressTimer);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate AI revision");
      }

      // If server returned preview stage with variations
      if (data.stage === "preview" && Array.isArray(data.tracks) && data.tracks.length > 0) {
        setGeneratedTracks(data.tracks);
        // Default select up to 2 tracks (or first track if only 1 exists)
        const initialSelections = data.tracks.slice(0, 2).map((t) => t.id);
        setSelectedTrackIds(initialSelections);
        setNewVersionNumber(data.newVersion || (Number(currentVersion) || 1) + 1);
        setIsReviewingTracks(true);
        showToast({
          variant: "success",
          title: "Variations Generated!",
          message: `${data.tracks.length} variations ready. You can select up to 2 songs for the revision mail!`,
        });
        return;
      }

      // Fallback for direct confirmation
      showToast({
        variant: "success",
        title: "Revision Generated!",
        message: data.message || "New song revision created and saved successfully!",
      });

      setIsOpen(false);
      if (onSuccess) onSuccess(data.revision);
      router.refresh();
    } catch (err) {
      console.error("AI Revision generation error:", err);
      showToast({
        variant: "error",
        title: "Generation Failed",
        message: err.message || "Could not generate revision. Please try again or upload manually.",
      });
    } finally {
      setGeneratingAi(false);
    }
  };

  // Confirm and Save Selected Variations as Final Revision (Supports 1 or 2 Songs)
  const handleConfirmSelectedRevision = async () => {
    const selectedTracks = generatedTracks.filter((t) => selectedTrackIds.includes(t.id));
    if (selectedTracks.length === 0) {
      showToast({ variant: "warning", title: "Selection Required", message: "Please select at least 1 song for the revision." });
      return;
    }

    setSavingSelected(true);
    try {
      const res = await fetch("/api/orders/music/revision-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          orderId,
          shopifyOrderId,
          musicId,
          selectedTracks: selectedTracks,
          selectedTrack: selectedTracks[0],
          allTracks: generatedTracks,
          version: newVersionNumber,
          revisionTitle: revisionTitle.trim() || `Revision v${newVersionNumber}`,
          note: note || `AI revision with ${selectedTracks.length} song option${selectedTracks.length > 1 ? "s" : ""} (${aiProvider.toUpperCase()})`,
          lyrics,
          genre,
          customStyle: customStyle.trim(),
          voice,
          mood,
          customerEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to confirm and save revision.");
      }

      showToast({
        variant: "success",
        title: "Revision Saved!",
        message: `Version ${data.version || newVersionNumber} with ${selectedTracks.length} song(s) confirmed and ready for delivery!`,
      });

      setIsReviewingTracks(false);
      setIsOpen(false);
      if (onSuccess) onSuccess(data.revision);
      router.refresh();
    } catch (err) {
      console.error("Confirm revision error:", err);
      showToast({
        variant: "error",
        title: "Save Failed",
        message: err.message || "Could not save the selected variation.",
      });
    } finally {
      setSavingSelected(false);
    }
  };

  // Manual File Upload Handler
  const handleFileUpload = async (file, type) => {
    if (!file) return;

    if (type === "audio") setUploadingAudio(true);
    if (type === "video") setUploadingVideo(true);

    try {
      const mimeType = file.type || (type === "audio" ? "audio/mpeg" : "video/mp4");
      const fileCategory = type === "audio" ? "audio" : "final_video";

      const presignRes = await fetch("/api/video-tool/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: mimeType,
          fileType: fileCategory,
          orderId: String(orderId || ""),
          videoId: String(orderId || ""),
        }),
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok || !presignData.success || !presignData.uploadUrl) {
        throw new Error(presignData.error || "Failed to initiate direct upload.");
      }

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presignData.uploadUrl, true);
        xhr.setRequestHeader("Content-Type", mimeType);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`S3 upload failed with status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error during S3 upload."));
        xhr.send(file);
      });

      if (type === "audio") {
        setAudioUrl(presignData.url);
        if (presignData.key) setAudioKey(presignData.key);
        showToast({ variant: "success", title: "Audio Uploaded", message: "New audio file attached to revision." });
      } else {
        setVideoUrl(presignData.url);
        if (presignData.key) setVideoKey(presignData.key);
        showToast({ variant: "success", title: "Video Uploaded", message: "New video file attached to revision." });
      }
    } catch (err) {
      console.error("Direct upload error:", err);
      showToast({ variant: "error", title: "Upload Failed", message: err.message || "Failed to upload file." });
    } finally {
      if (type === "audio") setUploadingAudio(false);
      if (type === "video") setUploadingVideo(false);
    }
  };

  const handleAddCustomFile = () => {
    if (!newFileName.trim() || !newFileUrl.trim()) {
      showToast({ variant: "warning", title: "Missing Information", message: "Please provide both a label and a valid URL." });
      return;
    }
    setCustomFiles((prev) => [...prev, { name: newFileName.trim(), url: newFileUrl.trim() }]);
    setNewFileName("");
    setNewFileUrl("");
  };

  const handleRemoveCustomFile = (index) => {
    setCustomFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Manual Revision Save Handler
  const handleSaveManualRevision = async (e) => {
    e.preventDefault();
    if (!audioUrl && !videoUrl && !lyrics && customFiles.length === 0) {
      showToast({ variant: "warning", title: "Missing Content", message: "Please provide at least an audio/video file or updated lyrics." });
      return;
    }

    setSaving(true);
    try {
      const targetId = orderId || shopifyOrderId || musicId;
      const endpoint = orderType === "video"
        ? `/api/video-orders/${targetId}/revision`
        : `/api/orders/${targetId}/revision`;

      const nextVerNum = (Number(currentVersion) || Number(revisionsCount) || 1) + 1;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          orderType,
          title: revisionTitle.trim() || `Revision v${nextVerNum}`,
          audioUrl: audioKey || audioUrl,
          audioKey,
          videoUrl: videoKey || videoUrl,
          videoKey,
          lyrics: lyrics.trim(),
          note: note.trim(),
          customFiles,
          customerEmail,
          shopifyOrderId,
          shopifyOrderNumber,
          musicId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save revision.");
      }

      showToast({
        variant: "success",
        title: "Revision Created",
        message: `Version ${data.version || ""} created and saved successfully!`,
      });

      setIsOpen(false);
      if (onSuccess) onSuccess(data.revision);
      router.refresh();
    } catch (err) {
      console.error("Save revision error:", err);
      showToast({ variant: "error", title: "Save Failed", message: err.message || "Failed to save revision." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center justify-center font-medium gap-2 rounded-md transition px-4 py-2 text-sm bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600 disabled:bg-brand-300 cursor-pointer"
      >
        <FiEdit3 size={14} />
        <span>Create Revision</span>
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} className="max-w-2xl p-6">
        {isReviewingTracks ? (
          <div className="space-y-5">
            {/* Header */}
            <div className="border-b border-gray-100 pb-3 dark:border-gray-800 pr-12">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-lg font-bold text-gray-800 dark:text-white/90 flex items-center gap-2">
                  <FiCheckCircle className="text-emerald-500" />
                  <span>Select Revision Version (v{newVersionNumber})</span>
                </h3>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  AI Generated
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {cleanSongTitle} • Order #{cleanOrderNumber} • AI generated {generatedTracks.length} versions. Listen to both and choose which one to save as the final revision.
              </p>
            </div>

            {/* Variations Selection Header */}
            <div className="flex items-center justify-between pb-1">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white/90">
                  Select Songs for Revision Mail
                </h4>
                <p className="text-xs text-gray-500">
                  Select 1 or 2 songs to deliver in the revision email to the customer.
                </p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                selectedTrackIds.length === 2
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                  : selectedTrackIds.length === 1
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
              }`}>
                {selectedTrackIds.length} of 2 songs selected
              </span>
            </div>

            {/* Variations List */}
            <div className="space-y-3.5 max-h-[55vh] overflow-y-auto pr-1">
              {generatedTracks.map((track, idx) => {
                const isSelected = selectedTrackIds.includes(track.id);
                const selectionIndex = selectedTrackIds.indexOf(track.id);
                return (
                  <div
                    key={track.id || idx}
                    onClick={() => handleToggleTrackSelection(track.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "border-brand-500 bg-brand-50/40 dark:border-brand-500 dark:bg-brand-950/40 ring-2 ring-brand-500/30 shadow-sm"
                        : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/60 dark:hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`track-opt-${idx}`}
                          checked={isSelected}
                          onChange={() => handleToggleTrackSelection(track.id)}
                          className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500 cursor-pointer accent-brand-500"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <label htmlFor={`track-opt-${idx}`} className="text-sm font-bold text-gray-800 dark:text-white/90 cursor-pointer">
                              Variation {track.variationNumber || idx + 1}
                            </label>
                            {isSelected && (
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shadow-xs ${
                                selectionIndex === 0
                                  ? "bg-brand-500 text-white"
                                  : "bg-emerald-600 text-white"
                              }`}>
                                {selectionIndex === 0 ? "✓ Song 1 (Primary)" : "✓ Song 2 (Alternative)"}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {track.title && !String(track.title).toLowerCase().includes("undefined")
                              ? track.title
                              : `${cleanSongTitle} (Variation ${track.variationNumber || idx + 1})`}
                            {track.duration ? ` • ${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, "0")}` : ""}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                        MP3 Audio
                      </span>
                    </div>

                    {/* Audio Preview Player */}
                    <div className="bg-white dark:bg-gray-900/90 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800 shadow-2xs" onClick={(e) => e.stopPropagation()}>
                      <audio
                        controls
                        className="w-full h-9 accent-brand-500"
                        src={track.streamAudioUrl || track.audioUrl}
                      >
                        Your browser does not support audio playback.
                      </audio>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Revision Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-gray-100 dark:border-gray-800">
              <div>
                <Label htmlFor="rev-final-title" className="text-xs">Revision Title</Label>
                <Input
                  id="rev-final-title"
                  type="text"
                  placeholder={`Revision v${newVersionNumber}`}
                  value={revisionTitle}
                  onChange={(e) => setRevisionTitle(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rev-final-note" className="text-xs">Internal Revision Note</Label>
                <Input
                  id="rev-final-note"
                  type="text"
                  placeholder="e.g. Selected variation with smoother vocals"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                disabled={savingSelected}
                onClick={() => setIsReviewingTracks(false)}
                className="rounded-lg px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition cursor-pointer"
              >
                ← Back to Edit Prompt
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingSelected}
                  onClick={() => {
                    setIsReviewingTracks(false);
                    setIsOpen(false);
                  }}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingSelected}
                  onClick={handleConfirmSelectedRevision}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingSelected ? (
                    <>
                      <FiLoader className="animate-spin" size={14} />
                      <span>Saving Revision v{newVersionNumber}...</span>
                    </>
                  ) : (
                    <>
                      <FiCheckCircle size={14} />
                      <span>Confirm &amp; Save Selected as Revision v{newVersionNumber}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header */}
            <div className="border-b border-gray-100 pb-3 dark:border-gray-800 pr-12">
              <h3 className="text-lg font-bold text-gray-800 dark:text-white/90 flex items-center gap-2">
                <FiEdit3 className="text-brand-500" />
                <span>Create New Order Revision</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {cleanSongTitle} • Order #{cleanOrderNumber}
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => setRevisionMode("ai")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
                  revisionMode === "ai"
                    ? "bg-white text-brand-600 shadow-xs dark:bg-gray-900 dark:text-brand-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                <FiZap size={14} />
                <span>✨ Re-generate with AI</span>
              </button>
              <button
                type="button"
                onClick={() => setRevisionMode("upload")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
                  revisionMode === "upload"
                    ? "bg-white text-brand-600 shadow-xs dark:bg-gray-900 dark:text-brand-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                <FiUploadCloud size={14} />
                <span>📁 Upload Custom MP3 / MP4</span>
              </button>
            </div>

            {/* TAB 1: AI GENERATION */}
            {revisionMode === "ai" && (
              <div className="space-y-4">
                {/* AI Provider Selection */}
                <div className="space-y-1.5 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                      <FiZap className="text-amber-500" size={13} /> AI Engine Provider
                    </Label>
                    <span className="text-[11px] text-gray-400">Select model for this revision</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setAiProvider("suno")}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                        aiProvider === "suno"
                          ? "bg-brand-500 text-white border-brand-500 shadow-xs"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <span>⚡ Suno AI</span>
                      {aiProvider === "suno" && <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded">Active</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiProvider("mureka")}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                        aiProvider === "mureka"
                          ? "bg-brand-500 text-white border-brand-500 shadow-xs"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <span>✨ Mureka AI</span>
                      {aiProvider === "mureka" && <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded">Active</span>}
                    </button>
                  </div>
                </div>

                {/* Lyrics Editor */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-300">
                    <FiFileText className="text-brand-500" size={14} /> Revised Lyrics
                  </Label>
                  <textarea
                    rows={6}
                    placeholder="Edit or revise the song lyrics..."
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-800 outline-none transition focus:border-brand-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90 font-mono leading-relaxed"
                  />
                </div>

                {/* Genre Selector & Custom Style */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Genre Preset</Label>
                    <span className="text-[11px] text-gray-400">Select preset or enter custom style below</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {GENRE_PRESETS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setGenre(g);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                          genre.toLowerCase() === g.toLowerCase() && !customStyle
                            ? "bg-brand-500 text-white shadow-xs"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>

                  {/* Custom Style Input (Allows any genre not in presets) */}
                  <div className="space-y-1 pt-1">
                    <Label className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <span>🎨 Custom Style / Other Genres</span>
                      <span className="text-[10px] text-gray-400 font-normal">(Overrides or enriches standard genre)</span>
                    </Label>
                    <Input
                      type="text"
                      value={customStyle}
                      onChange={(e) => setCustomStyle(e.target.value)}
                      placeholder="e.g. Dutch Nederpop, Upbeat Hardstyle, 80s Synthwave, Indie Folk, Reggae..."
                    />
                  </div>
                </div>

                {/* Voice & Mood */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Voice</Label>
                    <div className="flex gap-1.5">
                      {VOICE_PRESETS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setVoice(v)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                            voice.toLowerCase() === v.toLowerCase()
                              ? "bg-brand-500 text-white"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Mood</Label>
                    <select
                      value={mood}
                      onChange={(e) => setMood(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white"
                    >
                      {MOOD_PRESETS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Revision Title & Internal Note */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="rev-title-ai">Revision Title (Optional)</Label>
                    <Input
                      id="rev-title-ai"
                      type="text"
                      placeholder="e.g. Revised Lyrics with Acoustic Guitar"
                      value={revisionTitle}
                      onChange={(e) => setRevisionTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="rev-note-ai">Internal Note</Label>
                    <Input
                      id="rev-note-ai"
                      type="text"
                      placeholder="e.g. Changed verse 2 per customer request"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                </div>

                {/* AI Generation Progress Bar */}
                {generatingAi && (
                  <div className="rounded-xl bg-brand-50/80 p-3.5 border border-brand-200 dark:bg-brand-950/30 dark:border-brand-500/30 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-brand-600 dark:text-brand-400">
                      <FiRefreshCw className="animate-spin text-sm" />
                      <span>{aiProgressText}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900/40">
                      <div className="h-full w-full animate-pulse bg-brand-500"></div>
                    </div>
                  </div>
                )}

                {/* Action Buttons for AI Generation */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    disabled={generatingAi}
                    onClick={() => setIsOpen(false)}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={generatingAi}
                    onClick={handleAiGenerateRevision}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-brand-600 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {generatingAi ? (
                      <>
                        <FiLoader className="animate-spin" size={14} />
                        <span>Generating Variations...</span>
                      </>
                    ) : (
                      <>
                        <FiZap size={14} />
                        <span>✨ Generate Revision Variations</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: MANUAL UPLOAD (ORIGINAL FLOW) */}
            {revisionMode === "upload" && (
              <form onSubmit={handleSaveManualRevision} className="space-y-4">
                <div>
                  <Label htmlFor="rev-title">Revision Title (Optional)</Label>
                  <Input
                    id="rev-title"
                    type="text"
                    placeholder="e.g. Mastered Acoustic Mix"
                    value={revisionTitle}
                    onChange={(e) => setRevisionTitle(e.target.value)}
                  />
                </div>

                {/* Audio File Section */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3.5 dark:border-gray-800 dark:bg-gray-900/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label className="mb-0 flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-300">
                      <FiMusic className="text-brand-500" size={14} /> Replace / Update Audio Track (MP3/WAV)
                    </Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        ref={audioInputRef}
                        accept="audio/*,.mp3,.wav,.m4a"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e.target.files?.[0], "audio")}
                      />
                      <button
                        type="button"
                        onClick={() => audioInputRef.current?.click()}
                        disabled={uploadingAudio}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 shadow-2xs transition cursor-pointer"
                      >
                        {uploadingAudio ? <FiLoader className="animate-spin text-brand-500" size={13} /> : <FiUploadCloud className="text-brand-500" size={13} />}
                        <span>{uploadingAudio ? "Uploading..." : "Upload New Audio"}</span>
                      </button>
                    </div>
                  </div>

                  {audioUrl ? (
                    <div className="rounded-lg bg-white dark:bg-gray-800/90 p-2.5 border border-gray-200/80 dark:border-gray-700 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          Audio Track Attached
                        </span>
                        <button
                          type="button"
                          onClick={() => setAudioUrl("")}
                          className="text-gray-400 hover:text-red-500 text-xs transition flex items-center gap-1 cursor-pointer"
                        >
                          <FiTrash2 size={12} /> Remove
                        </button>
                      </div>
                      <audio controls src={audioUrl} className="h-8 w-full" />
                    </div>
                  ) : (
                    <div
                      onClick={() => audioInputRef.current?.click()}
                      className="flex flex-col items-center justify-center p-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 text-gray-400 hover:border-brand-400 hover:text-brand-500 cursor-pointer transition"
                    >
                      <FiMusic size={20} className="mb-1" />
                      <span className="text-xs">No audio attached. Click to upload (.mp3, .wav)</span>
                    </div>
                  )}
                </div>

                {/* Lyrics Editor */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-300">
                    <FiFileText className="text-brand-500" size={14} /> Updated Lyrics
                  </Label>
                  <textarea
                    rows={5}
                    placeholder="Enter updated or revised song lyrics..."
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-800 outline-none transition focus:border-brand-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90 font-mono"
                  />
                </div>

                {/* Video File */}
                {(orderType === "video" || videoUrl) && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3.5 dark:border-gray-800 dark:bg-gray-900/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="mb-0 flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-300">
                        <FiVideo className="text-purple-500" size={14} /> Replace / Update Music Video (MP4/MOV)
                      </Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={videoInputRef}
                          accept="video/*,.mp4,.mov,.webm"
                          className="hidden"
                          onChange={(e) => handleFileUpload(e.target.files?.[0], "video")}
                        />
                        <button
                          type="button"
                          onClick={() => videoInputRef.current?.click()}
                          disabled={uploadingVideo}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 shadow-2xs transition cursor-pointer"
                        >
                          {uploadingVideo ? <FiLoader className="animate-spin text-purple-500" size={13} /> : <FiUploadCloud className="text-purple-500" size={13} />}
                          <span>{uploadingVideo ? "Uploading..." : "Upload New Video"}</span>
                        </button>
                      </div>
                    </div>

                    {videoUrl ? (
                      <div className="rounded-lg bg-white dark:bg-gray-800/90 p-2.5 border border-gray-200/80 dark:border-gray-700 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Video Ready for Revision
                          </span>
                          <button
                            type="button"
                            onClick={() => setVideoUrl("")}
                            className="text-gray-400 hover:text-red-500 text-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <FiTrash2 size={12} /> Remove
                          </button>
                        </div>
                        <div className="aspect-video w-full rounded-md bg-black overflow-hidden max-h-56">
                          <video controls src={videoUrl} className="w-full h-full object-contain" />
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => videoInputRef.current?.click()}
                        className="flex flex-col items-center justify-center p-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 text-gray-400 hover:border-purple-400 hover:text-purple-500 cursor-pointer transition"
                      >
                        <FiVideo size={20} className="mb-1" />
                        <span className="text-xs">No video attached. Click to upload (.mp4, .mov)</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Note */}
                <div>
                  <Label htmlFor="rev-note">Revision Note (Shared with customer &amp; team)</Label>
                  <textarea
                    id="rev-note"
                    rows={2}
                    placeholder="Describe what was changed in this revision..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-800 outline-none transition focus:border-brand-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setIsOpen(false)}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || uploadingAudio || uploadingVideo}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-brand-600 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {saving ? (
                      <>
                        <FiLoader className="animate-spin" size={14} />
                        <span>Saving Revision...</span>
                      </>
                    ) : (
                      <>
                        <FiCheckCircle size={14} />
                        <span>Save &amp; Deliver Revision</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
