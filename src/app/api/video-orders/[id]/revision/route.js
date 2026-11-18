import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

import { extractS3Key } from "@/lib/s3";

export const dynamic = "force-dynamic";

async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return null;
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      videoUrl,
      videoKey,
      audioUrl,
      audioKey,
      lyrics,
      customFiles,
      note,
      title,
      initialVideoUrl,
      initialAudioUrl,
    } = body;

    const user = await getCurrentUser();
    const updaterName = user?.name || user?.email || "Admin";

    await dbConnect();
    const cleanId = String(id).replace(/^#/, "").trim();

    const order = await VideoOrder.findOne({
      $or: [
        { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
        { videoId: cleanId },
        { videoId: id },
        { shopifyOrderId: cleanId },
        { shopifyOrderId: id },
        { shopifyOrderNumber: cleanId },
        { shopifyOrderNumber: id },
      ].filter(Boolean),
    });

    if (!order) {
      return NextResponse.json({ error: "Video order not found" }, { status: 404 });
    }

    // Capture initial version if none exists
    if (!order.revisions || order.revisions.length === 0) {
      const v1Video = initialVideoUrl || order.finalVideoUrl || "";
      const v1VideoKey = order.finalVideoKey || extractS3Key(v1Video);
      const v1Audio = initialAudioUrl || order.audioFile?.url || "";
      const v1AudioKey = order.audioFile?.key || extractS3Key(v1Audio);

      order.revisions = [
        {
          version: 1,
          title: order.selectedPackage || "Original Delivery",
          videoUrl: v1Video,
          videoKey: v1VideoKey,
          audioUrl: v1Audio,
          audioKey: v1AudioKey,
          lyrics: "",
          customFiles: [],
          note: "Original delivered version",
          updatedBy: "Video Editor / Admin",
          createdAt: order.createdAt || new Date(),
        },
      ];
    }

    const nextVersion = (order.currentVersion || 1) + 1;
    const cleanVideoKey = videoKey || extractS3Key(videoUrl);
    const cleanAudioKey = audioKey || extractS3Key(audioUrl);

    const newRevision = {
      version: nextVersion,
      title: title || `Revision v${nextVersion}`,
      videoUrl: videoUrl || order.finalVideoUrl || "",
      videoKey: cleanVideoKey || order.finalVideoKey || "",
      audioUrl: audioUrl || order.audioFile?.url || "",
      audioKey: cleanAudioKey || order.audioFile?.key || "",
      lyrics: lyrics || "",
      customFiles: Array.isArray(customFiles) ? customFiles : [],
      note: note || `Updated by ${updaterName}`,
      updatedBy: updaterName,
      createdAt: new Date(),
    };

    order.revisions.push(newRevision);
    order.currentVersion = nextVersion;

    // Update active video fields so the Final Video Workspace always displays the latest revision
    if (videoUrl) {
      order.finalVideoUrl = videoUrl;
      order.finalVideoKey = cleanVideoKey || extractS3Key(videoUrl);
    }
    if (audioUrl) {
      order.audioFile = order.audioFile || {};
      order.audioFile.url = audioUrl;
      order.audioFile.key = cleanAudioKey || extractS3Key(audioUrl);
    }
    // Reset delivery status so Klaviyo delivery is required for this new revision version
    order.deliveryEmailSent = false;
    order.status = "ready";

    await order.save();

    return NextResponse.json({
      success: true,
      message: `Video revision v${nextVersion} created successfully`,
      currentVersion: nextVersion,
      revisions: order.revisions,
      order,
    });
  } catch (error) {
    console.error("[POST /api/video-orders/[id]/revision Error]:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create video order revision" },
      { status: 500 }
    );
  }
}
