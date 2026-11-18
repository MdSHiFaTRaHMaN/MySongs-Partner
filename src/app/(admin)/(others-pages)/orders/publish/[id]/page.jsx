import React from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import BackButton from "@/components/common/BackButton";
import { getSettings } from "@/lib/getSettings";
import Badge from "@/components/ui/badge/Badge";
import Link from "next/link";
import { notFound } from "next/navigation";
import FulfillmentManager from "@/components/ecommerce/FulfillmentManager";
import DeliverPublishOrderButton from "@/components/ecommerce/DeliverPublishOrderButton";
import { resolveOriginalOrder } from "@/lib/resolveOriginalOrder";
import ForceDownloadButton from "@/components/common/ForceDownloadButton";
import CollapsibleLyrics from "@/components/common/CollapsibleLyrics";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Notification from "@/models/Notification";
import PublishStatusManager from "@/components/ecommerce/PublishStatusManager";
import { FiExternalLink, FiUser, FiPackage, FiDollarSign, FiMapPin, FiMail, FiPhone, FiMusic, FiDownload } from "react-icons/fi";

export const metadata = {
  title: "Shopify Order Details | Dashboard",
  description: "Detailed view of a Shopify order",
};

export const dynamic = "force-dynamic";

export default async function OtherOrderDetailsPage({ params }) {
  const { id } = await params;
  const settings = await getSettings();
  let orderInfo = null;
  let errorMsg = null;

  const cleanId = String(id).replace(/^#/, "").trim();

  if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) {
    errorMsg = "Shopify integration is not configured. Please add Shop URL and Admin API Key in Settings.";
  } else {
    try {
      let url = settings.shopUrl1;
      if (!url.startsWith("http")) url = `https://${url}`;

      const response = await fetch(`${url}/admin/api/2024-04/orders/${cleanId}.json`, {
        headers: {
          "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      const data = await response.json();

      if (response.ok && data.order) {
        orderInfo = data.order;
      } else {
        // Fallback: If cleanId was the order name/number (e.g. 217279), search by name
        const searchRes = await fetch(`${url}/admin/api/2024-04/orders.json?name=${encodeURIComponent(cleanId)}&status=any`, {
          headers: {
            "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const matched = (searchData.orders || []).find(
            (o) =>
              String(o.order_number) === cleanId ||
              String(o.name || "").replace(/^#/, "") === cleanId ||
              String(o.id) === cleanId
          );
          if (matched) {
            orderInfo = matched;
          } else {
            errorMsg = data.errors ? JSON.stringify(data.errors) : "Failed to fetch order from Shopify.";
          }
        } else {
          errorMsg = data.errors ? JSON.stringify(data.errors) : "Failed to fetch order from Shopify.";
        }
      }
    } catch (err) {
      console.error("[OtherOrderDetails Error]:", err);
      errorMsg = "An error occurred while fetching the order.";
    }
  }

  if (errorMsg) {
    return (
      <div>
        <PageBreadcrumb pageTitle="Shopify Order Details" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="p-4 rounded bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 text-sm">
            {errorMsg}
          </div>
          <BackButton fallbackUrl="/orders/publish" className="mt-4 inline-block text-brand-500 hover:text-brand-600 underline text-sm">
            ← Back to Other Orders
          </BackButton>
        </div>
      </div>
    );
  }

  if (!orderInfo) return notFound();

  // Resolve original music order and final tracks for line items
  let firstResolvedTrack = null;
  const resolvedLineItems = await Promise.all(
    (orderInfo.line_items || []).map(async (item) => {
      const resolved = await resolveOriginalOrder(item.properties, orderInfo.note_attributes, settings);
      if (resolved?.finalTrack && !firstResolvedTrack) {
        firstResolvedTrack = resolved.finalTrack;
      }
      return {
        ...item,
        resolvedOriginal: resolved,
      };
    })
  );

  // Look up MongoDB record for this publish order to retrieve publishLinks and klaviyoSent status
  await dbConnect();

  const cleanOrderName = String(orderInfo.name || "").replace(/^#/, "").trim();
  const cleanOrderNum = String(orderInfo.order_number || "").replace(/^#/, "").trim();
  const cleanShopifyIdStr = String(orderInfo.id || "").replace(/^#/, "").trim();

  const orderSearchConditions = [
    { shopifyOrderId: cleanShopifyIdStr },
    { shopifyOrderId: `#${cleanShopifyIdStr}` },
    { shopifyOrderId: cleanId },
    { shopifyOrderId: `#${cleanId}` },
    { shopifyOrderNumber: orderInfo.name },
    { shopifyOrderNumber: cleanOrderName },
    { shopifyOrderNumber: `#${cleanOrderName}` },
    { shopifyOrderNumber: cleanOrderNum },
    { shopifyOrderNumber: `#${cleanOrderNum}` },
    { shopifyOrderNumber: cleanId },
    { shopifyOrderNumber: `#${cleanId}` },
    ...(cleanId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: cleanId }] : []),
  ];

  const dbPublishOrder = await Order.findOne({ $or: orderSearchConditions }).lean();

  let isKlaviyoSent = false;
  if (dbPublishOrder) {
    if (dbPublishOrder.publishLinks) {
      orderInfo.publishLinks = dbPublishOrder.publishLinks;
    }
    if (
      dbPublishOrder.deliveryEmailSent === true ||
      dbPublishOrder.status === "delivering" ||
      dbPublishOrder.status === "fulfilled" ||
      (dbPublishOrder.publishLinks &&
        (dbPublishOrder.publishLinks.deliveredAt ||
          (Array.isArray(dbPublishOrder.publishLinks.links) && dbPublishOrder.publishLinks.links.length > 0) ||
          dbPublishOrder.publishLinks.spotifyUrl ||
          dbPublishOrder.publishLinks.appleMusicUrl ||
          dbPublishOrder.publishLinks.youtubeUrl ||
          dbPublishOrder.publishLinks.otherUrl))
    ) {
      isKlaviyoSent = true;
    }
  }

  // Fallback: check if publishLinks were resolved from original order
  if (!orderInfo.publishLinks) {
    for (const item of resolvedLineItems) {
      if (item.resolvedOriginal?.originalOrder?.publishLinks) {
        orderInfo.publishLinks = item.resolvedOriginal.originalOrder.publishLinks;
        if (
          orderInfo.publishLinks.deliveredAt ||
          (Array.isArray(orderInfo.publishLinks.links) && orderInfo.publishLinks.links.length > 0) ||
          orderInfo.publishLinks.spotifyUrl
        ) {
          isKlaviyoSent = true;
        }
        break;
      }
    }
  }

  // Also check if any Notification exists for this publish order delivery
  if (!isKlaviyoSent) {
    try {
      const publishNotif = await Notification.findOne({
        $or: [
          { type: "publish_delivered" },
          { title: /publish/i },
        ],
        $and: [
          {
            $or: [
              { link: { $regex: cleanId } },
              { link: { $regex: cleanShopifyIdStr } },
              ...(cleanOrderName ? [{ message: { $regex: cleanOrderName } }] : []),
              ...(cleanOrderNum ? [{ message: { $regex: cleanOrderNum } }] : []),
            ],
          },
        ],
      }).lean();
      if (publishNotif) {
        isKlaviyoSent = true;
      }
    } catch (e) {
      console.warn("[OtherOrderDetails] Notification search warning:", e?.message);
    }
  }

  orderInfo.klaviyoSent = isKlaviyoSent;

  const shopDomain = settings.shopUrl1 ? settings.shopUrl1.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const shopifyAdminUrl = shopDomain ? `https://${shopDomain}/admin/orders/${orderInfo.id}` : null;
  const displayNumber = orderInfo.name || (orderInfo.order_number ? `#${orderInfo.order_number}` : `#${orderInfo.id}`);

  const formatAddress = (address) => {
    if (!address) return <p className="text-sm text-gray-500">No address provided</p>;
    return (
      <div className="text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
        <p className="font-medium text-gray-800 dark:text-white/90">
          {address.name || `${address.first_name || ""} ${address.last_name || ""}`.trim()}
        </p>
        {address.company && <p>{address.company}</p>}
        {address.address1 && <p>{address.address1}</p>}
        {address.address2 && <p>{address.address2}</p>}
        <p>
          {address.city ? `${address.city}, ` : ""}
          {address.province || ""} {address.zip || ""}
        </p>
        <p>{address.country}</p>
        {address.phone && <p className="text-xs text-gray-400 mt-1">📞 {address.phone}</p>}
      </div>
    );
  };

  const customerName = orderInfo.customer
    ? `${orderInfo.customer.first_name || ""} ${orderInfo.customer.last_name || ""}`.trim() || "Customer"
    : "No Customer Info";

  return (
    <div>
      <PageBreadcrumb pageTitle={`Order ${displayNumber}`} />

      {/* Top Bar Navigation */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
        <BackButton
          fallbackUrl="/orders/publish"
          className="text-gray-500 hover:text-gray-800 dark:hover:text-white transition inline-flex items-center gap-1 text-sm font-medium"
        >
          ← Back to Publish Orders
        </BackButton>

        <div className="flex flex-wrap items-center gap-3">
          <PublishStatusManager
            orderId={orderInfo.id}
            orderNumber={orderInfo.name || orderInfo.order_number}
            customerEmail={orderInfo.email || orderInfo.customer?.email || ""}
            initialStatus={dbPublishOrder?.publishStatus || (isKlaviyoSent ? "delivered" : "pending")}
            isDelivered={isKlaviyoSent}
          />

          <div className="flex items-center gap-2">
            <Badge
              size="sm"
              color={
                orderInfo.financial_status === "paid"
                  ? "success"
                  : orderInfo.financial_status === "pending"
                    ? "warning"
                    : "error"
              }
            >
              {orderInfo.financial_status || "unknown"}
            </Badge>
            <Badge
              size="sm"
              color={orderInfo.fulfillment_status === "fulfilled" ? "success" : "warning"}
            >
              {orderInfo.fulfillment_status || "unfulfilled"}
            </Badge>
          </div>

          {shopifyAdminUrl && (
            <a
              href={shopifyAdminUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-theme-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 transition"
            >
              <span>View in Shopify</span>
              <FiExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Left Column: Fulfillment Manager, Line Items & Cost Summary */}
        <div className="xl:col-span-2 space-y-6">
          {/* Fulfillment Manager */}
          <FulfillmentManager
            orderId={orderInfo.id}
            currentStatus={orderInfo.fulfillment_status}
            klaviyoSent={isKlaviyoSent}
          />

          {/* Line Items Card */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
              <FiPackage className="text-orange-500" />
              Order Items ({resolvedLineItems.length})
            </h3>

            <div className="space-y-6">
              {resolvedLineItems.map((item) => (
                <div key={item.id} className="border-b border-gray-100 dark:border-gray-800 pb-6 last:border-0 last:pb-0">
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <p className="font-medium text-gray-800 dark:text-white/90">{item.title}</p>
                      {item.variant_title && (
                        <p className="text-sm text-gray-500">{item.variant_title}</p>
                      )}
                      {item.sku && (
                        <p className="text-xs text-gray-400 font-mono">SKU: {item.sku}</p>
                      )}

                      {/* Properties list */}
                      {item.properties && item.properties.length > 0 && (
                        <div className="mt-2 space-y-1 text-xs text-gray-500">
                          {item.properties.map((p, idx) => (
                            <div key={idx} className="flex flex-wrap">
                              <span className="font-medium mr-1 text-gray-700 dark:text-gray-400">{p.name}:</span>
                              <span>{String(p.value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-medium text-gray-800 dark:text-white/90">
                        {item.price} {orderInfo.currency}
                      </p>
                      <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                    </div>
                  </div>

                  {/* Linked Original Order Music Track Preview */}
                  {item.resolvedOriginal?.finalTrack && (
                    <div className="mt-4 rounded-xl bg-gray-50 p-4 border border-gray-100 dark:bg-white/[0.02] dark:border-white/[0.05]">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                            <FiMusic size={20} />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                                Selected Music: {item.resolvedOriginal.finalTrack.title || "Custom Song"}
                              </p>
                              <Link
                                href={`/orders/music/${item.resolvedOriginal.originalOrderId || item.resolvedOriginal.originalOrder._id}`}
                                className="text-[11px] font-medium text-brand-600 hover:text-brand-700 underline bg-brand-50 dark:bg-brand-950/40 px-2.5 py-0.5 rounded-full border border-brand-200 dark:border-brand-800"
                              >
                                Linked from Original Order {item.resolvedOriginal.originalOrderNumber} ↗
                              </Link>
                              {item.resolvedOriginal.finalTrack.isRevision ? (
                                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                                  Final Music (Revision v{item.resolvedOriginal.finalTrack.version})
                                </span>
                              ) : (
                                <span className="text-[11px] font-medium text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-300 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700">
                                  Original Track
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Music ID: {item.resolvedOriginal.originalOrder.musicId || "N/A"}
                              {item.resolvedOriginal.finalTrack.totalRevisions > 0 && ` • Total Revisions: ${item.resolvedOriginal.finalTrack.totalRevisions}`}
                            </p>
                          </div>
                        </div>
                      </div>

                      {(item.resolvedOriginal.finalTrack.audioUrl || item.resolvedOriginal.finalTrack.streamAudioUrl) && (
                        <div className="mt-3 flex flex-wrap items-center gap-4">
                          <audio
                            controls
                            controlsList="nodownload noremoteplayback nosaveplayback noplaybackrate nofullscreen"
                            src={item.resolvedOriginal.finalTrack.audioUrl || item.resolvedOriginal.finalTrack.streamAudioUrl}
                            className="h-10 w-full max-w-[320px]"
                          />
                          {(item.resolvedOriginal.finalTrack.audioUrl || item.resolvedOriginal.finalTrack.streamAudioUrl) && (
                            <ForceDownloadButton
                              url={item.resolvedOriginal.finalTrack.audioUrl || item.resolvedOriginal.finalTrack.streamAudioUrl}
                              filename={`${item.resolvedOriginal.finalTrack.title || "music"} - My Own Songs.mp3`}
                              className="flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-600 dark:hover:text-brand-400"
                            >
                              <FiDownload size={16} />
                              Download MP3
                            </ForceDownloadButton>
                          )}
                        </div>
                      )}

                      {/* Lyrics if available */}
                      {item.resolvedOriginal.finalTrack.lyrics && (
                        <div className="mt-3">
                          <CollapsibleLyrics lyrics={item.resolvedOriginal.finalTrack.lyrics} title="Song Lyrics" defaultOpen={false} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Deliver Published Links Section */}
            <div className="mt-4">
              <DeliverPublishOrderButton
                order={orderInfo}
                defaultSongTitle={firstResolvedTrack?.title || ""}
                defaultArtist={customerName !== "No Customer Info" ? customerName : ""}
              />
            </div>
          </div>

          {/* Payment & Cost Summary Card */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
              <FiDollarSign className="text-orange-500" />
              Payment Summary
            </h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Subtotal</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {orderInfo.current_subtotal_price || orderInfo.subtotal_price || "0.00"} {orderInfo.currency}
                </span>
              </div>

              {parseFloat(orderInfo.total_discounts || 0) > 0 && (
                <div className="flex justify-between text-success-600 dark:text-success-400">
                  <span>Discounts</span>
                  <span>-{orderInfo.total_discounts} {orderInfo.currency}</span>
                </div>
              )}

              {orderInfo.total_shipping_price_set && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Shipping</span>
                  <span className="font-medium text-gray-800 dark:text-gray-200">
                    {orderInfo.total_shipping_price_set?.shop_money?.amount || "0.00"} {orderInfo.currency}
                  </span>
                </div>
              )}

              {parseFloat(orderInfo.total_tax || 0) > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Tax</span>
                  <span className="font-medium text-gray-800 dark:text-gray-200">
                    {orderInfo.total_tax} {orderInfo.currency}
                  </span>
                </div>
              )}

              <div className="border-t border-gray-100 dark:border-gray-800 pt-3 flex justify-between font-bold text-base text-gray-800 dark:text-white/90">
                <span>Total Paid</span>
                <span className="text-brand-500">{orderInfo.total_price} {orderInfo.currency}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Customer & Meta Info */}
        <div className="space-y-6">
          {/* Customer Info Card */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
              <FiUser className="text-orange-500" />
              Customer
            </h3>

            <div className="space-y-4">
              <div>
                <p className="font-medium text-brand-500 hover:text-brand-600">
                  {customerName}
                </p>
                {orderInfo.customer && orderInfo.customer.orders_count !== undefined && (
                  <p className="text-sm text-gray-500 mt-0.5">{orderInfo.customer.orders_count} order(s)</p>
                )}
              </div>

              {orderInfo.email && (
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Email Address</span>
                  <div className="flex items-center gap-2 text-sm">
                    <FiMail size={14} className="text-gray-400 shrink-0" />
                    <a href={`mailto:${orderInfo.email}`} className="text-brand-500 hover:underline break-all font-medium">
                      {orderInfo.email}
                    </a>
                  </div>
                </div>
              )}

              {orderInfo.phone && (
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Phone</span>
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <FiPhone size={14} className="text-gray-400 shrink-0" />
                    <span>{orderInfo.phone}</span>
                  </div>
                </div>
              )}

              {(orderInfo.email || orderInfo.customer?.email || orderInfo.customer?.id) && (
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <Link
                    href={`/customers/${encodeURIComponent(orderInfo.email || orderInfo.customer?.email || orderInfo.customer?.id)}`}
                    className="text-xs font-semibold text-brand-500 hover:text-brand-600 hover:underline inline-flex items-center gap-1"
                  >
                    <span>View Customer 360 CRM Profile</span>
                    <span>→</span>
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Shipping Address Card */}
          {orderInfo.shipping_address && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
                <FiMapPin className="text-orange-500" />
                Shipping Address
              </h3>
              {formatAddress(orderInfo.shipping_address)}
            </div>
          )}

          {/* Additional Info / Tags & Notes */}
          {(orderInfo.note || orderInfo.tags || orderInfo.created_at) && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03] space-y-4">
              <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Additional Info</h3>

              <div>
                <span className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Created At</span>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {new Date(orderInfo.created_at).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>

              {orderInfo.tags && (
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Tags</span>
                  <div className="flex flex-wrap gap-2">
                    {orderInfo.tags.split(",").map((tag) => (
                      <Badge key={tag} size="sm" color="light">
                        {tag.trim()}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {orderInfo.note && (
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Order Note</span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                    {orderInfo.note}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
