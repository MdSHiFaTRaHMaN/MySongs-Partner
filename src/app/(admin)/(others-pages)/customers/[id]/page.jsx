import React, { Suspense } from "react";
import dbConnect from "@/lib/mongoose";
import Customer from "@/models/Customer";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import CustomerDetailsView from "@/components/ecommerce/CustomerDetailsView";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import { generatePresignedUrl } from "@/lib/s3";
import { extractS3Key } from "@/lib/trashCleanup";
import { notFound } from "next/navigation";

import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id: rawId, email: rawEmail } = await params;
  const paramVal = decodeURIComponent(rawId || rawEmail || "").trim();
  await dbConnect();
  let titleEmail = paramVal;
  if (mongoose.Types.ObjectId.isValid(paramVal)) {
    const cDoc = await Customer.findById(paramVal).lean();
    if (cDoc?.email) titleEmail = cDoc.email;
  }
  return {
    title: `Customer 360° | ${titleEmail}`,
  };
}

export default async function Customer360Page({ params }) {
  const { id: rawId, email: rawEmail } = await params;
  const paramVal = decodeURIComponent(rawId || rawEmail || "").trim();

  await dbConnect();

  // 1. Resolve Customer by ID or Email
  let customerDoc = null;
  let customerEmail = "";

  if (mongoose.Types.ObjectId.isValid(paramVal)) {
    customerDoc = await Customer.findById(paramVal).lean();
    if (customerDoc) {
      customerEmail = customerDoc.email.trim().toLowerCase();
    }
  }

  if (!customerDoc) {
    customerDoc = await Customer.findOne({
      email: { $regex: new RegExp(`^${paramVal}$`, "i") },
    }).lean();
    if (customerDoc) {
      customerEmail = customerDoc.email.trim().toLowerCase();
    } else {
      customerEmail = paramVal.toLowerCase();
    }
  }

  // If customerDoc still doesn't exist, ensure a Customer record exists in MongoDB
  if (!customerDoc && customerEmail && customerEmail.includes("@")) {
    try {
      const created = await Customer.findOneAndUpdate(
        { email: customerEmail },
        { $setOnInsert: { email: customerEmail } },
        { upsert: true, returnDocument: "after", lean: true }
      );
      if (created) {
        customerDoc = created;
      }
    } catch (e) {
      console.warn("[Customer360Page] Could not auto-upsert customer doc:", e);
    }
  }

  const decodedEmail = customerEmail;

  if (!decodedEmail) return notFound();

  // 2. Fetch all Music / Custom Song Orders
  const rawMusicOrders = await Order.find({
    email: { $regex: new RegExp(`^${decodedEmail}$`, "i") },
    isDeleted: { $ne: true },
  })
    .sort({ createdAt: -1 })
    .lean();

  // 3. Fetch all Video Orders (actual orders with Shopify link or paid status)
  const rawVideoOrders = await VideoOrder.find({
    email: { $regex: new RegExp(`^${decodedEmail}$`, "i") },
    isDeleted: { $ne: true },
    $or: [
      { shopifyOrderId: { $ne: null, $nin: ["", "undefined"] } },
      { shopifyOrderNumber: { $ne: null, $nin: ["", "undefined"] } },
      { status: { $in: ["paid", "fulfilled"] } },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();

  // 3b. Fetch draft / incomplete video sessions (no Shopify order linked and not paid)
  const rawDraftVideoOrders = await VideoOrder.find({
    email: { $regex: new RegExp(`^${decodedEmail}$`, "i") },
    isDeleted: { $ne: true },
    $and: [
      {
        $or: [
          { shopifyOrderId: { $in: [null, "", "undefined"] } },
          { shopifyOrderId: { $exists: false } },
        ],
      },
      {
        $or: [
          { shopifyOrderNumber: { $in: [null, "", "undefined"] } },
          { shopifyOrderNumber: { $exists: false } },
        ],
      },
      { status: { $nin: ["paid", "fulfilled"] } },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();

  // 4. Presign URLs for Music Orders
  const musicOrders = await Promise.all(
    rawMusicOrders.map(async (o) => {
      const order = JSON.parse(JSON.stringify(o));
      if (order.musicTracks && Array.isArray(order.musicTracks)) {
        order.musicTracks = await Promise.all(
          order.musicTracks.map(async (track) => {
            const t = { ...track };
            const aKey = extractS3Key(t.audioUrl);
            if (aKey && !aKey.startsWith("http")) {
              try {
                t.audioUrl = await generatePresignedUrl(aKey, 7 * 24 * 3600);
              } catch (e) {}
            }
            const sKey = extractS3Key(t.streamAudioUrl);
            if (sKey && !sKey.startsWith("http")) {
              try {
                t.streamAudioUrl = await generatePresignedUrl(sKey, 7 * 24 * 3600);
              } catch (e) {}
            }
            return t;
          })
        );
      }

      if (order.revisions && Array.isArray(order.revisions)) {
        order.revisions = await Promise.all(
          order.revisions.map(async (rev) => {
            const r = { ...rev };
            const rAKey = extractS3Key(r.audioUrl);
            if (rAKey && !rAKey.startsWith("http")) {
              try {
                r.audioUrl = await generatePresignedUrl(rAKey, 7 * 24 * 3600);
              } catch (e) {}
            }
            const rSKey = extractS3Key(r.streamAudioUrl);
            if (rSKey && !rSKey.startsWith("http")) {
              try {
                r.streamAudioUrl = await generatePresignedUrl(rSKey, 7 * 24 * 3600);
              } catch (e) {}
            }
            return r;
          })
        );
      }
      return order;
    })
  );

  // Helper: Presign Video Order URLs
  const presignVideoOrder = async (v) => {
    const vOrder = JSON.parse(JSON.stringify(v));

    // 1. Audio file presigning
    const audioKey = vOrder.audioFile?.key || extractS3Key(vOrder.audioFile?.url);
    if (audioKey && !audioKey.startsWith("http")) {
      try {
        vOrder.audioFile = vOrder.audioFile || {};
        vOrder.audioFile.url = await generatePresignedUrl(audioKey, 7 * 24 * 3600);
      } catch (e) {
        console.warn("Failed to presign video audioFile:", e);
      }
    }

    // 2. Final video presigning
    const videoKey = vOrder.finalVideoKey || extractS3Key(vOrder.finalVideoUrl);
    if (videoKey && !videoKey.startsWith("http")) {
      try {
        vOrder.finalVideoUrl = await generatePresignedUrl(videoKey, 7 * 24 * 3600, {
          isStream: true,
          contentType: "video/mp4",
        });
      } catch (e) {
        console.warn("Failed to presign video finalVideoUrl:", e);
      }
    }

    // 3. Revisions presigning
    if (vOrder.revisions && Array.isArray(vOrder.revisions)) {
      vOrder.revisions = await Promise.all(
        vOrder.revisions.map(async (rev) => {
          const r = { ...rev };
          const rVidKey = r.videoKey || extractS3Key(r.videoUrl);
          if (rVidKey && !rVidKey.startsWith("http")) {
            try {
              r.videoUrl = await generatePresignedUrl(rVidKey, 7 * 24 * 3600, { isStream: true, contentType: "video/mp4" });
            } catch (e) {}
          }
          const rAudKey = r.audioKey || extractS3Key(r.audioUrl);
          if (rAudKey && !rAudKey.startsWith("http")) {
            try {
              r.audioUrl = await generatePresignedUrl(rAudKey, 7 * 24 * 3600);
            } catch (e) {}
          }
          return r;
        })
      );
    }

    // 4. Media files (Photos & Raw Videos) presigning
    if (vOrder.mediaFiles && Array.isArray(vOrder.mediaFiles)) {
      vOrder.mediaFiles = await Promise.all(
        vOrder.mediaFiles.map(async (m) => {
          const mf = { ...m };
          const mKey = mf.key || extractS3Key(mf.url);
          if (mKey && !mKey.startsWith("http")) {
            try {
              const isVideo = mf.type === "video" || (!mf.type && mf.mimeType?.startsWith("video")) || mKey.endsWith(".mp4") || mKey.endsWith(".mov");
              mf.url = await generatePresignedUrl(mKey, 7 * 24 * 3600, isVideo ? { isStream: true, contentType: "video/mp4" } : {});
            } catch (e) {
              console.warn("Failed to presign mediaFile:", e);
            }
          }
          return mf;
        })
      );
    }
    return vOrder;
  };

  // 5. Presign URLs for Video Orders & Drafts
  const videoOrders = await Promise.all(rawVideoOrders.map(presignVideoOrder));
  const draftVideoOrders = await Promise.all(rawDraftVideoOrders.map(presignVideoOrder));

  // 5b. Resolve Shopify Order Numbers (e.g. #215859) from Shopify Admin API
  let otherOrders = [];
  try {
    const { getSettings } = await import("@/lib/getSettings");
    const settings = await getSettings();
    if (settings.shopUrl1 && settings.shopifyAdminApiKey) {
      let url = settings.shopUrl1;
      if (!url.startsWith("http")) url = `https://${url}`;

      // First query Shopify for this customer's orders
      let res = await fetch(`${url}/admin/api/2024-04/orders.json?status=any&email=${encodeURIComponent(decodedEmail)}`, {
        headers: {
          "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      let customerSpecificOrders = [];
      if (res.ok) {
        const data = await res.json();
        customerSpecificOrders = (data.orders || []).filter((so) => {
          const oEmail = (so.email || so.customer?.email || "").trim().toLowerCase();
          return oEmail === decodedEmail.toLowerCase();
        });
      }

      // If missing order numbers, fetch recent orders list strictly to populate shopifyMap
      let lookupOrders = [];
      const needLookup = [...musicOrders, ...videoOrders].some((o) => o.shopifyOrderId && !o.shopifyOrderNumber);
      if (needLookup) {
        const lookupRes = await fetch(`${url}/admin/api/2024-04/orders.json?status=any&limit=250`, {
          headers: {
            "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          lookupOrders = lookupData.orders || [];
        }
      }

      // Build map from both customer orders and lookup orders for ID -> Order Number resolution
      const shopifyMap = new Map();
      [...lookupOrders, ...customerSpecificOrders].forEach((so) => {
        const formattedNum = so.name || (so.order_number ? `#${so.order_number}` : `#${so.id}`);
        shopifyMap.set(String(so.id), formattedNum);
        if (so.order_number) shopifyMap.set(String(so.order_number), formattedNum);
        if (so.name) shopifyMap.set(String(so.name).replace(/^#/, ""), formattedNum);
      });

      // Also check if any orders in lookupOrders actually belong to this customer
      const lookupMatchesForThisCustomer = lookupOrders.filter((so) => {
        const oEmail = (so.email || so.customer?.email || "").trim().toLowerCase();
        return oEmail === decodedEmail.toLowerCase();
      });

      // Deduplicate all orders strictly belonging to this customer
      const existingCustomerOrderIds = new Set(customerSpecificOrders.map((o) => String(o.id)));
      for (const lo of lookupMatchesForThisCustomer) {
        if (!existingCustomerOrderIds.has(String(lo.id))) {
          customerSpecificOrders.push(lo);
          existingCustomerOrderIds.add(String(lo.id));
        }
      }

      let allCustomerShopifyOrders = customerSpecificOrders;

      for (const order of musicOrders) {
        if (order.shopifyOrderId && (!order.shopifyOrderNumber || order.shopifyOrderNumber === `#${order.shopifyOrderId}`)) {
          const found = shopifyMap.get(String(order.shopifyOrderId));
          if (found) {
            order.shopifyOrderNumber = found;
            Order.updateOne({ _id: order._id }, { $set: { shopifyOrderNumber: found } }).catch(() => {});
          }
        }
      }

      for (const vOrder of videoOrders) {
        if (vOrder.shopifyOrderId && (!vOrder.shopifyOrderNumber || vOrder.shopifyOrderNumber === `#${vOrder.shopifyOrderId}`)) {
          const found = shopifyMap.get(String(vOrder.shopifyOrderId));
          if (found) {
            vOrder.shopifyOrderNumber = found;
            VideoOrder.updateOne({ _id: vOrder._id }, { $set: { shopifyOrderNumber: found } }).catch(() => {});
          }
        }
      }

      // Filter out orders that belong to Music or Video orders, leaving "Other Orders"
      if (allCustomerShopifyOrders.length > 0) {
        otherOrders = allCustomerShopifyOrders
          .filter((so) => {
            const isMusicLinked = musicOrders.some((m) => String(m.shopifyOrderId) === String(so.id));
            const isVideoLinked = videoOrders.some((v) => String(v.shopifyOrderId) === String(so.id));
            if (isMusicLinked || isVideoLinked) return false;

            // Check if any line item has _Music_ID or _Video_ID
            const hasMusicOrVideoProp = (so.line_items || []).some((item) => {
              return (item.properties || []).some((p) => {
                const norm = (p.name || "").toLowerCase().replace(/[\s_-]/g, "");
                return norm === "musicid" || norm === "videoid" || (norm === "ordertype" && (p.value === "music" || p.value === "video"));
              });
            });

            return !hasMusicOrVideoProp;
          })
          .map((so) => {
            const displayNumber = so.name || (so.order_number ? `#${so.order_number}` : `#${so.id}`);
            const isFulfilled = so.fulfillment_status === "fulfilled";
            return {
              _id: String(so.id),
              shopifyOrderId: String(so.id),
              shopifyOrderNumber: displayNumber,
              orderCategory: "other",
              financialStatus: so.financial_status || "paid",
              fulfillmentStatus: so.fulfillment_status || "unfulfilled",
              status: so.fulfillment_status || so.financial_status || "open",
              createdAt: so.created_at,
              totalPrice: so.total_price || so.current_total_price || "0.00",
              currency: so.currency || "USD",
              lineItems: (so.line_items || []).map((li) => ({
                id: li.id,
                title: li.title,
                quantity: li.quantity,
                price: li.price,
                variantTitle: li.variant_title,
              })),
              isOpen: !isFulfilled,
              isFulfilled,
              displayId: String(so.id),
              displayNumber,
              detailUrl: so.order_status_url || null,
              shopifyAdminUrl: settings.shopUrl1 ? `https://${settings.shopUrl1.replace(/^https?:\/\//, '')}/admin/orders/${so.id}` : null,
            };
          });
      }
    }
  } catch (err) {
    console.error("[Customer360Page] Error resolving Shopify order numbers:", err);
  }

  // 6. Paid Orders & Stats (Count distinct Shopify orders and paid orders)
  const paidShopifyOrderIds = new Set();
  const nonShopifyPaidOrderKeys = new Set();
  const countedSpentOrderIds = new Set();
  let totalSpent = 0;

  videoOrders.forEach((v) => {
    const isPaid = v.status === "paid" || v.status === "fulfilled" || v.status === "ready" || v.status === "delivering" || Boolean(v.shopifyOrderId);
    if (isPaid) {
      const key = v.shopifyOrderId ? String(v.shopifyOrderId) : `vid_${v._id}`;
      if (v.shopifyOrderId) {
        paidShopifyOrderIds.add(String(v.shopifyOrderId));
      } else {
        nonShopifyPaidOrderKeys.add(key);
      }
      if (!countedSpentOrderIds.has(key)) {
        if (v.packagePrice && typeof v.packagePrice === "number") {
          totalSpent += v.packagePrice;
        }
        countedSpentOrderIds.add(key);
      }
    }
  });

  const videoShopifyOrderIds = new Set(videoOrders.map((v) => String(v.shopifyOrderId)).filter(Boolean));

  const paidMusicOrders = musicOrders.filter((o) => {
    if (o.shopifyOrderId && videoShopifyOrderIds.has(String(o.shopifyOrderId))) {
      return false;
    }
    return o.status === "paid" || o.status === "fulfilled" || o.status === "delivering" || (Boolean(o.shopifyOrderId) && Boolean(o.musicId));
  });

  musicOrders.forEach((o) => {
    const isPaid = o.status === "paid" || o.status === "fulfilled" || o.status === "delivering" || (Boolean(o.shopifyOrderId) && Boolean(o.musicId));
    if (isPaid) {
      const key = o.shopifyOrderId ? String(o.shopifyOrderId) : `music_${o._id}`;
      if (o.shopifyOrderId) {
        paidShopifyOrderIds.add(String(o.shopifyOrderId));
      } else {
        nonShopifyPaidOrderKeys.add(key);
      }
      if (!countedSpentOrderIds.has(key)) {
        totalSpent += 29.99;
        countedSpentOrderIds.add(key);
      }
    }
  });

  otherOrders.forEach((o) => {
    const isPaid = o.financialStatus === "paid" || o.isFulfilled || o.status === "fulfilled" || Boolean(o.shopifyOrderId);
    if (isPaid) {
      const key = o.shopifyOrderId ? String(o.shopifyOrderId) : `other_${o._id}`;
      if (o.shopifyOrderId) {
        paidShopifyOrderIds.add(String(o.shopifyOrderId));
      } else {
        nonShopifyPaidOrderKeys.add(key);
      }
      if (!countedSpentOrderIds.has(key)) {
        totalSpent += parseFloat(o.totalPrice) || 0;
        countedSpentOrderIds.add(key);
      }
    }
  });

  const totalPurchases = paidShopifyOrderIds.size + nonShopifyPaidOrderKeys.size;
  const totalGenerations = musicOrders.length;

  const dates = [
    ...musicOrders.map((o) => new Date(o.createdAt)),
    ...videoOrders.map((v) => new Date(v.createdAt)),
    ...otherOrders.map((o) => new Date(o.createdAt)),
  ].filter((d) => !isNaN(d.getTime()));

  const firstActive = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const lastActive = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

  const stats = {
    totalPurchases,
    totalGenerations,
    totalSpent,
    securityFlags: customerDoc?.securityFlags || 0,
    firstActive,
    lastActive,
  };

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <CustomerDetailsView
        customerDoc={customerDoc ? JSON.parse(JSON.stringify(customerDoc)) : null}
        musicOrders={paidMusicOrders}
        videoOrders={videoOrders}
        draftVideoOrders={draftVideoOrders}
        otherOrders={otherOrders}
        allGeneratedSongs={musicOrders}
        stats={stats}
        email={decodedEmail}
      />
    </Suspense>
  );
}
