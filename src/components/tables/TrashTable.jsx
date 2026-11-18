"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Button from "@/components/ui/button/Button";
import { useToast } from "@/components/ui/toast/Toast";
import { Modal } from "@/components/ui/modal";
import Badge from "@/components/ui/badge/Badge";
import { FiTrash2, FiRotateCcw, FiSearch, FiAlertTriangle, FiMusic, FiVideo, FiClock, FiLoader } from "react-icons/fi";
import Pagination from "./Pagination";

export default function TrashTable({
  orders = [],
  totalOrders = 0,
  currentPage = 1,
  itemsPerPageDefault = 50,
  initialSearch = "",
  retentionDays = 30,
  activeType = "music",
  totalMusicTrashCount = 0,
  totalVideoTrashCount = 0,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const [isPending, startTransition] = useTransition();

  const activeTab = activeType; // "music" | "video"
  const [searchQuery, setSearchQuery] = useState(initialSearch || "");

  const [actionLoading, setActionLoading] = useState(false);
  const [emptyModalOpen, setEmptyModalOpen] = useState(false);
  const [restoreAllModalOpen, setRestoreAllModalOpen] = useState(false);
  const [permanentModalData, setPermanentModalData] = useState(null); // { id, type, label, email }

  // Sync state if props change
  useEffect(() => {
    setSearchQuery(initialSearch || "");
  }, [initialSearch]);

  const updateFilters = (newPage, newSearch) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");

    if (newPage && newPage > 1) {
      params.set("page", String(newPage));
    } else {
      params.delete("page");
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

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== (initialSearch || "")) {
        updateFilters(1, searchQuery);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handlePageChange = (page) => {
    updateFilters(page, searchQuery);
  };

  // Server-side Pagination Calculations
  const itemsPerPage = Number(itemsPerPageDefault) > 0 ? Number(itemsPerPageDefault) : 50;
  const totalPages = Math.max(1, Math.ceil(totalOrders / itemsPerPage));
  const startCount = totalOrders === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endCount = Math.min(currentPage * itemsPerPage, totalOrders);

  // Calculate remaining days
  const getRemainingDays = (deletedAt) => {
    if (!deletedAt) return retentionDays;
    const deletedDate = new Date(deletedAt);
    const expireDate = new Date(deletedDate.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    const diffMs = expireDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  // Restore Handler
  const handleRestore = async (id, type) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/trash/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast({
          variant: "success",
          title: "Order Restored",
          message: "Order restored to active list successfully.",
        });
        router.refresh();
      } else {
        throw new Error(data.error || "Failed to restore order");
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Restore Failed",
        message: err.message || "An error occurred while restoring the order.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Restore All Handler
  const handleRestoreAll = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/trash/restore-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "all" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const count = data.totalRestored ?? data.restoredCount ?? (Number(data.restoredMusicCount || 0) + Number(data.restoredVideoCount || 0));
        showToast({
          variant: "success",
          title: "All Restored",
          message: `Restored ${count} orders back to active list.`,
        });
        setRestoreAllModalOpen(false);
        router.refresh();
      } else {
        throw new Error(data.error || "Failed to restore all orders");
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Restore All Failed",
        message: err.message || "An error occurred while restoring all orders.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Permanently Delete Single Item
  const handlePermanentDelete = async () => {
    if (!permanentModalData) return;
    const { id, type } = permanentModalData;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/trash/permanent?id=${encodeURIComponent(id)}&type=${type}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast({
          variant: "success",
          title: "Permanently Deleted",
          message: "Order and all associated cloud files permanently destroyed.",
        });
        setPermanentModalData(null);
        router.refresh();
      } else {
        throw new Error(data.error || "Failed to permanently delete");
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Delete Failed",
        message: err.message || "An error occurred while deleting permanently.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Empty Entire Trash Handler
  const handleEmptyTrash = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/trash/empty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "all" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const deletedOrdersCount = Number(data.deletedMusicOrdersCount || 0) + Number(data.deletedVideoOrdersCount || 0);
        showToast({
          variant: "success",
          title: "Trash Emptied",
          message: `Entire Trash Bin emptied. ${deletedOrdersCount} orders and ${data.deletedS3FilesCount || 0} S3 files deleted.`,
        });
        setEmptyModalOpen(false);
        router.refresh();
      } else {
        throw new Error(data.error || "Failed to empty trash");
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Empty Trash Failed",
        message: err.message || "An error occurred while emptying trash.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const totalTrashCount = totalMusicTrashCount + totalVideoTrashCount;

  return (
    <div className="space-y-6">
      {/* Top Banner Info */}
      <div className="p-5 border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-md shrink-0 mt-0.5">
            <FiClock size={20} />
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 dark:text-white text-sm">
              Trash Bin Auto-Retention Lifecycle ({retentionDays} Days)
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 max-w-2xl leading-relaxed">
              Items in the Trash Bin are safely kept for <strong>{retentionDays} days</strong> before all database records and AWS S3 audio/media assets are automatically &amp; permanently deleted. You can restore items anytime before they expire.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="border-brand-200 text-brand-600 hover:bg-brand-50 dark:border-brand-800 dark:text-brand-400 dark:hover:bg-brand-950/30 shrink-0 disabled:opacity-50 disabled:pointer-events-none"
            onClick={() => setRestoreAllModalOpen(true)}
            disabled={actionLoading || totalTrashCount === 0}
            startIcon={<FiRotateCcw size={14} />}
          >
            Restore All {totalTrashCount > 0 ? `(${totalTrashCount})` : ""}
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 shrink-0 disabled:opacity-50 disabled:pointer-events-none"
            onClick={() => setEmptyModalOpen(true)}
            disabled={actionLoading || totalTrashCount === 0}
            startIcon={<FiTrash2 size={14} />}
          >
            Empty Trash
          </Button>
        </div>
      </div>

      {/* Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Tab Buttons (Route-based links) */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2 sm:pb-0 sm:border-0">
          <Link
            href="/trash/music"
            className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 transition ${activeTab === "music"
                ? "bg-brand-500 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
          >
            <FiMusic size={14} />
            <span>Music Trash ({totalMusicTrashCount})</span>
          </Link>

          <Link
            href="/trash/video"
            className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 transition ${activeTab === "video"
                ? "bg-brand-500 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
          >
            <FiVideo size={14} />
            <span>Video Trash ({totalVideoTrashCount})</span>
          </Link>

          {isPending && (
            <span className="flex items-center gap-1 text-xs text-brand-500 animate-pulse font-medium ml-2">
              <FiLoader className="animate-spin" size={14} /> Loading...
            </span>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder={`Search ${activeTab === "music" ? "music" : "video"} trash...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full pl-9 pr-4 text-xs rounded-md border border-gray-200 bg-white placeholder:text-gray-400 focus:border-brand-500 focus:outline-none dark:border-gray-800 dark:bg-white/[0.03] dark:text-white"
          />
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
        </div>
      </div>

      {/* Table Card */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-left">
            <thead className="bg-gray-50 dark:bg-white/[0.02] text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Order / Identification</th>
                <th className="px-5 py-3.5">Customer</th>
                <th className="px-5 py-3.5">Deleted On</th>
                <th className="px-5 py-3.5">Auto-Delete Countdown</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 text-xs">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FiTrash2 size={28} className="text-gray-300 dark:text-gray-600" />
                      <p className="font-medium">No deleted {activeTab} orders found in Trash Bin.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                orders.map((item) => {
                  const remDays = getRemainingDays(item.deletedAt);
                  const orderNumberDisplay = item.shopifyOrderNumber
                    ? String(item.shopifyOrderNumber).startsWith("#")
                      ? item.shopifyOrderNumber
                      : `#${item.shopifyOrderNumber}`
                    : item.shopifyOrderId || item.videoId || item.musicId || item._id;

                  return (
                    <tr key={item._id} className="hover:bg-gray-50 dark:hover:bg-white/[0.01] transition">
                      {/* Order Info */}
                      <td className="px-5 py-4 font-medium text-gray-800 dark:text-white/90">
                        <div className="flex items-center gap-2">
                          {activeTab === "music" ? <FiMusic className="text-brand-500" /> : <FiVideo className="text-orange-500" />}
                          <span className="font-semibold">{orderNumberDisplay}</span>
                        </div>
                        <span className="text-[11px] text-gray-400 block mt-0.5">
                          {item.genre || item.occasion || item.title || item.selectedPackage || "Custom Music"}
                        </span>
                      </td>

                      {/* Customer */}
                      <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                        <span className="font-medium block">{item.customerName || item.recipientName || "Customer"}</span>
                        <span className="text-[11px] text-gray-500">{item.email}</span>
                      </td>

                      {/* Deleted Date */}
                      <td className="px-5 py-4 text-gray-600 dark:text-gray-400">
                        <span>
                          {item.deletedAt
                            ? new Date(item.deletedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                            : "Recently"}
                        </span>
                        <span className="text-[10px] text-gray-400 block mt-0.5">
                          {item.deletedBy ? `By: ${item.deletedBy}` : "Manual Action"}
                        </span>
                      </td>

                      {/* Countdown */}
                      <td className="px-5 py-4">
                        <Badge
                          size="sm"
                          color={remDays <= 3 ? "error" : remDays <= 7 ? "warning" : "light"}
                        >
                          <FiClock size={11} className="mr-1 inline" />
                          {remDays === 0 ? "Purging Today" : `${remDays} days remaining`}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleRestore(item._id, activeTab)}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-50 text-brand-600 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20 transition"
                          >
                            <FiRotateCcw size={12} />
                            <span>Restore</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setPermanentModalData({
                                id: item._id,
                                type: activeTab,
                                label: orderNumberDisplay,
                                email: item.email,
                              })
                            }
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 transition"
                            title="Delete Permanently"
                          >
                            <FiTrash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer with Summary and Server Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-5 border-t border-gray-100 dark:border-white/[0.05] gap-4 sm:gap-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{startCount}</span> to{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{endCount}</span> of{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{totalOrders.toLocaleString()}</span> {activeTab === "music" ? "music" : "video"} orders
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

      {/* Confirmation Modal: Delete Single Item Permanently */}
      <Modal isOpen={!!permanentModalData} onClose={() => setPermanentModalData(null)} className="max-w-md p-6">
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400 mx-auto">
            <FiAlertTriangle size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              Permanently Delete {permanentModalData?.type === "video" ? "Video" : "Music"} Order?
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              Are you sure you want to permanently delete order <strong>{permanentModalData?.label}</strong> ({permanentModalData?.email})?
            </p>
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 rounded-md text-left text-xs text-red-800 dark:text-red-300">
              <strong>Warning:</strong> All database records, customer uploaded photos, raw videos, and rendered audio files will be immediately purged from AWS S3. <strong>This action cannot be undone.</strong>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="outline" size="sm" onClick={() => setPermanentModalData(null)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={handlePermanentDelete} disabled={actionLoading}>
              {actionLoading ? "Purging Files..." : "Yes, Purge Permanently"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal: Empty Entire Trash */}
      <Modal isOpen={emptyModalOpen} onClose={() => setEmptyModalOpen(false)} className="max-w-md p-6">
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400 mx-auto">
            <FiTrash2 size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              Empty Entire Trash Bin?
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              This will permanently delete all <strong>{totalTrashCount}</strong> orders currently in the Trash Bin and permanently destroy all their audio, photo, and video files from AWS S3.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="outline" size="sm" onClick={() => setEmptyModalOpen(false)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={handleEmptyTrash} disabled={actionLoading}>
              {actionLoading ? "Purging Entire Trash..." : "Yes, Empty Trash"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal: Restore All */}
      <Modal isOpen={restoreAllModalOpen} onClose={() => setRestoreAllModalOpen(false)} className="max-w-md p-6">
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400 mx-auto">
            <FiRotateCcw size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              Restore All Orders?
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              This will restore all <strong>{totalTrashCount}</strong> orders currently in the Trash Bin back to your active list.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="outline" size="sm" onClick={() => setRestoreAllModalOpen(false)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleRestoreAll} disabled={actionLoading}>
              {actionLoading ? "Restoring All..." : "Yes, Restore All"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
