import React from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getSettings } from "@/lib/getSettings";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import ShopifyVideoOrdersTable from "@/components/tables/ShopifyVideoOrdersTable";
import ComponentCard from "@/components/common/ComponentCard";

export const metadata = {
  title: "All Videos | Dashboard",
  description: "View all generated custom videos",
};

export const dynamic = "force-dynamic";

export default async function AllVideosPage() {
  const settings = await getSettings();
  let videoOrders = [];
  let errorMsg = null;

  try {
    await dbConnect();
    // Non-Shopify video drafts should not have fulfilled status or deliveredAt
    await VideoOrder.updateMany(
      {
        $or: [{ shopifyOrderId: "" }, { shopifyOrderId: null }, { shopifyOrderId: { $exists: false } }],
        status: { $in: ["fulfilled", "created"] },
      },
      { $set: { status: "created", deliveryEmailSent: false, deliveredAt: null } }
    );

    const orders = await VideoOrder.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
    videoOrders = JSON.parse(JSON.stringify(orders));
  } catch (err) {
    console.error("[AllVideosPage Error]:", err);
    errorMsg = "An error occurred while fetching video orders: " + err.message;
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="All Videos" />
      <div className="space-y-6">
        <ComponentCard title="All Customer Generated Videos">
          {errorMsg ? (
            <div className="p-4 rounded bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              {errorMsg}
            </div>
          ) : (
            <ShopifyVideoOrdersTable initialOrders={videoOrders} itemsPerPageDefault={settings.tableItemsPerPage || 50} />
          )}
        </ComponentCard>
      </div>
    </div>
  );
}
