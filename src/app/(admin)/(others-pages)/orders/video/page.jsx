import React from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getSettings } from "@/lib/getSettings";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import ShopifyVideoOrdersTable from "@/components/tables/ShopifyVideoOrdersTable";
import { fetchAllShopifyOrders } from "@/lib/shopifyOrders";

export const metadata = {
  title: "Video Orders | Dashboard",
  description: "Manage Customer Music Video Orders from Shopify",
};

export const dynamic = "force-dynamic";

export default async function VideoOrdersPage() {
  const settings = await getSettings();
  let videoOrders = [];
  let errorMsg = null;

  try {
    await dbConnect();

    // 1. Fetch real Shopify Orders
    let allShopifyOrders = [];
    if (settings.shopUrl1 && settings.shopifyAdminApiKey) {
      try {
        allShopifyOrders = await fetchAllShopifyOrders(settings);
      } catch (e) {
        console.error("[VideoOrdersPage] Failed to fetch Shopify orders:", e);
      }
    }

    // Filter Shopify orders that are Video orders
    const shopifyVideoOrders = allShopifyOrders.filter((order) => {
      return order.line_items?.some((item) => {
        const hasVideoId = item.properties?.some((p) =>
          ["_videoid", "videoid", "video id", "_video_id"].includes(p.name?.toLowerCase())
        );
        const isVideoTitle =
          item.title?.toLowerCase().includes("video") || item.name?.toLowerCase().includes("video");
        return hasVideoId || isVideoTitle;
      });
    });

    // 2. Fetch all MongoDB VideoOrders (and identify deleted ones)
    const mongoOrders = await VideoOrder.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
    const deletedMongoOrders = await VideoOrder.find({ isDeleted: true }).select("shopifyOrderId shopifyOrderNumber videoId").lean();

    const deletedIds = new Set();
    deletedMongoOrders.forEach((d) => {
      if (d.shopifyOrderId) {
        deletedIds.add(String(d.shopifyOrderId).replace(/^#/, "").trim());
        deletedIds.add(`#${String(d.shopifyOrderId).replace(/^#/, "").trim()}`);
      }
      if (d.shopifyOrderNumber) {
        deletedIds.add(String(d.shopifyOrderNumber).replace(/^#/, "").trim());
        deletedIds.add(`#${String(d.shopifyOrderNumber).replace(/^#/, "").trim()}`);
      }
      if (d.videoId) deletedIds.add(String(d.videoId).trim());
    });

    const mongoMap = new Map();
    mongoOrders.forEach((o) => {
      if (o.shopifyOrderId) {
        mongoMap.set(String(o.shopifyOrderId).replace(/^#/, "").trim(), o);
        mongoMap.set(`#${String(o.shopifyOrderId).replace(/^#/, "").trim()}`, o);
      }
      if (o.shopifyOrderNumber) {
        mongoMap.set(String(o.shopifyOrderNumber).replace(/^#/, "").trim(), o);
        mongoMap.set(`#${String(o.shopifyOrderNumber).replace(/^#/, "").trim()}`, o);
        mongoMap.set(String(o.shopifyOrderNumber).trim(), o);
      }
      if (o.videoId) mongoMap.set(String(o.videoId).trim(), o);
    });

    const combinedOrders = [];
    const seenIds = new Set();

    // First, process all real Shopify Video Orders (skip deleted ones)
    for (const shopifyOrder of shopifyVideoOrders) {
      const orderIdStr = String(shopifyOrder.id);
      const orderNameStr = String(shopifyOrder.name || (shopifyOrder.order_number ? `#${shopifyOrder.order_number}` : ""));
      const orderNumRaw = String(shopifyOrder.order_number || "");

      let videoId = "";
      shopifyOrder.line_items?.forEach((item) => {
        item.properties?.forEach((p) => {
          if (["_videoid", "videoid", "video id", "_video_id"].includes(p.name?.toLowerCase())) {
            videoId = p.value;
          }
        });
      });

      // If marked deleted in MongoDB, do not show in active table
      if (
        deletedIds.has(orderIdStr) ||
        deletedIds.has(orderNameStr) ||
        (orderNumRaw && deletedIds.has(orderNumRaw)) ||
        (videoId && deletedIds.has(videoId))
      ) {
        continue;
      }

      seenIds.add(orderIdStr);
      seenIds.add(orderNameStr);
      if (orderNumRaw) seenIds.add(orderNumRaw);

      const linkedMongo =
        mongoMap.get(orderIdStr) ||
        mongoMap.get(orderNameStr) ||
        (orderNumRaw ? mongoMap.get(orderNumRaw) : null) ||
        (videoId ? mongoMap.get(videoId) : null);

      combinedOrders.push({
        _id: linkedMongo?._id || `shopify_${shopifyOrder.id}`,
        videoId: linkedMongo?.videoId || videoId || `vid_${shopifyOrder.id}`,
        shopifyOrderId: orderIdStr,
        shopifyOrderNumber: orderNameStr || linkedMongo?.shopifyOrderNumber || orderNumRaw,
        customerName:
          linkedMongo?.customerName ||
          (shopifyOrder.customer
            ? `${shopifyOrder.customer.first_name || ""} ${shopifyOrder.customer.last_name || ""}`.trim()
            : "Customer"),
        email: linkedMongo?.email || shopifyOrder.email || shopifyOrder.contact_email || "",
        selectedPackage: linkedMongo?.selectedPackage || "Music Video",
        videoFormat: linkedMongo?.videoFormat || (() => {
          const rawFmt = (shopifyOrder.line_items || [])
            .flatMap((i) => i.properties || [])
            .find((p) => ["_video_format", "video format", "_aspect_ratio", "aspect ratio"].includes(p.name?.toLowerCase()));
          return rawFmt?.value?.includes("16:9") ? "16:9" : "9:16";
        })(),
        packagePrice: linkedMongo?.packagePrice || parseFloat(shopifyOrder.total_price || 0),
        currency: linkedMongo?.currency || shopifyOrder.currency || "USD",
        audioFile: linkedMongo?.audioFile || { key: "", url: "" },
        mediaFiles: linkedMongo?.mediaFiles || [],
        status: (() => {
          if (shopifyOrder.fulfillment_status === "fulfilled" || linkedMongo?.status === "fulfilled") {
            return "fulfilled";
          }
          if (linkedMongo?.status) {
            return linkedMongo.status;
          }
          return shopifyOrder.financial_status === "paid" ? "in_production" : "pending";
        })(),
        createdAt: shopifyOrder.created_at || linkedMongo?.createdAt,
        finalVideoUrl: linkedMongo?.finalVideoUrl || "",
        finalVideoKey: linkedMongo?.finalVideoKey || "",
        deliveryEmailSent: linkedMongo?.deliveryEmailSent || false,
      });
    }

    // Also include any MongoDB VideoOrder that has an actual linked Shopify Order ID
    for (const mOrder of mongoOrders) {
      if (mOrder.isDeleted) continue;
      const sId = String(mOrder.shopifyOrderId || "").replace(/^#/, "").trim();
      const sNum = String(mOrder.shopifyOrderNumber || "").replace(/^#/, "").trim();
      if ((sId || sNum) && !seenIds.has(sId) && !seenIds.has(sNum)) {
        seenIds.add(sId || sNum);
        combinedOrders.push(mOrder);
      }
    }

    videoOrders = JSON.parse(JSON.stringify(combinedOrders));
  } catch (err) {
    console.error("[VideoOrdersPage Error]:", err);
    errorMsg = "An error occurred while fetching video orders: " + err.message;
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="Music Video Orders" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        {errorMsg ? (
          <div className="p-4 rounded bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {errorMsg}
          </div>
        ) : (
          <ShopifyVideoOrdersTable initialOrders={videoOrders} itemsPerPageDefault={settings.tableItemsPerPage || 50} />
        )}
      </div>
    </div>
  );
}
