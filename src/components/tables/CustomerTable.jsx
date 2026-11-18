"use client";
import React, { useState, useEffect, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../ui/table";
import Badge from "../ui/badge/Badge";
import Button from "../ui/button/Button";
import Pagination from "./Pagination";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useToast } from "../ui/toast/Toast";
import { Modal } from "../ui/modal";
import { FiInfo, FiDownload, FiMusic, FiX, FiSearch, FiLoader, FiCheckCircle, FiExternalLink } from "react-icons/fi";
import ForceDownloadButton from "../common/ForceDownloadButton";

export default function CustomerTable({
  customers = [],
  totalCustomers = 0,
  currentPage = 1,
  totalPages = 1,
  itemsPerPageDefault = 50,
  initialStatus = "all",
  initialSortBy = "date",
  initialSortOrder = "desc",
  initialSearch = "",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [isUpdating, setIsUpdating] = useState(false);

  // Filter & Search Local State
  const [searchQuery, setSearchQuery] = useState(initialSearch || "");
  const [filterStatus, setFilterStatus] = useState(initialStatus || "all");
  const [sortBy, setSortBy] = useState(initialSortBy || "date");

  useEffect(() => {
    setFilterStatus(initialStatus || "all");
  }, [initialStatus]);

  useEffect(() => {
    setSortBy(initialSortBy || "date");
  }, [initialSortBy]);

  useEffect(() => {
    setSearchQuery(initialSearch || "");
  }, [initialSearch]);

  const updateFilters = (newPage, newStatus, newSortBy, newSearch) => {
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

    if (newSortBy && newSortBy !== "date") {
      params.set("sortBy", newSortBy);
    } else {
      params.delete("sortBy");
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
        updateFilters(1, filterStatus, sortBy, searchQuery);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleStatusChange = (e) => {
    const val = e.target.value;
    setFilterStatus(val);
    updateFilters(1, val, sortBy, searchQuery);
  };

  const handleSortChange = (e) => {
    const val = e.target.value;
    setSortBy(val);
    updateFilters(1, filterStatus, val, searchQuery);
  };

  const handlePageChange = (page) => {
    updateFilters(page, filterStatus, sortBy, searchQuery);
  };

  // Block Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalCustomer, setModalCustomer] = useState(null);
  const [blockReason, setBlockReason] = useState(
    "Your account has been restricted from generating music due to a policy violation."
  );

  // Customer Music Modal State
  const [isMusicModalOpen, setIsMusicModalOpen] = useState(false);
  const [selectedCustomerEmail, setSelectedCustomerEmail] = useState("");
  const [customerOrders, setCustomerOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Click email to open customer's generated music modal
  async function openCustomerMusicModal(email) {
    setSelectedCustomerEmail(email);
    setIsMusicModalOpen(true);
    setLoadingOrders(true);
    try {
      const res = await fetch(`/api/orders?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (res.ok && data.orders) {
        setCustomerOrders(data.orders);
      } else {
        setCustomerOrders([]);
      }
    } catch (err) {
      console.error("Failed to load customer orders:", err);
      setCustomerOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }

  function openBlockModal(customer) {
    if (customer.isBlocked) {
      executeBlockToggle(customer.email, true, "");
    } else {
      setModalCustomer(customer);
      setBlockReason("Your account has been restricted from generating music due to a policy violation.");
      setIsModalOpen(true);
    }
  }

  async function executeBlockToggle(email, currentStatus, customReason) {
    setIsUpdating(true);
    try {
      const res = await fetch("/api/customers/block", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          isBlocked: !currentStatus,
          blockReason: customReason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setIsModalOpen(false);
        router.refresh();
        toast({
          variant: "success",
          title: "Status Updated",
          message: `${email} has been ${!currentStatus ? "blocked" : "unblocked"}.`,
        });
      } else {
        toast({
          variant: "error",
          title: "Update Failed",
          message: data.error || "Failed to update the customer status.",
        });
      }
    } catch (err) {
      toast({
        variant: "error",
        title: "Network Error",
        message: "A network error occurred.",
      });
    } finally {
      setIsUpdating(false);
    }
  }

  const [exportProgress, setExportProgress] = useState({
    active: false,
    percent: 0,
    status: "",
  });

  // Direct In-Place CSV Export with Continuous Smooth Progress Bar (No new tab)
  const handleExportData = async () => {
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
          statusText = "Aggregating customer metrics...";
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
      const res = await fetch("/api/export?type=customers");
      if (!res.ok) throw new Error("Failed to export customer records");
      const blob = await res.blob();

      clearInterval(interval);

      setExportProgress({
        active: true,
        percent: 96,
        status: "Finalizing CSV download...",
      });

      await new Promise((r) => setTimeout(r, 180));

      const filename = `customers_export_${Date.now()}.csv`;
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

  const itemsPerPage = itemsPerPageDefault || 50;
  const startCount = totalCustomers === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endCount = Math.min(currentPage * itemsPerPage, totalCustomers);

  return (
    <>
      {/* Floating Export Progress Notification */}
      {exportProgress.active && (
        <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${exportProgress.percent === 100
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
                    : "Exporting Customers CSV"}
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
                className={`h-full transition-all duration-300 rounded-full ${exportProgress.percent === 100
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
              Customer List ({totalCustomers.toLocaleString()})
            </h3>
            <p className="text-xs text-gray-500">Manage and view customer records</p>
          </div>
          {isPending && (
            <span className="flex items-center gap-1 text-xs text-brand-500 animate-pulse font-medium">
              <FiLoader className="animate-spin" size={14} /> Loading...
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors"
            />
          </div>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={handleStatusChange}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors cursor-pointer"
          >
            <option value="all" className="dark:bg-gray-900">All Customers</option>
            <option value="active" className="dark:bg-gray-900">Active Only</option>
            <option value="blocked" className="dark:bg-gray-900">Blocked Only</option>
            <option value="purchases" className="dark:bg-gray-900">Purchases Only</option>
            <option value="flagged" className="dark:bg-gray-900">Abuse Flags Only</option>
          </select>

          {/* Sort Options */}
          <select
            value={sortBy}
            onChange={handleSortChange}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors cursor-pointer"
          >
            <option value="date" className="dark:bg-gray-900">Latest Active Date</option>
            <option value="generations" className="dark:bg-gray-900">Generations (High to Low)</option>
            <option value="purchases" className="dark:bg-gray-900">Purchases (High to Low)</option>
            <option value="flagged" className="dark:bg-gray-900">Abuse Flags (High to Low)</option>
            <option value="status" className="dark:bg-gray-900">Status (Blocked First)</option>
          </select>

          {/* Export CSV Button */}
          <button
            onClick={handleExportData}
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
                <FiLoader className="animate-spin" size={16} /> Loading Customers...
              </div>
            </div>
          )}

          <div className="min-w-[1102px]">
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                    Email (Click to View Music)
                  </TableCell>
                  <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                    Known IPs
                  </TableCell>
                  <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                    Generations
                  </TableCell>
                  <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                    Purchases
                  </TableCell>
                  <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                    Abuse Flags
                  </TableCell>
                  <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                    Last Active (Date &amp; Time)
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
                {customers.map((c) => (
                  <TableRow key={c.email} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.01] transition-colors">
                    {/* Email with Click action to Customer 360 */}
                    <TableCell className="px-5 py-4 sm:px-6 text-start">
                      <Link
                        href={`/customers/${c._id || encodeURIComponent(c.email)}`}
                        className="text-start font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:underline flex items-center gap-1.5 group text-theme-sm"
                        title="Click to open Customer 360° details and order history"
                      >
                        <FiMusic className="size-3.5 text-gray-400 group-hover:text-brand-500 transition-colors shrink-0" />
                        <span className="truncate max-w-[220px]">{c.email}</span>
                      </Link>
                    </TableCell>

                    {/* Known IPs */}
                    <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      {c.knownIps && c.knownIps.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {c.knownIps.slice(0, 2).map((ip, idx) => (
                            <span
                              key={idx}
                              className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-mono dark:bg-white/[0.05] dark:text-gray-300"
                            >
                              {ip}
                            </span>
                          ))}
                          {c.knownIps.length > 2 && (
                            <span className="text-[11px] text-gray-400" title={c.knownIps.join(", ")}>
                              +{c.knownIps.length - 2} more
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">None logged</span>
                      )}
                    </TableCell>

                    {/* Total Generations */}
                    <TableCell className="px-4 py-3 text-gray-700 dark:text-gray-300 font-semibold text-start text-theme-sm">
                      {c.totalGenerations}
                    </TableCell>

                    {/* Purchases */}
                    <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                      <span className={`font-semibold ${c.totalPurchases > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                        {c.totalPurchases}
                      </span>
                    </TableCell>

                    {/* Abuse Flags */}
                    <TableCell className={`px-4 py-3 ${c.securityFlags > 0 ? 'text-red-500 font-bold' : 'text-gray-400'} text-start text-theme-md dark:text-gray-400`}>
                      {c.securityFlags > 0 ? c.securityFlags : 0}
                    </TableCell>

                    {/* Last Active Date & Time */}
                    <TableCell suppressHydrationWarning className="px-4 py-3 text-gray-500 text-start text-theme-xs dark:text-gray-400 whitespace-nowrap font-mono">
                      {c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleString() : "N/A"}
                    </TableCell>

                    {/* Status */}
                    <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                      {c.isBlocked ? (
                        <Badge size="sm" color="error">
                          Blocked
                        </Badge>
                      ) : (
                        <Badge size="sm" color="success">
                          Active
                        </Badge>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href={`/customers/${c._id || encodeURIComponent(c.email)}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition shadow-xs"
                        >
                          <FiExternalLink size={12} /> 360° View
                        </Link>
                        <Button
                          size="sm"
                          variant={c.isBlocked ? "outline" : "primary"}
                          onClick={() => openBlockModal(c)}
                          disabled={isUpdating}
                          className={`!py-1.5 !px-3 !text-xs ${!c.isBlocked ? "!bg-error-500 hover:!bg-error-600" : ""}`}
                        >
                          {c.isBlocked ? "Unblock" : "Block"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {customers.length === 0 && (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400">
                <p className="text-sm font-medium">No customers found.</p>
                {searchQuery && (
                  <p className="text-xs text-gray-400 mt-1">
                    Try adjusting your search criteria.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer with Summary and Server Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-5 border-t border-gray-100 dark:border-white/[0.05] gap-4 sm:gap-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{startCount}</span> to{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{endCount}</span> of{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{totalCustomers.toLocaleString()}</span> customers
          </div>

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </div>

        {/* Block Confirmation Modal */}
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} className="max-w-md p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <FiInfo size={24} />
              <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
                Block Customer
              </h4>
            </div>

            <p className="text-sm text-gray-500">
              Are you sure you want to block <strong>{modalCustomer?.email}</strong>? They will be immediately prevented from creating new AI songs.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Reason / Public Notice to Customer:
              </label>
              <textarea
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="w-full text-xs p-3 rounded-lg border border-gray-200 dark:border-gray-800 dark:bg-gray-900 outline-none focus:border-brand-500"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => executeBlockToggle(modalCustomer?.email, false, blockReason)}
                disabled={isUpdating}
                className="!bg-error-500 hover:!bg-error-600"
              >
                {isUpdating ? "Updating..." : "Confirm Block"}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Customer Generated Musics List Modal */}
        <Modal isOpen={isMusicModalOpen} onClose={() => setIsMusicModalOpen(false)} className="max-w-4xl p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400">
                  <FiMusic size={18} />
                </div>
                <div>
                  <h4 className="text-base font-bold text-gray-800 dark:text-white/90">
                    Custom Songs by Customer
                  </h4>
                  <p className="text-xs text-brand-500 font-mono">{selectedCustomerEmail}</p>
                </div>
              </div>
              <button
                onClick={() => setIsMusicModalOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <FiX size={18} />
              </button>
            </div>

            {loadingOrders ? (
              <div className="py-12 text-center text-gray-400 text-xs flex flex-col items-center gap-2">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"></div>
                <span>Loading customer's generations...</span>
              </div>
            ) : customerOrders.length === 0 ? (
              <div className="py-10 text-center text-gray-500 text-xs">
                No music generations found for this customer.
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
                {customerOrders.map((order, idx) => {
                  const tracks = order.musicTracks || [];
                  const firstTrack = tracks[0] || {};
                  const audioUrl = firstTrack.audioUrl || order.audioUrl;
                  const lyrics = order.lyrics || firstTrack.lyrics;

                  return (
                    <div
                      key={order._id || idx}
                      className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/40 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-gray-800 dark:text-white">
                              {order.occasion || "Custom Song"} {order.recipientName ? `for ${order.recipientName}` : ""}
                            </span>
                            {order.selectedStyle && (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 border border-brand-200 dark:border-brand-500/20">
                                {order.selectedStyle}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 capitalize mt-0.5">
                            {[order.genre, order.voice, order.mood, order.language].filter(Boolean).join(" • ") || "No style specified"} &bull; {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : ""}
                          </p>
                        </div>

                        {order.shopifyOrderId && (
                          <Link
                            href={`/orders/music/${order.shopifyOrderId}`}
                            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-semibold dark:text-brand-400"
                          >
                            Order Details <FiExternalLink size={12} />
                          </Link>
                        )}
                      </div>

                      {/* Audio Player */}
                      {audioUrl && (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-white dark:bg-gray-800/80 p-2.5 rounded-lg border border-gray-200/70 dark:border-gray-700/50">
                          <audio
                            controls
                            src={audioUrl.startsWith("http") ? audioUrl : `/api/download?url=${encodeURIComponent(audioUrl)}&stream=true`}
                            className="h-8 w-full min-w-0"
                          />
                          <ForceDownloadButton
                            url={audioUrl}
                            filename={`${order.occasion || "custom-song"} - My Own Songs.mp3`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-brand-500 text-white hover:bg-brand-600 shrink-0"
                          >
                            <FiDownload size={13} /> Download
                          </ForceDownloadButton>
                        </div>
                      )}

                      {/* Lyrics Preview if available */}
                      {lyrics && (
                        <details className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800/40 p-2.5 rounded border border-gray-100 dark:border-gray-800">
                          <summary className="cursor-pointer font-medium text-brand-600 dark:text-brand-400 hover:underline">
                            View Generated Lyrics
                          </summary>
                          <pre className="mt-2 text-[11px] whitespace-pre-wrap font-mono max-h-40 overflow-y-auto text-gray-700 dark:text-gray-300">
                            {lyrics}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end border-t border-gray-100 pt-3 dark:border-gray-800">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsMusicModalOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
}
