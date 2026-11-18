import React from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getSettings } from "@/lib/getSettings";
import ShopifyOrdersTable from "@/components/tables/ShopifyOrdersTable";
import { fetchAllShopifyOrders } from "@/lib/shopifyOrders";

import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { classifyOrder } from "@/lib/orderClassifier";

export const metadata = {
  title: "Music Orders | Dashboard",
  description: "Shopify Custom AI Song Orders",
};

export const dynamic = "force-dynamic";

export default async function MusicOrdersPage({ searchParams }) {
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

      // Filter: Keep only music orders
      allOrders = allFetchedOrders.filter((order) => {
        const orderType = classifyOrder(order, { mongoMusicIds, mongoVideoIds });
        return orderType === "music";
      });
    } catch (err) {
      console.error("[MusicOrdersPage Error]:", err);
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
      <PageBreadcrumb pageTitle="Shopify Music Orders" />
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
            linkPrefix="/orders/music"
          />
        )}
      </div>
    </div>
  );
}
