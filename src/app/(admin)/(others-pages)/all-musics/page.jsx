import ComponentCard from "@/components/common/ComponentCard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import MusicTable from "@/components/tables/MusicTable";
import React from "react";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { getSettings } from "@/lib/getSettings";

export const metadata = {
  title: "All Musics | My Own Music",
  description: "View all generated custom musics, including those pending checkout.",
};

export const dynamic = "force-dynamic";

export default async function AllMusics({ searchParams }) {
  await dbConnect();
  const settings = await getSettings();

  const params = await searchParams;
  const page = Math.max(1, parseInt(params?.page || "1", 10));
  const limit = Math.max(1, parseInt(params?.limit || settings.tableItemsPerPage || "50", 10));
  const status = params?.status || "all";
  const search = (params?.search || "").trim();

  const query = {
    isDeleted: { $ne: true },
  };

  if (status && status !== "all") {
    query.status = status;
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    query.$or = [
      { email: searchRegex },
      { shopifyOrderId: searchRegex },
      { musicId: searchRegex },
      { taskId: searchRegex },
      { occasion: searchRegex },
      { genre: searchRegex },
      { recipientName: searchRegex },
    ];
  }

  const [orders, totalOrders] = await Promise.all([
    Order.find(query)
      .select("_id email shopifyOrderId musicId taskId occasion genre voice mood selectedPackage createdAt status")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments(query),
  ]);

  const serializedOrders = JSON.parse(JSON.stringify(orders));

  return (
    <div>
      <PageBreadcrumb pageTitle="All Musics" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <MusicTable
          orders={serializedOrders}
          totalOrders={totalOrders}
          currentPage={page}
          itemsPerPageDefault={limit}
          initialStatus={status}
          initialSearch={search}
        />
      </div>
    </div>
  );
}
