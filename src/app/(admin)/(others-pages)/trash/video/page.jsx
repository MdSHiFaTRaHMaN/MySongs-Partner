import React from "react";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "@/lib/getSettings";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import TrashTable from "@/components/tables/TrashTable";

export const metadata = {
  title: "Video Trash | Admin Dashboard",
  description: "View and manage deleted video orders before auto-purge.",
};

export const dynamic = "force-dynamic";

export default async function VideoTrashPage({ searchParams }) {
  await dbConnect();

  const settings = await getSettings();
  const params = await searchParams;
  const page = Math.max(1, parseInt(params?.page || "1", 10));
  const limit = Math.max(1, parseInt(params?.limit || settings.tableItemsPerPage || "50", 10));
  const search = (params?.search || "").trim();

  const retentionDays = Number(settings?.trashBinRetentionDays) || 30;

  const query = { isDeleted: true };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    query.$or = [
      { email: searchRegex },
      { shopifyOrderId: searchRegex },
      { shopifyOrderNumber: searchRegex },
      { videoId: searchRegex },
      { recipientName: searchRegex },
      { customerName: searchRegex },
      { title: searchRegex },
      { selectedPackage: searchRegex },
    ];
  }

  const [videoOrdersRaw, totalVideoOrders, totalVideoTrashCount, totalMusicTrashCount] = await Promise.all([
    VideoOrder.find(query)
      .sort({ deletedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    VideoOrder.countDocuments(query),
    VideoOrder.countDocuments({ isDeleted: true }),
    Order.countDocuments({ isDeleted: true }),
  ]);

  const initialOrders = JSON.parse(JSON.stringify(videoOrdersRaw || []));

  return (
    <div className="space-y-6">
      <PageBreadcrumb pageTitle="Video Trash" />
      <TrashTable
        orders={initialOrders}
        totalOrders={totalVideoOrders}
        currentPage={page}
        itemsPerPageDefault={limit}
        initialSearch={search}
        retentionDays={retentionDays}
        activeType="video"
        totalMusicTrashCount={totalMusicTrashCount}
        totalVideoTrashCount={totalVideoTrashCount}
      />
    </div>
  );
}
