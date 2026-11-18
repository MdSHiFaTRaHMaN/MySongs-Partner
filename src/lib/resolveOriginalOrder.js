import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { generatePresignedUrl, extractS3Key, checkS3KeyExists } from "@/lib/s3";

/**
 * Normalizes property keys to simplify lookup
 */
function normalizeKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\s_\-:/]+/g, "");
}

/**
 * Resolves an original order and its final music track from line item properties or order note attributes.
 *
 * Rules:
 * - If the original order has revisions: The LAST/LATEST revision's music is the final track.
 * - If the original order has NO revisions: The purchased/generated music from the original order is the final track.
 *
 * @param {Array} lineItemProperties - Shopify line item properties array
 * @param {Array} noteAttributes - Shopify order note_attributes array
 * @param {Object} settings - Settings object containing shopUrl1 and shopifyAdminApiKey
 * @returns {Promise<Object|null>} Resolved original order data and finalTrack, or null if not found
 */
export async function resolveOriginalOrder(lineItemProperties = [], noteAttributes = [], settings = null) {
  const allProps = [...(lineItemProperties || []), ...(noteAttributes || [])];
  let originalOrderRef = null;

  for (const p of allProps) {
    const rawKey = normalizeKey(p.name || p.key);
    if (
      rawKey === "originalordernumber" ||
      rawKey === "originalorderid" ||
      rawKey === "originalorder" ||
      rawKey === "originalmusicorder" ||
      rawKey === "originalmusicordernumber" ||
      rawKey === "originalordername"
    ) {
      if (p.value && String(p.value).trim()) {
        originalOrderRef = String(p.value).trim();
        break;
      }
    }
  }

  if (!originalOrderRef) {
    return null;
  }

  await dbConnect();
  const cleanRef = originalOrderRef.replace(/^#/, "").trim();

  // 1. Search in MongoDB Order collection
  let originalOrder = await Order.findOne({
    $or: [
      ...(cleanRef.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: cleanRef }] : []),
      { shopifyOrderNumber: cleanRef },
      { shopifyOrderNumber: `#${cleanRef}` },
      { shopifyOrderId: cleanRef },
      { shopifyOrderId: `#${cleanRef}` },
      { musicId: cleanRef },
    ].filter(Boolean),
  }).lean();

  // 2. If not found in MongoDB, search Shopify API to find Shopify Order ID, then search MongoDB
  if (!originalOrder && settings?.shopUrl1 && settings?.shopifyAdminApiKey) {
    try {
      let shopUrl = settings.shopUrl1;
      if (!shopUrl.startsWith("http")) shopUrl = `https://${shopUrl}`;

      const sRes = await fetch(
        `${shopUrl}/admin/api/2024-04/orders.json?name=${encodeURIComponent(originalOrderRef)}&status=any`,
        {
          headers: {
            "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }
      );

      if (sRes.ok) {
        const sData = await sRes.json();
        const matchedShopifyOrder = (sData.orders || []).find(
          (o) =>
            String(o.order_number) === cleanRef ||
            String(o.name || "").replace(/^#/, "") === cleanRef ||
            String(o.id) === cleanRef
        );

        if (matchedShopifyOrder) {
          originalOrder = await Order.findOne({
            $or: [
              { shopifyOrderId: String(matchedShopifyOrder.id) },
              { shopifyOrderNumber: String(matchedShopifyOrder.order_number) },
              { shopifyOrderNumber: `#${matchedShopifyOrder.order_number}` },
            ],
          }).lean();
        }
      }
    } catch (e) {
      console.warn("[resolveOriginalOrder] Shopify lookup error:", e?.message);
    }
  }

  if (!originalOrder) {
    return null;
  }

  // Presign all revisions if present
  let presignedRevisions = [];
  if (originalOrder.revisions && Array.isArray(originalOrder.revisions)) {
    presignedRevisions = await Promise.all(
      originalOrder.revisions.map(async (rev) => {
        const r = JSON.parse(JSON.stringify(rev));
        const s3KeyOrUrl = r.audioKey || r.audioUrl;
        if (s3KeyOrUrl) {
          const s3Key = extractS3Key(s3KeyOrUrl);
          if (s3Key) {
            r.audioUrl = await generatePresignedUrl(s3Key, 7 * 24 * 3600);
            r.streamAudioUrl = r.audioUrl;
          }
        }
        if (r.streamAudioUrl && r.streamAudioUrl !== s3KeyOrUrl) {
          const s3StreamKey = extractS3Key(r.streamAudioUrl);
          if (s3StreamKey) {
            r.streamAudioUrl = await generatePresignedUrl(s3StreamKey, 7 * 24 * 3600);
          }
        }
        if (r.videoUrl || r.videoKey) {
          r.videoUrl = await generatePresignedUrl(r.videoKey || r.videoUrl, 7 * 24 * 3600, {
            isStream: true,
            contentType: "video/mp4",
          });
        }
        return r;
      })
    );
  }

  // Determine final track
  let finalTrack = null;
  if (presignedRevisions.length > 0) {
    // RULE 1: If revisions exist, the LATEST revision is the final music
    const sortedRevs = [...presignedRevisions].sort((a, b) => (b.version || 0) - (a.version || 0));
    const latestRev = sortedRevs[0];

    finalTrack = {
      id: latestRev._id?.toString() || `rev_${latestRev.version}`,
      title: latestRev.title || originalOrder.musicTracks?.[0]?.title || `Revision v${latestRev.version}`,
      audioUrl: latestRev.audioUrl || "",
      streamAudioUrl: latestRev.streamAudioUrl || latestRev.audioUrl || "",
      lyrics: latestRev.lyrics || originalOrder.lyrics || "",
      version: latestRev.version,
      isRevision: true,
      totalRevisions: presignedRevisions.length,
    };
  } else {
    // RULE 2: If NO revisions exist, use the originally purchased/generated music
    let selected = null;
    if (originalOrder.selectedDemo && originalOrder.musicTracks) {
      selected = originalOrder.musicTracks.find((t) => t.id === originalOrder.selectedDemo);
    }
    if (!selected && originalOrder.musicTracks && originalOrder.musicTracks.length > 0) {
      selected = originalOrder.musicTracks[0];
    }

    if (selected) {
      const trackCopy = JSON.parse(JSON.stringify(selected));
      const s3Key = extractS3Key(trackCopy.audioUrl || trackCopy.streamAudioUrl);
      const exists = s3Key ? await checkS3KeyExists(s3Key) : false;

      let pAudioUrl = "";
      let pStreamUrl = "";
      if (exists) {
        if (trackCopy.audioUrl) {
          pAudioUrl = await generatePresignedUrl(trackCopy.audioUrl, 7 * 24 * 3600);
        }
        if (trackCopy.streamAudioUrl) {
          pStreamUrl = await generatePresignedUrl(trackCopy.streamAudioUrl, 7 * 24 * 3600);
        }
      } else {
        pAudioUrl = trackCopy.audioUrl || "";
        pStreamUrl = trackCopy.streamAudioUrl || trackCopy.audioUrl || "";
      }

      finalTrack = {
        id: trackCopy.id || "track_1",
        title: trackCopy.title || originalOrder.songTitle || "Original Custom Song",
        audioUrl: pAudioUrl,
        streamAudioUrl: pStreamUrl || pAudioUrl,
        lyrics: originalOrder.lyrics || "",
        version: 1,
        isRevision: false,
        totalRevisions: 0,
      };
    }
  }

  return {
    originalOrder,
    finalTrack,
    revisions: presignedRevisions,
    isFromOriginalOrder: true,
    originalOrderNumber: originalOrder.shopifyOrderNumber || originalOrderRef,
    originalOrderId: originalOrder.shopifyOrderId || originalOrder._id?.toString(),
    originalOrderRef,
  };
}
