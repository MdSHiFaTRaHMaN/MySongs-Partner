import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import { withCORS, handleOptions } from "@/lib/cors";
import crypto from "crypto";

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();
    const body = await request.json();

    const {
      email,
      customerName = "",
      audioFile,
      mediaFiles = [],
      selectedPackage = "Music Video",
      videoFormat = "9:16",
      packagePrice = 0,
      currency = "USD",
      orderNotes = "",
      shopifyProductId = "",
      shopifyVariantId = "",
      videoId: existingVideoId,
    } = body;

    if (!audioFile || !audioFile.key) {
      return withCORS(
        NextResponse.json({ success: false, error: "Audio file is required" }, { status: 400 }),
        origin
      );
    }

    if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) {
      return withCORS(
        NextResponse.json({ success: false, error: "At least one image or video is required" }, { status: 400 }),
        origin
      );
    }

    let videoId = existingVideoId;
    let videoOrder = null;

    const rawOrderNum = body.shopifyOrderNumber || body.orderNumber;
    const cleanOrderNum = rawOrderNum ? String(rawOrderNum).replace(/^#/, "").trim() : "";
    const isUpsellUpload = Boolean(body.isUpsellUpload || cleanOrderNum);

    // If order number provided (e.g. customer bought video upsell and was sent the upload link)
    if (cleanOrderNum) {
      videoOrder = await VideoOrder.findOne({
        $or: [
          { shopifyOrderNumber: cleanOrderNum },
          { shopifyOrderNumber: `#${cleanOrderNum}` },
          { shopifyOrderId: cleanOrderNum },
          ...(cleanOrderNum.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: cleanOrderNum }] : []),
        ],
      });
    }

    if (!videoOrder && videoId) {
      videoOrder = await VideoOrder.findOne({ videoId });
      // If the order was already paid/fulfilled and NOT an explicit upsell re-upload, create a new draft
      if (videoOrder && !isUpsellUpload && ["paid", "in_production", "ready", "delivering", "fulfilled"].includes(videoOrder.status)) {
        videoId = null;
        videoOrder = null;
      }
    }

    if (videoOrder) {
      // Connect uploaded files to existing video order
      videoOrder.email = email || videoOrder.email;
      videoOrder.customerName = customerName || videoOrder.customerName;
      videoOrder.audioFile = audioFile;
      videoOrder.mediaFiles = mediaFiles;
      videoOrder.selectedPackage = selectedPackage || videoOrder.selectedPackage;
      if (videoFormat) videoOrder.videoFormat = videoFormat;
      if (orderNotes) videoOrder.orderNotes = orderNotes;
      if (shopifyProductId) videoOrder.shopifyProductId = shopifyProductId;
      if (shopifyVariantId) videoOrder.shopifyVariantId = shopifyVariantId;
      if (cleanOrderNum && !videoOrder.shopifyOrderNumber) {
        videoOrder.shopifyOrderNumber = `#${cleanOrderNum}`;
      }

      // If customer is submitting media for a bought upsell, keep it unfulfilled in production
      if (isUpsellUpload) {
        videoOrder.status = "in_production";
      } else if (!["in_production", "ready", "delivering", "fulfilled"].includes(videoOrder.status)) {
        videoOrder.status = "in_cart";
      }

      await videoOrder.save();

      // Create dashboard notification for team
      try {
        const Notification = (await import("@/models/Notification")).default;
        await Notification.create({
          title: "Video Media Uploaded",
          message: `Customer (${videoOrder.email}) uploaded ${mediaFiles.length} files for Video Order #${cleanOrderNum || videoOrder.shopifyOrderNumber || videoOrder.videoId}!`,
          type: "video_order",
          link: `/orders/video/${videoOrder.videoId}`,
        });
      } catch (notifErr) {
        console.warn("[create-order] Notification warning:", notifErr);
      }
    } else {
      // Generate unique video ID
      videoId = `vid_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
      videoOrder = await VideoOrder.create({
        videoId,
        email: email || "pending-checkout@myownsongs.com",
        customerName,
        shopifyOrderId: cleanOrderNum || "",
        shopifyOrderNumber: cleanOrderNum ? `#${cleanOrderNum}` : "",
        audioFile,
        mediaFiles,
        selectedPackage,
        videoFormat: videoFormat || "9:16",
        packagePrice,
        currency,
        orderNotes,
        shopifyProductId,
        shopifyVariantId,
        status: isUpsellUpload ? "in_production" : "in_cart",
      });

      if (isUpsellUpload && cleanOrderNum) {
        try {
          const Notification = (await import("@/models/Notification")).default;
          await Notification.create({
            title: "New Video Upsell Files Uploaded",
            message: `Media files uploaded for Order #${cleanOrderNum}! Order is now in production.`,
            type: "video_order",
            link: `/orders/video/${videoOrder.videoId}`,
          });
        } catch (e) {}
      }
    }

    return withCORS(
      NextResponse.json({
        success: true,
        videoId: videoOrder.videoId,
        orderId: videoOrder._id.toString(),
        isUpsellUpload: isUpsellUpload,
        shopifyOrderNumber: videoOrder.shopifyOrderNumber,
        message: isUpsellUpload
          ? `Media files successfully connected to Order ${videoOrder.shopifyOrderNumber}!`
          : "Video order created successfully",
      }),
      origin
    );
  } catch (error) {
    console.error("[Video Tool Create Order Error]:", error);
    return withCORS(
      NextResponse.json({ success: false, error: error.message || "Failed to create video order" }, { status: 500 }),
      origin
    );
  }
}
