import ComponentCard from "@/components/common/ComponentCard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import CustomerTable from "@/components/tables/CustomerTable";
import React from "react";
import { GroupIcon } from "@/icons";
import { FiMusic, FiShieldOff } from "react-icons/fi";
import { isLocalOrPrivateIp } from "@/lib/security";
import { getSettings } from "@/lib/getSettings";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Customer from "@/models/Customer";
import redis from "@/lib/redis";

export const metadata = {
  title: "Customer CRM & Security | My Own Music",
  description: "Manage customers and monitor security limits.",
};

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }) {
  await dbConnect();
  const settings = await getSettings();
  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page || "1", 10));
  const limit = Math.max(1, parseInt(params?.limit || settings.tableItemsPerPage || "50", 10));
  const status = params?.status || "all";
  const sortBy = params?.sortBy || "date";
  const sortOrder = params?.sortOrder || "desc";
  const search = (params?.search || "").trim();

  const isDefaultView = page === 1 && !search && status === "all" && sortBy === "date" && sortOrder === "desc";
  const CUSTOMERS_CACHE_KEY = `cache:customers:page1:${limit}`;

  // 1. Check Redis cache for default CRM view (sub-millisecond load)
  if (isDefaultView) {
    try {
      const cached = await redis.get(CUSTOMERS_CACHE_KEY);
      if (cached) {
        const { totalGenerations, totalBlocked, totalCustomers, totalPages, serializedCustomers } = JSON.parse(cached);
        return renderCustomerCRM({
          totalGenerations,
          totalBlocked,
          totalCustomers,
          totalPages,
          serializedCustomers,
          page,
          limit,
          status,
          sortBy,
          sortOrder,
          search,
        });
      }
    } catch (e) {
      console.warn("[CustomersPage] Redis cache error, fetching fresh:", e.message);
    }
  }

  // Top High-Level Global Stats
  const [totalGenerations, totalBlocked] = await Promise.all([
    Order.countDocuments(),
    Customer.countDocuments({ isBlocked: true }),
  ]);

  // Build high-performance aggregation pipeline
  const pipeline = [];

  // 1. Initial project from Order (Music)
  pipeline.push({
    $match: {
      email: { $ne: null, $nin: ["", "unknown", "undefined"] },
    },
  });

  pipeline.push({
    $project: {
      email: { $toLower: "$email" },
      rawEmail: "$email",
      status: 1,
      shopifyOrderId: { $ifNull: ["$shopifyOrderId", ""] },
      musicId: { $ifNull: ["$musicId", ""] },
      taskId: { $ifNull: ["$taskId", ""] },
      occasion: { $ifNull: ["$occasion", ""] },
      createdAt: 1,
      isMusic: { $literal: true },
      isPaid: {
        $cond: [
          {
            $or: [
              { $in: ["$status", ["paid", "fulfilled", "delivering", "ready"]] },
              {
                $and: [
                  { $ne: ["$shopifyOrderId", null] },
                  { $ne: ["$shopifyOrderId", ""] },
                  { $ne: ["$musicId", null] },
                  { $ne: ["$musicId", ""] },
                ],
              },
            ],
          },
          true,
          false,
        ],
      },
      orderKey: {
        $cond: [
          { $and: [{ $ne: ["$shopifyOrderId", null] }, { $ne: ["$shopifyOrderId", ""] }] },
          { $concat: ["shop_", { $toString: "$shopifyOrderId" }] },
          { $concat: ["music_", { $toString: "$_id" }] },
        ],
      },
    },
  });

  // 2. Union with videoorders
  pipeline.push({
    $unionWith: {
      coll: "videoorders",
      pipeline: [
        {
          $match: {
            isDeleted: { $ne: true },
            email: { $ne: null, $nin: ["", "unknown", "undefined"] },
          },
        },
        {
          $project: {
            email: { $toLower: "$email" },
            rawEmail: "$email",
            status: 1,
            shopifyOrderId: { $ifNull: ["$shopifyOrderId", ""] },
            musicId: { $literal: "" },
            taskId: { $literal: "" },
            occasion: { $ifNull: ["$selectedPackage", ""] },
            createdAt: 1,
            isMusic: { $literal: false },
            isPaid: {
              $cond: [
                {
                  $or: [
                    { $in: ["$status", ["paid", "fulfilled", "ready", "delivering"]] },
                    { $and: [{ $ne: ["$shopifyOrderId", null] }, { $ne: ["$shopifyOrderId", ""] }] },
                  ],
                },
                true,
                false,
              ],
            },
            orderKey: {
              $cond: [
                { $and: [{ $ne: ["$shopifyOrderId", null] }, { $ne: ["$shopifyOrderId", ""] }] },
                { $concat: ["shop_", { $toString: "$shopifyOrderId" }] },
                { $concat: ["vid_", { $toString: "$_id" }] },
              ],
            },
          },
        },
      ],
    },
  });

  // Match stage if searching
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    pipeline.push({
      $match: {
        $or: [
          { email: searchRegex },
          { rawEmail: searchRegex },
          { shopifyOrderId: searchRegex },
          { musicId: searchRegex },
          { taskId: searchRegex },
          { occasion: searchRegex },
        ],
      },
    });
  }

  // Group by email
  pipeline.push({
    $group: {
      _id: "$email",
      rawEmail: { $first: "$rawEmail" },
      totalGenerations: {
        $sum: { $cond: ["$isMusic", 1, 0] },
      },
      paidOrderKeys: {
        $addToSet: {
          $cond: ["$isPaid", "$orderKey", null],
        },
      },
      lastOrderDate: { $max: "$createdAt" },
    },
  });

  pipeline.push({
    $addFields: {
      totalPurchases: {
        $size: {
          $filter: {
            input: "$paidOrderKeys",
            as: "k",
            cond: { $and: [{ $ne: ["$$k", null] }, { $ne: ["$$k", ""] }] },
          },
        },
      },
    },
  });

  // Lookup Customer security document
  pipeline.push({
    $lookup: {
      from: "customers",
      localField: "_id",
      foreignField: "email",
      as: "customerDoc",
    },
  });

  pipeline.push({
    $addFields: {
      customer: { $arrayElemAt: ["$customerDoc", 0] },
    },
  });

  pipeline.push({
    $addFields: {
      isBlocked: { $ifNull: ["$customer.isBlocked", false] },
      blockReason: { $ifNull: ["$customer.blockReason", ""] },
      securityFlags: { $ifNull: ["$customer.securityFlags", 0] },
      knownIps: { $ifNull: ["$customer.knownIps", []] },
    },
  });

  // Status filtering
  if (status === "active") {
    pipeline.push({ $match: { isBlocked: false } });
  } else if (status === "blocked") {
    pipeline.push({ $match: { isBlocked: true } });
  } else if (status === "purchases") {
    pipeline.push({ $match: { totalPurchases: { $gt: 0 } } });
  } else if (status === "flagged") {
    pipeline.push({ $match: { securityFlags: { $gt: 0 } } });
  }

  // Sort
  const isAsc = sortOrder === "asc";
  let sortStage = { lastOrderDate: isAsc ? 1 : -1 };
  if (sortBy === "generations") {
    sortStage = { totalGenerations: isAsc ? 1 : -1, lastOrderDate: -1 };
  } else if (sortBy === "purchases") {
    sortStage = { totalPurchases: isAsc ? 1 : -1, lastOrderDate: -1 };
  } else if (sortBy === "flagged") {
    sortStage = { securityFlags: isAsc ? 1 : -1, lastOrderDate: -1 };
  } else if (sortBy === "status") {
    sortStage = { isBlocked: isAsc ? 1 : -1, lastOrderDate: -1 };
  } else if (sortBy === "date") {
    sortStage = { lastOrderDate: isAsc ? 1 : -1 };
  }

  // Facet pagination (count + page slice)
  pipeline.push({
    $facet: {
      metadata: [{ $count: "total" }],
      data: [
        { $sort: sortStage },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
    },
  });

  const [aggResult] = await Order.aggregate(pipeline);

  const totalCustomers = aggResult?.metadata?.[0]?.total || 0;
  const pageData = aggResult?.data || [];

  // Batch non-blocking background sync for any missing customer documents
  const missingEmails = pageData
    .filter((g) => !g.customer?._id && (g.rawEmail || g._id))
    .map((g) => (g.rawEmail || g._id).toLowerCase());

  if (missingEmails.length > 0) {
    Customer.bulkWrite(
      missingEmails.map((email) => ({
        updateOne: {
          filter: { email },
          update: { $setOnInsert: { email } },
          upsert: true,
        },
      }))
    ).catch(() => {});
  }

  const customersList = pageData.map((group) => {
    const rawIps = Array.isArray(group.knownIps) ? group.knownIps : [];
    const customerId = group.customer?._id ? group.customer._id.toString() : null;
    const email = group.rawEmail || group._id;

    return {
      _id: customerId,
      email: email,
      totalGenerations: group.totalGenerations || 0,
      totalPurchases: group.totalPurchases || 0,
      totalOrders: group.totalGenerations || 0,
      lastOrderDate: group.lastOrderDate,
      isBlocked: Boolean(group.isBlocked),
      blockReason: group.blockReason || "",
      securityFlags: group.securityFlags || 0,
      knownIps: rawIps.filter((ip) => !isLocalOrPrivateIp(ip)),
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalCustomers / limit));
  const serializedCustomers = JSON.parse(JSON.stringify(customersList));

  // Cache default view in Redis for 60 seconds
  if (isDefaultView) {
    try {
      await redis.set(
        CUSTOMERS_CACHE_KEY,
        JSON.stringify({ totalGenerations, totalBlocked, totalCustomers, totalPages, serializedCustomers }),
        "EX",
        60
      );
    } catch (e) {
      console.warn("[CustomersPage] Redis cache set failed:", e.message);
    }
  }

  return renderCustomerCRM({
    totalGenerations,
    totalBlocked,
    totalCustomers,
    totalPages,
    serializedCustomers,
    page,
    limit,
    status,
    sortBy,
    sortOrder,
    search,
  });
}

function renderCustomerCRM({
  totalGenerations,
  totalBlocked,
  totalCustomers,
  totalPages,
  serializedCustomers,
  page,
  limit,
  status,
  sortBy,
  sortOrder,
  search,
}) {
  return (
    <div>
      <PageBreadcrumb pageTitle="Customer CRM" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-6 mb-6">
        {/* Total Customers */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <GroupIcon className="text-gray-800 size-6 dark:text-white/90" />
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Total Customers
              </span>
              <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
                {totalCustomers.toLocaleString()}
              </h4>
            </div>
          </div>
        </div>

        {/* Blocked Customers */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-red-50 rounded-xl dark:bg-red-500/10">
            <FiShieldOff className="text-red-500 size-6" />
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Blocked Customers
              </span>
              <h4 className="mt-2 font-bold text-red-600 text-title-sm dark:text-red-400">
                {totalBlocked.toLocaleString()}
              </h4>
            </div>
          </div>
        </div>

        {/* Total Generations */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <FiMusic className="text-gray-800 size-6 dark:text-white/90" />
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Total Generations
              </span>
              <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
                {totalGenerations.toLocaleString()}
              </h4>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <CustomerTable
          customers={serializedCustomers}
          totalCustomers={totalCustomers}
          currentPage={page}
          totalPages={totalPages}
          itemsPerPageDefault={limit}
          initialStatus={status}
          initialSortBy={sortBy}
          initialSortOrder={sortOrder}
          initialSearch={search}
        />
      </div>
    </div>
  );
}
