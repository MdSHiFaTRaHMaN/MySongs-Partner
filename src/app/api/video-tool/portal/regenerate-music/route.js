import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import Order from "@/models/Order";
import Notification from "@/models/Notification";
import { getSettings } from "@/lib/getSettings";
import { withCORS, handleOptions } from "@/lib/cors";
import { musicQueue } from "@/lib/queue";
import { encryptTaskId } from "@/lib/encryption";

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const token = (body.token || "").trim();
    const legacyId = (body.id || body.orderNumber || "").replace(/^#/, "").trim();

    if (!token && !legacyId) {
      return withCORS(
        NextResponse.json({ success: false, error: "Upload token or order identifier is required" }, { status: 400 }),
        origin
      );
    }

    let queryConditions = [];
    if (token) {
      queryConditions.push({ uploadToken: token });
      queryConditions.push({ "tokenHistory.token": token });
      try {
        const fuzzyPattern = token
          .replace(/[8B]/gi, "[8B]")
          .replace(/[0O]/gi, "[0O]")
          .replace(/[1Il]/gi, "[1Il]");
        queryConditions.push({ uploadToken: { $regex: new RegExp(`^${fuzzyPattern}$`, "i") } });
        queryConditions.push({ "tokenHistory.token": { $regex: new RegExp(`^${fuzzyPattern}$`, "i") } });
      } catch (e) {}
    }
    if (legacyId) {
      if (legacyId.match(/^[0-9a-fA-F]{24}$/)) {
        queryConditions.push({ _id: legacyId });
      }
      queryConditions.push({ videoId: legacyId });
      queryConditions.push({ shopifyOrderId: legacyId });
      queryConditions.push({ shopifyOrderNumber: legacyId });
      queryConditions.push({ shopifyOrderNumber: `#${legacyId}` });
    }

    const videoOrder = await VideoOrder.findOne({ $or: queryConditions });

    if (!videoOrder) {
      return withCORS(
        NextResponse.json({ success: false, error: "Video order not found for this link" }, { status: 404 }),
        origin
      );
    }

    // Check if portal is locked / consumed
    if (token && videoOrder.uploadToken !== token) {
      return withCORS(
        NextResponse.json({
          success: false,
          error: "This upload link is inactive. Please use your newest link or contact support.",
        }, { status: 403 }),
        origin
      );
    }

    if (videoOrder.uploadTokenStatus !== "active" && videoOrder.uploadTokenStatus !== undefined) {
      return withCORS(
        NextResponse.json({
          success: false,
          error: "This portal is currently locked. Music regeneration is not available.",
        }, { status: 403 }),
        origin
      );
    }

    // Check if Music Regeneration is allowed by admin for this video customer
    if (videoOrder.allowMusicRegeneration === false) {
      return withCORS(
        NextResponse.json({
          success: false,
          error: "Music regeneration is currently disabled for this order. Please contact our support team.",
        }, { status: 403 }),
        origin
      );
    }

    // Find linked Music Order
    let musicOrder = null;
    if (videoOrder.originalMusicOrderId) {
      musicOrder = await Order.findById(videoOrder.originalMusicOrderId);
    }
    if (!musicOrder) {
      musicOrder = await Order.findOne({
        $or: [
          ...(videoOrder.shopifyOrderId ? [{ shopifyOrderId: videoOrder.shopifyOrderId }] : []),
          ...(videoOrder.shopifyOrderNumber ? [
            { shopifyOrderNumber: videoOrder.shopifyOrderNumber },
            { shopifyOrderNumber: `#${String(videoOrder.shopifyOrderNumber).replace(/^#/, "")}` },
            { shopifyOrderNumber: String(videoOrder.shopifyOrderNumber).replace(/^#/, "") },
          ] : []),
          ...(videoOrder.email ? [{ email: videoOrder.email }] : []),
        ],
      }).sort({ createdAt: -1 });
    }

    if (!musicOrder) {
      return withCORS(
        NextResponse.json({
          success: false,
          error: "Associated music order details could not be found to regenerate music.",
        }, { status: 404 }),
        origin
      );
    }

    // Get settings and API credentials
    const settings = await getSettings();
    const activeProvider = settings.activeAiProvider === "mureka" ? "mureka" : "suno";
    const apiKey = activeProvider === "mureka"
      ? (settings.murekaApiKey || process.env.MUREKA_API_KEY)
      : (settings.sunoApiKey || process.env.SUNO_API_KEY);

    if (!apiKey) {
      const providerName = activeProvider === "mureka" ? "Mureka AI" : "Suno AI";
      return withCORS(
        NextResponse.json({ error: `${providerName} API Key not configured.` }, { status: 500 }),
        origin
      );
    }

    const lyricsText = musicOrder.lyrics || musicOrder.generatedLyrics || musicOrder.ownLyrics || "";
    if (!lyricsText) {
      return withCORS(
        NextResponse.json({
          success: false,
          error: "Song lyrics were not found on this order to generate new music.",
        }, { status: 400 }),
        origin
      );
    }

    const callBackUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/suno/callback`;
    const safeStyle = (musicOrder.genre || "Pop").substring(0, 200);
    const safeTitle = (musicOrder.recipientName ? `${musicOrder.recipientName}'s Song` : "Custom Song").substring(0, 80);
    const safeLyrics = lyricsText.substring(0, 3000);

    const sunoModel = settings.sunoModel || "V3_5";
    const murekaModel = settings.murekaModel || "mureka-9.5";

    const sunoBody = {
      prompt: safeLyrics,
      style: safeStyle,
      title: safeTitle,
      customMode: true,
      instrumental: false,
      model: sunoModel,
      callBackUrl,
    };

    const newTaskId = crypto.randomUUID();

    // Update music order taskId & reset status to created
    musicOrder.taskId = newTaskId;
    musicOrder.status = "created";
    await musicOrder.save();

    // Link music order to video order if not already linked
    if (!videoOrder.originalMusicOrderId) {
      videoOrder.originalMusicOrderId = musicOrder._id;
      await videoOrder.save();
    }

    // Enqueue music generation job to BullMQ queue
    await musicQueue.add("generate-music", {
      taskId: newTaskId,
      orderId: musicOrder._id,
      provider: activeProvider,
      sunoBody,
      murekaBody: {
        lyrics: safeLyrics,
        prompt: [musicOrder.genre, musicOrder.voice, musicOrder.mood, musicOrder.occasion].filter(Boolean).join(", ") || safeStyle || "Pop, melodic",
        style: safeStyle || "Pop",
        title: safeTitle || "Custom Song",
        model: murekaModel,
      },
      apiKey,
      apiBase: activeProvider === "mureka" ? (settings.murekaApiBase || "https://api.mureka.ai") : settings.sunoApiBase,
    }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    try {
      await Notification.create({
        title: "Video Customer Music Regeneration",
        message: `${videoOrder.email || "Customer"} requested fresh music regeneration for Video Order ${videoOrder.shopifyOrderNumber || `#${videoOrder.shopifyOrderId}`}.`,
        type: "music_started",
        link: `/orders/video/${videoOrder.shopifyOrderId || videoOrder._id}`,
      });
    } catch (notifErr) {
      console.warn("[portal regenerate-music] Notification warning:", notifErr);
    }

    return withCORS(
      NextResponse.json({
        success: true,
        message: "New music generation started!",
        taskId: encryptTaskId(newTaskId),
      }),
      origin
    );
  } catch (error) {
    console.error("[POST /api/video-tool/portal/regenerate-music Error]:", error);
    return withCORS(
      NextResponse.json({ success: false, error: error.message || "Failed to regenerate music" }, { status: 500 }),
      origin
    );
  }
}

