import dbConnect from "./mongoose";
import Order from "@/models/Order";
import { deleteFromS3, BUCKET_NAME } from "./s3";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

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
function extractS3Key(keyOrUrl) {
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

  // Already a raw key
  return val;
}

/**
 * Cleans up unpaid / unordered music files older than specified retention days (default 30 days)
 * @param {number} retentionDays - Number of days to retain unpaid music (default 30)
 * @returns {Promise<Object>} cleanup statistics
 */
export async function runS3Cleanup(retentionDays = 30) {
  await dbConnect();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  console.log(`[S3 Cleanup] Scanning for unpaid music generated before: ${cutoffDate.toISOString()}`);

  // Query unpaid/abandoned orders older than retentionDays that haven't been cleaned up yet
  const unpaidOrders = await Order.find({
    status: { $in: ["created", "completed", "in_cart", "failed", "pending", "pending_payment"] },
    shopifyOrderId: { $in: [null, "", undefined] },
    createdAt: { $lt: cutoffDate },
    s3CleanedUp: { $ne: true },
  }).lean();

  if (!unpaidOrders || unpaidOrders.length === 0) {
    return {
      success: true,
      processedOrdersCount: 0,
      deletedFilesCount: 0,
      freedEstimateMB: 0,
      message: "No unpaid music files older than 30 days found.",
      timestamp: new Date().toISOString(),
    };
  }

  const keysToDelete = [];
  const orderIdsToUpdate = [];

  for (const order of unpaidOrders) {
    let hasKeys = false;

    // Collect track audio and stream keys
    if (order.musicTracks && Array.isArray(order.musicTracks)) {
      for (const track of order.musicTracks) {
        const audioKey = extractS3Key(track.audioUrl);
        const streamKey = extractS3Key(track.streamAudioUrl);

        if (audioKey && (audioKey.startsWith("music/") || audioKey.startsWith("video-tool/"))) {
          keysToDelete.push(audioKey);
          hasKeys = true;
        }
        if (streamKey && (streamKey.startsWith("music/") || streamKey.startsWith("video-tool/")) && streamKey !== audioKey) {
          keysToDelete.push(streamKey);
          hasKeys = true;
        }
      }
    }

    orderIdsToUpdate.push(order._id);
  }

  // Deduplicate keys
  const uniqueKeys = Array.from(new Set(keysToDelete));
  let deletedCount = 0;

  // Batch delete in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
    const chunk = uniqueKeys.slice(i, i + chunkSize);
    try {
      if (BUCKET_NAME) {
        const deleteParams = {
          Bucket: BUCKET_NAME,
          Delete: {
            Objects: chunk.map((k) => ({ Key: k })),
            Quiet: true,
          },
        };
        const command = new DeleteObjectsCommand(deleteParams);
        await s3.send(command);
        deletedCount += chunk.length;
      }
    } catch (err) {
      console.error("[S3 Cleanup] Batch delete error:", err);
      // Fallback single file deletion
      for (const singleKey of chunk) {
        try {
          await deleteFromS3(singleKey);
          deletedCount++;
        } catch (e) {
          console.error(`[S3 Cleanup] Error deleting key ${singleKey}:`, e);
        }
      }
    }
  }

  // Mark orders as cleaned up and move them to Trash Bin
  if (orderIdsToUpdate.length > 0) {
    await Order.updateMany(
      { _id: { $in: orderIdsToUpdate } },
      {
        $set: {
          s3CleanedUp: true,
          s3CleanedUpAt: new Date(),
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: "S3_Auto_Cleanup",
        },
      }
    );
  }

  // Estimate freed storage: ~5 MB per full audio + 1 MB per preview
  const estimatedMB = (deletedCount * 3.5).toFixed(2);

  console.log(
    `[S3 Cleanup Completed] ${deletedCount} files deleted from S3 across ${orderIdsToUpdate.length} unpaid orders. Reclaimed ~${estimatedMB} MB.`
  );

  return {
    success: true,
    processedOrdersCount: orderIdsToUpdate.length,
    deletedFilesCount: deletedCount,
    freedEstimateMB: parseFloat(estimatedMB),
    message: `Successfully cleaned up ${deletedCount} files across ${orderIdsToUpdate.length} unpaid orders older than ${retentionDays} days.`,
    timestamp: new Date().toISOString(),
  };
}
