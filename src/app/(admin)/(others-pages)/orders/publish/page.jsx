import React from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getSettings } from "@/lib/getSettings";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import ShopifyOrdersTable from "@/components/tables/ShopifyOrdersTable";
import PublishFilterConfigModal from "@/components/ecommerce/PublishFilterConfigModal";
import { fetchAllShopifyOrders } from "@/lib/shopifyOrders";
import { classifyOrder } from "@/lib/orderClassifier";

export const metadata = {
  title: "Other Orders | Dashboard",
  description: "Manage Shopify orders other than Music and Video",
};

export const dynamic = "force-dynamic";

export default async function OtherOrdersPage({ searchParams }) {
  const settings = await getSettings();
  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page || "1", 10));
  const limit = Math.max(1, parseInt(params?.limit || settings.tableItemsPerPage || "50", 10));
  const filter = params?.filter || "all";
  const sort = params?.sort || "date_desc";
  const search = (params?.search || "").trim();

  let allOrders = [];
  let errorMsg = null;

  if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) {
    errorMsg = "Shopify integration is not configured. Please add Shop URL and Admin API Key in Settings.";
  } else {
    try {
      await dbConnect();

      // Fetch only orders that have a Shopify order reference or ID to classify fast
      const [musicDocs, videoDocs] = await Promise.all([
        Order.find({
          $or: [
            { shopifyOrderId: { $exists: true, $nin: [null, ""] } },
            { shopifyOrderNumber: { $exists: true, $nin: [null, ""] } },
          ],
        })
          .select("shopifyOrderId shopifyOrderNumber musicId")
          .lean(),
        VideoOrder.find({
          $or: [
            { shopifyOrderId: { $exists: true, $nin: [null, ""] } },
            { shopifyOrderNumber: { $exists: true, $nin: [null, ""] } },
          ],
        })
          .select("shopifyOrderId shopifyOrderNumber videoId")
          .lean(),
      ]);

      const mongoMusicIds = new Set();
      musicDocs.forEach((d) => {
        if (d.shopifyOrderId) mongoMusicIds.add(String(d.shopifyOrderId).replace(/^#/, "").trim());
        if (d.shopifyOrderNumber) mongoMusicIds.add(String(d.shopifyOrderNumber).replace(/^#/, "").trim());
        if (d.musicId) mongoMusicIds.add(String(d.musicId).trim());
      });

      const mongoVideoIds = new Set();
      videoDocs.forEach((d) => {
        if (d.shopifyOrderId) mongoVideoIds.add(String(d.shopifyOrderId).replace(/^#/, "").trim());
        if (d.shopifyOrderNumber) mongoVideoIds.add(String(d.shopifyOrderNumber).replace(/^#/, "").trim());
        if (d.videoId) mongoVideoIds.add(String(d.videoId).trim());
      });

      const allFetchedOrders = await fetchAllShopifyOrders(settings);

      // Configured publish product keywords & IDs
      const rawKeywords = settings.publishProductKeywords && settings.publishProductKeywords.length > 0
        ? settings.publishProductKeywords
        : ["Music on Spotify", "Spotify & Apple Music", "Song on Spotify & Apple Music", "Spotify", "Apple Music", "Muziek op Spotify", "Song on Spotify"];
      // Clean keywords: ignore loose/generic single words like "publish" or "streaming" that match non-publish items
      const keywords = rawKeywords
        .map((k) => String(k).trim().toLowerCase())
        .filter((k) => k && k !== "publish" && k !== "streaming");
      const configuredIds = new Set((settings.publishProductIds || []).map(String));

      // Filter: Keep only orders that legitimately contain Spotify/Apple Music publishing
      allOrders = allFetchedOrders.filter((order) => {
        const orderType = classifyOrder(order, { mongoMusicIds, mongoVideoIds });
        // Pure video orders shouldn't appear here
        if (orderType === "video") return false;

        const lineItems = order.line_items || [];

        // Check if any line item matches configured publish products or verified streaming properties
        const hasPublishItem = lineItems.some((item) => {
          if (item.product_id && configuredIds.has(String(item.product_id))) return true;
          if (item.variant_id && configuredIds.has(String(item.variant_id))) return true;

          const title = String(item.title || "").toLowerCase();
          if (keywords.some((kw) => title.includes(kw))) return true;

          // Check line item properties for explicit Spotify / Streaming add-on
          const props = item.properties || [];
          return props.some((p) => {
            const pName = String(p.name || "").toLowerCase().replace(/[\s_-]/g, "");
            const pVal = String(p.value || "").trim().toLowerCase();
            if (pName.includes("upsell") && pName.includes("spotify") && (pVal === "yes" || pVal === "true" || pVal === "1")) {
              return true;
            }
            if (pName === "streamingpackage") {
              // Exclude video items (e.g. "Personal Music Video") and falsy values
              if (pVal.includes("video") || pVal === "none" || pVal === "no" || pVal === "false") {
                return false;
              }
              if (pVal.includes("spotify") || pVal.includes("apple") || pVal.includes("streaming") || pVal.includes("publish")) {
                return true;
              }
            }
            if ((pName.includes("spotify") || pName.includes("applemusic")) && (pVal === "yes" || pVal === "true" || pVal === "1")) {
              return true;
            }
            return false;
          });
        });

        return hasPublishItem;
      });

      // Enrich orders with DB publishStatus & publishLinks if existing in MongoDB
      if (allOrders.length > 0) {
        const orderIdentifiers = [];
        allOrders.forEach((o) => {
          if (o.id) orderIdentifiers.push(String(o.id));
          if (o.order_number) orderIdentifiers.push(String(o.order_number), `#${o.order_number}`);
          if (o.name) orderIdentifiers.push(String(o.name), String(o.name).replace(/^#/, ""));
        });

        const matchingDbOrders = await Order.find({
          $or: [
            { shopifyOrderId: { $in: orderIdentifiers } },
            { shopifyOrderNumber: { $in: orderIdentifiers } },
          ],
        }).select("shopifyOrderId shopifyOrderNumber publishStatus publishLinks deliveryEmailSent status").lean();

        const dbMap = new Map();
        matchingDbOrders.forEach((doc) => {
          if (doc.shopifyOrderId) dbMap.set(String(doc.shopifyOrderId).replace(/^#/, ""), doc);
          if (doc.shopifyOrderNumber) dbMap.set(String(doc.shopifyOrderNumber).replace(/^#/, ""), doc);
        });

        allOrders = allOrders.map((ord) => {
          const cleanOId = String(ord.id || "").replace(/^#/, "");
          const cleanONum = String(ord.order_number || ord.name || "").replace(/^#/, "");
          const dbDoc = dbMap.get(cleanOId) || dbMap.get(cleanONum);
          if (dbDoc) {
            return {
              ...ord,
              publishStatus: dbDoc.publishStatus || (dbDoc.deliveryEmailSent ? "delivered" : "pending"),
              publishLinks: dbDoc.publishLinks,
              dbDeliveryEmailSent: dbDoc.deliveryEmailSent,
            };
          }
          return ord;
        });
      }
    } catch (err) {
      console.error("[OtherOrdersPage Error]:", err);
      errorMsg = "An error occurred while fetching orders: " + err.message;
    }
  }

  // Server-side filtering
  let filtered = [...allOrders];
  if (filter === "fulfilled") {
    filtered = filtered.filter((o) => o.fulfillment_status === "fulfilled");
  } else if (filter === "unfulfilled") {
    filtered = filtered.filter(
      (o) =>
        !o.fulfillment_status ||
        o.fulfillment_status === "unfulfilled" ||
        o.fulfillment_status === "partial"
    );
  } else if (filter === "paid") {
    filtered = filtered.filter((o) => o.financial_status === "paid");
  } else if (filter === "unpaid") {
    filtered = filtered.filter((o) => o.financial_status !== "paid");
  }

  // Server-side searching
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (o) =>
        String(o.name || "").toLowerCase().includes(q) ||
        String(o.order_number || "").includes(q) ||
        String(o.id || "").includes(q) ||
        (o.email || "").toLowerCase().includes(q) ||
        (o.customer?.first_name || "").toLowerCase().includes(q) ||
        (o.customer?.last_name || "").toLowerCase().includes(q)
    );
  }

  // Server-side sorting
  if (sort === "date_desc") {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (sort === "date_asc") {
    filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else if (sort === "total_desc") {
    filtered.sort((a, b) => parseFloat(b.total_price || 0) - parseFloat(a.total_price || 0));
  } else if (sort === "total_asc") {
    filtered.sort((a, b) => parseFloat(a.total_price || 0) - parseFloat(b.total_price || 0));
  }

  const totalOrders = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalOrders / limit));
  const startIndex = (page - 1) * limit;
  const paginatedOrders = filtered.slice(startIndex, startIndex + limit);

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <PageBreadcrumb pageTitle="Music Publish Orders" />
        <PublishFilterConfigModal
          initialKeywords={settings.publishProductKeywords || []}
          initialProductIds={settings.publishProductIds || []}
        />
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        {errorMsg ? (
          <div className="p-4 rounded bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {errorMsg}
          </div>
        ) : (
          <ShopifyOrdersTable
            orders={paginatedOrders}
            totalOrders={totalOrders}
            currentPage={page}
            totalPages={totalPages}
            itemsPerPageDefault={limit}
            initialFilter={filter}
            initialSort={sort}
            initialSearch={search}
            linkPrefix="/orders/publish"
          />
        )}
      </div>
    </div>
  );
}
