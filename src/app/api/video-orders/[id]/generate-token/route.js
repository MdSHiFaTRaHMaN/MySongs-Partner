import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import { jwtVerify } from "jose";

async function verifyAdminAuth(request) {
  const token =
    request.cookies.get("admin_token")?.value ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export async function POST(request, { params }) {
  try {
    const admin = await verifyAdminAuth(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await dbConnect();
    const cleanId = String(id).replace(/^#/, "").trim();

    const order = await VideoOrder.findOne({
      $or: [
        ...(cleanId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: cleanId }] : []),
        { videoId: cleanId },
        { shopifyOrderId: cleanId },
        { shopifyOrderNumber: cleanId },
        { shopifyOrderNumber: `#${cleanId}` },
      ],
    });

    if (!order) {
      return NextResponse.json({ error: "Video order not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action || "generate"; // "generate", "lock", "unlock", "toggle_music_regen"

    if (action === "toggle_music_regen") {
      const nextVal = typeof body.allowMusicRegeneration === "boolean"
        ? body.allowMusicRegeneration
        : !(order.allowMusicRegeneration !== false);
      order.allowMusicRegeneration = nextVal;
      await order.save();
      return NextResponse.json({
        success: true,
        message: nextVal
          ? "Music regeneration enabled for this customer upload link."
          : "Music regeneration disabled for this customer upload link.",
        allowMusicRegeneration: nextVal,
      });
    }

    if (action === "lock") {
      order.uploadTokenStatus = "consumed";
      await order.save();
      return NextResponse.json({
        success: true,
        message: "Upload portal has been locked/closed.",
        uploadToken: order.uploadToken,
        uploadTokenStatus: "consumed",
      });
    }

    if (action === "unlock" && order.uploadToken) {
      order.uploadTokenStatus = "active";
      await order.save();
      return NextResponse.json({
        success: true,
        message: "Existing upload link has been reopened for 1 submission.",
        uploadToken: order.uploadToken,
        uploadTokenStatus: "active",
      });
    }

    // Default: Generate a brand new Base64-URL safe token
    const newToken = crypto.randomBytes(24).toString("base64url");

    // Archive current token into history
    if (order.uploadToken) {
      order.tokenHistory = order.tokenHistory || [];
      order.tokenHistory.push({
        token: order.uploadToken,
        status: order.uploadTokenStatus || "consumed",
        createdAt: order.updatedAt || new Date(),
        consumedAt: new Date(),
      });
    }

    order.uploadToken = newToken;
    order.uploadTokenStatus = "active";
    await order.save();

    return NextResponse.json({
      success: true,
      message: "New secure one-time upload link generated successfully!",
      uploadToken: newToken,
      uploadTokenStatus: "active",
    });
  } catch (error) {
    console.error("[generate-token API Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to generate upload token" }, { status: 500 });
  }
}

