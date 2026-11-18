import React from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import BackButton from "@/components/common/BackButton";
import { getSettings } from "@/lib/getSettings";
import Badge from "@/components/ui/badge/Badge";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import { generatePresignedUrl } from "@/lib/s3";
import VideoAssetDownloader from "@/components/ecommerce/VideoAssetDownloader";
import VideoFinalUploader from "@/components/ecommerce/VideoFinalUploader";
import DeliverVideoButton from "@/components/ecommerce/DeliverVideoButton";
import VideoUploadLinkCard from "@/components/ecommerce/VideoUploadLinkCard";
import OrderRevisionModal from "@/components/ecommerce/OrderRevisionModal";
import OrderRevisionHistory from "@/components/ecommerce/OrderRevisionHistory";
import DeleteVideoOrderButton from "@/components/common/DeleteVideoOrderButton";
import { FiLock } from "react-icons/fi";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

export const metadata = {
  title: "Video Order Details | Dashboard",
  description: "Video Editor Workspace and Delivery for Custom Music Video Order",
};

export const dynamic = "force-dynamic";

async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export default async function VideoOrderDetailsPage({ params }) {
  const { id } = await params;
  const settings = await getSettings();
  const currentUser = await getCurrentUser();

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const userPermissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
  const canViewCustomerInfo = isAdmin || userPermissions.includes("customer_info");

  await dbConnect();
  const cleanId = String(id).replace(/^#/, "").trim();

  let videoOrder = await VideoOrder.findOne({
    $or: [
      { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
      { videoId: cleanId },
      { videoId: id },
      { shopifyOrderId: cleanId },
      { shopifyOrderId: id },
      { shopifyOrderId: `#${cleanId}` },
      { shopifyOrderNumber: cleanId },
      { shopifyOrderNumber: id },
      { shopifyOrderNumber: `#${cleanId}` },
    ].filter(Boolean),
  }).lean();

  if (videoOrder && !videoOrder.uploadToken) {
    const crypto = await import("crypto");
    const freshToken = crypto.randomBytes(24).toString("base64url");
    await VideoOrder.updateOne(
      { _id: videoOrder._id },
      { $set: { uploadToken: freshToken, uploadTokenStatus: "active" } }
    );
    videoOrder.uploadToken = freshToken;
    videoOrder.uploadTokenStatus = "active";
  }

  let shopifyOrder = null;

  // Try to load Shopify Order if connected
  if (videoOrder?.shopifyOrderId && settings.shopUrl1 && settings.shopifyAdminApiKey) {
    try {
      let url = settings.shopUrl1;
      if (!url.startsWith("http")) url = `https://${url}`;

      const res = await fetch(`${url}/admin/api/2024-04/orders/${videoOrder.shopifyOrderId}.json`, {
        headers: {
          "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      const data = await res.json();
      if (res.ok && data.order) {
        shopifyOrder = data.order;
      }
    } catch (e) {
      console.error("Failed to fetch Shopify order:", e);
    }
  }

  // If no VideoOrder found by ID, try looking up in Shopify directly
  if (!videoOrder && settings.shopUrl1 && settings.shopifyAdminApiKey) {
    try {
      let url = settings.shopUrl1;
      if (!url.startsWith("http")) url = `https://${url}`;

      const res = await fetch(`${url}/admin/api/2024-04/orders/${id}.json`, {
        headers: {
          "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      const data = await res.json();
      if (res.ok && data.order) {
        shopifyOrder = data.order;
        // Search line items for videoId
        const videoIdProp = shopifyOrder.line_items
          ?.flatMap((item) => item.properties || [])
          ?.find((p) => ["_videoid", "videoid", "video id", "_video_id"].includes(p.name?.toLowerCase()));

        if (videoIdProp && videoIdProp.value) {
          videoOrder = await VideoOrder.findOne({ videoId: videoIdProp.value }).lean();
        }
      }
    } catch (e) {
      console.error("Shopify fallback lookup failed:", e);
    }
  }

  if (!videoOrder && !shopifyOrder) {
    return notFound();
  }

  // If order is not a Video Order, route to Music or Others accordingly
  if (!videoOrder && shopifyOrder) {
    const hasVideoProp = (shopifyOrder.line_items || []).some((item) =>
      (item.properties || []).some((p) =>
        ["_videoid", "videoid", "video id", "_video_id"].includes(p.name?.toLowerCase())
      )
    );
    const hasMusicProp = (shopifyOrder.line_items || []).some((item) =>
      (item.properties || []).some((p) =>
        ["_musicid", "musicid", "music id", "_music_id", "_music_id"].includes(p.name?.toLowerCase())
      )
    );

    if (!hasVideoProp) {
      if (hasMusicProp) {
        redirect(`/orders/music/${id}`);
      } else {
        redirect(`/orders/publish/${id}`);
      }
    }
  }

  // If videoOrder is found, generate fresh presigned URLs for assets
  if (videoOrder) {
    videoOrder = JSON.parse(JSON.stringify(videoOrder));

    if (shopifyOrder) {
      videoOrder.shopifyOrderId = videoOrder.shopifyOrderId || String(shopifyOrder.id);
      videoOrder.shopifyOrderNumber = shopifyOrder.name || videoOrder.shopifyOrderNumber || String(shopifyOrder.order_number);

      // Music Video orders must NOT be automatically marked as fulfilled in the dashboard
      // even if Shopify auto-fulfills line items. They stay unfulfilled (in_production)
      // until the video is uploaded and admin manually fulfills the order in dashboard.
    }

    if (videoOrder.audioFile?.key || videoOrder.audioFile?.url) {
      videoOrder.audioFile = videoOrder.audioFile || {};
      videoOrder.audioFile.url = await generatePresignedUrl(videoOrder.audioFile.key || videoOrder.audioFile.url, 7 * 24 * 3600);
    }

    if (videoOrder.mediaFiles && Array.isArray(videoOrder.mediaFiles)) {
      for (const m of videoOrder.mediaFiles) {
        if (m.key || m.url) {
          const isVid = m.type === "video" || m.mimeType?.startsWith("video") || String(m.name || m.key || m.url).match(/\.(mp4|mov|webm)$/i);
          m.url = await generatePresignedUrl(m.key || m.url, 7 * 24 * 3600, isVid ? { isStream: true, contentType: "video/mp4" } : {});
        }
      }
    }

    if (videoOrder.finalVideoKey || videoOrder.finalVideoUrl) {
      videoOrder.finalVideoUrl = await generatePresignedUrl(videoOrder.finalVideoKey || videoOrder.finalVideoUrl, 7 * 24 * 3600, {
        isStream: true,
        contentType: "video/mp4",
      });
    }

    // Presign revision items if any
    if (videoOrder.revisions && Array.isArray(videoOrder.revisions)) {
      videoOrder.revisions = await Promise.all(
        videoOrder.revisions.map(async (rev) => {
          const r = JSON.parse(JSON.stringify(rev));
          const vKey = r.videoKey || r.videoUrl;
          if (vKey) {
            r.videoUrl = await generatePresignedUrl(vKey, 7 * 24 * 3600, { isStream: true, contentType: "video/mp4" });
          }

          const aKey = r.audioKey || r.audioUrl;
          if (aKey) {
            r.audioUrl = await generatePresignedUrl(aKey, 7 * 24 * 3600);
          }
          return r;
        })
      );

      // Ensure the Final Rendered Video workspace strictly shows the latest revision video
      const sortedRevs = [...videoOrder.revisions].sort((a, b) => (b.version || 0) - (a.version || 0));
      const latestRev = sortedRevs[0];
      if (latestRev?.videoUrl) {
        videoOrder.finalVideoUrl = latestRev.videoUrl;
      }
    }
  } else {
    // Construct placeholder videoOrder from Shopify data
    videoOrder = {
      videoId: `vid_${shopifyOrder.id}`,
      email: shopifyOrder.email,
      customerName: shopifyOrder.customer ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim() : "Customer",
      shopifyOrderId: String(shopifyOrder.id),
      shopifyOrderNumber: String(shopifyOrder.name || shopifyOrder.order_number),
      selectedPackage: "Music Video",
      packagePrice: parseFloat(shopifyOrder.total_price),
      currency: shopifyOrder.currency,
      mediaFiles: [],
      status: shopifyOrder.fulfillment_status === "fulfilled" ? "fulfilled" : shopifyOrder.financial_status === "paid" ? "in_production" : "pending",
      createdAt: shopifyOrder.created_at,
      currentVersion: 1,
      revisions: [],
    };
  }

  const rawFmtProp = (shopifyOrder?.line_items || [])
    .flatMap((i) => i.properties || [])
    .find((p) => ["_video_format", "video format", "_aspect_ratio", "aspect ratio"].includes(p.name?.toLowerCase()));
  const inferredFormat = rawFmtProp?.value?.includes("16:9") ? "16:9" : "9:16";
  const effectiveFormat = videoOrder.videoFormat || inferredFormat;

  const rawOrderNum = shopifyOrder?.name || videoOrder.shopifyOrderNumber || (shopifyOrder?.order_number ? `#${shopifyOrder.order_number}` : videoOrder.videoId);
  const displayOrderNumber = String(rawOrderNum).startsWith("#") ? rawOrderNum : `#${rawOrderNum}`;
  const orderNumber = displayOrderNumber;
  const customerEmail = videoOrder.email || shopifyOrder?.email || "No email provided";
  const customerName = videoOrder.customerName || (shopifyOrder?.customer ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim() : "Customer");

  const isFulfilled =
    videoOrder.status === "fulfilled" ||
    shopifyOrder?.fulfillment_status === "fulfilled";

  return (
    <div className="space-y-6">
      <PageBreadcrumb pageTitle={`Video Order ${displayOrderNumber}`} />

      {/* Top Navigation */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <BackButton
          fallbackUrl="/orders/video"
          className="text-gray-500 hover:text-gray-800 dark:hover:text-white transition inline-flex items-center gap-1 text-sm font-medium"
        >
          ← Back to Video Orders
        </BackButton>

        <div className="flex items-center gap-3">
          {isFulfilled && (
            <OrderRevisionModal
              orderId={videoOrder.videoId || videoOrder._id}
              orderType="video"
              currentAudioUrl={videoOrder.audioFile?.url || ""}
              currentVideoUrl={videoOrder.finalVideoUrl || ""}
            />
          )}
          {shopifyOrder && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Shopify Financial:</span>
              <Badge size="sm" color={shopifyOrder.financial_status === "paid" ? "success" : "warning"}>
                {shopifyOrder.financial_status}
              </Badge>
              <span className="text-xs text-gray-500 ml-2">Fulfillment:</span>
              <Badge size="sm" color={shopifyOrder.fulfillment_status === "fulfilled" ? "success" : "light"}>
                {shopifyOrder.fulfillment_status || "unfulfilled"}
              </Badge>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
        {/* Left Column: Editor Assets & Delivery Workspace */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Upload Link Portal Generator */}
          <VideoUploadLinkCard
            orderId={videoOrder._id?.toString()}
            orderNumber={displayOrderNumber || orderNumber}
            customerEmail={videoOrder.email || shopifyOrder?.email}
            shopUrl={settings.shopUrl1 || "https://myownsongs.com"}
            mediaCount={(videoOrder.mediaFiles || []).length}
            uploadToken={videoOrder.uploadToken}
            uploadTokenStatus={videoOrder.uploadTokenStatus || "active"}
            lastSubmittedAt={videoOrder.lastSubmittedAt}
            allowMusicRegeneration={videoOrder.allowMusicRegeneration !== false}
          />

          {/* Asset Downloader */}
          <VideoAssetDownloader
            audioFile={videoOrder.audioFile}
            mediaFiles={videoOrder.mediaFiles || []}
            orderNumber={orderNumber}
            videoFormat={effectiveFormat}
          />

          {/* Final Video Uploader Workspace */}
          <VideoFinalUploader order={videoOrder} />

          {/* Deliver to Customer Action */}
          <DeliverVideoButton order={videoOrder} />

          {/* Customer Order Notes */}
          {canViewCustomerInfo && (videoOrder.orderNotes || shopifyOrder?.note) && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-3 text-lg font-semibold text-gray-800 dark:text-white/90">
                Customer Notes / Special Instructions
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
                {videoOrder.orderNotes || shopifyOrder?.note}
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Customer Details & Order Meta (Sticky Sidebar) */}
        <div className="lg:col-span-1 w-full">
          <div className="space-y-6" style={{ position: "sticky", top: "72px", alignSelf: "start" }}>
            {/* Customer Card */}

            {canViewCustomerInfo &&
              <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Customer Information</h3>
                  {!canViewCustomerInfo && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">
                      <FiLock className="w-3 h-3" /> Restricted
                    </span>
                  )}
                </div>

                <div className="space-y-4 text-sm">
                  <div>
                    <span className="text-xs text-gray-400 uppercase tracking-wider block">Customer Name</span>
                    <p className="font-semibold text-gray-800 dark:text-white/90 mt-0.5">{customerName}</p>
                  </div>

                  <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-xs text-gray-400 uppercase tracking-wider block">Email Address</span>
                    <p className="text-brand-500 hover:text-brand-600 font-medium break-all mt-0.5">{customerEmail}</p>
                  </div>

                  {shopifyOrder?.shipping_address && (
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                      <span className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Shipping Address</span>
                      <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                        <p>{shopifyOrder.shipping_address.name}</p>
                        <p>{shopifyOrder.shipping_address.address1}</p>
                        <p>{shopifyOrder.shipping_address.city}, {shopifyOrder.shipping_address.country}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            }

            {/* Order Summary Card */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Order Summary</h3>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">Video ID</span>
                  <span className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">{videoOrder.videoId}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">Package</span>
                  <span className="font-medium text-gray-800 dark:text-white/90">{videoOrder.selectedPackage || "Music Video"}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">Video Format</span>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    effectiveFormat === "16:9"
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40"
                      : "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40"
                  }`}>
                    {effectiveFormat === "16:9" ? "16:9 Landscape ▭" : "9:16 Vertical ▯"}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">Status</span>
                  <Badge
                    size="sm"
                    color={
                      videoOrder.status === "fulfilled"
                        ? "success"
                        : videoOrder.status === "delivering"
                        ? "info"
                        : videoOrder.status === "ready"
                        ? "brand"
                        : videoOrder.status === "in_production"
                        ? "warning"
                        : "light"
                    }
                  >
                    {videoOrder.status === "in_production"
                      ? "In Production"
                      : videoOrder.status === "ready"
                      ? "Ready"
                      : videoOrder.status === "delivering"
                      ? "Delivering"
                      : videoOrder.status === "fulfilled"
                      ? "Fulfilled"
                      : videoOrder.status}
                  </Badge>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">Order Date</span>
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    {new Date(videoOrder.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>

                {videoOrder.status === "fulfilled" && videoOrder.deliveredAt && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400">Delivered Date</span>
                    <span className="text-xs text-green-600 font-medium">
                      {new Date(videoOrder.deliveredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                )}

                <div className="pt-3 mt-3 border-t border-gray-100 dark:border-gray-800 flex justify-between font-semibold">
                  <span className="text-gray-800 dark:text-white/90">Total Paid</span>
                  <span className="text-gray-800 dark:text-white/90">
                    {videoOrder.packagePrice ? `${videoOrder.packagePrice} ${videoOrder.currency || "USD"}` : shopifyOrder?.total_price ? `${shopifyOrder.total_price} ${shopifyOrder.currency}` : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Version & Revision History */}
            {videoOrder.revisions && videoOrder.revisions.length > 0 && (
              <OrderRevisionHistory
                revisions={JSON.parse(JSON.stringify(videoOrder.revisions))}
                currentVersion={videoOrder.currentVersion || 1}
                activeAudioUrl={videoOrder.audioFile?.url || ""}
                activeVideoUrl={videoOrder.finalVideoUrl || ""}
                orderTitle={`Video Order ${displayOrderNumber}`}
              />
            )}

            <BackButton
              fallbackUrl={videoOrder.shopifyOrderId ? "/orders/video" : (videoOrder.email ? `/customers?search=${encodeURIComponent(videoOrder.email)}` : "/orders/video")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05] mt-4"
            >
              ← {videoOrder.shopifyOrderId ? "Back to Video Orders" : "Back to Orders"}
            </BackButton>

            <DeleteVideoOrderButton
              orderId={videoOrder.shopifyOrderId || videoOrder.videoId || videoOrder._id}
              shopifyOrderNumber={videoOrder.shopifyOrderNumber || videoOrder.videoId}
              customerEmail={videoOrder.email}
              redirectUrl={videoOrder.shopifyOrderId ? "/orders/video" : (videoOrder.email ? `/customers?search=${encodeURIComponent(videoOrder.email)}` : "/orders/video")}
              retentionDays={settings.trashBinRetentionDays ?? 30}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

