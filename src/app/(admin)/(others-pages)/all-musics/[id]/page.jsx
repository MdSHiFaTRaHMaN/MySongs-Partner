import React from "react";
import Link from "next/link";
import BackButton from "@/components/common/BackButton";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Badge from "@/components/ui/badge/Badge";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/getSettings";
import SyncMusicButton from "@/components/common/SyncMusicButton";
import DeleteOrderButton from "@/components/common/DeleteOrderButton";
import ForceDownloadButton from "@/components/common/ForceDownloadButton";
import FetchMusicFileButton from "@/components/common/FetchMusicFileButton";
import { generatePresignedUrl, extractS3Key, checkS3KeyExists } from "@/lib/s3";

export const dynamic = "force-dynamic";

export default async function MusicDetailPage({ params }) {
  const { id } = await params;
  const settings = await getSettings();
  await dbConnect();
  let order = await Order.findById(id).lean();

  if (!order) return notFound();

  // Auto-sync missing audioUrls from Suno API
  const apiKey = settings?.sunoApiKey || process.env.SUNO_API_KEY;
  const apiBase = settings?.sunoApiBase || process.env.SUNO_API_BASE || "https://api.sunoapi.org";
  const isValidTaskId = order.taskId && !order.taskId.startsWith("shopify_") && !order.taskId.startsWith("manual_");
  if (apiKey && isValidTaskId && order.musicTracks?.length > 0 && order.musicTracks.some(t => !t.audioUrl || !t.duration)) {
    try {
      const response = await fetch(`${apiBase}/api/v1/generate/record-info?taskId=${order.taskId}`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
        cache: "no-store"
      });
      const data = await response.json();
      const sunoData = data?.data?.response?.sunoData;

      if (sunoData && sunoData.length > 0) {
        const allTracksReady = sunoData.every(t => t.audioUrl && t.duration);
        if (allTracksReady) {
          const updatedTracks = sunoData.map(track => ({
            id: track.id,
            title: track.title,
            audioUrl: track.audioUrl,
            streamAudioUrl: track.streamAudioUrl,
            imageUrl: track.imageUrl,
            duration: track.duration,
            lyrics: track.prompt,
          }));
          await Order.updateOne({ _id: order._id }, { $set: { musicTracks: updatedTracks } });
          order.musicTracks = updatedTracks; // Update local reference
        }
      }
    } catch (err) {
      console.error("Auto-sync error on all-musics detail page:", err);
    }
  }

  // Check if audio file actually exists on S3 storage
  let hasValidS3Audio = false;
  if (order.musicTracks && order.musicTracks.length > 0) {
    for (const track of order.musicTracks) {
      const rawAudioKey = track.audioUrl || track.streamAudioUrl;
      const cleanKey = extractS3Key(rawAudioKey);
      const existsOnS3 = cleanKey ? await checkS3KeyExists(cleanKey) : false;

      if (existsOnS3) {
        hasValidS3Audio = true;
        if (track.audioUrl && !track.audioUrl.startsWith("http")) {
          track.audioUrl = await generatePresignedUrl(track.audioUrl, 604800); // 7 days
        }
        if (track.streamAudioUrl && !track.streamAudioUrl.startsWith("http")) {
          track.streamAudioUrl = await generatePresignedUrl(track.streamAudioUrl, 604800);
        }
      } else {
        track.audioUrl = "";
        track.streamAudioUrl = "";
      }
    }
  }

  // Auto-heal status if erroneously flagged as failed but audio files exist on S3
  if (order.status === "failed" && hasValidS3Audio) {
    try {
      await Order.updateOne({ _id: order._id }, { $set: { status: "completed" }, $unset: { generationError: 1 } });
      order.status = "completed";
      delete order.generationError;
    } catch (e) {
      console.warn("Auto-heal status error:", e.message);
    }
  }

  const serialized = JSON.parse(JSON.stringify(order));
  const selectedTrack = serialized.musicTracks?.find(t => t.id === serialized.selectedDemo) || serialized.musicTracks?.[0];

  // If S3 file is missing or tracks are empty, needsSync is true and button is shown
  const needsSync = !hasValidS3Audio || !serialized.musicTracks || serialized.musicTracks.length === 0;

  return (
    <div>
      <PageBreadcrumb pageTitle="Song Details" />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">

        {/* Left: Customer & Order Info */}
        <div className="xl:col-span-2 space-y-6">

          {/* Customer Info */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Customer Information</h3>
              {needsSync && (
                <div className="flex items-center gap-2">
                  <FetchMusicFileButton
                    orderId={serialized._id}
                    taskId={serialized.taskId}
                    musicId={serialized.musicId}
                    email={serialized.email}
                    buttonText="Sync Music File"
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                ["Email", serialized.email],
                ["Recipient", serialized.forWho === "specific" ? serialized.recipientName : "General"],
                ["Occasion", serialized.occasion],
                ["Package", serialized.selectedPackage?.toUpperCase() || "None"],
                ["Genre", serialized.genre],
                ["Voice", serialized.voice],
                ["Mood", serialized.mood],
                ["Language", serialized.language || "English"],
                ["Status", null],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
                  {label === "Status" ? (
                    <Badge
                      size="sm"
                      color={
                        (serialized.status === "paid" || serialized.status === "fulfilled" || serialized.status === "completed") ? "success"
                          : serialized.status === "delivering" ? "info"
                            : serialized.status === "pending_payment" ? "warning"
                              : serialized.status === "created" ? "light"
                                : "error"
                      }
                    >
                      {serialized.status === "delivering" ? "Delivering" : serialized.status === "fulfilled" ? "Fulfilled" : serialized.status === "completed" ? "Completed" : serialized.status === "created" ? "Created" : serialized.status}
                    </Badge>
                  ) : (
                    <p className="font-medium text-gray-800 dark:text-white/90">{value || "—"}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {serialized.orderNotes && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-3 text-lg font-semibold text-gray-800 dark:text-white/90">Order Notes</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{serialized.orderNotes}</p>
            </div>
          )}

          {/* Lyrics */}
          {serialized.lyrics && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Song Lyrics</h3>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400 border border-brand-200 dark:border-brand-800">
                  Lyrics Provider: {
                    serialized.creationMethod === "own_lyrics"
                      ? "Customer's Own Lyrics"
                      : (serialized.storyText?.length > 200)
                      ? "Mureka AI (> 200 chars)"
                      : "Suno AI (≤ 200 chars)"
                  }
                </span>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{serialized.lyrics}</pre>
            </div>
          )}

          {/* Story */}
          {serialized.storyText && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-3 text-lg font-semibold text-gray-800 dark:text-white/90">Customer&apos;s Story</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{serialized.storyText}</p>
            </div>
          )}
        </div>

        {/* Right: Audio Tracks */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">
              Generated Tracks ({serialized.musicTracks?.length || 0})
            </h3>

            {serialized.musicTracks?.length > 0 ? (
              <div className="space-y-5">
                {serialized.musicTracks.map((track, idx) => {
                  const audioUrl = track.audioUrl || track.streamAudioUrl;
                  const isSelected = track.id === serialized.selectedDemo;
                  return (
                    <div
                      key={track.id || idx}
                      className={`rounded-xl border p-4 ${isSelected ? "border-brand-400 bg-brand-50 dark:border-brand-500/50 dark:bg-brand-500/5" : "border-gray-200 dark:border-gray-700"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                          {track.title || `Version ${idx + 1}`}
                        </p>
                        {isSelected && (
                          <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-white">Selected</span>
                        )}
                      </div>
                      {track.imageUrl && (
                        <img src={track.imageUrl} alt={track.title} className="mb-3 h-32 w-full rounded-lg object-cover" />
                      )}
                      {audioUrl && (
                        <div className="flex flex-col gap-2 mt-3">
                          <audio controls controlsList="nodownload noplaybackrate" src={audioUrl} className="w-full h-10" />
                          <ForceDownloadButton
                            url={audioUrl}
                            filename={`${track.title || "music"} - My Own Songs.mp3`}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-50 py-2 text-xs font-semibold text-brand-500 transition hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Download this track
                          </ForceDownloadButton>
                        </div>
                      )}
                      {track.duration && (
                        <p className="mt-2 text-center text-xs text-gray-400">
                          Duration: {Math.floor(track.duration / 60)}:{String(Math.floor(track.duration % 60)).padStart(2, "0")} min
                        </p>
                      )}
                      {track.lyrics && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Track Lyrics:</p>
                          <pre className="whitespace-pre-wrap text-xs text-gray-500 dark:text-gray-400 max-h-40 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-800 rounded">{track.lyrics}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-center space-y-3">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  No music audio file available in database or S3.
                </p>
                <div className="flex justify-center">
                  <FetchMusicFileButton
                    orderId={serialized._id}
                    taskId={serialized.taskId}
                    musicId={serialized.musicId}
                    email={serialized.email}
                    buttonText="Fetch Music from Suno / S3"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Order Meta */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-3 text-lg font-semibold text-gray-800 dark:text-white/90">Order Meta</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Order ID</span>
                <span className="font-mono text-xs text-gray-600 dark:text-gray-300">{serialized._id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Created</span>
                <span className="text-gray-600 dark:text-gray-300">
                  {new Date(serialized.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              </div>
              {serialized.musicId && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Task ID</span>
                  <span className="font-mono text-xs text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{serialized.musicId}</span>
                </div>
              )}
            </div>
          </div>

          <BackButton
            fallbackUrl="/all-musics"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]"
          >
            ← Back to All Musics
          </BackButton>
          <DeleteOrderButton
            orderId={serialized._id}
            redirectUrl="/all-musics"
            customerEmail={serialized.email}
            retentionDays={settings.trashBinRetentionDays ?? 30}
          />
        </div>
      </div>
    </div>
  );
}
