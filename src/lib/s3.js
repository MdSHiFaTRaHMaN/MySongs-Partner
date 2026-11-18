import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

export async function checkS3KeyExists(key) {
  if (!key) return false;
  try {
    const cleanKey = extractS3Key(key);
    if (!cleanKey) return false;
    await s3.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: cleanKey,
    }));
    return true;
  } catch (err) {
    return false;
  }
}

export async function deleteFromS3(key) {
  if (!key) return true;
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  await s3.send(command);
  return true;
}

export async function uploadToS3(filePath, key, contentType = "audio/mpeg") {
  const fileBuffer = fs.readFileSync(filePath);
  const uploadParams = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  };

  const command = new PutObjectCommand(uploadParams);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await s3.send(command);
      return key;
    } catch (err) {
      lastErr = err;
      console.warn(`[S3] Upload attempt ${attempt} failed for ${key}:`, err.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

export async function generatePresignedPutUrl(key, contentType = "", expiresIn = 3600) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await getSignedUrl(s3, command, { expiresIn });
}

export function extractS3Key(urlOrKey) {
  if (!urlOrKey || typeof urlOrKey !== "string") return "";
  const trimmed = urlOrKey.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      let pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
      if (BUCKET_NAME && pathname.startsWith(`${BUCKET_NAME}/`)) {
        pathname = pathname.substring(BUCKET_NAME.length + 1);
      }
      return pathname;
    } catch {
      return trimmed;
    }
  }
  return trimmed.replace(/^\/+/, "");
}

export async function generatePresignedUrl(key, expiresIn = 3600, options = {}) {
  const cleanKey = extractS3Key(key);
  if (!cleanKey) return "";

  const params = {
    Bucket: BUCKET_NAME,
    Key: cleanKey,
  };

  if (options.filename) {
    const isStream = Boolean(options.isStream);
    const dispositionType = isStream ? "inline" : "attachment";
    // Sanitize filename for HTTP header
    const cleanFilename = String(options.filename).replace(/["\r\n]/g, "").trim();
    params.ResponseContentDisposition = `${dispositionType}; filename="${cleanFilename}"`;
  }

  if (options.contentType) {
    params.ResponseContentType = options.contentType;
  }

  try {
    const command = new GetObjectCommand(params);
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    console.warn(`[s3.js] Failed to generate presigned URL for key "${cleanKey}":`, err?.message || err);
    return typeof key === "string" && key.startsWith("http") ? key : "";
  }
}


/**
 * Shared utility — determines the S3 subfolder based on file type / name / mime.
 * Used by both upload-file and upload-url routes.
 */
export function getCategoryFolder(type, name, mime) {
  const t = (type || "").toLowerCase();
  const n = (name || "").toLowerCase();
  const m = (mime || "").toLowerCase();

  if (t === "audio" || m.startsWith("audio/") || n.match(/\.(mp3|wav|m4a|aac|flac|ogg)$/i)) {
    return "audio";
  }
  if (t === "final_video" || t === "final-video" || t === "final video" || t === "finalvideo") {
    return "final video";
  }
  if (t === "video" || m.startsWith("video/") || n.match(/\.(mp4|mov|webm|mkv|avi)$/i)) {
    return "video";
  }
  if (t === "image" || t === "photo" || t === "photos" || m.startsWith("image/") || n.match(/\.(jpg|jpeg|png|heic|webp|gif)$/i)) {
    return "image";
  }
  return "media";
}

export async function uploadBufferToS3(buffer, key, contentType = "application/octet-stream") {
  const uploadParams = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  };
  const command = new PutObjectCommand(uploadParams);
  await s3.send(command);
  return key;
}
