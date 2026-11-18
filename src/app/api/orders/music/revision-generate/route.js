import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Notification from "@/models/Notification";
import { getSettings } from "@/lib/getSettings";
import { uploadToS3, generatePresignedUrl } from "@/lib/s3";
import { generateMurekaSong, pollMurekaSong } from "@/lib/mureka";
import crypto from "crypto";

const TEMP_DIR = os.tmpdir();

async function downloadFileToDisk(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);
  const destStream = fs.createWriteStream(destPath);
  await pipeline(response.body, destStream);
}

function createPreview(inputPath, outputPath, durationSeconds = 45) {
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .setStartTime("00:00:15")
      .setDuration(durationSeconds.toString())
      .output(outputPath)
      .on("end", () => resolve(true))
      .on("error", (err) => {
        console.warn("[revision-generate] ffmpeg preview warning:", err.message || err);
        resolve(false);
      })
      .run();
  });
}

export async function POST(request) {
  try {
    await dbConnect();
    const settings = await getSettings();
    const previewDuration = settings?.previewDurationSeconds || 45;

    const body = await request.json().catch(() => ({}));
    const {
      orderId,
      shopifyOrderId,
      musicId,
      lyrics,
      genre,
      voice,
      mood,
      occasion,
      songTitle,
      revisionTitle,
      note,
      customerEmail,
    } = body;

    let targetOrder = null;
    const cleanShopifyId = shopifyOrderId ? String(shopifyOrderId).replace(/^#/, "").trim() : null;

    if (orderId && String(orderId).match(/^[0-9a-fA-F]{24}$/)) {
      targetOrder = await Order.findById(orderId);
    }
    if (!targetOrder && musicId && musicId !== "N/A") {
      targetOrder = await Order.findOne({ musicId: musicId });
    }
    if (!targetOrder && cleanShopifyId) {
      targetOrder = await Order.findOne({
        $or: [
          { shopifyOrderId: cleanShopifyId },
          { shopifyOrderId: `#${cleanShopifyId}` },
          { shopifyOrderNumber: cleanShopifyId },
          { shopifyOrderNumber: `#${cleanShopifyId}` },
        ],
      });
    }

    if (!targetOrder) {
      return NextResponse.json({ success: false, error: "Order not found in database" }, { status: 404 });
    }

function cleanS3Key(urlOrKey) {
  if (!urlOrKey) return "";
  if (typeof urlOrKey !== "string") return String(urlOrKey);
  if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
    try {
      const u = new URL(urlOrKey);
      return u.pathname.replace(/^\/+/, "");
    } catch (e) {
      return urlOrKey;
    }
  }
  return urlOrKey;
}

    // ACTION 1: CONFIRM AND SAVE SELECTED REVISION TRACK (SUPPORTS 1 OR 2 SONGS)
    if (body.action === "confirm" || body.action === "save") {
      const {
        selectedTrack,
        selectedTracks,
        allTracks,
        version: requestedVersion,
        revisionTitle,
        note,
        lyrics,
        genre,
        customStyle,
        voice,
        mood,
        occasion,
      } = body;

      const tracksToSave = Array.isArray(selectedTracks) && selectedTracks.length > 0
        ? selectedTracks
        : (selectedTrack ? [selectedTrack] : []);

      if (tracksToSave.length === 0) {
        return NextResponse.json({ success: false, error: "No track was selected for the revision." }, { status: 400 });
      }

      const primaryTrack = tracksToSave[0];
      const secondaryTrack = tracksToSave[1] || null;

      const highestVer = (targetOrder.revisions || []).reduce((max, r) => Math.max(max, r.version || 0), targetOrder.currentVersion || 1);
      const version = requestedVersion || (highestVer + 1);

      const audioKey = cleanS3Key(primaryTrack.s3Key || primaryTrack.audioKey || primaryTrack.audioUrl);
      const streamKey = cleanS3Key(primaryTrack.streamS3Key || primaryTrack.streamKey || primaryTrack.streamAudioUrl || audioKey);
      
      const secondaryAudioKey = secondaryTrack ? cleanS3Key(secondaryTrack.s3Key || secondaryTrack.audioKey || secondaryTrack.audioUrl) : "";
      const secondaryStreamKey = secondaryTrack ? cleanS3Key(secondaryTrack.streamS3Key || secondaryTrack.streamKey || secondaryTrack.streamAudioUrl || secondaryAudioKey) : "";

      const finalTitle = revisionTitle && !revisionTitle.match(/^Revision\s+v\d+$/i)
        ? revisionTitle
        : `Revision v${version}`;

      const safeLyrics = lyrics || targetOrder.lyrics || "";
      const safeGenre = customStyle || genre || targetOrder.genre || "";
      const safeVoice = voice || targetOrder.voice || "";
      const safeMood = mood || targetOrder.mood || "";
      const safeOccasion = occasion || targetOrder.occasion || "";

      const formattedTracks = tracksToSave.map((t, idx) => ({
        id: t.id || `rev_${version}_track_${idx + 1}`,
        title: t.title || `${finalTitle} (Option ${idx + 1})`,
        audioUrl: cleanS3Key(t.s3Key || t.audioKey || t.audioUrl),
        streamAudioUrl: cleanS3Key(t.streamS3Key || t.streamKey || t.streamAudioUrl || t.audioUrl),
        duration: t.duration || 0,
        lyrics: safeLyrics,
      }));

      const newRevision = {
        version,
        title: finalTitle,
        audioUrl: audioKey,
        audioKey: audioKey,
        streamAudioUrl: streamKey,
        secondaryAudioUrl: secondaryAudioKey,
        secondaryStreamAudioUrl: secondaryStreamKey,
        selectedTrackIds: tracksToSave.map((t) => t.id),
        tracks: formattedTracks,
        lyrics: safeLyrics,
        genre: safeGenre,
        voice: safeVoice,
        mood: safeMood,
        note: note || `AI generated revision with ${safeGenre} style & ${safeVoice} vocals (${tracksToSave.length} song${tracksToSave.length > 1 ? "s" : ""} selected)`,
        customFiles: [],
        createdBy: "admin",
        createdAt: new Date(),
      };

      targetOrder.revisions = targetOrder.revisions || [];
      const existingRevIdx = targetOrder.revisions.findIndex((r) => r.version === version);
      if (existingRevIdx !== -1) {
        targetOrder.revisions[existingRevIdx] = newRevision;
      } else {
        targetOrder.revisions.push(newRevision);
      }
      targetOrder.currentVersion = Math.max(targetOrder.currentVersion || 1, version);

      // Save formatted tracks to musicTracks so both options are accessible
      if (formattedTracks.length > 0) {
        targetOrder.musicTracks = formattedTracks;
        targetOrder.selectedDemo = primaryTrack.id;
      } else if (allTracks && Array.isArray(allTracks)) {
        targetOrder.musicTracks = allTracks.map((t) => ({
          id: t.id,
          title: t.title,
          audioUrl: cleanS3Key(t.s3Key || t.audioUrl),
          streamAudioUrl: cleanS3Key(t.streamS3Key || t.streamAudioUrl || t.s3Key || t.audioUrl),
          duration: t.duration || 0,
          lyrics: safeLyrics,
        }));
      }

      if (safeLyrics) targetOrder.lyrics = safeLyrics;
      if (safeGenre) targetOrder.genre = safeGenre;
      if (safeVoice) targetOrder.voice = safeVoice;
      if (safeMood) targetOrder.mood = safeMood;
      if (safeOccasion) targetOrder.occasion = safeOccasion;

      await targetOrder.save();

      // Create notification defensively
      try {
        await Notification.create({
          title: `Order Revision v${version} Ready`,
          message: `A new AI revision (v${version}) with ${tracksToSave.length} selected song(s) was saved for ${targetOrder.email || customerEmail}!`,
          type: "revision_added",
          link: `/ordered-musics/${targetOrder._id}`,
        });
      } catch (notifErr) {
        console.warn("[revision-generate] Notification create warning:", notifErr.message || notifErr);
      }

      const presignedAudio = await generatePresignedUrl(audioKey, 7 * 24 * 3600);
      const presignedStream = await generatePresignedUrl(streamKey, 7 * 24 * 3600);
      const presignedSecondaryAudio = secondaryAudioKey ? await generatePresignedUrl(secondaryAudioKey, 7 * 24 * 3600) : "";
      const presignedSecondaryStream = secondaryStreamKey ? await generatePresignedUrl(secondaryStreamKey, 7 * 24 * 3600) : "";

      try {
        const { revalidatePath } = await import("next/cache");
        if (targetOrder.shopifyOrderId) revalidatePath(`/orders/music/${targetOrder.shopifyOrderId}`);
        if (cleanShopifyId) revalidatePath(`/orders/music/${cleanShopifyId}`);
        revalidatePath(`/orders/music/${targetOrder._id}`);
        revalidatePath("/orders/music");
      } catch (e) {}

      return NextResponse.json({
        success: true,
        message: `Revision v${version} (${tracksToSave.length} song${tracksToSave.length > 1 ? "s" : ""}) confirmed and saved successfully!`,
        version,
        revision: {
          ...newRevision,
          audioUrl: presignedAudio,
          streamAudioUrl: presignedStream,
          secondaryAudioUrl: presignedSecondaryAudio,
          secondaryStreamAudioUrl: presignedSecondaryStream,
        },
      });
    }

    // ACTION 2: GENERATE AUDIO TRACKS (Returns preview for user selection)
    const reqProvider = body.provider ? String(body.provider).toLowerCase().trim() : null;
    const activeProvider = (reqProvider === "mureka" || reqProvider === "suno")
      ? reqProvider
      : (settings.activeAiProvider === "mureka" ? "mureka" : "suno");
    const isMureka = activeProvider === "mureka";
    const apiKey = isMureka
      ? (settings.murekaApiKey || process.env.MUREKA_API_KEY)
      : (settings.sunoApiKey || process.env.SUNO_API_KEY);
    const apiBase = isMureka
      ? (settings.murekaApiBase || "https://api.mureka.ai")
      : (settings.sunoApiBase || "https://api.sunoapi.org");

    if (!apiKey) {
      const providerName = isMureka ? "Mureka AI" : "Suno AI";
      return NextResponse.json({ success: false, error: `${providerName} API key is not configured in Settings.` }, { status: 400 });
    }

    const safeLyrics = lyrics || targetOrder.lyrics || "A beautiful custom song full of memories and love.";
    const safeGenre = body.customStyle || body.customGenre || genre || targetOrder.genre || "Pop";
    const safeVoice = voice || targetOrder.voice || "Male";
    const safeMood = mood || targetOrder.mood || "Emotional";
    const safeOccasion = occasion || targetOrder.occasion || "Special Occasion";
    let rawTitle = "Custom Song";
    if (songTitle && !String(songTitle).toLowerCase().includes("undefined")) {
      rawTitle = songTitle.trim();
    } else if (targetOrder.recipientName && !String(targetOrder.recipientName).toLowerCase().includes("undefined")) {
      rawTitle = `Song for ${targetOrder.recipientName}`.trim();
    } else if (targetOrder.songTitle && !String(targetOrder.songTitle).toLowerCase().includes("undefined")) {
      rawTitle = targetOrder.songTitle.trim();
    }
    const safeTitle = rawTitle.substring(0, 80);
    const safeStyle = body.customStyle && body.customStyle.trim()
      ? body.customStyle.trim().substring(0, 200)
      : [safeGenre, safeVoice, safeMood, safeOccasion].filter(Boolean).join(", ").substring(0, 200) || "Pop, Melodic";

    console.log(`[revision-generate] Starting ${activeProvider.toUpperCase()} revision for order ${targetOrder._id}... Title: ${safeTitle}, Style: ${safeStyle}`);

    let generatedTracks = [];

    if (isMureka) {
      const murekaModel = settings.murekaModel || "mureka-9.5";
      const murekaRes = await generateMurekaSong(
        apiKey,
        {
          lyrics: safeLyrics.substring(0, 3000),
          prompt: safeStyle,
          style: safeStyle,
          title: safeTitle,
          model: murekaModel,
          callBackUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/suno/callback`,
        },
        apiBase
      );
      const murekaTaskId = murekaRes.taskId;
      generatedTracks = await pollMurekaSong(murekaTaskId, apiKey, apiBase, 120);
    } else {
      const sunoModel = settings.sunoModel || "V3_5";
      const startRes = await fetch(`${apiBase}/api/v1/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: safeLyrics.substring(0, 3000),
          style: safeStyle,
          title: safeTitle,
          customMode: true,
          instrumental: false,
          model: sunoModel,
          callBackUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/suno/callback`,
        }),
      });

      const startData = await startRes.json();
      if (startData.code !== 200 || !startData.data?.taskId) {
        return NextResponse.json({
          success: false,
          error: startData.msg || "Failed to start Suno AI generation for revision.",
        }, { status: 400 });
      }

      const sunoTaskId = startData.data.taskId;
      console.log(`[revision-generate] Suno AI revision task started: ${sunoTaskId}. Polling for completion...`);

      // Poll Suno API until tracks are ready (up to 120 attempts = 4 mins)
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const pollRes = await fetch(`${apiBase}/api/v1/generate/record-info?taskId=${sunoTaskId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: "no-store",
          });
          if (pollRes.ok) {
            const pollJson = await pollRes.json();
            const sunoData = pollJson?.data?.response?.sunoData || [];
            const taskStatus = pollJson?.data?.status;

            if (["FAILED", "CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED"].includes(taskStatus)) {
              throw new Error(`Suno AI generation failed with status: ${taskStatus}`);
            }

            if ((["SUCCESS", "FIRST_SUCCESS"].includes(taskStatus) || sunoData.length > 0) && sunoData.some((t) => t.audioUrl)) {
              generatedTracks = sunoData.filter((t) => t.audioUrl);
              if (taskStatus === "SUCCESS" || generatedTracks.length >= 2 || i > 25) {
                break;
              }
            }
          }
        } catch (pollErr) {
          console.warn("[revision-generate] Polling warning:", pollErr?.message);
        }
      }
    }

    if (!generatedTracks || generatedTracks.length === 0) {
      return NextResponse.json({
        success: false,
        error: "AI Generation timed out or did not return audio tracks. Please try again.",
      }, { status: 504 });
    }

    // Process all generated tracks and upload to S3
    const highestVer = (targetOrder.revisions || []).reduce((max, r) => Math.max(max, r.version || 0), targetOrder.currentVersion || 1);
    const newVersion = highestVer + 1;

    const processedTracks = [];

    for (let idx = 0; idx < generatedTracks.length; idx++) {
      const t = generatedTracks[idx];
      const trackId = t.id || crypto.randomUUID();
      const fullPath = path.join(TEMP_DIR, `${trackId}_rev_full.mp3`);
      const previewPath = path.join(TEMP_DIR, `${trackId}_rev_preview.mp3`);

      try {
        console.log(`[revision-generate] Downloading revision track ${idx + 1}...`);
        await downloadFileToDisk(t.audioUrl, fullPath);

        console.log(`[revision-generate] Creating preview for revision track ${idx + 1}...`);
        const previewCreated = await createPreview(fullPath, previewPath, previewDuration);

        const s3FullKey = `music/${targetOrder._id}/revision_v${newVersion}_var${idx + 1}_${crypto.randomUUID()}.mp3`;
        const s3PreviewKey = `music/${targetOrder._id}/revision_v${newVersion}_var${idx + 1}_${crypto.randomUUID()}_preview.mp3`;

        console.log(`[revision-generate] Uploading revision track to S3: ${s3FullKey}...`);
        await uploadToS3(fullPath, s3FullKey, "audio/mpeg");

        if (previewCreated && fs.existsSync(previewPath)) {
          await uploadToS3(previewPath, s3PreviewKey, "audio/mpeg");
        }

        const presignedFull = await generatePresignedUrl(s3FullKey, 7 * 24 * 3600);
        const presignedPreview = previewCreated ? await generatePresignedUrl(s3PreviewKey, 7 * 24 * 3600) : presignedFull;

        const variationTitle = t.title || (generatedTracks.length > 1 ? `${safeTitle} (Variation ${idx + 1})` : `${safeTitle}`);

        processedTracks.push({
          id: trackId,
          variationNumber: idx + 1,
          title: variationTitle,
          audioUrl: presignedFull,
          s3Key: s3FullKey,
          streamAudioUrl: presignedPreview,
          streamS3Key: previewCreated ? s3PreviewKey : s3FullKey,
          imageUrl: t.imageUrl || "",
          duration: t.duration || 0,
          lyrics: safeLyrics,
        });
      } catch (trackErr) {
        console.error(`[revision-generate] Error processing track ${trackId}:`, trackErr);
      } finally {
        try {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
        } catch (e) {}
      }
    }

    if (processedTracks.length === 0) {
      return NextResponse.json({ success: false, error: "Failed to download and upload generated audio to S3." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      stage: "preview",
      message: `AI generated ${processedTracks.length} musical variations! Please select which version to save.`,
      newVersion,
      tracks: processedTracks,
      orderId: targetOrder._id.toString(),
      lyrics: safeLyrics,
      genre: safeGenre,
      voice: safeVoice,
      mood: safeMood,
      occasion: safeOccasion,
    });
  } catch (error) {
    console.error("[revision-generate] Fatal error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
