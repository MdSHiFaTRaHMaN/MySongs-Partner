import { NextResponse } from "next/server";
import { uploadBufferToS3, generatePresignedUrl, BUCKET_NAME, getCategoryFolder } from "@/lib/s3";
import { withCORS, handleOptions } from "@/lib/cors";
import crypto from "crypto";

export const dynamic = "force-dynamic";
// Note: maxDuration is Vercel-specific — not needed on VPS/PM2 deployments

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    let buffer;
    let filename = "uploaded_file";
    let contentType = "application/octet-stream";
    let fileType = "media";

    const reqContentType = request.headers.get("content-type") || "";
    const urlObj = new URL(request.url);
    let orderId = request.headers.get("x-order-id") || request.headers.get("x-video-id") || urlObj.searchParams.get("orderId") || urlObj.searchParams.get("videoId") || "";

    if (reqContentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      fileType = formData.get("fileType") || "media";
      orderId = formData.get("orderId") || formData.get("videoId") || orderId;

      if (!file || typeof file === "string") {
        return withCORS(
          NextResponse.json({ success: false, error: "No file provided" }, { status: 400 }),
          origin
        );
      }

      filename = file.name || filename;
      contentType = file.type || contentType;
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      // Direct raw binary stream (100% reliable, zero multipart parsing overhead)
      const headerFilename = request.headers.get("x-file-name");
      if (headerFilename) {
        try {
          filename = decodeURIComponent(headerFilename);
        } catch (e) {
          filename = headerFilename;
        }
      }
      fileType = request.headers.get("x-file-type") || "media";
      contentType = reqContentType || "application/octet-stream";
      buffer = Buffer.from(await request.arrayBuffer());
    }

    if (!buffer || buffer.length === 0) {
      return withCORS(
        NextResponse.json({ success: false, error: "Empty file payload received" }, { status: 400 }),
        origin
      );
    }

    const safeOrderId = (orderId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
    const orderFolder = safeOrderId || `order_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
    const subFolder = getCategoryFolder(fileType, filename, contentType);

    // Sanitize filename and create unique S3 key within order folder
    const cleanFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueId = crypto.randomBytes(6).toString("hex");
    const key = `video-tool/${orderFolder}/${subFolder}/${uniqueId}-${cleanFilename}`;

    // Upload directly to S3 via backend SDK
    await uploadBufferToS3(buffer, key, contentType);
    const publicOrPresignedUrl = await generatePresignedUrl(key, 7 * 24 * 3600); // 7 days preview

    return withCORS(
      NextResponse.json({
        success: true,
        key,
        url: publicOrPresignedUrl,
        bucket: BUCKET_NAME,
      }),
      origin
    );
  } catch (error) {
    console.error("[Video Tool Direct S3 Upload Error]:", error);
    return withCORS(
      NextResponse.json(
        { success: false, error: error.message || "Failed to upload file to storage" },
        { status: 500 }
      ),
      origin
    );
  }
}
