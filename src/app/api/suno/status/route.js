import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Notification from "@/models/Notification";
import { getSettings } from "@/lib/getSettings";
import { withCORS, handleOptions } from "@/lib/cors";
import { decryptTaskId } from "@/lib/encryption";
import { generatePresignedUrl } from "@/lib/s3";
import { pollMurekaLyrics, getMurekaLyricsCache } from "@/lib/mureka";
import redis from "@/lib/redis";

// Preflight — the browser sends this automatically before the real GET.
export async function OPTIONS(request) {
  return handleOptions(request);
}

// Poll endpoint for both lyrics and music task status
export async function GET(request) {
  const origin = request.headers.get("origin") || "";
  try {
    const { searchParams } = new URL(request.url);
    const encryptedTaskId = searchParams.get("taskId");
    const taskId = decryptTaskId(encryptedTaskId);
    const type = searchParams.get("type") || "music"; // "music" | "lyrics"

    if (!taskId) {
      return withCORS(NextResponse.json({ error: "taskId is required" }, { status: 400 }), origin);
    }

    const settings = await getSettings();

    // ── 1. MUSIC STATUS POLLING (DATABASE S3 TRACKS) ──
    if (type === "music") {
      await dbConnect();
      const existingOrder = await Order.findOne({ taskId: taskId });
      
      if (!existingOrder) {
        return withCORS(NextResponse.json({ status: "PENDING", tracks: [], isFullySaved: false }), origin);
      }

      const currentTracks = existingOrder.musicTracks || [];
      const allTracksReady = currentTracks.length > 0 && currentTracks.every(t => t.audioUrl && t.streamAudioUrl);

      // Check if tracks are ready FIRST. Even if status was mistakenly marked failed earlier,
      // having valid audio tracks means generation succeeded!
      if (allTracksReady) {
        // Auto-heal status if erroneously flagged as failed
        if (existingOrder.status === "failed") {
          try {
            await Order.findByIdAndUpdate(existingOrder._id, {
              status: "completed",
              $unset: { generationError: 1 }
            });
          } catch (healErr) {
            console.warn("[status/route] Auto-heal error:", healErr?.message);
          }
        }

        let secureTracks = null;
        const cacheKey = `cache:status:tracks:${taskId}`;
        try {
          const cachedJson = await redis.get(cacheKey);
          if (cachedJson) {
            secureTracks = JSON.parse(cachedJson);
          }
        } catch (cacheErr) {
          console.warn("[status/route] Redis cache read error:", cacheErr?.message);
        }

        if (!secureTracks) {
          // Generate pre-signed URLs for preview streaming (24h expiry)
          secureTracks = await Promise.all(currentTracks.map(async (track) => {
            let s3Key = track.streamAudioUrl || "";
            if (s3Key.startsWith("http://") || s3Key.startsWith("https://")) {
              try {
                const urlObj = new URL(s3Key);
                s3Key = urlObj.pathname.replace(/^\//, "");
              } catch (e) {}
            }
            let presignedUrl = track.streamAudioUrl;
            if (s3Key && (s3Key.startsWith("music/") || !s3Key.startsWith("http"))) {
              presignedUrl = await generatePresignedUrl(s3Key, 86400); // 24 hours expiry
            }
            return {
              id: track.id,
              title: track.title,
              streamAudioUrl: presignedUrl,
              imageUrl: track.imageUrl,
              duration: track.duration,
              lyrics: track.lyrics,
            };
          }));

          try {
            await redis.set(cacheKey, JSON.stringify(secureTracks), "EX", 3600); // Cache for 1 hour
          } catch (cacheSetErr) {
            console.warn("[status/route] Redis cache set error:", cacheSetErr?.message);
          }
        }

        return withCORS(NextResponse.json({
          status: "SUCCESS",
          tracks: secureTracks,
          failed: false,
          isFullySaved: true
        }), origin);
      }

      if (existingOrder.status === "failed") {
        return withCORS(
          NextResponse.json({
            status: "FAILED",
            error: existingOrder.generationError || "Music generation failed",
            failed: true,
            isFullySaved: false,
          }),
          origin
        );
      }

      // Still generating - Watchdog timeout check:
      // If an order has been pending for over 6 minutes (360 seconds) without tracks, mark as failed to break the 92% hang
      const createdAtMs = existingOrder.createdAt ? new Date(existingOrder.createdAt).getTime() : 0;
      const ageMs = Date.now() - createdAtMs;
      if (createdAtMs > 0 && ageMs > 360 * 1000 && (!currentTracks || currentTracks.length === 0)) {
        try {
          await Order.findByIdAndUpdate(existingOrder._id, {
            status: "failed",
            generationError: "Generation timed out after 6 minutes. Please try again.",
          });
        } catch (dbErr) {
          console.warn("[status/route] Watchdog DB update error:", dbErr?.message);
        }
        return withCORS(
          NextResponse.json({
            status: "FAILED",
            error: "Generation is taking longer than expected due to high AI cluster demand. Please try again.",
            failed: true,
            isFullySaved: false,
          }),
          origin
        );
      }

      return withCORS(NextResponse.json({
        status: "PENDING",
        tracks: [],
        failed: false,
        isFullySaved: false
      }), origin);
    }

    // ── 2. LYRICS STATUS POLLING ──
    if (type === "lyrics") {
      // Check if task is Mureka AI Lyrics
      if (taskId.startsWith("mureka_")) {
        const rawMurekaTaskId = taskId.replace(/^mureka_/, "");
        const cached = getMurekaLyricsCache(rawMurekaTaskId) || getMurekaLyricsCache(taskId);
        if (cached && cached.lyrics) {
          return withCORS(
            NextResponse.json({
              status: "SUCCESS",
              lyrics: cached.lyrics,
              title: cached.title || "Custom Lyrics",
              allVariations: [{ text: cached.lyrics, title: cached.title }],
            }),
            origin
          );
        }

        const apiKey = settings.murekaApiKey || process.env.MUREKA_API_KEY;
        if (!apiKey) {
          return withCORS(
            NextResponse.json({ error: "Mureka API key not configured" }, { status: 500 }),
            origin
          );
        }

        try {
          const murekaResult = await pollMurekaLyrics(rawMurekaTaskId, apiKey, settings.murekaApiBase);
          if (murekaResult.status === "SUCCESS" && murekaResult.lyrics) {
            return withCORS(
              NextResponse.json({
                status: "SUCCESS",
                lyrics: murekaResult.lyrics,
                title: murekaResult.title || "Custom Lyrics",
                allVariations: [{ text: murekaResult.lyrics, title: murekaResult.title }],
              }),
              origin
            );
          }
          return withCORS(
            NextResponse.json({
              status: "FAILED",
              error: murekaResult.error || "Mureka lyrics task not found or expired.",
              failed: true,
            }),
            origin
          );
        } catch (mErr) {
          return withCORS(
            NextResponse.json({
              status: "FAILED",
              error: mErr.message || "Failed to retrieve Mureka lyrics.",
              failed: true,
            }),
            origin
          );
        }
      }

      // Suno AI Lyrics Polling
      const apiKey = settings.sunoApiKey || process.env.SUNO_API_KEY;
      if (!apiKey) {
        return withCORS(
          NextResponse.json({ error: "SUNO API Key not configured. Please set it in Settings." }, { status: 500 }),
          origin
        );
      }

      const endpoint = `${settings.sunoApiBase || "https://api.sunoapi.org"}/api/v1/lyrics/record-info?taskId=${taskId}`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const data = await response.json();
      console.log(`[status/lyrics] Response:`, JSON.stringify(data).substring(0, 500));

      if (data.code !== 200) {
        if (data.code === 500) {
          console.warn("[status/lyrics] Suno returned temporary 500, treating as PENDING to retry...");
          return withCORS(
            NextResponse.json({
              status: "PENDING",
              lyrics: null,
              title: null,
              allVariations: [],
            }),
            origin
          );
        }
        return withCORS(
          NextResponse.json(
            { error: data.msg || "Failed to fetch status" },
            { status: 400 }
          ),
          origin
        );
      }

      const taskData = data.data;
      const status = taskData?.status;
      const lyricsItems = taskData?.response?.data || [];

      return withCORS(
        NextResponse.json({
          status,
          lyrics: status === "SUCCESS" ? (lyricsItems[0]?.text || null) : null,
          title: status === "SUCCESS" ? (lyricsItems[0]?.title || null) : null,
          allVariations: status === "SUCCESS" ? lyricsItems : [],
        }),
        origin
      );
    }
  } catch (error) {
    console.error("[status] Error:", error);
    return withCORS(NextResponse.json({ error: "Internal server error" }, { status: 500 }), origin);
  }
}