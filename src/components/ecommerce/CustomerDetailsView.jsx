"use client";

import React, { useState, useMemo, useEffect } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import BackButton from "@/components/common/BackButton";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast/Toast";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  FiMusic,
  FiVideo,
  FiShoppingBag,
  FiDownload,
  FiFileText,
  FiShield,
  FiShieldOff,
  FiClock,
  FiExternalLink,
  FiChevronDown,
  FiChevronUp,
  FiSearch,
  FiCopy,
  FiCheck,
  FiDollarSign,
  FiCalendar,
  FiImage,
  FiLayers,
  FiMaximize2,
  FiEye,
  FiPlay,
  FiFilm,
  FiFolder,
} from "react-icons/fi";
import OrderRevisionModal from "./OrderRevisionModal";
import OrderRevisionHistory from "./OrderRevisionHistory";
import ForceDownloadButton from "@/components/common/ForceDownloadButton";

export default function CustomerDetailsView({
  customerDoc,
  musicOrders = [],
  videoOrders = [],
  draftVideoOrders = [],
  otherOrders = [],
  allGeneratedSongs = [],
  stats = {},
  email = "",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showToast = useToast();

  const rawTab = searchParams.get("tab") || "all";
  const activeTab = rawTab === "orders" ? "all" : rawTab; // "all" | "music" | "video" | "other" | "songs"
  const orderFilter = searchParams.get("filter") || "all"; // "all" | "open" | "fulfilled"

  const [searchTerm, setSearchTerm] = useState("");
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedLyricsId, setCopiedLyricsId] = useState(null);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isBlocked, setIsBlocked] = useState(Boolean(customerDoc?.isBlocked));
  const [expandedLyrics, setExpandedLyrics] = useState({});
  const [mediaModal, setMediaModal] = useState(null); // { type: 'video'|'image', url, title }
  const [expandedMediaOrder, setExpandedMediaOrder] = useState({});

  // Local state for orders so newly generated revisions appear immediately
  const [localMusicOrders, setLocalMusicOrders] = useState(musicOrders);
  const [localVideoOrders, setLocalVideoOrders] = useState(videoOrders);

  useEffect(() => {
    setLocalMusicOrders(musicOrders);
  }, [musicOrders]);

  useEffect(() => {
    setLocalVideoOrders(videoOrders);
  }, [videoOrders]);

  const handleRevisionCreated = (targetId, newRev, isMusic) => {
    if (isMusic) {
      setLocalMusicOrders((prev) =>
        prev.map((o) => {
          if (
            String(o._id) === String(targetId) ||
            String(o.musicId) === String(targetId) ||
            String(o.shopifyOrderId) === String(targetId)
          ) {
            const existingRevs = Array.isArray(o.revisions) ? o.revisions : [];
            const updatedRevs = [newRev, ...existingRevs].sort((a, b) => (b.version || 0) - (a.version || 0));
            return {
              ...o,
              revisions: updatedRevs,
              currentVersion: newRev.version || (o.currentVersion || 1) + 1,
              ...(newRev.audioUrl ? { track: { ...(o.track || {}), audioUrl: newRev.audioUrl, lyrics: newRev.lyrics || o.lyrics } } : {}),
            };
          }
          return o;
        })
      );
    } else {
      setLocalVideoOrders((prev) =>
        prev.map((v) => {
          if (
            String(v._id) === String(targetId) ||
            String(v.videoId) === String(targetId) ||
            String(v.shopifyOrderId) === String(targetId)
          ) {
            const existingRevs = Array.isArray(v.revisions) ? v.revisions : [];
            const updatedRevs = [newRev, ...existingRevs].sort((a, b) => (b.version || 0) - (a.version || 0));
            return {
              ...v,
              revisions: updatedRevs,
              currentVersion: newRev.version || (v.currentVersion || 1) + 1,
              ...(newRev.videoUrl ? { finalVideoUrl: newRev.videoUrl } : {}),
            };
          }
          return v;
        })
      );
    }
    router.refresh();
  };

  const handleTabChange = (newTab) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
    if (newTab && newTab !== "all") {
      params.set("tab", newTab);
    } else {
      params.delete("tab");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleFilterChange = (newFilter) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
    if (newFilter && newFilter !== "all") {
      params.set("filter", newFilter);
    } else {
      params.delete("filter");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleCopyEmail = () => {
    if (!email) return;
    navigator.clipboard.writeText(email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
    showToast({ variant: "success", title: "Copied", message: "Email copied to clipboard" });
  };

  const handleCopyLyrics = (id, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedLyricsId(id);
    setTimeout(() => setCopiedLyricsId(null), 2000);
    showToast({ variant: "success", title: "Copied", message: "Lyrics copied to clipboard" });
  };

  const toggleLyrics = (id) => {
    setExpandedLyrics((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleBlock = async () => {
    setIsUpdatingStatus(true);
    try {
      const nextStatus = !isBlocked;
      const res = await fetch("/api/customers/block", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          isBlocked: nextStatus,
          blockReason: nextStatus ? (blockReason.trim() || "Administrative security block") : "",
        }),
      });

      if (res.ok) {
        setIsBlocked(nextStatus);
        setIsBlockModalOpen(false);
        setBlockReason("");
        showToast({
          variant: "success",
          title: "Status Updated",
          message: `${email} has been ${nextStatus ? "blocked" : "unblocked"}.`,
        });
        router.refresh();
      } else {
        showToast({
          variant: "error",
          title: "Update Failed",
          message: "Could not update customer status.",
        });
      }
    } catch (err) {
      console.error(err);
      showToast({ variant: "error", title: "Network Error", message: "An error occurred." });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const currentFullUrl = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";

  // Combine Music, Video & Other Orders into unified list
  const unifiedOrders = useMemo(() => {
    const list = [
      ...localMusicOrders.map((o) => {
        const isFulfilled = o.status === "fulfilled" || o.status === "completed" || o.status === "delivered";
        const isOpen = !isFulfilled;
        const displayNumber = o.shopifyOrderNumber
          ? (String(o.shopifyOrderNumber).startsWith("#") ? o.shopifyOrderNumber : `#${o.shopifyOrderNumber}`)
          : (o.shopifyOrderId ? (String(o.shopifyOrderId).startsWith("#") ? o.shopifyOrderId : `#${o.shopifyOrderId}`) : `Music ID: ${o.musicId || o._id}`);

        return {
          ...o,
          orderCategory: "music",
          displayId: o.shopifyOrderId || o.musicId || o._id,
          displayNumber,
          detailUrl: `/orders/music/${o.shopifyOrderId || o.musicId || o._id}${currentFullUrl ? `?returnUrl=${encodeURIComponent(currentFullUrl)}` : ""}`,
          shopifyUrl: o.shopifyOrderId ? `/orders/music/${o.shopifyOrderId}` : null,
          isOpen,
          isFulfilled,
        };
      }),
      ...localVideoOrders.map((v) => {
        const isFulfilled = v.status === "fulfilled" || v.status === "completed" || v.status === "delivered";
        const isOpen = !isFulfilled;
        const displayNumber = v.shopifyOrderNumber
          ? (String(v.shopifyOrderNumber).startsWith("#") ? v.shopifyOrderNumber : `#${v.shopifyOrderNumber}`)
          : (v.shopifyOrderId ? (String(v.shopifyOrderId).startsWith("#") ? v.shopifyOrderId : `#${v.shopifyOrderId}`) : `Video ID: ${v.videoId || v._id}`);

        return {
          ...v,
          orderCategory: "video",
          displayId: v.shopifyOrderId || v.videoId || v._id,
          displayNumber,
          detailUrl: `/orders/video/${v.shopifyOrderId || v.videoId || v._id}${currentFullUrl ? `?returnUrl=${encodeURIComponent(currentFullUrl)}` : ""}`,
          shopifyUrl: v.shopifyOrderId ? `/orders/video/${v.shopifyOrderId}` : null,
          isOpen,
          isFulfilled,
        };
      }),
      ...otherOrders.map((oth) => {
        const isFulfilled = oth.isFulfilled || oth.fulfillmentStatus === "fulfilled";
        const isOpen = !isFulfilled;
        const displayNumber = oth.shopifyOrderNumber
          ? (String(oth.shopifyOrderNumber).startsWith("#") ? oth.shopifyOrderNumber : `#${oth.shopifyOrderNumber}`)
          : `#${oth.shopifyOrderId}`;

        return {
          ...oth,
          orderCategory: "other",
          displayId: oth.shopifyOrderId || oth._id,
          displayNumber,
          detailUrl: `/orders/publish/${oth.shopifyOrderId || oth._id}${currentFullUrl ? `?returnUrl=${encodeURIComponent(currentFullUrl)}` : ""}`,
          shopifyUrl: oth.shopifyOrderId ? `/orders/publish/${oth.shopifyOrderId}` : null,
          isOpen,
          isFulfilled,
        };
      }),
    ];
    return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [musicOrders, videoOrders, otherOrders, currentFullUrl]);

  // Formatted draft video sessions
  const formattedDraftVideos = useMemo(() => {
    return (draftVideoOrders || []).map((v) => {
      const displayNumber = `Draft: ${v.videoId || v._id}`;
      return {
        ...v,
        orderCategory: "video",
        isDraft: true,
        displayId: v.videoId || v._id,
        displayNumber,
        detailUrl: `/orders/video/${v._id}${currentFullUrl ? `?returnUrl=${encodeURIComponent(currentFullUrl)}` : ""}`,
        isOpen: true,
        isFulfilled: false,
      };
    }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [draftVideoOrders, currentFullUrl]);

  // Filter orders by active tab (All, Music, Video, Drafts, or Other)
  const targetCategoryOrders = useMemo(() => {
    if (activeTab === "music") return unifiedOrders.filter((o) => o.orderCategory === "music");
    if (activeTab === "video") return unifiedOrders.filter((o) => o.orderCategory === "video");
    if (activeTab === "other") return unifiedOrders.filter((o) => o.orderCategory === "other");
    if (activeTab === "drafts") return formattedDraftVideos;
    return unifiedOrders;
  }, [unifiedOrders, activeTab, formattedDraftVideos]);

  // Filter and search orders by sub-filter (all/open/fulfilled) and search term
  const filteredOrders = useMemo(() => {
    return targetCategoryOrders.filter((order) => {
      // Sub-filter by open/fulfilled only when not in drafts
      if (activeTab !== "drafts") {
        if (orderFilter === "open" && !order.isOpen) return false;
        if (orderFilter === "fulfilled" && !order.isFulfilled) return false;
      }

      // Search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const num = String(order.displayNumber || "").toLowerCase();
        const id = String(order.displayId || "").toLowerCase();
        const occ = String(order.occasion || order.selectedPackage || "").toLowerCase();
        const genre = String(order.genre || "").toLowerCase();
        return num.includes(term) || id.includes(term) || occ.includes(term) || genre.includes(term);
      }
      return true;
    });
  }, [targetCategoryOrders, orderFilter, searchTerm, activeTab]);

  // Filter generated songs
  const filteredGeneratedSongs = useMemo(() => {
    if (!searchTerm) return allGeneratedSongs;
    const term = searchTerm.toLowerCase();
    return allGeneratedSongs.filter((song) => {
      const occ = String(song.occasion || "").toLowerCase();
      const rec = String(song.recipientName || "").toLowerCase();
      const genre = String(song.genre || "").toLowerCase();
      const num = String(song.shopifyOrderNumber || song.shopifyOrderId || "").toLowerCase();
      return occ.includes(term) || rec.includes(term) || genre.includes(term) || num.includes(term);
    });
  }, [allGeneratedSongs, searchTerm]);

  // Initials for avatar
  const emailInitials = (email ? email.split("@")[0].substring(0, 2) : "CU").toUpperCase();
  const isVip = (stats.totalPurchases || 0) >= 3 || (stats.totalSpent || 0) >= 80;

  return (
    <div className="space-y-6">
      {/* Top Header Navigation & Back Button */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <PageBreadcrumb pageTitle="Customer 360° Profile" />
        <BackButton
          fallbackUrl="/customers"
          className="text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 transition inline-flex items-center gap-1.5 text-xs font-semibold"
        >
          ← Back to Customer CRM
        </BackButton>
      </div>

      {/* Profile Overview Card */}
      <div className="rounded-2xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden">
        <div className="p-6 md:p-7 bg-gradient-to-r from-orange-50/40 via-white to-amber-50/30 dark:from-gray-900 dark:via-gray-900/60 dark:to-gray-900 border-b border-gray-100 dark:border-gray-800">
          <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6">

            {/* Customer Info Header */}
            <div className="flex items-start sm:items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-amber-500 text-white font-bold text-lg">
                {emailInitials}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">{email}</h2>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="p-1 rounded-md text-gray-400 hover:text-brand-500 hover:bg-orange-50 dark:hover:bg-gray-800 transition"
                    title="Copy Email"
                  >
                    {copiedEmail ? <FiCheck size={14} className="text-emerald-500" /> : <FiCopy size={14} />}
                  </button>

                  {isBlocked ? (
                    <Badge size="sm" color="error">
                      Blocked
                    </Badge>
                  ) : (
                    <Badge size="sm" color="success">
                      Active Customer
                    </Badge>
                  )}

                  {isVip && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60">
                      ★ VIP Customer
                    </span>
                  )}

                  {stats.securityFlags > 0 && (
                    <Badge size="sm" color="warning">
                      Abuse Flags: {stats.securityFlags}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                  <span className="flex items-center gap-1">
                    <FiCalendar size={13} className="text-gray-400" />
                    First Seen: {stats.firstActive ? new Date(stats.firstActive).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}
                  </span>
                  <span>&bull;</span>
                  <span className="flex items-center gap-1">
                    <FiClock size={13} className="text-gray-400" />
                    Last Active: {stats.lastActive ? new Date(stats.lastActive).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}
                  </span>
                </div>
              </div>
            </div>

            {/* Block / Unblock & IP Actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
              {customerDoc?.knownIps && customerDoc.knownIps.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {customerDoc.knownIps.slice(0, 2).map((ip, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-mono border border-gray-200 dark:border-gray-700"
                    >
                      {ip}
                    </span>
                  ))}
                  {customerDoc.knownIps.length > 2 && (
                    <span className="text-xs text-gray-400 font-mono">+{customerDoc.knownIps.length - 2} more</span>
                  )}
                </div>
              )}

              <Button
                size="sm"
                variant={isBlocked ? "outline" : "danger"}
                startIcon={isBlocked ? <FiShield size={14} /> : <FiShieldOff size={14} />}
                onClick={() => {
                  if (isBlocked) {
                    handleToggleBlock();
                  } else {
                    setIsBlockModalOpen(true);
                  }
                }}
                disabled={isUpdatingStatus}
              >
                {isBlocked ? "Unblock Account" : "Block Customer"}
              </Button>
            </div>
          </div>
        </div>

        {/* High Level Metrics KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-gray-800 bg-white dark:bg-white/[0.02]">

          {/* Card 1: Paid Orders */}
          <div className="p-5 flex items-center gap-3.5">
            <div className="p-3 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 rounded-md">
              <FiShoppingBag size={22} />
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">Total Paid Orders</span>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{stats.totalPurchases || 0}</h3>
            </div>
          </div>

          {/* Card 2: Generated Songs */}
          <div className="p-5 flex items-center gap-3.5">
            <div className="p-3 bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 rounded-md">
              <FiMusic size={22} />
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">Songs Generated</span>
              <h3 className="text-xl font-bold text-brand-600 dark:text-brand-400 mt-0.5">{allGeneratedSongs.length || 0}</h3>
            </div>
          </div>

          {/* Card 3: Video Orders */}
          <div className="p-5 flex items-center gap-3.5">
            <div className="p-3 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 rounded-md">
              <FiVideo size={22} />
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">Music Video Orders</span>
              <h3 className="text-xl font-bold text-brand-600 dark:text-brand-400 mt-0.5">{videoOrders.length || 0}</h3>
            </div>
          </div>

          {/* Card 4: Total Spent */}
          <div className="p-5 flex items-center gap-3.5">
            <div className="p-3 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 rounded-md">
              <FiDollarSign size={22} />
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">Lifetime Spend</span>
              <h3 className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                ${stats.totalSpent ? stats.totalSpent.toFixed(2) : "0.00"} <span className="text-xs font-normal text-gray-400">USD</span>
              </h3>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Tabs & Controls Toolbar */}
      <div className="space-y-4">

        {/* Navigation Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-3">

          {/* Main Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => handleTabChange("all")}
              className={`px-3.5 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "all"
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              <FiShoppingBag size={14} />
              <span>All Orders ({unifiedOrders.length})</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("music")}
              className={`px-3.5 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "music"
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              <FiMusic size={14} />
              <span>Music Orders ({musicOrders.length})</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("video")}
              className={`px-3.5 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "video"
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              <FiVideo size={14} />
              <span>Video Orders ({videoOrders.length})</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("drafts")}
              className={`px-3.5 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "drafts"
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              <FiClock size={14} />
              <span>Draft Videos ({draftVideoOrders.length})</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("other")}
              className={`px-3.5 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "other"
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              <FiFolder size={14} />
              <span>Music  Publish Orders ({otherOrders.length})</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("songs")}
              className={`px-3.5 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "songs"
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              <FiLayers size={14} />
              <span>Generated Songs ({allGeneratedSongs.length})</span>
            </button>
          </div>

          {/* Search Filter */}
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder={`Search ${activeTab === "songs" ? "songs" : activeTab === "video" ? "video orders" : activeTab === "drafts" ? "draft videos" : activeTab === "music" ? "music orders" : activeTab === "other" ? "other orders" : "all orders"}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 w-full pl-8 pr-3 text-xs rounded-md border border-gray-200 bg-white placeholder:text-gray-400 focus:border-brand-500 focus:outline-none dark:border-gray-800 dark:bg-white/[0.03] dark:text-white"
            />
            <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
          </div>
        </div>

        {/* ORDERS SECTION (For All, Music, Video, Drafts, or Other tabs) */}
        {activeTab !== "songs" && (
          <div className="space-y-4">

            {/* Filter Pills */}
            {activeTab === "drafts" ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold flex items-center gap-1.5 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
                  <FiClock size={13} className="text-amber-500" /> Incomplete / Draft Video Sessions ({targetCategoryOrders.length}) &bull; Not completed on Shopify checkout
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleFilterChange("all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${orderFilter === "all"
                    ? "bg-brand-50 text-brand-600 border border-brand-200 dark:bg-brand-500/10 dark:text-brand-400 dark:border-brand-800"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-800"
                    }`}
                >
                  All {activeTab === "video" ? "Video Orders" : activeTab === "music" ? "Music Orders" : activeTab === "other" ? "Other Orders" : "Orders"} ({targetCategoryOrders.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange("open")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${orderFilter === "open"
                    ? "bg-brand-50 text-brand-600 border border-brand-200 dark:bg-brand-500/10 dark:text-brand-400 dark:border-brand-800"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-800"
                    }`}
                >
                  Open / In Production ({targetCategoryOrders.filter((o) => o.isOpen).length})
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange("fulfilled")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${orderFilter === "fulfilled"
                    ? "bg-brand-50 text-brand-600 border border-brand-200 dark:bg-brand-500/10 dark:text-brand-400 dark:border-brand-800"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-800"
                    }`}
                >
                  Completed / Fulfilled ({targetCategoryOrders.filter((o) => o.isFulfilled).length})
                </button>
              </div>
            )}

            {filteredOrders.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-500 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="flex flex-col items-center justify-center gap-2">
                  <FiShoppingBag size={28} className="text-gray-300 dark:text-gray-600" />
                  <p className="font-medium text-xs">No {orderFilter !== "all" ? orderFilter : ""} orders match your criteria.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {filteredOrders.map((order) => {
                  const isMusic = order.orderCategory === "music";
                  const isOther = order.orderCategory === "other";

                  if (isOther) {
                    return (
                      <div
                        key={order._id || order.displayId}
                        className="rounded-2xl border border-gray-200/90 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] space-y-4 hover:border-blue-400/40 hover transition"
                      >
                        {/* Top Bar of Other Order Card */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                              <FiShoppingBag size={18} />
                            </div>

                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-gray-900 dark:text-white">
                                  Shopify Store Order
                                </span>
                                <span className="font-mono text-xs font-semibold text-gray-600 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                                  {order.displayNumber}
                                </span>
                                <Badge
                                  size="sm"
                                  color={order.financialStatus === "paid" ? "success" : "warning"}
                                >
                                  {order.financialStatus || "paid"}
                                </Badge>
                                <Badge
                                  size="sm"
                                  color={order.isFulfilled ? "success" : "info"}
                                >
                                  {order.fulfillmentStatus || "unfulfilled"}
                                </Badge>
                              </div>

                              <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5 flex-wrap">
                                <span>Ordered on {order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
                                <span>&bull;</span>
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">${order.totalPrice} {order.currency}</span>
                              </div>
                            </div>
                          </div>

                          {/* Card Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            {order.shopifyAdminUrl ? (
                              <a
                                href={`/orders/publish/${order._id}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 transition"
                              >
                                <span>Order Details</span>
                                <FiExternalLink size={12} />
                              </a>
                            ) : order.detailUrl ? (
                              <a
                                href={order.detailUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 transition"
                              >
                                <span>Order Status</span>
                                <FiExternalLink size={12} />
                              </a>
                            ) : null}
                          </div>
                        </div>

                        {/* Line Items List */}
                        {order.lineItems && order.lineItems.length > 0 && (
                          <div className="space-y-2 bg-gray-50/60 dark:bg-gray-900/40 p-3.5 rounded-md border border-gray-100 dark:border-gray-800">
                            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
                              Ordered Products ({order.lineItems.length})
                            </span>
                            <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                              {order.lineItems.map((li, liIdx) => (
                                <div key={li.id || liIdx} className="py-2 flex items-center justify-between text-xs">
                                  <div>
                                    <p className="font-semibold text-gray-800 dark:text-gray-200">{li.title}</p>
                                    {li.variantTitle && (
                                      <p className="text-[11px] text-gray-400">{li.variantTitle}</p>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <span className="text-gray-500 font-mono">Qty: {li.quantity}</span>
                                    <span className="ml-3 font-semibold text-gray-700 dark:text-gray-300 font-mono">${li.price}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  const primaryTrack = isMusic
                    ? (order.musicTracks?.find((t) => t.id === order.selectedDemo) ||
                      order.musicTracks?.find((t) => t.audioUrl || t.streamAudioUrl) ||
                      order.musicTracks?.[0] || {})
                    : null;
                  const currentVer = order.currentVersion || 1;

                  // Full length song vs 45s preview:
                  // audioUrl contains the full S3 master track. Fallback to streamAudioUrl only if audioUrl is missing or is an expired tempfile.
                  const fullSong = primaryTrack?.audioUrl || "";
                  const previewSong = primaryTrack?.streamAudioUrl || "";
                  const isTempExpired = fullSong.includes("tempfile.aiquickdraw.com");
                  const audioUrl = isMusic
                    ? (fullSong && !isTempExpired ? fullSong : (previewSong || fullSong || order.audioUrl || ""))
                    : (order.audioFile?.url || order.audioUrl || "");
                  const videoUrl = !isMusic ? (order.finalVideoUrl || order.videoUrl || "") : "";
                  const mediaFiles = order.mediaFiles || [];
                  const photoCount = mediaFiles.filter((m) => m.type === "image" || (!m.type && m.mimeType?.startsWith("image"))).length;
                  const rawVideoCount = mediaFiles.filter((m) => m.type === "video" || (!m.type && m.mimeType?.startsWith("video"))).length;

                  return (
                    <div
                      key={order._id || order.displayId}
                      className="rounded-2xl border border-gray-200/90 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] space-y-4 hover:border-brand-400/40 hover transition"
                    >
                      {/* Top Bar of Card */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                            {isMusic ? <FiMusic size={18} /> : <FiVideo size={18} />}
                          </div>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-gray-900 dark:text-white">
                                {isMusic ? (order.occasion || "Custom Song Order") : (order.selectedPackage || "Custom Music Video")}
                              </span>
                              <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${order.isDraft ? "text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300" : "text-gray-600 bg-gray-100 dark:bg-gray-800"}`}>
                                {order.displayNumber}
                              </span>
                              {order.isDraft ? (
                                <Badge size="sm" color="warning">
                                  Draft Session (Unpaid)
                                </Badge>
                              ) : (
                                <Badge
                                  size="sm"
                                  color={
                                    order.isFulfilled
                                      ? "success"
                                      : order.status === "in_production" || order.status === "ready"
                                        ? "warning"
                                        : "info"
                                  }
                                >
                                  {order.status}
                                </Badge>
                              )}
                              {currentVer > 1 && (
                                <Badge size="sm" color="primary">
                                  v{currentVer} Final
                                </Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5 flex-wrap">
                              <span>{order.isDraft ? "Draft created on" : "Ordered on"} {order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
                              {order.isDraft && (
                                <>
                                  <span>&bull;</span>
                                  <span className="text-amber-600 dark:text-amber-400 font-medium">Checkout Not Completed</span>
                                </>
                              )}
                              {isMusic && [order.genre, order.mood, order.voice].filter(Boolean).length > 0 && (
                                <>
                                  <span>&bull;</span>
                                  <span className="capitalize">{[order.genre, order.mood, order.voice].filter(Boolean).join(" • ")}</span>
                                </>
                              )}
                              {!isMusic && (photoCount > 0 || rawVideoCount > 0) && (
                                <>
                                  <span>&bull;</span>
                                  <span className="flex items-center gap-2">
                                    {photoCount > 0 && <span className="text-blue-500 flex items-center gap-1"><FiImage size={11} /> {photoCount} Photos</span>}
                                    {rawVideoCount > 0 && <span className="text-purple-500 flex items-center gap-1"><FiVideo size={11} /> {rawVideoCount} Videos</span>}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {!order.isDraft && (order.status === "fulfilled" || order.fulfillmentStatus === "fulfilled" || order.fulfillment_status === "fulfilled") && (
                            <OrderRevisionModal
                              orderId={order._id || order.videoId || order.musicId}
                              orderType={isMusic ? "music" : "video"}
                              currentAudioUrl={audioUrl}
                              currentVideoUrl={videoUrl}
                              currentLyrics={isMusic ? (order.lyrics || primaryTrack?.lyrics || "") : ""}
                              customerEmail={order.email || email}
                              shopifyOrderId={order.shopifyOrderId || ""}
                              shopifyOrderNumber={order.shopifyOrderNumber || ""}
                              musicId={order.musicId || ""}
                              songTitle={order.occasion || primaryTrack?.title || "Custom Song"}
                              currentVersion={order.currentVersion || (order.revisions?.length ? Math.max(...order.revisions.map(r => r.version || 0)) : 1)}
                              revisionsCount={order.revisions?.length || 0}
                              onSuccess={(newRev) => handleRevisionCreated(order._id || order.videoId || order.musicId, newRev, isMusic)}
                            />
                          )}

                          <Link
                            href={order.detailUrl}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 transition"
                          >
                            <span>{order.isDraft ? "View Session" : "Details"}</span>
                            <FiExternalLink size={12} />
                          </Link>
                        </div>
                      </div>

                      {/* Content Preview: Audio or Video */}
                      {isMusic && (
                        <div className="space-y-3">
                          {audioUrl && (
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5 bg-orange-50/50 dark:bg-gray-900/50 p-3.5 rounded-2xl border border-orange-100 dark:border-gray-800">
                              {primaryTrack?.imageUrl && (
                                <button
                                  type="button"
                                  onClick={() => setMediaModal({ type: "image", url: primaryTrack.imageUrl, title: `${order.occasion || "Song Artwork"}` })}
                                  className="relative h-12 w-12 rounded-md overflow-hidden shrink-0 group border border-orange-200 dark:border-gray-700 cursor-pointer"
                                  title="Click to view full cover art"
                                >
                                  <img src={primaryTrack.imageUrl} alt="Album Art" className="h-full w-full object-cover group-hover:scale-105 transition" />
                                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition">
                                    <FiEye size={16} />
                                  </div>
                                </button>
                              )}

                              <div className="flex-1 min-w-0 w-full space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs text-brand-600 dark:text-brand-400 font-semibold flex items-center gap-1.5">
                                    <FiMusic size={14} /> Delivered Track (v{currentVer})
                                  </span>
                                </div>
                                <audio controls src={audioUrl} className="h-9 w-full" preload="metadata" />
                              </div>

                              <ForceDownloadButton
                                url={audioUrl}
                                filename={`${order.occasion || "custom-song"} - v${currentVer}.mp3`}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-brand-500 text-white hover:bg-brand-600 shrink-0"
                              >
                                <FiDownload size={14} /> Download Audio
                              </ForceDownloadButton>
                            </div>
                          )}

                          {/* If Music Order has Video deliverable / revision */}
                          {videoUrl && (
                            <div className="rounded-2xl border border-brand-200/80 bg-brand-50/20 p-4 dark:border-gray-800 dark:bg-gray-900/40 space-y-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-brand-600 dark:text-brand-400 font-semibold flex items-center gap-1.5">
                                  <FiVideo size={14} /> Delivered Video Version
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setMediaModal({ type: "video", url: videoUrl, title: `${order.occasion || "Music Video"} - v${currentVer}` })}
                                    className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium inline-flex items-center gap-1"
                                  >
                                    <FiMaximize2 size={12} /> Theater Mode
                                  </button>
                                  <ForceDownloadButton
                                    url={videoUrl}
                                    filename={`${order.occasion || "custom-song-video"} - v${currentVer}.mp4`}
                                    className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 font-semibold inline-flex items-center gap-1"
                                  >
                                    <FiDownload size={12} /> Download Video
                                  </ForceDownloadButton>
                                </div>
                              </div>
                              <div className="aspect-video w-full rounded-md bg-black overflow-hidden shadow-inner max-h-80">
                                <video controls src={videoUrl} className="w-full h-full object-contain" />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {!isMusic && (
                        <div className="space-y-4">
                          {/* Top Grid: Video Player + Audio Track */}
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Main Video Cinema Player (2 Columns) */}
                            <div className="lg:col-span-2 space-y-2 rounded-2xl bg-brand-50/20 p-4 dark:bg-gray-900/40 border border-brand-100/60 dark:border-gray-800">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-brand-600 dark:text-brand-400 font-bold flex items-center gap-1.5">
                                  <FiVideo size={15} /> Final Video Production (v{currentVer})
                                </span>
                                <div className="flex items-center gap-2.5">
                                  {videoUrl && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => setMediaModal({ type: "video", url: videoUrl, title: `${order.selectedPackage || "Music Video"} - v${currentVer}` })}
                                        className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-gray-800 border border-brand-200 dark:border-gray-700 hover:bg-brand-50 transition"
                                      >
                                        <FiMaximize2 size={12} /> Theater Mode
                                      </button>
                                      <ForceDownloadButton
                                        url={videoUrl}
                                        filename={`${order.selectedPackage || "video-order"} - v${currentVer}.mp4`}
                                        className="text-xs text-white bg-brand-500 hover:bg-brand-600 font-semibold inline-flex items-center gap-1 px-3 py-1 rounded-lg transition"
                                      >
                                        <FiDownload size={12} /> Download
                                      </ForceDownloadButton>
                                    </>
                                  )}
                                </div>
                              </div>

                              {videoUrl ? (
                                <div className="aspect-video w-full rounded-md bg-black overflow-hidden max-h-96">
                                  <video controls src={videoUrl} className="w-full h-full object-contain" />
                                </div>
                              ) : (
                                <div className="aspect-video w-full rounded-md bg-gray-100 dark:bg-gray-800/80 flex flex-col items-center justify-center p-6 text-center text-gray-400 max-h-64 border border-dashed border-gray-200 dark:border-gray-700">
                                  <FiFilm size={32} className="text-purple-400/60 mb-2 animate-pulse" />
                                  <p className="font-semibold text-xs text-gray-600 dark:text-gray-300">Video Render in Progress</p>
                                  <p className="text-[11px] text-gray-400 mt-0.5">Final video will appear here once rendered. Use the Revision button above to upload completed video.</p>
                                </div>
                              )}
                            </div>

                            {/* Source Audio & Overview (1 Column) */}
                            <div className="space-y-3 flex flex-col justify-between rounded-2xl bg-orange-50/40 p-4 dark:bg-gray-900/40 border border-orange-100/80 dark:border-gray-800">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-brand-600 dark:text-brand-400 font-bold flex items-center gap-1.5">
                                    <FiMusic size={14} /> Source Song Audio
                                  </span>
                                  {audioUrl && (
                                    <ForceDownloadButton
                                      url={audioUrl}
                                      filename={`${order.selectedPackage || "video-audio"}.mp3`}
                                      className="text-[11px] text-brand-600 hover:text-brand-700 dark:text-brand-400 font-semibold inline-flex items-center gap-1"
                                    >
                                      <FiDownload size={11} /> Download
                                    </ForceDownloadButton>
                                  )}
                                </div>

                                {audioUrl ? (
                                  <audio controls src={audioUrl} className="h-9 w-full mt-1" />
                                ) : (
                                  <div className="h-12 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">
                                    No source audio provided
                                  </div>
                                )}

                                {order.audioFile?.name && (
                                  <p className="text-[11px] text-gray-500 truncate" title={order.audioFile.name}>
                                    File: {order.audioFile.name}
                                  </p>
                                )}
                              </div>

                              {/* Customer Assets Summary */}
                              <div className="pt-3 border-t border-orange-200/60 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 space-y-1.5">
                                <div className="flex justify-between">
                                  <span>Customer Photos:</span>
                                  <strong className="text-blue-600 dark:text-blue-400">{photoCount} files</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span>Raw Video Clips:</span>
                                  <strong className="text-purple-600 dark:text-purple-400">{rawVideoCount} files</strong>
                                </div>
                                {order.orderNotes && (
                                  <div className="mt-2 p-2 bg-white/80 dark:bg-gray-800 rounded-lg text-[11px] text-gray-600 dark:text-gray-300">
                                    <strong>Notes:</strong> {order.orderNotes}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Customer Uploaded Media Gallery (Photos & Raw Clips) */}
                          {mediaFiles.length > 0 && (
                            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/30 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setExpandedMediaOrder((prev) => ({ ...prev, [order._id]: !prev[order._id] }))}
                                className="w-full flex items-center justify-between p-3.5 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-left cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <FiFolder className="text-brand-500" size={16} />
                                  <span className="text-xs font-bold text-gray-800 dark:text-white">
                                    Customer Uploaded Assets ({mediaFiles.length} files: {photoCount} photos, {rawVideoCount} videos)
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-brand-600 font-semibold">
                                  <span>{expandedMediaOrder[order._id] ? "Collapse Files" : "View & Download All Assets"}</span>
                                  {expandedMediaOrder[order._id] ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                                </div>
                              </button>

                              {expandedMediaOrder[order._id] && (
                                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                  {mediaFiles.map((m, mIdx) => {
                                    const isImg = m.type === "image" || (!m.type && m.mimeType?.startsWith("image"));
                                    const isVid = m.type === "video" || (!m.type && m.mimeType?.startsWith("video"));
                                    const fileUrl = m.url || "";

                                    return (
                                      <div
                                        key={m._id || m.key || `media-${mIdx}`}
                                        className="group relative rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-hidden flex flex-col justify-between"
                                      >
                                        <div className="relative aspect-square w-full bg-black/10 overflow-hidden flex items-center justify-center">
                                          {/* Sequence Order Badge */}
                                          <div className="absolute top-1.5 left-1.5 z-10">
                                            <span
                                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold shadow-sm ${
                                                isVid ? "bg-purple-600 text-white" : "bg-blue-600 text-white"
                                              }`}
                                            >
                                              <span>#{mIdx + 1}</span>
                                              <span className="text-[8px] uppercase tracking-wider font-semibold opacity-90">{isVid ? "Video" : "Photo"}</span>
                                            </span>
                                          </div>

                                          {isImg && fileUrl ? (
                                            <img src={fileUrl} alt={m.name || "Customer photo"} className="h-full w-full object-cover group-hover:scale-105 transition" />
                                          ) : isVid && fileUrl ? (
                                            <video src={fileUrl} className="h-full w-full object-cover" />
                                          ) : (
                                            <div className="text-gray-400 flex flex-col items-center gap-1 text-[10px]">
                                              {isVid ? <FiVideo size={20} /> : <FiImage size={20} />}
                                              <span>No preview</span>
                                            </div>
                                          )}

                                          {fileUrl && (
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition">
                                              <button
                                                type="button"
                                                onClick={() => setMediaModal({ type: isVid ? "video" : "image", url: fileUrl, title: m.name || `Media ${mIdx + 1}` })}
                                                className="p-1.5 bg-white text-gray-900 rounded-lg hover:scale-110 transition shadow"
                                                title="Preview Full Size"
                                              >
                                                <FiEye size={14} />
                                              </button>
                                              <ForceDownloadButton
                                                url={fileUrl}
                                                filename={m.name || `media-${mIdx + 1}.${isVid ? "mp4" : "jpg"}`}
                                                className="p-1.5 bg-brand-500 text-white rounded-lg hover:scale-110 transition shadow"
                                                title="Download File"
                                              >
                                                <FiDownload size={14} />
                                              </ForceDownloadButton>
                                            </div>
                                          )}
                                        </div>

                                        <div className="p-1.5 bg-white dark:bg-gray-800 text-[10px]">
                                          <p className="truncate font-medium text-gray-700 dark:text-gray-300" title={m.name}>
                                            {m.name || `File ${mIdx + 1}`}
                                          </p>
                                          <p className="text-gray-400 capitalize">
                                            {isVid ? "Video" : "Photo"} {m.size ? `• ${(m.size / (1024 * 1024)).toFixed(1)}MB` : ""}
                                          </p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Revisions History Accordion if revisions exist */}
                      {order.revisions && order.revisions.length > 0 && (
                        <OrderRevisionHistory
                          revisions={order.revisions}
                          currentVersion={currentVer}
                          activeAudioUrl={audioUrl}
                          activeVideoUrl={videoUrl}
                          activeLyrics={isMusic ? (order.lyrics || primaryTrack?.lyrics) : ""}
                          orderTitle={isMusic ? order.occasion : order.selectedPackage}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: GENERATED SONGS SECTION */}
        {activeTab === "songs" && (
          <div className="space-y-4">
            {filteredGeneratedSongs.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-500 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="flex flex-col items-center justify-center gap-2">
                  <FiMusic size={28} className="text-gray-300 dark:text-gray-600" />
                  <p className="font-medium text-xs">No generated songs match your criteria.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {filteredGeneratedSongs.map((song, sIdx) => {
                  const tracks = song.musicTracks || [];
                  const activeTrack = tracks.find((t) => t.id === song.selectedDemo) || tracks.find((t) => t.audioUrl || t.streamAudioUrl) || tracks[0] || {};
                  const fullSong = activeTrack.audioUrl || "";
                  const previewSong = activeTrack.streamAudioUrl || "";
                  const isTempExpired = fullSong.includes("tempfile.aiquickdraw.com");
                  const audioUrl = (fullSong && !isTempExpired ? fullSong : (previewSong || fullSong || song.audioUrl || ""));
                  const songLyrics = song.lyrics || activeTrack.lyrics;
                  const isPaid = song.status === "paid" || song.status === "fulfilled";
                  const songId = song._id || `song-${sIdx}`;

                  return (
                    <div
                      key={songId}
                      className="rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] space-y-3 hover:border-brand-300 transition"
                    >
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-gray-900 dark:text-white">
                              {song.occasion || "Custom Song"} {song.recipientName ? `for ${song.recipientName}` : ""}
                            </span>
                            <Badge
                              size="sm"
                              color={
                                isPaid
                                  ? "success"
                                  : song.status === "in_cart"
                                    ? "info"
                                    : song.status === "created"
                                      ? "light"
                                      : "warning"
                              }
                            >
                              {song.status || "created"}
                            </Badge>
                            {song.shopifyOrderId && (
                              <span className="text-[11px] font-mono text-gray-600 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                                Shopify {song.shopifyOrderNumber ? (String(song.shopifyOrderNumber).startsWith("#") ? song.shopifyOrderNumber : `#${song.shopifyOrderNumber}`) : `#${song.shopifyOrderId}`}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 capitalize mt-0.5 font-mono">
                            {[song.genre, song.voice, song.mood, song.language].filter(Boolean).join(" • ") || "No style specified"} &bull; Generated on {song.createdAt ? new Date(song.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                          </p>
                        </div>

                        {song.shopifyOrderId && (
                          <Link
                            href={`/orders/music/${song.shopifyOrderId}`}
                            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-semibold dark:text-brand-400"
                          >
                            Order Details <FiExternalLink size={12} />
                          </Link>
                        )}
                      </div>

                      {/* Audio Player Bar */}
                      {audioUrl && (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-gray-50/80 dark:bg-gray-900/40 p-2.5 rounded-md border border-gray-100 dark:border-gray-800">
                          <audio controls src={audioUrl} className="h-8 w-full min-w-0" />
                          <ForceDownloadButton
                            url={audioUrl}
                            filename={`${song.occasion || "custom-song"} - My Own Songs.mp3`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 text-white hover:bg-brand-600 shrink-0"
                          >
                            <FiDownload size={13} /> Download
                          </ForceDownloadButton>
                        </div>
                      )}

                      {/* Expandable Lyrics */}
                      {songLyrics && (
                        <div className="rounded-md border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/20">
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => toggleLyrics(songId)}
                              className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 cursor-pointer"
                            >
                              <FiFileText size={14} />
                              <span>{expandedLyrics[songId] ? "Hide Lyrics" : "View Generated Lyrics"}</span>
                              {expandedLyrics[songId] ? <FiChevronUp size={15} /> : <FiChevronDown size={15} />}
                            </button>

                            {expandedLyrics[songId] && (
                              <button
                                type="button"
                                onClick={() => handleCopyLyrics(songId, songLyrics)}
                                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-brand-500 transition cursor-pointer"
                              >
                                {copiedLyricsId === songId ? <FiCheck size={12} className="text-emerald-500" /> : <FiCopy size={12} />}
                                <span>Copy Lyrics</span>
                              </button>
                            )}
                          </div>

                          {expandedLyrics[songId] && (
                            <pre className="mt-2 text-[11px] whitespace-pre-wrap font-mono max-h-48 overflow-y-auto text-gray-700 dark:text-gray-300 p-2.5 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800">
                              {songLyrics}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full Media Preview Modal (Theater / Lightbox Mode) */}
      <Modal isOpen={Boolean(mediaModal)} onClose={() => setMediaModal(null)} className="max-w-4xl p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3.5 pr-20 min-h-[44px]">
            <h4 className="text-sm font-bold text-gray-800 dark:text-white truncate max-w-xs sm:max-w-md">
              {mediaModal?.title || "Media Preview"}
            </h4>
            <div className="flex items-center gap-3">
              {mediaModal?.url && (
                <ForceDownloadButton
                  url={mediaModal.url}
                  filename={mediaModal.title ? `${mediaModal.title}.${mediaModal.type === "video" ? "mp4" : "jpg"}` : "download"}
                  className="text-xs text-white bg-brand-500 hover:bg-brand-600 px-3.5 py-2 rounded-md font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <FiDownload size={13} /> Download
                </ForceDownloadButton>
              )}
            </div>
          </div>

          <div className="w-full flex items-center justify-center bg-black/90 rounded-2xl overflow-hidden min-h-[300px] max-h-[75vh]">
            {mediaModal?.type === "video" ? (
              <video controls autoPlay src={mediaModal?.url} className="w-full max-h-[75vh] object-contain" />
            ) : (
              <img src={mediaModal?.url} alt={mediaModal?.title || "Preview"} className="max-h-[75vh] max-w-full object-contain" />
            )}
          </div>
        </div>
      </Modal>

      {/* Block Confirmation Modal */}
      <Modal isOpen={isBlockModalOpen} onClose={() => setIsBlockModalOpen(false)} className="max-w-md p-6">
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400 mx-auto">
            <FiShieldOff size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">Block Customer Account</h4>
            <p className="text-xs text-gray-500 mt-1">
              Are you sure you want to block <strong>{email}</strong>? They will not be able to generate music or place new orders.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Reason for Blocking (Optional):
            </label>
            <textarea
              rows={3}
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="e.g., Abuse of generation limits, chargebacks, automated bot..."
              className="w-full text-xs p-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsBlockModalOpen(false)} disabled={isUpdatingStatus}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={handleToggleBlock} disabled={isUpdatingStatus}>
              {isUpdatingStatus ? "Updating..." : "Yes, Block Account"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
