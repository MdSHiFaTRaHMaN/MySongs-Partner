import dbConnect from "./mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "./getSettings";
import { BUCKET_NAME } from "./s3";
import { S3Client, DeleteObjectsCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Extracts pure S3 Key from URL or key string
 */
export function extractS3Key(keyOrUrl) {
  if (!keyOrUrl || typeof keyOrUrl !== "string") return null;
  const val = keyOrUrl.trim();
  if (!val) return null;

  if (val.startsWith("http://") || val.startsWith("https://")) {
    try {
      const parsed = new URL(val);
      const pathname = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
      return pathname || null;
    } catch (e) {
      return null;
    }
  }

  return val;
}

/**
 * Collects all S3 keys from a Music Order document
 */
export function collectMusicOrderS3Keys(order) {
  const keys = [];
  if (!order) return keys;

  if (Array.isArray(order.musicTracks)) {
    for (const track of order.musicTracks) {
      const audioKey = extractS3Key(track.audioUrl);
      const streamKey = extractS3Key(track.streamAudioUrl);
      if (audioKey) keys.push(audioKey);
      if (streamKey && streamKey !== audioKey) keys.push(streamKey);
    }
  }

  if (Array.isArray(order.revisions)) {
    for (const rev of order.revisions) {
      const revAudio = extractS3Key(rev.audioUrl);
      const revStream = extractS3Key(rev.streamAudioUrl);
      const revVideo = extractS3Key(rev.videoUrl);
      if (revAudio) keys.push(revAudio);
      if (revStream && revStream !== revAudio) keys.push(revStream);
      if (revVideo) keys.push(revVideo);

      if (Array.isArray(rev.customFiles)) {
        for (const file of rev.customFiles) {
          const fileKey = extractS3Key(file.key || file.url);
          if (fileKey) keys.push(fileKey);
        }
      }
    }
  }

  return Array.from(new Set(keys.filter(Boolean)));
}

/**
 * Collects all S3 keys from a Video Order document
 */
export function collectVideoOrderS3Keys(videoOrder) {
  const keys = [];
  if (!videoOrder) return keys;

  // 1. Audio file
  if (videoOrder.audioFile) {
    const audioKey = extractS3Key(videoOrder.audioFile.key || videoOrder.audioFile.url);
    if (audioKey) keys.push(audioKey);
  }

  // 2. Uploaded Media files (photos / videos / audios)
  if (Array.isArray(videoOrder.mediaFiles)) {
    for (const file of videoOrder.mediaFiles) {
      const fileKey = extractS3Key(file.key || file.url);
      if (fileKey) keys.push(fileKey);
    }
  }

  // 3. Final Video delivery
  const finalKey = extractS3Key(videoOrder.finalVideoKey || videoOrder.finalVideoUrl);
  if (finalKey) keys.push(finalKey);

  // 4. Revisions
  if (Array.isArray(videoOrder.revisions)) {
    for (const rev of videoOrder.revisions) {
      const revVideo = extractS3Key(rev.videoKey || rev.videoUrl);
      const revAudio = extractS3Key(rev.audioKey || rev.audioUrl);
      if (revVideo) keys.push(revVideo);
      if (revAudio) keys.push(revAudio);

      if (Array.isArray(rev.customFiles)) {
        for (const file of rev.customFiles) {
          const fileKey = extractS3Key(file.key || file.url);
          if (fileKey) keys.push(fileKey);
        }
      }
    }
  }

  return Array.from(new Set(keys.filter(Boolean)));
}

/**
 * Batch deletes a list of S3 keys from the bucket
 */
export async function deleteS3KeysBatch(keys = []) {
  if (!keys || keys.length === 0 || !BUCKET_NAME) return 0;
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  let deletedCount = 0;

  const chunkSize = 500;
  for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
    const chunk = uniqueKeys.slice(i, i + chunkSize);
    try {
      const command = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: chunk.map((k) => ({ Key: k })),
          Quiet: true,
        },
      });
      await s3.send(command);
      deletedCount += chunk.length;
    } catch (err) {
      console.error("[Trash S3 Batch Delete Error]:", err);
      // Fallback: delete one by one
      for (const k of chunk) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: k }));
          deletedCount += 1;
        } catch (singleErr) {
          console.error(`[Trash S3 Single Delete Error for ${k}]:`, singleErr);
        }
      }
    }
  }

  return deletedCount;
}

/**
 * Permanently deletes items CURRENTLY in the Trash Bin (isDeleted: true).
 * Does NOT touch active, draft, or unpurchased orders.
 * Only purges what is actually inside the Trash Bin.
 * @param {"all" | "music" | "video"} targetType
 */
export async function emptyTrashBinOnly(targetType = "all") {
  await dbConnect();

  let deletedMusicCount = 0;
  let deletedVideoCount = 0;
  const s3KeysToDelete = [];
  const musicOrderIdsToDelete = [];
  const videoOrderIdsToDelete = [];

  // 1. Collect trashed music orders
  if (targetType === "all" || targetType === "music") {
    const trashedMusicOrders = await Order.find({ isDeleted: true }).lean();
    for (const o of trashedMusicOrders) {
      const keys = collectMusicOrderS3Keys(o);
      s3KeysToDelete.push(...keys);
      musicOrderIdsToDelete.push(o._id);
    }
    deletedMusicCount = musicOrderIdsToDelete.length;
    if (musicOrderIdsToDelete.length > 0) {
      await Order.deleteMany({ _id: { $in: musicOrderIdsToDelete } });
    }
  }

  // 2. Collect trashed video orders
  if (targetType === "all" || targetType === "video") {
    const trashedVideoOrders = await VideoOrder.find({ isDeleted: true }).lean();
    for (const vo of trashedVideoOrders) {
      const keys = collectVideoOrderS3Keys(vo);
      s3KeysToDelete.push(...keys);
      videoOrderIdsToDelete.push(vo._id);
    }
    deletedVideoCount = videoOrderIdsToDelete.length;
    if (videoOrderIdsToDelete.length > 0) {
      await VideoOrder.deleteMany({ _id: { $in: videoOrderIdsToDelete } });
    }
  }

  // 3. Purge collected S3 files from AWS S3
  let deletedS3Count = 0;
  if (s3KeysToDelete.length > 0) {
    deletedS3Count = await deleteS3KeysBatch(s3KeysToDelete);
  }

  return {
    success: true,
    deletedMusicOrdersCount: deletedMusicCount,
    deletedVideoOrdersCount: deletedVideoCount,
    deletedS3FilesCount: deletedS3Count,
    message: `Trash Bin successfully emptied. Permanently deleted ${deletedMusicCount} music and ${deletedVideoCount} video orders (${deletedS3Count} S3 files removed).`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Executes Unified Storage & Trash Bin Lifecycle Cleanup:
 * 1. Finds unpurchased/abandoned music older than retentionDays -> deletes S3 files & moves them to Trash Bin.
 * 2. Finds all soft-deleted items (Music & Video) that have exceeded the retentionDays in Trash Bin -> deletes all S3 files & permanently removes them from DB.
 * @param {number|null} customDays - Optional override for retention days
 */
export async function runTrashCleanup(customDays = null) {
  await dbConnect();
  const settings = await getSettings();
  const retentionDays = customDays !== null && !isNaN(customDays)
    ? Number(customDays)
    : (settings.trashBinRetentionDays ?? 30);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  console.log(`[Storage & Trash Cleanup] Running for items older than: ${cutoffDate.toISOString()} (${retentionDays} days retention)`);

  // -------------------------------------------------------------
  // PHASE 1: Move abandoned/unpurchased music orders to Trash Bin & delete S3 audio
  // Only runs when retentionDays > 0 to avoid sweeping active/cart orders
  // -------------------------------------------------------------
  let deletedUnpaidFilesCount = 0;
  const unpaidOrderIdsToTrash = [];

  if (retentionDays > 0) {
    const unpaidOrders = await Order.find({
      status: { $in: ["created", "completed", "in_cart", "failed", "pending", "pending_payment"] },
      shopifyOrderId: { $in: [null, "", undefined] },
      createdAt: { $lt: cutoffDate },
      isDeleted: { $ne: true },
    }).lean();

    const unpaidS3Keys = [];
    for (const order of unpaidOrders) {
      const keys = collectMusicOrderS3Keys(order);
      unpaidS3Keys.push(...keys);
      unpaidOrderIdsToTrash.push(order._id);
    }

    if (unpaidS3Keys.length > 0) {
      deletedUnpaidFilesCount = await deleteS3KeysBatch(unpaidS3Keys);
    }

    if (unpaidOrderIdsToTrash.length > 0) {
      await Order.updateMany(
        { _id: { $in: unpaidOrderIdsToTrash } },
        {
          $set: {
            s3CleanedUp: true,
            s3CleanedUpAt: new Date(),
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: "Storage_Auto_Cleanup",
          },
        }
      );
    }
  }

  // -------------------------------------------------------------
  // PHASE 2: Permanently purge expired Trash Bin orders (older than retentionDays)
  // -------------------------------------------------------------
  const expiredMusicOrders = await Order.find({
    isDeleted: true,
    deletedAt: { $lt: cutoffDate },
  }).lean();

  const expiredVideoOrders = await VideoOrder.find({
    isDeleted: true,
    deletedAt: { $lt: cutoffDate },
  }).lean();

  const expiredS3Keys = [];
  const musicOrderIdsToDelete = [];
  const videoOrderIdsToDelete = [];

  for (const o of expiredMusicOrders) {
    const keys = collectMusicOrderS3Keys(o);
    expiredS3Keys.push(...keys);
    musicOrderIdsToDelete.push(o._id);
  }

  for (const vo of expiredVideoOrders) {
    const keys = collectVideoOrderS3Keys(vo);
    expiredS3Keys.push(...keys);
    videoOrderIdsToDelete.push(vo._id);
  }

  const deletedExpiredFilesCount = await deleteS3KeysBatch(expiredS3Keys);

  if (musicOrderIdsToDelete.length > 0) {
    await Order.deleteMany({ _id: { $in: musicOrderIdsToDelete } });
  }

  if (videoOrderIdsToDelete.length > 0) {
    await VideoOrder.deleteMany({ _id: { $in: videoOrderIdsToDelete } });
  }

  const totalFilesDeleted = deletedUnpaidFilesCount + deletedExpiredFilesCount;

  return {
    success: true,
    retentionDays,
    cutoffDate: cutoffDate.toISOString(),
    movedToTrashCount: unpaidOrderIdsToTrash.length,
    deletedMusicOrdersCount: musicOrderIdsToDelete.length,
    deletedVideoOrdersCount: videoOrderIdsToDelete.length,
    deletedS3FilesCount: totalFilesDeleted,
    message: `Storage & Trash Cleanup completed. Moved ${unpaidOrderIdsToTrash.length} unpaid orders to Trash. Permanently purged ${musicOrderIdsToDelete.length} music & ${videoOrderIdsToDelete.length} video orders (${totalFilesDeleted} S3 files deleted).`,
    timestamp: new Date().toISOString(),
  };
}
