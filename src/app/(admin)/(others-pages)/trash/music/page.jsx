import React from "react";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "@/lib/getSettings";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import TrashTable from "@/components/tables/TrashTable";

export const metadata = {
  title: "Music Trash | Admin Dashboard",
  description: "View and manage deleted music orders before auto-purge.",
};

export const dynamic = "force-dynamic";

export default async function MusicTrashPage({ searchParams }) {
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
      { musicId: searchRegex },
      { recipientName: searchRegex },
      { customerName: searchRegex },
      { occasion: searchRegex },
      { genre: searchRegex },
      { selectedPackage: searchRegex },
    ];
  }

  const [musicOrdersRaw, totalMusicOrders, totalMusicTrashCount, totalVideoTrashCount] = await Promise.all([
    Order.find(query)
      .sort({ deletedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments(query),
    Order.countDocuments({ isDeleted: true }),
    VideoOrder.countDocuments({ isDeleted: true }),
  ]);

  const initialOrders = JSON.parse(JSON.stringify(musicOrdersRaw || []));

  return (
    <div className="space-y-6">
      <PageBreadcrumb pageTitle="Music Trash" />
      <TrashTable
        orders={initialOrders}
        totalOrders={totalMusicOrders}
        currentPage={page}
        itemsPerPageDefault={limit}
        initialSearch={search}
        retentionDays={retentionDays}
        activeType="music"
        totalMusicTrashCount={totalMusicTrashCount}
        totalVideoTrashCount={totalVideoTrashCount}
      />
    </div>
  );
}
