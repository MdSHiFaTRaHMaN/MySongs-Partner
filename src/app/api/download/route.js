import { NextResponse } from "next/server";
import { generatePresignedUrl } from "@/lib/s3";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    let rawUrl = searchParams.get("url");
    let filename = searchParams.get("filename") || "";
    const isStream = searchParams.get("stream") === "true";

    if (!rawUrl) {
      return new NextResponse("Missing url parameter", { status: 400 });
    }

    // Extract clean S3 Key if rawUrl is a full Amazon S3 URL
    let s3Key = rawUrl;
    if (rawUrl.includes(".amazonaws.com/")) {
      try {
        const parsed = new URL(rawUrl);
        s3Key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      } catch {
        s3Key = rawUrl.split(".amazonaws.com/")[1]?.split("?")[0] || rawUrl;
      }
    }

    // Detect file format
    const isVideo =
      s3Key.toLowerCase().endsWith(".mp4") ||
      s3Key.toLowerCase().endsWith(".mov") ||
      s3Key.toLowerCase().endsWith(".webm") ||
      filename.toLowerCase().endsWith(".mp4") ||
      filename.toLowerCase().endsWith(".mov");

    // Format safe filename
    if (!filename) {
      filename = isVideo ? "Custom-Music-Video - My Own Songs.mp4" : "Custom-Song - My Own Songs.mp3";
    } else {
      filename = filename.replace(/[^a-zA-Z0-9-_\. ]/g, "").trim();

      if (isVideo) {
        if (!filename.toLowerCase().endsWith(".mp4") && !filename.toLowerCase().endsWith(".mov")) {
          filename += ".mp4";
        }
      } else {
        if (!filename.toLowerCase().endsWith(".mp3") && !filename.toLowerCase().endsWith(".wav")) {
          filename += ".mp3";
        }
      }

      if (!filename.toLowerCase().includes("my own songs")) {
        const ext = filename.lastIndexOf(".") !== -1 ? filename.slice(filename.lastIndexOf(".")) : (isVideo ? ".mp4" : ".mp3");
        const base = filename.slice(0, filename.length - ext.length).trim();
        filename = `${base} - My Own Songs${ext}`;
      }
    }

    // Determine contentType
    let contentType = isVideo ? "video/mp4" : "audio/mpeg";
    if (filename.toLowerCase().endsWith(".mov")) contentType = "video/quicktime";
    if (filename.toLowerCase().endsWith(".wav")) contentType = "audio/wav";

    // If it's an S3 key (or extracted S3 key), generate a fresh presigned URL with custom headers
    if (!s3Key.startsWith("http://") && !s3Key.startsWith("https://")) {
      const presignedUrl = await generatePresignedUrl(s3Key, 7 * 24 * 3600, {
        filename,
        isStream,
        contentType,
      });

      const response = NextResponse.redirect(presignedUrl, 307);
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    }

    // External non-S3 URL fallback
    const response = NextResponse.redirect(rawUrl, 307);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } catch (error) {
    console.error("[Download API] Error:", error);
    return new NextResponse("Media request failed", { status: 500 });
  }
}
