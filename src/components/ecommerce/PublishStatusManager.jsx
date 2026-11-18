"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FaSpotify } from "react-icons/fa";
import { FiCheck, FiClock, FiLoader } from "react-icons/fi";
import { useToast } from "@/components/ui/toast/Toast";

export default function PublishStatusManager({
  orderId,
  orderNumber,
  customerEmail,
  initialStatus = "pending",
  isDelivered = false,
}) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const showToast = useToast();

  const handleStatusChange = async (newStatus) => {
    setLoading(true);
    try {
      const res = await fetch("/api/orders/publish/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          orderNumber,
          email: customerEmail,
          status: newStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update status");
      }
      setStatus(newStatus);
      showToast({
        variant: "success",
        title: "Status Updated",
        message:
          newStatus === "in_progress"
            ? "Order marked as Uploaded to Spotify (In Progress)."
            : "Order status updated to Pending.",
      });
      router.refresh();
    } catch (err) {
      showToast({
        variant: "error",
        title: "Update Failed",
        message: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (isDelivered || status === "delivered") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
        <FiCheck size={13} />
        Delivered to Customer
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      {status === "in_progress" ? (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
          <FaSpotify className="text-[#1DB954]" size={13} />
          In Progress (Uploaded to Spotify)
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
          <FiClock size={13} />
          Pending Distributor Upload
        </span>
      )}

      {status === "in_progress" ? (
        <button
          type="button"
          onClick={() => handleStatusChange("pending")}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline transition cursor-pointer"
        >
          {loading ? "Updating..." : "Revert to Pending"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => handleStatusChange("in_progress")}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-xs transition cursor-pointer"
        >
          {loading ? (
            <FiLoader className="animate-spin" size={13} />
          ) : (
            <FaSpotify size={13} />
          )}
          <span>Mark Uploaded to Spotify</span>
        </button>
      )}
    </div>
  );
}
