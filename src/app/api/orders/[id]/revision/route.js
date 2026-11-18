import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { generatePresignedUrl } from "@/lib/s3";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

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
    const { audioUrl, streamAudioUrl, lyrics, videoUrl, customFiles, note, title } = body;

    const user = await getCurrentUser();
    const updaterName = user?.name || user?.email || "Admin";

    const cleanId = String(id).replace(/^#/, "").trim();

    await dbConnect();

    let order = await Order.findOne({
      $or: [
        ...(cleanId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: cleanId }] : []),
        { musicId: cleanId },
        { musicId: id },
        { shopifyOrderId: cleanId },
        { shopifyOrderId: id },
        { shopifyOrderId: `#${cleanId}` },
        { shopifyOrderNumber: cleanId },
        { shopifyOrderNumber: `#${cleanId}` },
        { taskId: cleanId },
        { taskId: id },
      ].filter(Boolean),
    });

    if (!order) {
      // Auto-create base order record for Shopify orders so revisions work flawlessly
      const initialAudio = body.initialAudioUrl || audioUrl || "";
      const initialLyrics = body.initialLyrics !== undefined ? body.initialLyrics : (lyrics || "");
      order = new Order({
        email: body.email || "customer@example.com",
        taskId: body.taskId || cleanId || `task_${Date.now()}`,
        musicId: body.musicId || cleanId,
        shopifyOrderId: body.shopifyOrderId || cleanId,
        shopifyOrderNumber: body.shopifyOrderNumber || `#${cleanId}`,
        occasion: body.initialTitle || body.title || "Custom Song",
        lyrics: initialLyrics,
        currentVersion: 1,
        musicTracks: [
          {
            id: "initial_track",
            title: body.initialTitle || "Custom Song",
            audioUrl: initialAudio,
            streamAudioUrl: initialAudio,
            lyrics: initialLyrics,
          },
        ],
        revisions: [
          {
            version: 1,
            title: body.initialTitle || "Initial Version",
            audioUrl: initialAudio,
            streamAudioUrl: initialAudio,
            lyrics: initialLyrics,
            videoUrl: "",
            customFiles: [],
            note: "Initial version",
            updatedBy: "System",
            createdAt: new Date(),
          },
        ],
      });
    }

    // Capture the current state as a revision if revisions list is empty
    if (!order.revisions || order.revisions.length === 0) {
      const initialTrack = (order.musicTracks && order.musicTracks[0]) || {};
      const v1Audio = initialTrack.audioUrl || body.initialAudioUrl || "";
      const v1Lyrics = order.lyrics || initialTrack.lyrics || body.initialLyrics || "";
      order.revisions = [
        {
          version: 1,
          title: initialTrack.title || order.occasion || body.initialTitle || "Initial Version",
          audioUrl: v1Audio,
          streamAudioUrl: initialTrack.streamAudioUrl || v1Audio,
          lyrics: v1Lyrics,
          videoUrl: "",
          customFiles: [],
          note: "Original generated version",
          updatedBy: "System / Generator",
          createdAt: order.createdAt || new Date(),
        },
      ];
    }

    const nextVersion = (order.currentVersion || 1) + 1;

    const finalTitle = (title && !title.match(/^Revision\s+v\d+$/i))
      ? title
      : `Revision v${nextVersion}`;

    // Create the new revision snapshot
    const newRevision = {
      version: nextVersion,
      title: finalTitle,
      audioUrl: audioUrl || (order.musicTracks?.[0]?.audioUrl || ""),
      streamAudioUrl: streamAudioUrl || audioUrl || (order.musicTracks?.[0]?.streamAudioUrl || ""),
      lyrics: lyrics !== undefined ? lyrics : (order.lyrics || ""),
      videoUrl: videoUrl || "",
      customFiles: Array.isArray(customFiles) ? customFiles : [],
      note: note || `Updated by ${updaterName}`,
      updatedBy: updaterName,
      createdAt: new Date(),
    };

    order.revisions.push(newRevision);
    order.currentVersion = nextVersion;

    // Update active fields on the Order
    if (lyrics !== undefined) {
      order.lyrics = lyrics;
    }

    if (audioUrl) {
      if (!order.musicTracks || order.musicTracks.length === 0) {
        order.musicTracks = [
          {
            id: `rev_${nextVersion}`,
            title: title || order.occasion || "Custom Song",
            audioUrl: audioUrl,
            streamAudioUrl: streamAudioUrl || audioUrl,
            lyrics: lyrics || order.lyrics || "",
          },
        ];
        order.selectedDemo = `rev_${nextVersion}`;
      } else {
        // Update first/active track
        order.musicTracks[0].audioUrl = audioUrl;
        order.musicTracks[0].streamAudioUrl = streamAudioUrl || audioUrl;
        if (title) order.musicTracks[0].title = title;
        if (lyrics !== undefined) order.musicTracks[0].lyrics = lyrics;
      }
    }

    // Reset delivery status so Klaviyo delivery is required for this new revision version
    order.deliveryEmailSent = false;
    order.status = "in_production";

    await order.save();

    return NextResponse.json({
      success: true,
      message: `Revision v${nextVersion} created successfully`,
      currentVersion: nextVersion,
      revisions: order.revisions,
      order,
    });
  } catch (error) {
    console.error("[POST /api/orders/[id]/revision Error]:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create order revision" },
      { status: 500 }
    );
  }
}
