"use client";
import React, { useState, useMemo } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Pagination from "./Pagination";
import { FiVideo, FiMusic, FiImage, FiEye } from "react-icons/fi";

export default function ShopifyVideoOrdersTable({ initialOrders = [], itemsPerPageDefault = 50 }) {
  const [sortOption, setSortOption] = useState("date_desc");
  const [filterOption, setFilterOption] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = itemsPerPageDefault || 50;

  const filteredAndSortedOrders = useMemo(() => {
    let result = [...initialOrders];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (o) =>
          o.email?.toLowerCase().includes(q) ||
          o.customerName?.toLowerCase().includes(q) ||
          o.shopifyOrderNumber?.toLowerCase().includes(q) ||
          o.shopifyOrderId?.toLowerCase().includes(q) ||
          o.videoId?.toLowerCase().includes(q) ||
          o.selectedPackage?.toLowerCase().includes(q)
      );
    }

    // Status Filter
    if (filterOption !== "all") {
      result = result.filter((o) => o.status === filterOption);
    }

    // Sort
    if (sortOption === "date_desc") {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortOption === "date_asc") {
      result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortOption === "total_desc") {
      result.sort((a, b) => parseFloat(b.packagePrice || 0) - parseFloat(a.packagePrice || 0));
    } else if (sortOption === "total_asc") {
      result.sort((a, b) => parseFloat(a.packagePrice || 0) - parseFloat(b.packagePrice || 0));
    }

    return result;
  }, [initialOrders, sortOption, filterOption, searchQuery]);

  const getStatusBadge = (status) => {
    switch (status) {
      case "fulfilled":
        return <Badge size="sm" color="success">Fulfilled</Badge>;
      case "delivering":
        return <Badge size="sm" color="info">Delivering</Badge>;
      case "ready":
        return <Badge size="sm" color="primary">Ready</Badge>;
      case "in_production":
        return <Badge size="sm" color="warning">In Production</Badge>;
      case "paid":
        return <Badge size="sm" color="success">Paid</Badge>;
      case "in_cart":
      case "created":
        return <Badge size="sm" color="light">In Cart / Draft</Badge>;
      case "pending":
      default:
        return <Badge size="sm" color="light">Pending</Badge>;
    }
  };

  const getMediaSummary = (order) => {
    const hasAudio = !!order.audioFile?.key || !!order.audioFile?.url;
    const mediaFiles = order.mediaFiles || [];
    const imageCount = mediaFiles.filter((m) => m.type === "image" || (!m.type && m.mimeType?.startsWith("image"))).length;
    const videoCount = mediaFiles.filter((m) => m.type === "video" || (!m.type && m.mimeType?.startsWith("video"))).length;

    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {hasAudio && (
          <span className="flex items-center gap-1 bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400 px-1.5 py-0.5 rounded">
            <FiMusic size={12} /> Audio
          </span>
        )}
        {imageCount > 0 && (
          <span className="flex items-center gap-1 bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 px-1.5 py-0.5 rounded">
            <FiImage size={12} /> {imageCount} Photos
          </span>
        )}
        {videoCount > 0 && (
          <span className="flex items-center gap-1 bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400 px-1.5 py-0.5 rounded">
            <FiVideo size={12} /> {videoCount} Videos
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:mb-7">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Music Video Orders ({filteredAndSortedOrders.length})
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">Manage customer uploaded assets and deliver completed music videos</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search orders, email, name..."
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />

          <select
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors"
            value={filterOption}
            onChange={(e) => {
              setFilterOption(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">All Statuses</option>
            <option value="in_production">In Production</option>
            <option value="ready">Ready</option>
            <option value="delivering">Delivering</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="paid">Paid</option>
            <option value="in_cart">In Cart / Draft</option>
          </select>

          <select
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors"
            value={sortOption}
            onChange={(e) => {
              setSortOption(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="date_desc">Sort by Date (Newest)</option>
            <option value="date_asc">Sort by Date (Oldest)</option>
            <option value="total_desc">Sort by Price (Highest)</option>
            <option value="total_asc">Sort by Price (Lowest)</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-gray-100 dark:border-white/[0.05]">
              <tr>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400">Order ID</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400">Customer</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400">Package</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400">Uploaded Assets</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400">Status</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400">Total</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400">Date</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-sm dark:text-gray-400 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {filteredAndSortedOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-500">
                    No video orders found matching your filter.
                  </td>
                </tr>
              ) : (
                filteredAndSortedOrders
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((order) => {
                    const detailTargetId = order.shopifyOrderId || order.videoId || order._id;
                    return (
                      <tr key={order._id || order.videoId} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <td className="px-5 py-4 text-sm font-medium text-gray-800 dark:text-white/90">
                          <Link
                            href={`/orders/video/${detailTargetId}`}
                            className="text-brand-500 hover:text-brand-600 hover:underline flex items-center gap-1.5"
                          >
                            <FiVideo className="text-orange-500" />
                            {order.shopifyOrderNumber
                              ? String(order.shopifyOrderNumber).startsWith("#")
                                ? order.shopifyOrderNumber
                                : `#${order.shopifyOrderNumber}`
                              : order.videoId}
                          </Link>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                          <span className="block font-medium text-gray-800 dark:text-white/90">
                            {order.customerName || "Customer"}
                          </span>
                          <span className="text-xs text-gray-500">{order.email}</span>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">
                          <span className="font-medium block">{order.selectedPackage || "Music Video"}</span>
                          <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                            order.videoFormat === "16:9"
                              ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40"
                              : "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40"
                          }`}>
                            {order.videoFormat === "16:9" ? "16:9 Landscape ▭" : "9:16 Vertical ▯"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm">
                          {getMediaSummary(order)}
                        </td>
                        <td className="px-5 py-4 text-sm">
                          {getStatusBadge(order.status)}
                        </td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-800 dark:text-white/90 whitespace-nowrap">
                          {order.packagePrice ? `${order.packagePrice} ${order.currency || "USD"}` : "—"}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span>
                              {new Date(order.createdAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(order.createdAt).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              })}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-right">
                          <Link
                            href={`/orders/video/${detailTargetId}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-400 dark:hover:bg-orange-500/20 transition-colors"
                          >
                            <FiEye size={13} />
                            Workspace
                          </Link>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>

        {Math.ceil(filteredAndSortedOrders.length / itemsPerPage) > 1 && (
          <div className="flex items-center justify-center p-4 border-t border-gray-100 dark:border-white/[0.05]">
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(filteredAndSortedOrders.length / itemsPerPage)}
              onPageChange={(page) => setCurrentPage(page)}
            />
          </div>
        )}
      </div>
    </>
  );
}
