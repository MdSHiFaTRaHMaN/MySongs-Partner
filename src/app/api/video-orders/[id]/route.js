import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import { generatePresignedUrl, deleteFromS3 } from "@/lib/s3";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    await dbConnect();
    const cleanId = String(id).replace(/^#/, "").trim();

    let order = await VideoOrder.findOne({
      $or: [
        { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
        { videoId: cleanId },
        { videoId: id },
        { shopifyOrderId: cleanId },
        { shopifyOrderId: id },
        { shopifyOrderId: `#${cleanId}` },
        { shopifyOrderNumber: cleanId },
        { shopifyOrderNumber: id },
        { shopifyOrderNumber: `#${cleanId}` },
      ].filter(Boolean),
    }).populate("assignedEditor", "name email");

    if (!order) {
      return NextResponse.json({ success: false, error: "Video order not found" }, { status: 404 });
    }

    const orderObj = order.toObject();

    // Generate fresh presigned URLs for audio and media files
    if (orderObj.audioFile?.key) {
      orderObj.audioFile.url = await generatePresignedUrl(orderObj.audioFile.key, 7 * 24 * 3600);
    }

    if (orderObj.mediaFiles && Array.isArray(orderObj.mediaFiles)) {
      for (const media of orderObj.mediaFiles) {
        if (media.key) {
          media.url = await generatePresignedUrl(media.key, 7 * 24 * 3600);
        }
      }
    }

    if (orderObj.finalVideoKey) {
      orderObj.finalVideoUrl = await generatePresignedUrl(orderObj.finalVideoKey, 7 * 24 * 3600);
    }

    return NextResponse.json({ success: true, order: orderObj });
  } catch (error) {
    console.error("[GET /api/video-orders/[id] Error]:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    await dbConnect();
    const cleanId = String(id).replace(/^#/, "").trim();
    const body = await request.json();

    const updateFields = {};
    if (body.status) updateFields.status = body.status;
    if (body.finalVideoKey) updateFields.finalVideoKey = body.finalVideoKey;
    if (body.finalVideoUrl) updateFields.finalVideoUrl = body.finalVideoUrl;
    if (body.assignedEditor) updateFields.assignedEditor = body.assignedEditor;
    if (body.orderNotes !== undefined) updateFields.orderNotes = body.orderNotes;
    if (body.deliveryEmailSent !== undefined) updateFields.deliveryEmailSent = body.deliveryEmailSent;
    if (body.deliveredAt !== undefined) updateFields.deliveredAt = body.deliveredAt;

    const order = await VideoOrder.findOneAndUpdate(
      {
        $or: [
          { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
          { videoId: cleanId },
          { videoId: id },
          { shopifyOrderId: cleanId },
          { shopifyOrderId: id },
          { shopifyOrderId: `#${cleanId}` },
          { shopifyOrderNumber: cleanId },
          { shopifyOrderNumber: id },
          { shopifyOrderNumber: `#${cleanId}` },
        ].filter(Boolean),
      },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!order) {
      return NextResponse.json({ success: false, error: "Video order not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error("[PUT /api/video-orders/[id] Error]:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { collectVideoOrderS3Keys, deleteS3KeysBatch } from "@/lib/trashCleanup";

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const deleteType = url.searchParams.get("type") || url.searchParams.get("target");
    const isPermanent = url.searchParams.get("permanent") === "true";

    await dbConnect();
    const cleanId = String(id).replace(/^#/, "").trim();

    const order = await VideoOrder.findOne({
      $or: [
        { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
        { videoId: cleanId },
        { videoId: id },
        { shopifyOrderId: cleanId },
        { shopifyOrderId: id },
        { shopifyOrderId: `#${cleanId}` },
        { shopifyOrderNumber: cleanId },
        { shopifyOrderNumber: id },
        { shopifyOrderNumber: `#${cleanId}` },
      ].filter(Boolean),
    });

    if (!order) {
      return NextResponse.json({ success: false, error: "Video order not found" }, { status: 404 });
    }

    // If deleting the entire Video Order (Move to Trash Bin or Permanent purge)
    if (deleteType === "order" || deleteType === "video_order") {
      if (isPermanent) {
        // 1. Purge all S3 keys (audio, photos, videos, final video, revisions)
        const s3Keys = collectVideoOrderS3Keys(order);
        await deleteS3KeysBatch(s3Keys);

        // 2. Permanently delete DB record
        await VideoOrder.findByIdAndDelete(order._id);

        return NextResponse.json({
          success: true,
          message: "Video order and all assets permanently deleted",
        });
      } else {
        // Soft delete to Trash Bin
        order.isDeleted = true;
        order.deletedAt = new Date();
        await order.save();

        return NextResponse.json({
          success: true,
          message: "Video order moved to Trash Bin",
        });
      }
    }

    // Otherwise: delete just the final delivered video file from S3 & reset workspace status
    if (order.finalVideoKey) {
      try {
        await deleteFromS3(order.finalVideoKey);
        console.log(`[VideoOrder] Permanently deleted final video from S3: ${order.finalVideoKey}`);
      } catch (s3Err) {
        console.error("[VideoOrder] Error deleting final video from S3:", s3Err);
      }
    }

    order.finalVideoKey = "";
    order.finalVideoUrl = "";
    if (order.status === "ready" || order.status === "delivering") {
      order.status = "in_production";
    }
    await order.save();

    return NextResponse.json({
      success: true,
      message: "Final video permanently deleted from S3 and workspace",
      order,
    });
  } catch (error) {
    console.error("[DELETE /api/video-orders/[id] Error]:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
