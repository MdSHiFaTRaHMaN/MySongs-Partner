"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/button/Button";
import { useToast } from "@/components/ui/toast/Toast";
import { FiSend, FiCheckCircle, FiClock, FiAlertCircle, FiSearch, FiXCircle, FiRefreshCw } from "react-icons/fi";
import { Modal } from "@/components/ui/modal";
import Badge from "@/components/ui/badge/Badge";

export default function DeliverVideoButton({ order, onStatusChanged }) {
  const showToast = useToast();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isFulfilling, setIsFulfilling] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [klaviyoData, setKlaviyoData] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [orderState, setOrderState] = useState(order);

  // Sync state if order prop changes or video is uploaded in real time
  React.useEffect(() => {
    setOrderState(order);
  }, [order]);

  React.useEffect(() => {
    const handleVideoUpdated = (e) => {
      if (e.detail) {
        setOrderState((prev) => ({
          ...prev,
          finalVideoKey: e.detail.finalVideoKey !== undefined ? e.detail.finalVideoKey : prev.finalVideoKey,
          finalVideoUrl: e.detail.finalVideoUrl !== undefined ? e.detail.finalVideoUrl : prev.finalVideoUrl,
          status: e.detail.status !== undefined ? e.detail.status : prev.status,
          currentVersion: e.detail.currentVersion !== undefined ? e.detail.currentVersion : prev.currentVersion,
        }));
      }
    };

    window.addEventListener("video-order-updated", handleVideoUpdated);
    return () => window.removeEventListener("video-order-updated", handleVideoUpdated);
  }, []);

  const isReady = !!orderState.finalVideoUrl || !!orderState.finalVideoKey;
  const isDelivered = orderState.status === "delivering" || orderState.deliveryEmailSent;
  const isFulfilled = orderState.status === "fulfilled";
  const customerEmail = order.email;
  const targetDeliverId = encodeURIComponent(order.videoId || order._id || order.shopifyOrderId || order.shopifyOrderNumber || "");
  const orderNumber = order.shopifyOrderNumber || "";

  const handleDeliver = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/video-orders/${targetDeliverId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to trigger Klaviyo video delivery");
      }

      setOrderState((prev) => ({ ...prev, status: "delivering", deliveryEmailSent: true }));
      showToast({
        variant: "success",
        title: "Delivery Email Sent to Klaviyo",
        message: "Video delivery event sent to Klaviyo! Shopify order will be fulfilled upon email webhook trigger.",
      });

      setIsConfirmOpen(false);
      router.refresh();
      if (onStatusChanged) onStatusChanged(data.order);
    } catch (error) {
      console.error("Delivery error:", error);
      showToast({
        variant: "error",
        title: "Delivery Failed",
        message: error.message || "Failed to send delivery email",
      });
    } finally {
      setLoading(false);
    }
  };

  const checkKlaviyoDelivery = async () => {
    if (!customerEmail) {
      showToast({ variant: "error", title: "Error", message: "No customer email found." });
      return;
    }

    setIsChecking(true);
    setCheckError(null);
    setIsStatusModalOpen(true);

    try {
      const res = await fetch("/api/klaviyo/verify-delivery", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: String(order.shopifyOrderId || order.videoId || ""),
          email: customerEmail,
          orderNumber: orderNumber,
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
    const fulfillId = order.shopifyOrderId;
    if (!fulfillId) {
      showToast({ variant: "error", title: "Error", message: "No linked Shopify Order ID to fulfill." });
      return;
    }
    setIsFulfilling(true);

    try {
      // 1. Re-verify with Klaviyo that the email was actually delivered
      const checkRes = await fetch("/api/klaviyo/verify-delivery", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: String(order.shopifyOrderId || order.videoId || ""),
          email: customerEmail,
          orderNumber: orderNumber,
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
      const res = await fetch(`/api/shopify/fulfill/${fulfillId}`, {
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
        setOrderState((prev) => ({ ...prev, status: "fulfilled" }));
        setKlaviyoData((prev) => ({
          ...prev,
          fulfillmentResult: { success: true },
        }));
        router.refresh();
        if (onStatusChanged) onStatusChanged({ ...orderState, status: "fulfilled" });
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
  const isNowFulfilled = isFulfilled || klaviyoData?.fulfillmentResult?.success || orderState.status === "fulfilled";
  const hasShopifyOrder = Boolean(order.shopifyOrderId || order.shopifyOrderNumber);
  const isDraftOrUnplaced = !hasShopifyOrder || orderState.status === "created" || orderState.status === "in_cart";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base lg:text-lg font-semibold text-gray-800 dark:text-white/90">
              Customer Delivery & Klaviyo Automation
            </h3>
            {!hasShopifyOrder && (
              <Badge size="sm" color="light">Draft / Unplaced</Badge>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {hasShopifyOrder
              ? "Deliver completed music video download link to customer via Klaviyo email flow"
              : "This video was created directly in the tool and is not linked to a placed Shopify order."}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
          {/* Check Klaviyo Delivery Button (Only for placed Shopify orders) */}
          {hasShopifyOrder && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => checkKlaviyoDelivery(true)}
              disabled={isChecking}
              startIcon={<FiSearch size={15} />}
            >
              {isChecking ? "Checking..." : "Check Klaviyo Delivery"}
            </Button>
          )}

          {isNowFulfilled ? (
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
              <div className="inline-flex items-center justify-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20 whitespace-nowrap shrink-0">
                <FiCheckCircle size={16} />
                Order Fulfilled in Shopify
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => setIsConfirmOpen(true)}
                disabled={!isReady || loading}
                startIcon={<FiSend size={15} />}
              >
                {orderState.currentVersion > 1
                  ? `Deliver Revision v${orderState.currentVersion} via Klaviyo`
                  : "Deliver via Klaviyo"}
              </Button>
            </div>
          ) : isDelivered ? (
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
              <div className="inline-flex items-center justify-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20 whitespace-nowrap shrink-0">
                <FiClock size={16} />
                Delivering via Klaviyo
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsConfirmOpen(true)}
                disabled={loading}
                startIcon={<FiRefreshCw size={14} />}
              >
                {orderState.currentVersion > 1
                  ? `Resend Revision v${orderState.currentVersion}`
                  : "Resend Event"}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setIsConfirmOpen(true)}
              disabled={!isReady || loading}
              startIcon={<FiSend size={15} />}
            >
              {orderState.currentVersion > 1
                ? `Deliver Revision v${orderState.currentVersion} to Customer`
                : "Deliver to Customer"}
            </Button>
          )}
        </div>
      </div>

      {!isReady && !isNowFulfilled && (
        <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 text-xs dark:bg-amber-500/10 dark:text-amber-400">
          <FiAlertCircle size={16} className="shrink-0" />
          <span>Upload the completed final video above before you can send delivery to the customer.</span>
        </div>
      )}

      {/* Confirmation Modal to Send Delivery Event */}
      <Modal isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)} className="max-w-md p-6">
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 mx-auto">
            <FiSend size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              {orderState.currentVersion > 1
                ? `Deliver Revision v${orderState.currentVersion} to Customer?`
                : "Deliver Music Video to Customer?"}
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              This will send the <strong>Video_Delivered</strong> event with the latest video (v{orderState.currentVersion || 1}) download link to Klaviyo for <strong>{order.email}</strong>.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              The customer will receive an email notification with the direct download link for this revision.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="outline" size="sm" onClick={() => setIsConfirmOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleDeliver} disabled={loading} startIcon={loading ? <FiRefreshCw className="animate-spin" size={14} /> : <FiSend size={14} />}>
              {loading ? "Sending Event..." : "Confirm & Deliver"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Klaviyo Verification Modal */}
      <Modal isOpen={isStatusModalOpen} onClose={() => setIsStatusModalOpen(false)} className="max-w-2xl p-6 sm:p-8">
        <div>
          <div className="flex items-center justify-between border-b border-gray-100 pb-4 dark:border-gray-800">
            <div>
              <h3 className="text-xl font-bold text-gray-800 dark:text-white/90">
                Klaviyo Email Delivery Status
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Order {String(orderNumber || order.shopifyOrderId || order.videoId || "").replace(/^#*/, "#")} &bull; {customerEmail}
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
              <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400 flex items-start gap-3">
                <FiAlertCircle className="mt-0.5 shrink-0" size={18} />
                <div>
                  <p className="font-semibold">Failed to verify Klaviyo status</p>
                  <p className="mt-1 text-xs">{checkError}</p>
                </div>
              </div>
            </div>
          ) : klaviyoData ? (
            <div className="py-6 space-y-5">
              {/* Delivered */}
              {status === "delivered" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  <div className="flex items-start gap-3">
                    <FiCheckCircle className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" size={20} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-emerald-800 dark:text-emerald-300 text-sm">
                          Email Delivered to Customer
                        </span>
                        <Badge size="sm" color="success">Delivered</Badge>
                      </div>
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                        {klaviyoData.message}
                      </p>
                      {isNowFulfilled ? (
                        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          <FiCheckCircle size={14} /> Shopify order is marked as <strong>Fulfilled</strong>
                        </div>
                      ) : (
                        <div className="mt-3 pt-2 border-t border-emerald-200/60 dark:border-emerald-500/20 flex items-center gap-3">
                          <Button
                            size="sm"
                            onClick={handleVerifyAndFulfill}
                            disabled={isFulfilling}
                            startIcon={<FiCheckCircle size={14} />}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-theme-xs"
                          >
                            {isFulfilling ? "Fulfilling..." : "Verify Delivery & Fulfill Shopify Order"}
                          </Button>
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
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={checkKlaviyoDelivery}
                          disabled={isChecking}
                          startIcon={<FiRefreshCw size={13} className={isChecking ? "animate-spin" : ""} />}
                        >
                          Re-check Status
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIsStatusModalOpen(false);
                            setIsConfirmOpen(true);
                          }}
                          startIcon={<FiRefreshCw size={14} />}
                        >
                          Re-send Event to Klaviyo
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Dropped / Bounced */}
              {(status === "dropped" || status === "bounced") && (
                <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-500/20 dark:bg-red-500/10">
                  <div className="flex items-start gap-3">
                    <FiXCircle className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" size={20} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-red-800 dark:text-red-300 text-sm">
                          {status === "dropped" ? "Email Dropped by Klaviyo" : "Email Bounced"}
                        </span>
                        <Badge size="sm" color="error">{status.toUpperCase()}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-red-700 dark:text-red-400 font-medium">
                        Reason: {klaviyoData.klaviyoStatus?.reason || "Delivery blocked by mail filter or suppression list."}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setIsStatusModalOpen(false);
                            setIsConfirmOpen(true);
                          }}
                          startIcon={<FiRefreshCw size={14} />}
                          className="bg-rose-600 hover:bg-rose-700 text-white shadow-theme-xs"
                        >
                          Re-send Delivery Event
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Not Found */}
              {(status === "not_found" || status === "no_delivery_event") && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
                  <div className="flex items-start gap-3">
                    <FiAlertCircle className="text-gray-500 mt-0.5 shrink-0" size={20} />
                    <div className="flex-1">
                      <span className="font-semibold text-gray-800 dark:text-white/90 text-sm">
                        No Delivery Event in Klaviyo
                      </span>
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                        {klaviyoData.message}
                      </p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setIsStatusModalOpen(false);
                            setIsConfirmOpen(true);
                          }}
                          disabled={!isReady}
                          startIcon={<FiSend size={14} />}
                        >
                          Send Delivery Email Now
                        </Button>
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => checkKlaviyoDelivery(true)}
              disabled={isChecking}
              startIcon={<FiRefreshCw className={isChecking ? "animate-spin" : ""} size={14} />}
            >
              Re-check Status
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsStatusModalOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
