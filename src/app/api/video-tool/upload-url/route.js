import { NextResponse } from "next/server";
import { generatePresignedPutUrl, generatePresignedUrl, BUCKET_NAME, getCategoryFolder } from "@/lib/s3";
import { withCORS, handleOptions } from "@/lib/cors";
import crypto from "crypto";

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    const urlObj = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const {
      filename,
      contentType = "application/octet-stream",
      fileType = "media",
      orderId: bodyOrderId,
      videoId: bodyVideoId,
    } = body;

    if (!filename) {
      return withCORS(
        NextResponse.json({ success: false, error: "Filename is required" }, { status: 400 }),
        origin
      );
    }

    const rawOrderId =
      bodyOrderId ||
      bodyVideoId ||
      request.headers.get("x-order-id") ||
      request.headers.get("x-video-id") ||
      urlObj.searchParams.get("orderId") ||
      urlObj.searchParams.get("videoId") ||
      "";

    const safeOrderId = rawOrderId.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
    const orderFolder = safeOrderId || `order_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
    const subFolder = getCategoryFolder(fileType, filename, contentType);

    // Sanitize filename and create unique S3 key within order folder
    const cleanFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueId = crypto.randomBytes(6).toString("hex");
    const key = `video-tool/${orderFolder}/${subFolder}/${uniqueId}-${cleanFilename}`;

    const uploadUrl = await generatePresignedPutUrl(key, contentType, 3600); // 1 hour expiration
    const publicOrPresignedUrl = await generatePresignedUrl(key, 7 * 24 * 3600, {
      isStream: true,
      contentType: contentType || "video/mp4",
    }); // 7 days expiration for preview

    return withCORS(
      NextResponse.json({
        success: true,
        uploadUrl,
        key,
        url: publicOrPresignedUrl,
        bucket: BUCKET_NAME,
      }),
      origin
    );
  } catch (error) {
    console.error("[Video Tool S3 Presign Error]:", error);
    return withCORS(
      NextResponse.json({ success: false, error: error.message || "Failed to generate upload URL" }, { status: 500 }),
      origin
    );
  }
}
