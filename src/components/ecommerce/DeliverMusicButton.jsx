"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FiSend, FiSearch, FiCheckCircle, FiAlertCircle, FiClock, FiXCircle, FiRefreshCw } from "react-icons/fi";
import { useToast } from "@/components/ui/toast/Toast";
import { Modal } from "@/components/ui/modal";
import Badge from "@/components/ui/badge/Badge";

export default function DeliverMusicButton({ order }) {
  const [isSending, setIsSending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isFulfilling, setIsFulfilling] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [klaviyoData, setKlaviyoData] = useState(null);
  const [checkError, setCheckError] = useState(null);

  const router = useRouter();
  const showToast = useToast();

  const customerEmail = order.email || order.contact_email || order.customer?.email;

  const triggerKlaviyo = async () => {
    if (!customerEmail) {
      showToast({ variant: "error", title: "Error", message: "No email available to send Klaviyo event." });
      return;
    }

    setIsSending(true);

    try {
      const res = await fetch("/api/klaviyo/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          shopifyOrderId: String(order.id), 
          email: customerEmail, 
          orderNumber: order.order_number,
          lineItems: order.line_items,
        })
      });
      const data = await res.json();

      if (res.ok) {
        showToast({ variant: "success", title: "Success", message: "Music delivered successfully via Klaviyo!" });
        router.refresh();
      } else {
        showToast({ variant: "error", title: "Error", message: data.error || "Failed to deliver music." });
      }
    } catch (err) {
      showToast({ variant: "error", title: "Error", message: "Network error occurred." });
    } finally {
      setIsSending(false);
    }
  };

  const checkKlaviyoDelivery = async () => {
    if (!customerEmail) {
      showToast({ variant: "error", title: "Error", message: "No customer email found." });
      return;
    }

    setIsChecking(true);
    setCheckError(null);
    setIsModalOpen(true);

    try {
      const res = await fetch("/api/klaviyo/verify-delivery", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: String(order.id),
          email: customerEmail,
          orderNumber: order.order_number,
          autoFulfill: false, // Pure status check; never auto fulfill
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setKlaviyoData(data);
      } else {
        setCheckError(data.error || "Failed to verify Klaviyo status.");
      }
    } catch (err) {
      setCheckError(err.message || "Network error while checking Klaviyo status.");
    } finally {
      setIsChecking(false);
    }
  };

  const handleVerifyAndFulfill = async () => {
    if (!order.id) return;
    setIsFulfilling(true);

    try {
      // 1. Re-verify with Klaviyo that the email was actually delivered
      const checkRes = await fetch("/api/klaviyo/verify-delivery", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: String(order.id),
          email: customerEmail,
          orderNumber: order.order_number,
          autoFulfill: false,
        }),
      });

      const checkData = await checkRes.json();
      const isEmailDelivered = Boolean(
        checkData?.klaviyoStatus?.emailDelivered || checkData?.klaviyoStatus?.status === "delivered"
      );

      if (!isEmailDelivered) {
        showToast({
          variant: "warning",
          title: "Email Not Delivered Yet",
          message: "Klaviyo has not delivered the email to the customer yet. Order cannot be fulfilled.",
        });
        setKlaviyoData(checkData);
        setIsFulfilling(false);
        return;
      }

      // 2. Email confirmed delivered -> Call Shopify fulfill API
      const res = await fetch(`/api/shopify/fulfill/${order.id}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (res.ok && (data.success || data.alreadyFulfilled || data.message?.includes("Already fulfilled"))) {
        showToast({
          variant: "success",
          title: "Order Fulfilled",
          message: data.alreadyFulfilled ? "Order is already fulfilled in Shopify!" : "Shopify order marked as fulfilled!",
        });
        setKlaviyoData((prev) => ({
          ...prev,
          fulfillmentResult: { success: true },
        }));
        router.refresh();
      } else {
        showToast({ variant: "error", title: "Error", message: data.error || data.message || "Failed to fulfill order." });
      }
    } catch (error) {
      showToast({ variant: "error", title: "Error", message: error.message || "An unexpected error occurred." });
    } finally {
      setIsFulfilling(false);
    }
  };

  const status = klaviyoData?.klaviyoStatus?.status;
  const isFulfilled = order.fulfillment_status === "fulfilled" || klaviyoData?.fulfillmentResult?.success;

  return (
    <>
      <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50/60 p-5 lg:p-6 dark:border-brand-500/20 dark:bg-brand-500/5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-brand-700 dark:text-brand-400">Deliver Music</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              Trigger Klaviyo delivery email or verify real-time email dispatch status and fulfillment.
            </p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
            <button
              type="button"
              onClick={checkKlaviyoDelivery}
              disabled={isChecking}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-brand-300 bg-white px-4 py-2.5 text-xs font-semibold text-brand-700 hover:bg-brand-100/60 dark:border-brand-500/30 dark:bg-gray-800 dark:text-brand-300 dark:hover:bg-brand-500/10 transition disabled:opacity-70 cursor-pointer whitespace-nowrap"
            >
              <FiSearch size={14} />
              <span>{isChecking ? "Checking..." : "Check Klaviyo Delivery"}</span>
            </button>

            <button
              type="button"
              onClick={triggerKlaviyo}
              disabled={isSending}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-brand-600 transition disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              <FiSend size={14} />
              <span>
                {isSending
                  ? "Sending..."
                  : order.currentVersion > 1
                  ? `Deliver Revision v${order.currentVersion} via Klaviyo`
                  : "Deliver Music"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Klaviyo Verification Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} className="max-w-2xl p-6 sm:p-8">
        <div>
          <div className="flex items-center justify-between border-b border-gray-100 pb-4 dark:border-gray-800">
            <div>
              <h3 className="text-xl font-bold text-gray-800 dark:text-white/90">
                Klaviyo Email Delivery Status
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Order {String(order.order_number || "").replace(/^#*/, "#")} &bull; {customerEmail}
              </p>
            </div>
          </div>

          {isChecking ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent"></div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Querying Klaviyo API in real-time...
              </p>
            </div>
          ) : checkError ? (
            <div className="py-6">
              <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400 flex items-start gap-3">
                <FiAlertCircle className="mt-0.5 shrink-0" size={18} />
                <div>
                  <p className="font-semibold">Failed to verify Klaviyo status</p>
                  <p className="mt-1 text-xs">{checkError}</p>
                </div>
              </div>
            </div>
          ) : klaviyoData ? (
            <div className="py-6 space-y-5">
              {/* Primary Status Banner: Email Delivered */}
              {status === "delivered" && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  <div className="flex items-start gap-3">
                    <FiCheckCircle className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" size={22} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-emerald-800 dark:text-emerald-300 text-base">
                          Email Delivered to Customer
                        </span>
                        <Badge size="sm" color="success">Delivered</Badge>
                      </div>
                      <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                        {klaviyoData.message}
                      </p>
                      {isFulfilled ? (
                        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          <FiCheckCircle size={14} /> Shopify order is marked as <strong>Fulfilled</strong>
                        </div>
                      ) : (
                        <div className="mt-3 pt-2 border-t border-emerald-200/60 dark:border-emerald-500/20 flex items-center gap-3">
                          <button
                            onClick={handleVerifyAndFulfill}
                            disabled={isFulfilling}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition shadow-theme-xs disabled:opacity-70"
                          >
                            <FiCheckCircle size={14} />
                            {isFulfilling ? "Fulfilling..." : "Verify Delivery & Fulfill Shopify Order"}
                          </button>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            (Email delivery is verified in Klaviyo)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* In Flow Queue (Delay Step) */}
              {status === "in_flow" && (
                <div className="rounded-md border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                  <div className="flex items-start gap-3">
                    <FiClock className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" size={20} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-amber-800 dark:text-amber-300 text-sm">
                          Event Received by Klaviyo &bull; Email in Delay Queue
                        </span>
                        <Badge size="sm" color="warning">In Flow Queue</Badge>
                      </div>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {klaviyoData.message}
                      </p>
                      <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                        ⚡ <em>The Klaviyo Webhook will automatically fulfill this order in Shopify once the email delay completes and the email is sent out.</em>
                      </p>

                      <div className="mt-3 flex gap-2 flex-wrap items-center">
                        <button
                          onClick={checkKlaviyoDelivery}
                          disabled={isChecking}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-500/30 dark:bg-gray-800 dark:text-amber-300 transition"
                        >
                          <FiRefreshCw size={13} className={isChecking ? "animate-spin" : ""} />
                          Re-check Status
                        </button>
                        <button
                          onClick={triggerKlaviyo}
                          disabled={isSending}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 transition"
                        >
                          {isSending ? "Re-sending..." : "Re-send Event to Klaviyo"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(status === "dropped" || status === "bounced") && (
                <div className="rounded-md border border-red-200 bg-red-50/70 p-4 dark:border-red-500/20 dark:bg-red-500/10">
                  <div className="flex items-start gap-3">
                    <FiXCircle className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" size={22} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-red-800 dark:text-red-300 text-base">
                          {status === "dropped" ? "Email Dropped by Klaviyo" : "Email Bounced"}
                        </span>
                        <Badge size="sm" color="error">{status.toUpperCase()}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-red-700 dark:text-red-400 font-medium">
                        Reason: {klaviyoData.klaviyoStatus?.reason || "Delivery blocked by mail filter or suppression list."}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={triggerKlaviyo}
                          disabled={isSending}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition"
                        >
                          {isSending ? "Re-sending..." : "Re-send Delivery Event"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(status === "not_found" || status === "no_delivery_event") && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
                  <div className="flex items-start gap-3">
                    <FiAlertCircle className="text-gray-500 mt-0.5 shrink-0" size={22} />
                    <div className="flex-1">
                      <span className="font-semibold text-gray-800 dark:text-white/90 text-base">
                        No Delivery Event in Klaviyo
                      </span>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {klaviyoData.message}
                      </p>
                      <div className="mt-3">
                        <button
                          onClick={triggerKlaviyo}
                          disabled={isSending}
                          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 transition"
                        >
                          {isSending ? "Sending..." : "Send Delivery Email Now"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Event Activity History */}
              {klaviyoData.klaviyoStatus?.events?.length > 0 && (
                <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Recent Klaviyo Activity for this Customer
                  </h4>
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900 text-xs">
                    {klaviyoData.klaviyoStatus.events.map((evt, idx) => (
                      <div key={idx} className="p-2.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-brand-500"></span>
                          <span className="font-medium text-gray-800 dark:text-gray-200">{evt.name}</span>
                        </div>
                        <span className="text-gray-400">
                          {evt.datetime ? new Date(evt.datetime).toLocaleString() : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Modal Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
            <button
              onClick={() => checkKlaviyoDelivery(true)}
              disabled={isChecking}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              <FiRefreshCw className={isChecking ? "animate-spin" : ""} size={13} />
              Re-check Status
            </button>
            <button
              onClick={() => setIsModalOpen(false)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
