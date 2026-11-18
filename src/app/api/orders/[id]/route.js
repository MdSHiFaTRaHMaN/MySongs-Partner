import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { withCORS, handleOptions } from "@/lib/cors";
import { generatePresignedUrl } from "@/lib/s3";

import { collectMusicOrderS3Keys, deleteS3KeysBatch } from "@/lib/trashCleanup";

// Preflight request
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function DELETE(request, { params }) {
  const origin = request.headers.get("origin") || "";
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const isPermanent = url.searchParams.get("permanent") === "true";

    await dbConnect();

    const order = await Order.findById(id);
    if (!order) {
      return withCORS(NextResponse.json({ error: "Order not found" }, { status: 404 }), origin);
    }

    if (isPermanent) {
      // 1. Purge all S3 files
      const s3Keys = collectMusicOrderS3Keys(order);
      await deleteS3KeysBatch(s3Keys);

      // 2. Permanently delete document
      await Order.findByIdAndDelete(id);

      return withCORS(
        NextResponse.json({ success: true, message: "Order and all files permanently deleted" }),
        origin
      );
    } else {
      // Soft delete to Trash Bin
      order.isDeleted = true;
      order.deletedAt = new Date();
      await order.save();

      return withCORS(
        NextResponse.json({ success: true, message: "Order moved to Trash Bin" }),
        origin
      );
    }
  } catch (error) {
    console.error("Delete order error:", error);
    return withCORS(NextResponse.json({ error: "Internal server error" }, { status: 500 }), origin);
  }
}

export async function GET(request, { params }) {
  const origin = request.headers.get("origin") || "";
  try {
    const { id } = await params;
    await dbConnect();

    const order = await Order.findById(id).lean();

    if (!order) {
      return withCORS(NextResponse.json({ error: "Order not found" }, { status: 404 }), origin);
    }

    // Auto-heal missing lyrics or recipient fields for resumed/legacy orders
    let healed = false;
    const updateSet = {};

    if ((!order.lyrics || !order.lyrics.trim()) && order.musicTracks && Array.isArray(order.musicTracks) && order.musicTracks.length > 0) {
      const trackWithLyrics = order.musicTracks.find((t) => t.lyrics && t.lyrics.trim().length > 0);
      if (trackWithLyrics) {
        order.lyrics = trackWithLyrics.lyrics;
        updateSet.lyrics = trackWithLyrics.lyrics;
        healed = true;
      }
    }

    const hasRecipients = order.recipients && Array.isArray(order.recipients) && order.recipients.some((r) => r && r.name && r.name.trim());
    if (!hasRecipients) {
      let candidateName = order.recipientName;
      if (!candidateName && order.formData && order.formData.recipients && Array.isArray(order.formData.recipients) && order.formData.recipients[0]?.name) {
        candidateName = order.formData.recipients[0].name;
      }
      if (!candidateName && order.musicTracks && order.musicTracks[0]?.title) {
        const match = order.musicTracks[0].title.match(/\s+for\s+(.+)$/i);
        if (match && match[1]) {
          candidateName = match[1].trim();
        }
      }
      if (candidateName) {
        order.recipientName = candidateName;
        order.recipients = [{ name: candidateName, pronunciationMode: "Original", pronunciation: "" }];
        updateSet.recipientName = candidateName;
        updateSet.recipients = order.recipients;
        healed = true;
      }
    }

    if (!order.storyText && order.formData && order.formData.storyText) {
      order.storyText = order.formData.storyText;
      updateSet.storyText = order.formData.storyText;
      healed = true;
    }

    if (!order.creationMethod && order.formData && order.formData.creationMethod) {
      order.creationMethod = order.formData.creationMethod;
      updateSet.creationMethod = order.formData.creationMethod;
      healed = true;
    }

    if (healed) {
      Order.updateOne({ _id: order._id }, { $set: updateSet }).catch((e) => {
        console.error("Failed to auto-heal order:", e);
      });
    }

    // Generate fresh presigned URLs for preview streaming
    if (order.musicTracks && Array.isArray(order.musicTracks)) {
      order.musicTracks = await Promise.all(
        order.musicTracks.map(async (track) => {
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

          // Secure response: do not expose original audioUrl before payment
          return {
            id: track.id,
            title: track.title,
            streamAudioUrl: presignedUrl,
            imageUrl: track.imageUrl,
            duration: track.duration,
            lyrics: track.lyrics,
          };
        })
      );
    }

    return withCORS(NextResponse.json({ success: true, order }), origin);
  } catch (error) {
    console.error("Get order error:", error);
    return withCORS(NextResponse.json({ error: "Internal server error" }, { status: 500 }), origin);
  }
}
