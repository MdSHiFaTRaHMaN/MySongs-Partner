"use client";
import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../ui/table";
import Badge from "../ui/badge/Badge";
import Pagination from "./Pagination";
import { FiDownload, FiSearch, FiLoader, FiCheckCircle, FiX } from "react-icons/fi";

export default function MusicTable({
  orders = [],
  totalOrders = 0,
  currentPage = 1,
  itemsPerPageDefault = 50,
  initialStatus = "all",
  initialSearch = "",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [statusFilter, setStatusFilter] = useState(initialStatus || "all");
  const [searchQuery, setSearchQuery] = useState(initialSearch || "");
  const [exportProgress, setExportProgress] = useState({
    active: false,
    percent: 0,
    status: "",
  });

  useEffect(() => {
    setStatusFilter(initialStatus || "all");
  }, [initialStatus]);

  useEffect(() => {
    setSearchQuery(initialSearch || "");
  }, [initialSearch]);

  const updateFilters = (newPage, newStatus, newSearch) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");

    if (newPage && newPage > 1) {
      params.set("page", String(newPage));
    } else {
      params.delete("page");
    }

    if (newStatus && newStatus !== "all") {
      params.set("status", newStatus);
    } else {
      params.delete("status");
    }

    if (newSearch && newSearch.trim()) {
      params.set("search", newSearch.trim());
    } else {
      params.delete("search");
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Debounced search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== (initialSearch || "")) {
        updateFilters(1, statusFilter, searchQuery);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleStatusChange = (e) => {
    const val = e.target.value;
    setStatusFilter(val);
    updateFilters(1, val, searchQuery);
  };

  const handlePageChange = (page) => {
    updateFilters(page, statusFilter, searchQuery);
  };

  const totalCount = totalOrders !== undefined ? totalOrders : orders.length;
  const itemsPerPage = itemsPerPageDefault || 50;
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const startCount = totalCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endCount = Math.min(currentPage * itemsPerPage, totalCount);

  // Direct In-Place CSV Export with Continuous Smooth Progress Bar (No new tab)
  const handleExportCSV = async () => {
    if (exportProgress.active) return;

    setExportProgress({
      active: true,
      percent: 8,
      status: "Connecting to database...",
    });

    let currentPercent = 8;
    const interval = setInterval(() => {
      if (currentPercent < 88) {
        const increment = currentPercent < 35 ? 5 : currentPercent < 65 ? 3 : 1;
        currentPercent += increment;

        let statusText = "Connecting to database...";
        if (currentPercent > 20 && currentPercent <= 60) {
          statusText = "Fetching & formatting orders...";
        } else if (currentPercent > 60) {
          statusText = "Generating CSV archive...";
        }

        setExportProgress((prev) =>
          prev.active
            ? {
                ...prev,
                percent: currentPercent,
                status: statusText,
              }
            : prev
        );
      }
    }, 100);

    try {
      const res = await fetch("/api/export?type=orders");
      if (!res.ok) throw new Error("Failed to export music orders");
      const blob = await res.blob();

      clearInterval(interval);

      setExportProgress({
        active: true,
        percent: 96,
        status: "Finalizing CSV download...",
      });

      await new Promise((r) => setTimeout(r, 180));

      const filename = `orders_export_${Date.now()}.csv`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setExportProgress({
        active: true,
        percent: 100,
        status: "Download ready!",
      });

      setTimeout(() => {
        setExportProgress((p) => ({ ...p, active: false }));
      }, 3000);
    } catch (err) {
      clearInterval(interval);
      console.error("Export failed:", err);
      setExportProgress({
        active: true,
        percent: 100,
        status: "Export failed! Please retry.",
      });
      setTimeout(() => {
        setExportProgress({ active: false, percent: 0, status: "" });
      }, 4000);
    }
  };

  return (
    <>
      {/* Floating Export Progress Notification */}
      {exportProgress.active && (
        <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  exportProgress.percent === 100
                    ? exportProgress.status.includes("failed")
                      ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                      : "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                    : "bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400"
                }`}
              >
                {exportProgress.percent === 100 ? (
                  exportProgress.status.includes("failed") ? <FiX size={18} /> : <FiCheckCircle size={18} />
                ) : (
                  <FiLoader className="animate-spin" size={18} />
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-gray-800 dark:text-white/90">
                  {exportProgress.percent === 100
                    ? exportProgress.status.includes("failed")
                      ? "Export Failed"
                      : "Export Ready"
                    : "Exporting Music CSV"}
                </h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                  {exportProgress.status}
                </p>
              </div>
            </div>
            <button
              onClick={() => setExportProgress((p) => ({ ...p, active: false }))}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-white p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <FiX size={14} />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="mt-2">
            <div className="flex justify-between items-center text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
              <span>Progress</span>
              <span className="font-mono text-brand-600 dark:text-brand-400">{exportProgress.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  exportProgress.percent === 100
                    ? exportProgress.status.includes("failed")
                      ? "bg-red-500"
                      : "bg-emerald-500"
                    : "bg-gradient-to-r from-brand-500 to-orange-500"
                }`}
                style={{ width: `${exportProgress.percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Header & Filter Controls matching Shopify Orders Layout */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:mb-7">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Music List ({totalCount.toLocaleString()})
            </h3>
            <p className="text-xs text-gray-500">Manage and view customer generated songs</p>
          </div>
          {isPending && (
            <span className="flex items-center gap-1 text-xs text-brand-500 animate-pulse font-medium">
              <FiLoader className="animate-spin" size={14} /> Loading...
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search email, order #, style..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors"
            />
          </div>

          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={handleStatusChange}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors cursor-pointer"
          >
            <option value="all" className="dark:bg-gray-900">All Statuses</option>
            <option value="created" className="dark:bg-gray-900">Created</option>
            <option value="in_cart" className="dark:bg-gray-900">In Cart</option>
            <option value="pending" className="dark:bg-gray-900">Payment Pending</option>
            <option value="paid" className="dark:bg-gray-900">Paid</option>
            <option value="delivering" className="dark:bg-gray-900">Delivering</option>
            <option value="fulfilled" className="dark:bg-gray-900">Fulfilled</option>
          </select>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            disabled={exportProgress.active}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 dark:hover:bg-white/[0.08] transition-colors"
          >
            {exportProgress.active ? (
              <>
                <FiLoader className="animate-spin text-brand-500" size={15} /> Exporting...
              </>
            ) : (
              <>
                <FiDownload size={15} /> Export CSV
              </>
            )}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03] relative">

      <div className="max-w-full overflow-x-auto relative">
        {isPending && (
          <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-gray-800 px-4 py-2 shadow-lg border border-gray-100 dark:border-gray-700 text-xs font-semibold text-brand-600 dark:text-brand-400">
              <FiLoader className="animate-spin" size={16} /> Fetching from Server...
            </div>
          </div>
        )}

        <div className="min-w-[1102px]">
          <Table>
            <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
              <TableRow>
                <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Customer &amp; Order #
                </TableCell>
                <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Occasion &amp; Style
                </TableCell>
                <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Package
                </TableCell>
                <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Created Date &amp; Time
                </TableCell>
                <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Status
                </TableCell>
                <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-center text-theme-xs dark:text-gray-400">
                  Actions
                </TableCell>
              </TableRow>
            </TableHeader>

            <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {orders.map((order) => {
                const orderNumberDisplay = order.shopifyOrderId || order.musicId || (order.taskId ? order.taskId.substring(0, 12) : "N/A");

                return (
                  <TableRow key={order._id} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.01] transition-colors">
                    {/* Customer & Order # */}
                    <TableCell className="px-5 py-4 sm:px-6 text-start">
                      <span className="block font-semibold text-gray-800 text-theme-sm dark:text-white/90">
                        {order.email}
                      </span>
                      <span className="block text-gray-500 text-theme-xs dark:text-gray-400 font-mono">
                        Order #: {orderNumberDisplay}
                      </span>
                    </TableCell>

                    {/* Occasion & Style */}
                    <TableCell className="px-4 py-3 text-gray-500 text-start max-w-[260px]">
                      <div className="max-w-[240px]">
                        <p
                          className="font-medium text-gray-800 dark:text-white/90 text-xs sm:text-sm truncate"
                          title={order.occasion || "N/A"}
                        >
                          {order.occasion || "N/A"}
                        </p>
                        <p className="text-[11px] sm:text-xs text-gray-400 dark:text-gray-500 truncate capitalize mt-0.5" title={[order.genre, order.voice, order.mood].filter(Boolean).join(" • ")}>
                          {[order.genre, order.voice, order.mood].filter(Boolean).join(" • ") || "Custom Track"}
                        </p>
                      </div>
                    </TableCell>

                    {/* Package */}
                    <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400 uppercase font-medium">
                      {order.selectedPackage || "None"}
                    </TableCell>

                    {/* Created Date & Time */}
                    <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-xs dark:text-gray-400 whitespace-nowrap font-mono">
                      {order.createdAt ? new Date(order.createdAt).toLocaleString() : "N/A"}
                    </TableCell>

                    {/* Status */}
                    <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                      <Badge
                        size="sm"
                        color={
                          (order.status === "paid" || order.status === "fulfilled" || order.status === "completed")
                            ? "success"
                            : order.status === "delivering"
                              ? "info"
                              : order.status === "in_cart"
                                ? "info"
                                : order.status === "created"
                                  ? "light"
                                  : (order.status === "pending" || order.status === "pending_payment")
                                    ? "warning"
                                    : "error"
                        }
                      >
                        {order.status === "created"
                          ? "Created"
                          : order.status === "completed"
                            ? "Completed"
                            : order.status === "in_cart"
                              ? "In Cart"
                              : (order.status === "pending" || order.status === "pending_payment")
                                ? "Payment Pending"
                                : order.status === "delivering"
                                  ? "Delivering"
                                  : order.status === "fulfilled"
                                    ? "Fulfilled"
                                    : order.status === "paid"
                                      ? "Paid"
                                      : order.status}
                      </Badge>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="px-4 py-3 text-center">
                      <Link
                        href={`/all-musics/${order._id}`}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/[0.05] dark:text-gray-200 dark:hover:bg-white/[0.1]"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                        Details
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {orders.length === 0 && (
            <div className="p-12 text-center text-gray-500 dark:text-gray-400">
              <p className="text-sm font-medium">No music records found.</p>
              {searchQuery && (
                <p className="text-xs text-gray-400 mt-1">
                  Try adjusting your search query or status filter.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pagination & Summary Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-5 border-t border-gray-100 dark:border-white/[0.05] gap-4 sm:gap-0">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{startCount}</span> to{" "}
          <span className="font-semibold text-gray-700 dark:text-gray-200">{endCount}</span> of{" "}
          <span className="font-semibold text-gray-700 dark:text-gray-200">{totalCount.toLocaleString()}</span> entries
        </div>

        {totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        )}
      </div>
    </div>
    </>
  );
}
