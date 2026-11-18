import React from "react";
import { getSettings } from "@/lib/getSettings";
import { notFound, redirect } from "next/navigation";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import ShopifyMusicOrderView from "@/components/ecommerce/ShopifyMusicOrderView";
import { generatePresignedUrl, extractS3Key, checkS3KeyExists } from "@/lib/s3";

export const metadata = {
  title: "Shopify Music Order Details | Dashboard",
  description: "Detailed view of a Shopify music order",
};

export const dynamic = "force-dynamic";

export default async function ShopifyMusicOrderDetailsPage({ params }) {
  const { id } = await params;
  const settings = await getSettings();
  let orderInfo = null;
  let errorMsg = null;
  let matchedMusicInfo = [];

  await dbConnect();
  const cleanId = String(id).replace(/^#/, "").trim();

  // 1. Check if id is a MongoDB ObjectId, musicId, or shopifyOrderId
  let dbOrder = await Order.findOne({
    $or: [
      ...(cleanId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: cleanId }] : []),
      { musicId: cleanId },
      { shopifyOrderId: cleanId },
      { shopifyOrderNumber: cleanId },
      { shopifyOrderNumber: `#${cleanId}` },
    ],
  }).lean();

  const targetShopifyId = dbOrder?.shopifyOrderId ? String(dbOrder.shopifyOrderId).replace(/^#/, "") : cleanId;

  if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) {
    errorMsg = "Shopify integration is not configured.";
  } else {
    try {
      let url = settings.shopUrl1;
      if (!url.startsWith("http")) url = `https://${url}`;

      const response = await fetch(`${url}/admin/api/2024-04/orders/${targetShopifyId}.json`, {
        headers: {
          "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      const data = await response.json();

      if (response.ok && data.order) {
        orderInfo = data.order;

        // Check if this is actually a Video Order (line item has _orderType: "video" or videoId and no musicId)
        const hasVideoProp = (orderInfo.line_items || []).some((item) => {
          const props = item.properties || [];
          const getP = (name) => {
            const target = name.toLowerCase().replace(/[\s_-]/g, "");
            return props.find((p) => p.name?.toLowerCase().replace(/[\s_-]/g, "") === target);
          };
          return getP("ordertype")?.value?.toLowerCase() === "video" || !!getP("videoid")?.value;
        });

        const hasMusicProp = (orderInfo.line_items || []).some((item) => {
          const props = item.properties || [];
          const getP = (name) => {
            const target = name.toLowerCase().replace(/[\s_-]/g, "");
            return props.find((p) => p.name?.toLowerCase().replace(/[\s_-]/g, "") === target);
          };
          return getP("ordertype")?.value?.toLowerCase() === "music" || !!getP("musicid")?.value;
        });

        if (hasVideoProp && !hasMusicProp) {
          redirect(`/orders/video/${targetShopifyId}`);
        }

        if (!hasMusicProp && !dbOrder && !hasVideoProp) {
          const anyMusicTrack = (orderInfo.line_items || []).some((item) => {
            const props = item.properties || [];
            return props.some((p) => {
              const norm = (p.name || "").toLowerCase().replace(/[\s_-]/g, "");
              return norm === "musicid" || norm === "audiourl" || norm === "taskid" || norm.includes("originalorder");
            });
          });
          if (!anyMusicTrack) {
            redirect(`/orders/publish/${targetShopifyId}`);
          }
        }

        await dbConnect();

        for (const item of orderInfo.line_items || []) {
          const props = item.properties || [];

          // Helper to find property by normalized key
          const getProp = (name) => {
            const target = name.toLowerCase().replace(/[\s_-]/g, "");
            return props.find((p) => p.name?.toLowerCase().replace(/[\s_-]/g, "") === target);
          };

          const musicIdProp = getProp("musicid");
          const audioUrlProp = getProp("audiourl");
          const lyricsProp = getProp("lyrics");
          const songTitleProp = getProp("songtitle");

          let trackObj = null;
          let matchedOrderId = null;
          let matchedEmail = null;
          let matchedMusicId = musicIdProp?.value || null;

          let musicOrder = null;
          if (matchedMusicId) {
            musicOrder = await Order.findOne({ musicId: matchedMusicId }).lean();
          }
            if (!musicOrder && audioUrlProp?.value) {
              const extractedKey = extractS3Key(audioUrlProp.value);
              const folderMatch = extractedKey?.match(/music\/([0-9a-fA-F]{24})\//);
              if (folderMatch) {
                musicOrder = await Order.findById(folderMatch[1]).lean();
              }
            }
            if (!musicOrder) {
              musicOrder = await Order.findOne({
                $or: [
                  ...(matchedMusicId ? [{ musicId: matchedMusicId }] : []),
                  { shopifyOrderId: String(id) },
                  { shopifyOrderId: `#${orderInfo.order_number}` },
                  { shopifyOrderId: String(orderInfo.order_number) },
                  { shopifyOrderNumber: String(orderInfo.order_number) },
                  { shopifyOrderNumber: `#${orderInfo.order_number}` },
                  ...(dbOrder ? [{ _id: dbOrder._id }] : []),
                ].filter(Boolean),
              }).lean();
            }

            if (musicOrder) {
              matchedOrderId = musicOrder._id.toString();
              matchedEmail = musicOrder.email;

              let selectedTrack = null;
              if (musicOrder.selectedDemo && musicOrder.musicTracks) {
                selectedTrack = musicOrder.musicTracks.find((t) => t.id === musicOrder.selectedDemo);
              }
              if (!selectedTrack && musicOrder.musicTracks && musicOrder.musicTracks.length > 0) {
                selectedTrack = musicOrder.musicTracks[0];
              }

              if (selectedTrack) {
                trackObj = JSON.parse(JSON.stringify(selectedTrack));
                const s3Key = extractS3Key(trackObj.audioUrl || trackObj.streamAudioUrl);
                const existsOnS3 = s3Key ? await checkS3KeyExists(s3Key) : false;

                if (existsOnS3) {
                  if (trackObj.audioUrl) {
                    trackObj.audioUrl = await generatePresignedUrl(trackObj.audioUrl, 7 * 24 * 3600);
                  }
                  if (trackObj.streamAudioUrl) {
                    trackObj.streamAudioUrl = await generatePresignedUrl(trackObj.streamAudioUrl, 7 * 24 * 3600);
                  }
                } else {
                  trackObj.audioUrl = "";
                  trackObj.streamAudioUrl = "";
                }
              }

              // Presign revision tracks if any
              let revisions = [];
              if (musicOrder.revisions && Array.isArray(musicOrder.revisions)) {
                revisions = await Promise.all(
                  musicOrder.revisions.map(async (rev) => {
                    const r = JSON.parse(JSON.stringify(rev));
                    if (r.audioUrl || r.audioKey) {
                      r.audioUrl = await generatePresignedUrl(r.audioKey || r.audioUrl, 7 * 24 * 3600);
                    }

                    if (r.streamAudioUrl || r.audioKey || r.audioUrl) {
                      r.streamAudioUrl = await generatePresignedUrl(r.streamAudioUrl || r.audioKey || r.audioUrl, 7 * 24 * 3600);
                    }

                    if (r.videoUrl || r.videoKey) {
                      r.videoUrl = await generatePresignedUrl(r.videoKey || r.videoUrl, 7 * 24 * 3600, { isStream: true, contentType: "video/mp4" });
                    }
                    return r;
                  })
                );

                // Ensure active music track preview displays the latest revision
                const sortedRevs = [...revisions].sort((a, b) => (b.version || 0) - (a.version || 0));
                const latestRev = sortedRevs[0];
                if (latestRev && trackObj) {
                  if (latestRev.audioUrl) {
                    trackObj.audioUrl = latestRev.audioUrl;
                    trackObj.streamAudioUrl = latestRev.streamAudioUrl || latestRev.audioUrl;
                  }
                  if (latestRev.lyrics) {
                    trackObj.lyrics = latestRev.lyrics;
                  }
                }
              }

              matchedMusicInfo.push({
                lineItemId: item.id,
                musicId: matchedMusicId || musicOrder.musicId || "N/A",
                taskId: musicOrder.taskId || null,
                orderId: matchedOrderId || "",
                track: trackObj,
                mongoEmail: matchedEmail || orderInfo.email,
                revisions,
                currentVersion: musicOrder.currentVersion || 1,
                rawLyrics: musicOrder.lyrics || trackObj?.lyrics || "",
              });
              continue;
            }

          // Fallback: If no MongoDB track was found, but line item has direct _Audio_Url
          if (!trackObj && audioUrlProp?.value) {
            let directAudioUrl = audioUrlProp.value;
            const extractedKey = extractS3Key(directAudioUrl);
            const existsOnS3 = extractedKey ? await checkS3KeyExists(extractedKey) : false;

            if (existsOnS3) {
              const freshUrl = await generatePresignedUrl(extractedKey, 7 * 24 * 3600);
              if (freshUrl) directAudioUrl = freshUrl;
              trackObj = {
                title: songTitleProp?.value || item.title || "Custom Song",
                audioUrl: directAudioUrl,
                streamAudioUrl: directAudioUrl,
                lyrics: lyricsProp?.value || "",
              };
            }
          }

          if (trackObj || matchedMusicId) {
            matchedMusicInfo.push({
              lineItemId: item.id,
              musicId: matchedMusicId || "N/A",
              orderId: matchedOrderId || matchedMusicId || cleanId || String(orderInfo.id),
              track: trackObj,
              mongoEmail: matchedEmail || orderInfo.email,
              revisions: [],
              currentVersion: 1,
              rawLyrics: lyricsProp?.value || "",
            });
          }
        }

        // Check if Klaviyo event was sent for this specific order or its line items
        let klaviyoSent = false;
        const musicIdsFound = matchedMusicInfo.map((m) => m.musicId).filter((id) => id && id !== "N/A");

        const orConditions = [
          { shopifyOrderId: String(id) },
          { shopifyOrderId: String(orderInfo.id) },
          { shopifyOrderId: `#${orderInfo.order_number}` },
          { shopifyOrderId: String(orderInfo.order_number) },
          { shopifyOrderNumber: String(orderInfo.order_number) },
          { shopifyOrderNumber: `#${orderInfo.order_number}` },
          { shopifyOrderNumber: orderInfo.name },
          ...(cleanId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: cleanId }] : []),
        ];
        if (musicIdsFound.length > 0) {
          orConditions.push({ musicId: { $in: musicIdsFound } });
        }

        const relatedOrders = await Order.find({ $or: orConditions }).lean();
        if (relatedOrders.length > 0) {
          klaviyoSent = relatedOrders.some((o) => {
            if (o.currentVersion > 1) {
              return o.deliveryEmailSent === true && (o.deliveredVersion === o.currentVersion || o.status === "delivering");
            }
            return o.deliveryEmailSent === true || o.status === "delivering";
          });
        }

        if (!klaviyoSent) {
          const relatedVideo = await VideoOrder.findOne({
            $or: [
              { shopifyOrderId: String(id) },
              { shopifyOrderId: String(orderInfo.id) },
              { shopifyOrderId: `#${orderInfo.order_number}` },
              { shopifyOrderId: String(orderInfo.order_number) },
              { shopifyOrderNumber: String(orderInfo.order_number || "") },
              { shopifyOrderNumber: `#${orderInfo.order_number || ""}` },
              { shopifyOrderNumber: orderInfo.name || "" },
            ],
          }).lean();
          if (relatedVideo) {
            if (relatedVideo.currentVersion > 1) {
              klaviyoSent = relatedVideo.deliveryEmailSent === true && (relatedVideo.deliveredVersion === relatedVideo.currentVersion || relatedVideo.status === "delivering");
            } else {
              klaviyoSent =
                relatedVideo.deliveryEmailSent === true ||
                relatedVideo.status === "delivering";
            }
          }
        }

        orderInfo.klaviyoSent = klaviyoSent;
      } else {
        errorMsg = data.errors ? JSON.stringify(data.errors) : "Failed to fetch order from Shopify.";
      }
    } catch (err) {
      console.error("[MusicOrderDetails Error]:", err);
      errorMsg = "An error occurred while fetching the order.";
    }
  }

  if (errorMsg) {
    return (
      <div>
        <PageBreadcrumb pageTitle="Order Details" />
        <div className="p-4 rounded bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {errorMsg}
        </div>
        <BackButton fallbackUrl="/orders/music" className="mt-4 inline-block text-brand-500 underline">
          ← Back to Music Orders
        </BackButton>
      </div>
    );
  }

  if (!orderInfo) return notFound();

  const formatAddress = (address) => {
    if (!address) return "No address provided";
    return (
      <div className="text-sm text-gray-700 dark:text-gray-300">
        <p className="font-medium text-gray-800 dark:text-white/90">{address.name || `${address.first_name || ''} ${address.last_name || ''}`.trim()}</p>
        <p>{address.company}</p>
        <p>{address.address1}</p>
        <p>{address.address2}</p>
        <p>{`${address.city ? address.city + ',' : ''} ${address.province || ''} ${address.zip || ''}`}</p>
        <p>{address.country}</p>
        <p>{address.phone}</p>
      </div>
    );
  };

  let bestEmail = orderInfo.email || orderInfo.contact_email || orderInfo.customer?.email;
  if (!bestEmail && matchedMusicInfo.length > 0) {
    const fallback = matchedMusicInfo.find(m => m.mongoEmail);
    if (fallback) bestEmail = fallback.mongoEmail;
  }

  const musicDisplayNumber = orderInfo.name || (orderInfo.order_number ? `#${orderInfo.order_number}` : `#${orderInfo.id}`);

  const isMusicFulfilled =
    orderInfo?.fulfillment_status === "fulfilled" ||
    matchedMusicInfo.some((m) => m.status === "fulfilled");

  const serializedOrderInfo = orderInfo ? JSON.parse(JSON.stringify(orderInfo)) : null;
  const serializedMatchedMusicInfo = JSON.parse(JSON.stringify(matchedMusicInfo || []));
  const serializedDbOrder = dbOrder ? JSON.parse(JSON.stringify(dbOrder)) : null;

  return (
    <ShopifyMusicOrderView
      orderInfo={serializedOrderInfo}
      initialMatchedMusicInfo={serializedMatchedMusicInfo}
      dbOrder={serializedDbOrder}
      bestEmail={bestEmail}
      cleanId={cleanId}
      isMusicFulfilled={isMusicFulfilled}
      musicDisplayNumber={musicDisplayNumber}
    />
  );
}
