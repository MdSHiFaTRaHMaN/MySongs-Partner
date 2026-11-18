import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import Order from "@/models/Order";
import Notification from "@/models/Notification";
import { withCORS, handleOptions } from "@/lib/cors";
import { generatePresignedUrl } from "@/lib/s3";

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const token = (searchParams.get("token") || "").trim();
    const legacyId = (searchParams.get("id") || searchParams.get("orderNumber") || searchParams.get("order") || "").replace(/^#/, "").trim();

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

    const order = await VideoOrder.findOne({ $or: queryConditions });

    if (!order) {
      return withCORS(
        NextResponse.json({ success: false, error: "Video order not found for this link" }, { status: 404 }),
        origin
      );
    }

    // Determine edit permission:
    let canEdit = false;
    let tokenStatus = "consumed";

    if (token) {
      let matchesActiveToken = false;
      if (order.uploadToken === token) {
        matchesActiveToken = true;
      } else {
        try {
          const fuzzyPattern = token
            .replace(/[8B]/gi, "[8B]")
            .replace(/[0O]/gi, "[0O]")
            .replace(/[1Il]/gi, "[1Il]");
          matchesActiveToken = new RegExp(`^${fuzzyPattern}$`, "i").test(order.uploadToken || "");
        } catch (e) {}
      }

      if (matchesActiveToken && (order.uploadTokenStatus === "active" || !order.uploadTokenStatus)) {
        canEdit = true;
        tokenStatus = "active";
      } else {
        canEdit = false;
        tokenStatus = order.uploadTokenStatus || "consumed";
      }
    } else {
      // Legacy fallback access (without token)
      canEdit = order.uploadTokenStatus === "active";
      tokenStatus = order.uploadTokenStatus || "active";
    }

    // Generate fresh presigned URLs for safe viewing
    let audioFile = null;
    if (order.audioFile && (order.audioFile.key || order.audioFile.url)) {
      const audioKey = order.audioFile.key || order.audioFile.url;
      let playableUrl = order.audioFile.url || "";
      if (audioKey && !audioKey.startsWith("http://") && !audioKey.startsWith("https://")) {
        try {
          playableUrl = await generatePresignedUrl(audioKey, 7 * 24 * 3600);
        } catch (e) {
          console.warn("[portal API] Failed to presign audio:", e);
        }
      }
      audioFile = {
        name: order.audioFile.name || "Custom Audio",
        key: audioKey,
        url: playableUrl,
        size: order.audioFile.size || 0,
      };
    }

    let mediaFiles = [];
    if (Array.isArray(order.mediaFiles)) {
      mediaFiles = await Promise.all(
        order.mediaFiles.map(async (m, idx) => {
          const rawKey = m.key || m.url || "";
          let viewUrl = m.url || "";
          if (rawKey && !rawKey.startsWith("http://") && !rawKey.startsWith("https://")) {
            try {
              viewUrl = await generatePresignedUrl(rawKey, 7 * 24 * 3600);
            } catch (e) {}
          }
          return {
            id: m._id ? m._id.toString() : `media_${idx}`,
            key: rawKey,
            url: viewUrl,
            name: m.name || `File ${idx + 1}`,
            size: m.size || 0,
            type: m.type || "image",
            mimeType: m.mimeType || "",
            order: m.order || idx,
          };
        })
      );
    }

    // Fetch associated Music Order to find available tracks and check if music can be regenerated
    let linkedMusicOrder = null;
    if (order.originalMusicOrderId) {
      linkedMusicOrder = await Order.findById(order.originalMusicOrderId);
    }
    if (!linkedMusicOrder) {
      linkedMusicOrder = await Order.findOne({
        $or: [
          ...(order.shopifyOrderId ? [{ shopifyOrderId: order.shopifyOrderId }] : []),
          ...(order.shopifyOrderNumber ? [
            { shopifyOrderNumber: order.shopifyOrderNumber },
            { shopifyOrderNumber: `#${String(order.shopifyOrderNumber).replace(/^#/, "")}` },
            { shopifyOrderNumber: String(order.shopifyOrderNumber).replace(/^#/, "") },
          ] : []),
          ...(order.email ? [{ email: order.email }] : []),
        ],
      }).sort({ createdAt: -1 });
    }

    let availableTracks = [];
    if (linkedMusicOrder && Array.isArray(linkedMusicOrder.musicTracks) && linkedMusicOrder.musicTracks.length > 0) {
      const isRawHash = !audioFile?.name || /^[a-f0-9-]{12,}\.mp3$/i.test(audioFile.name);
      if (!audioFile || isRawHash) {
        let chosenTrack = linkedMusicOrder.musicTracks[0];
        if (linkedMusicOrder.selectedDemo) {
          const fav = linkedMusicOrder.musicTracks.find((t) => t.id === linkedMusicOrder.selectedDemo);
          if (fav) chosenTrack = fav;
        }
        if (chosenTrack) {
          const rawKey = chosenTrack.audioUrl || chosenTrack.streamAudioUrl || "";
          let playable = rawKey;
          if (rawKey && !rawKey.startsWith("http://") && !rawKey.startsWith("https://")) {
            try {
              playable = await generatePresignedUrl(rawKey, 7 * 24 * 3600);
            } catch (e) {}
          }
          audioFile = {
            name: (chosenTrack.title || (linkedMusicOrder.recipientName ? `${linkedMusicOrder.recipientName}'s Song` : "Custom Song")) + " (Variation 1)",
            trackId: chosenTrack.id || "track_0",
            key: rawKey,
            url: playable,
            size: 0,
            isAutoSelected: true,
          };
          order.audioFile = audioFile;
          order.originalMusicOrderId = linkedMusicOrder._id;
          await order.save();
        }
      }

      availableTracks = await Promise.all(
        linkedMusicOrder.musicTracks.map(async (t, idx) => {
          let trackUrl = t.audioUrl || t.streamAudioUrl || "";
          if (trackUrl && !trackUrl.startsWith("http://") && !trackUrl.startsWith("https://")) {
            try {
              trackUrl = await generatePresignedUrl(trackUrl, 7 * 24 * 3600);
            } catch (e) {}
          }
          return {
            id: t.id || `track_${idx}`,
            title: t.title || `Variation ${idx + 1}`,
            variationName: `Variation ${idx + 1}`,
            url: trackUrl,
            key: t.audioUrl || t.streamAudioUrl || "",
            duration: t.duration || 0,
          };
        })
      );
    }

    return withCORS(
      NextResponse.json({
        success: true,
        order: {
          id: order._id.toString(),
          orderNumber: order.shopifyOrderNumber || `#${order.shopifyOrderId || ""}`,
          customerName: order.customerName || "",
          email: order.email || "",
          canEdit,
          tokenStatus,
          audioFile,
          availableTracks,
          allowMusicRegeneration: order.allowMusicRegeneration !== false,
          hasLinkedMusicOrder: Boolean(linkedMusicOrder),
          mediaFiles,
          videoFormat: order.videoFormat || "9:16",
          selectedPackage: order.selectedPackage || "Music Video",
          orderNotes: order.orderNotes || "",
          status: order.status,
          lastSubmittedAt: order.lastSubmittedAt || null,
        },
      }),
      origin
    );
  } catch (error) {
    console.error("[GET /api/video-tool/portal Error]:", error);
    return withCORS(
      NextResponse.json({ success: false, error: "Failed to load video order" }, { status: 500 }),
      origin
    );
  }
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();
    const body = await request.json();
    const token = (body.token || "").trim();
    const legacyId = (body.id || body.orderNumber || "").replace(/^#/, "").trim();

    if (!token && !legacyId) {
      return withCORS(
        NextResponse.json({ success: false, error: "Upload token is required to submit changes" }, { status: 400 }),
        origin
      );
    }

    let query = null;
    if (token) {
      try {
        const fuzzyPattern = token
          .replace(/[8B]/gi, "[8B]")
          .replace(/[0O]/gi, "[0O]")
          .replace(/[1Il]/gi, "[1Il]");
        query = {
          $or: [
            { uploadToken: token },
            { uploadToken: { $regex: new RegExp(`^${fuzzyPattern}$`, "i") } },
          ],
        };
      } catch (e) {
        query = { uploadToken: token };
      }
    } else {
      query = {
        $or: [
          ...(legacyId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: legacyId }] : []),
          { shopifyOrderNumber: legacyId },
          { shopifyOrderNumber: `#${legacyId}` },
          { shopifyOrderId: legacyId },
        ],
      };
    }

    const order = await VideoOrder.findOne(query);

    if (!order) {
      return withCORS(
        NextResponse.json({
          success: false,
          error: "Video order not found or invalid link.",
        }, { status: 404 }),
        origin
      );
    }

    // Verify token is active (single-use enforcement)
    if (order.uploadTokenStatus !== "active" && order.uploadTokenStatus !== undefined) {
      return withCORS(
        NextResponse.json({
          success: false,
          error: "This upload link has already been used and is closed for editing. Please contact support if you need to submit additional files.",
        }, { status: 403 }),
        origin
      );
    }

    // Validate that at least mediaFiles or audioFile exists
    const { audioFile, mediaFiles, videoFormat, orderNotes, customerEmail } = body;

    if (audioFile) {
      order.audioFile = {
        key: audioFile.key || audioFile.url || order.audioFile?.key || "",
        url: audioFile.url || order.audioFile?.url || "",
        name: audioFile.name || order.audioFile?.name || "Audio Track",
        size: audioFile.size || order.audioFile?.size || 0,
      };
    }

    if (Array.isArray(mediaFiles) && mediaFiles.length > 0) {
      order.mediaFiles = mediaFiles.map((m, idx) => ({
        key: m.key || m.url,
        url: m.url || "",
        name: m.name || `File ${idx + 1}`,
        size: m.size || 0,
        type: m.type || (m.mimeType?.startsWith("video/") ? "video" : "image"),
        mimeType: m.mimeType || "",
        order: idx,
      }));
    }

    if (videoFormat) {
      order.videoFormat = videoFormat;
    }

    if (orderNotes !== undefined) {
      order.orderNotes = orderNotes;
    }

    if (customerEmail && !order.email) {
      order.email = customerEmail;
    }

    // SINGLE-USE CONSUMPTION:
    // Mark the current token as consumed so it cannot be used again
    const currentTokenStr = order.uploadToken || token;
    order.uploadTokenStatus = "consumed";
    order.lastSubmittedAt = new Date();
    order.status = "in_production";

    order.tokenHistory = order.tokenHistory || [];
    if (currentTokenStr) {
      order.tokenHistory.push({
        token: currentTokenStr,
        status: "consumed",
        createdAt: order.createdAt || new Date(),
        consumedAt: new Date(),
      });
    }

    await order.save();

    // Trigger Admin Notification
    try {
      await Notification.create({
        title: "Video Order Files Received",
        message: `Customer updated media files for Order ${order.shopifyOrderNumber || `#${order.shopifyOrderId}`}. Upload portal is now locked.`,
        type: "video_order",
        link: `/orders/video/${order.shopifyOrderId || order._id}`,
      });
    } catch (notifErr) {
      console.warn("[portal API] Notification create warning:", notifErr);
    }

    return withCORS(
      NextResponse.json({
        success: true,
        message: "Your files have been successfully submitted and saved! Your link is now closed for editing.",
        orderNumber: order.shopifyOrderNumber || `#${order.shopifyOrderId}`,
      }),
      origin
    );
  } catch (error) {
    console.error("[POST /api/video-tool/portal Error]:", error);
    return withCORS(
      NextResponse.json({ success: false, error: error.message || "Failed to submit files" }, { status: 500 }),
      origin
    );
  }
}

