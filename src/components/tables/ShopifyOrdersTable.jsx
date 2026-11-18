"use client";
import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Badge from "@/components/ui/badge/Badge";
import Pagination from "./Pagination";
import { FiSearch, FiLoader, FiEye } from "react-icons/fi";

export default function ShopifyOrdersTable({
  orders = [],
  totalOrders = 0,
  currentPage = 1,
  totalPages = 1,
  itemsPerPageDefault = 10,
  initialFilter = "all",
  initialSort = "date_desc",
  initialSearch = "",
  linkPrefix = "/orders/music",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [sortOption, setSortOption] = useState(initialSort || "date_desc");
  const [filterOption, setFilterOption] = useState(initialFilter || "all");
  const [searchQuery, setSearchQuery] = useState(initialSearch || "");

  useEffect(() => {
    setFilterOption(initialFilter || "all");
  }, [initialFilter]);

  useEffect(() => {
    setSortOption(initialSort || "date_desc");
  }, [initialSort]);

  useEffect(() => {
    setSearchQuery(initialSearch || "");
  }, [initialSearch]);

  const updateFilters = (newPage, newFilter, newSort, newSearch) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");

    if (newPage && newPage > 1) {
      params.set("page", String(newPage));
    } else {
      params.delete("page");
    }

    if (newFilter && newFilter !== "all") {
      params.set("filter", newFilter);
    } else {
      params.delete("filter");
    }

    if (newSort && newSort !== "date_desc") {
      params.set("sort", newSort);
    } else {
      params.delete("sort");
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
        updateFilters(1, filterOption, sortOption, searchQuery);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleFilterChange = (e) => {
    const val = e.target.value;
    setFilterOption(val);
    updateFilters(1, val, sortOption, searchQuery);
  };

  const handleSortChange = (e) => {
    const val = e.target.value;
    setSortOption(val);
    updateFilters(1, filterOption, val, searchQuery);
  };

  const handlePageChange = (page) => {
    updateFilters(page, filterOption, sortOption, searchQuery);
  };

  const itemsPerPage = itemsPerPageDefault || 10;
  const startCount = totalOrders === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endCount = Math.min(currentPage * itemsPerPage, totalOrders);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:mb-7">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Order List ({totalOrders.toLocaleString()})
            </h3>
            <p className="text-xs text-gray-500">Manage and view customer Shopify orders</p>
          </div>
          {isPending && (
            <span className="flex items-center gap-1 text-xs text-brand-500 animate-pulse font-medium">
              <FiLoader className="animate-spin" size={14} /> Loading...
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search orders, email, name..."
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <select
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors cursor-pointer"
            value={filterOption}
            onChange={handleFilterChange}
          >
            <option value="all">All Statuses</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="unfulfilled">Unfulfilled</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>

          <select
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-white/90 transition-colors cursor-pointer"
            value={sortOption}
            onChange={handleSortChange}
          >
            <option value="date_desc">Sort by Date (Newest)</option>
            <option value="date_asc">Sort by Date (Oldest)</option>
            <option value="total_desc">Sort by Total (Highest)</option>
            <option value="total_asc">Sort by Total (Lowest)</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03] relative">
        {isPending && (
          <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-gray-800 px-4 py-2 shadow-lg border border-gray-100 dark:border-gray-700 text-xs font-semibold text-brand-600 dark:text-brand-400">
              <FiLoader className="animate-spin" size={16} /> Fetching from Shopify...
            </div>
          </div>
        )}

        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-gray-100 dark:border-white/[0.05]">
              <tr>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider">Order ID</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider">Customer</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider">Financial Status</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider">Fulfillment Status</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider">Total</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider">Items</th>
                <th className="px-5 py-3 font-medium text-gray-500 text-xs dark:text-gray-400 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-4 text-sm font-semibold text-gray-800 dark:text-white/90">
                    <Link href={`${linkPrefix}/${order.id}`} className="text-brand-500 hover:text-brand-600 hover:underline">
                      {order.name || (order.order_number ? `#${order.order_number}` : `#${order.id}`)}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                    <span className="block font-medium text-gray-800 dark:text-white/90">
                      {order.customer ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || "Customer" : "No Customer"}
                    </span>
                    <span className="text-xs text-gray-500 break-all">{order.email}</span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {new Date(order.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(order.created_at).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm">
                    <Badge
                      size="sm"
                      color={
                        order.financial_status === "paid"
                          ? "success"
                          : order.financial_status === "pending"
                          ? "warning"
                          : "error"
                      }
                    >
                      {order.financial_status || "unknown"}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-sm">
                    {order.publishStatus === "in_progress" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                        In Progress
                      </span>
                    ) : order.publishStatus === "delivered" || order.fulfillment_status === "fulfilled" ? (
                      <Badge size="sm" color="success">
                        {order.fulfillment_status === "fulfilled" ? "fulfilled" : "delivered"}
                      </Badge>
                    ) : (
                      <Badge size="sm" color="warning">
                        {order.fulfillment_status || "unfulfilled"}
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm font-semibold text-gray-800 dark:text-white/90 whitespace-nowrap">
                    {order.total_price} {order.currency}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-600 dark:text-gray-400">
                    <ul className="list-disc pl-4 space-y-1.5">
                      {order.line_items?.map((item) => {
                        const props = item.properties || [];
                        const storyProp = props.find((p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "storytext")?.value;
                        const isOwnLyrics = props.some((p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "creationmethod" && p.value === "own_lyrics");
                        const providerBadge = isOwnLyrics
                          ? "Own Lyrics"
                          : (storyProp && storyProp.length > 200)
                          ? "Mureka AI (>200)"
                          : "Suno AI (≤200)";
                        return (
                          <li key={item.id} className="space-y-1">
                            <div>
                              {item.title} <span className="text-gray-400">x{item.quantity}</span>
                            </div>
                            <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300 border border-brand-200/60 dark:border-brand-800">
                              Lyrics: {providerBadge}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                  <td className="px-5 py-4 text-sm text-right whitespace-nowrap">
                    <Link
                      href={`${linkPrefix}/${order.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 dark:hover:bg-orange-500/10 dark:hover:text-orange-400 dark:hover:border-orange-500/20 transition"
                    >
                      <FiEye size={13} />
                      <span>View</span>
                    </Link>
                  </td>
                </tr>
              ))}
              {totalOrders === 0 && (
                <tr>
                  <td colSpan="8" className="px-5 py-8 text-center text-gray-500 text-sm">
                    No orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer with Summary and Server Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-5 border-t border-gray-100 dark:border-white/[0.05] gap-4 sm:gap-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{startCount}</span> to{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{endCount}</span> of{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{totalOrders.toLocaleString()}</span> orders
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
