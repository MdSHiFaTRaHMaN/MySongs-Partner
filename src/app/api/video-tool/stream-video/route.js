import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { BUCKET_NAME } from "@/lib/s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    let rawKey = searchParams.get("key") || searchParams.get("url") || "";

    if (!rawKey) {
      return new Response("Missing video key", { status: 400 });
    }

    // Extract clean S3 key if a full URL was provided
    let s3Key = rawKey;
    if (rawKey.includes(".amazonaws.com/")) {
      try {
        const parsed = new URL(rawKey);
        s3Key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      } catch {
        s3Key = rawKey.split(".amazonaws.com/")[1]?.split("?")[0] || rawKey;
      }
    }

    // Get file metadata (size, content type) from S3
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
    );

    const fileSize = head.ContentLength;
    let contentType = head.ContentType || "video/mp4";
    if (s3Key.toLowerCase().endsWith(".mov")) contentType = "video/quicktime";
    if (s3Key.toLowerCase().endsWith(".webm")) contentType = "video/webm";

    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      // Parse Range Header (e.g. bytes=0- or bytes=1048576-2097151)
      const rangeParts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(rangeParts[0], 10) || 0;
      const end = rangeParts[1] ? parseInt(rangeParts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const s3Response = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Range: `bytes=${start}-${end}`,
        })
      );

      return new Response(s3Response.Body.transformToWebStream(), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // No range requested: stream with Accept-Ranges
    const s3Response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
    );

    return new Response(s3Response.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileSize),
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[Stream Video API Error]:", error);
    return new Response("Failed to stream video", { status: 500 });
  }
}
