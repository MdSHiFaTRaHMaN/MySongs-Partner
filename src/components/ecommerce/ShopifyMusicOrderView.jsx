"use client";

import React, { useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import BackButton from "@/components/common/BackButton";
import Badge from "@/components/ui/badge/Badge";
import Link from "next/link";
import EditOrderModal from "@/components/ecommerce/EditOrderModal";
import DeliverMusicButton from "@/components/ecommerce/DeliverMusicButton";
import FulfillmentManager from "@/components/ecommerce/FulfillmentManager";
import OrderRevisionModal from "@/components/ecommerce/OrderRevisionModal";
import OrderRevisionHistory from "@/components/ecommerce/OrderRevisionHistory";
import { FiMusic, FiDownload, FiAlertCircle } from "react-icons/fi";
import ForceDownloadButton from "@/components/common/ForceDownloadButton";
import FetchMusicFileButton from "@/components/common/FetchMusicFileButton";
import CollapsibleLyrics from "@/components/common/CollapsibleLyrics";
import { useRouter } from "next/navigation";

export default function ShopifyMusicOrderView({
  orderInfo,
  initialMatchedMusicInfo = [],
  dbOrder,
  bestEmail,
  cleanId,
  isMusicFulfilled,
  musicDisplayNumber,
}) {
  const router = useRouter();
  const [matchedMusicInfo, setMatchedMusicInfo] = useState(initialMatchedMusicInfo);

  const handleRevisionSuccess = (newRev) => {
    if (!newRev) return;

    setMatchedMusicInfo((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      if (copy.length > 0) {
        const primary = copy[0];
        const existingRevs = Array.isArray(primary.revisions) ? primary.revisions : [];
        const filteredRevs = existingRevs.filter((r) => r.version !== newRev.version);
        const updatedRevs = [newRev, ...filteredRevs].sort((a, b) => (b.version || 0) - (a.version || 0));
        primary.revisions = updatedRevs;
        primary.currentVersion = newRev.version || (primary.currentVersion || 1) + 1;

        if (primary.track) {
          primary.track.audioUrl = newRev.audioUrl;
          primary.track.streamAudioUrl = newRev.streamAudioUrl || newRev.audioUrl;
          primary.track.isRevision = true;
          primary.track.version = newRev.version || primary.currentVersion;
          if (newRev.lyrics) primary.track.lyrics = newRev.lyrics;
          primary.track.totalRevisions = updatedRevs.length;
        }
      }
      return copy;
    });

    // Refresh server state in background without page reload
    router.refresh();
  };

  return (
    <div>
      <PageBreadcrumb pageTitle={`Music Order ${musicDisplayNumber}`} />

      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
        <BackButton
          fallbackUrl="/orders/music"
          className="text-gray-500 hover:text-gray-800 dark:hover:text-white transition inline-flex items-center gap-1 text-sm font-medium"
        >
          ← Back to Music Orders
        </BackButton>
        <div className="flex items-center gap-3">
          {isMusicFulfilled && (
            <OrderRevisionModal
              orderId={matchedMusicInfo[0]?.orderId || cleanId || String(orderInfo.id)}
              orderType="music"
              currentLyrics={matchedMusicInfo[0]?.rawLyrics || matchedMusicInfo[0]?.track?.lyrics || ""}
              currentAudioUrl={matchedMusicInfo[0]?.track?.audioUrl || ""}
              customerEmail={bestEmail}
              shopifyOrderId={String(orderInfo.id)}
              shopifyOrderNumber={`#${orderInfo.order_number}`}
              musicId={matchedMusicInfo[0]?.musicId && matchedMusicInfo[0].musicId !== "N/A" ? matchedMusicInfo[0].musicId : undefined}
              songTitle={matchedMusicInfo[0]?.track?.title || "Custom Song"}
              currentVersion={matchedMusicInfo[0]?.currentVersion || 1}
              revisionsCount={matchedMusicInfo[0]?.revisions?.length || 0}
              onSuccess={handleRevisionSuccess}
            />
          )}
          <EditOrderModal order={orderInfo} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 items-start">
        {/* Left: Main Info (Sticky so it stays in view while scrolling long revision history) */}
        <div className="xl:col-span-2 space-y-6 xl:sticky xl:top-0 self-start pr-1">
          {/* Email Delivery Failure / Typo Alert (Only shows when an actual delivery failure occurred) */}
          {Boolean(dbOrder?.emailDeliveryFailed || matchedMusicInfo[0]?.emailDeliveryFailed) && (
            <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 dark:border-red-900/60 dark:bg-red-950/20">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400">
                    <FiAlertCircle size={18} />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-red-900 dark:text-red-200">
                      Email Delivery Failed (Klaviyo / Typo Detected)
                    </h4>
                    <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                      {dbOrder?.emailDeliveryError || matchedMusicInfo[0]?.emailDeliveryError || "Klaviyo reported an email delivery failure. Please check customer email address or resend delivery below."}
                    </p>
                    <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                      Customer Email: <span className="font-mono font-medium">{bestEmail || "Not found"}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Fulfillment Manager */}
          <FulfillmentManager orderId={orderInfo.id} currentStatus={orderInfo.fulfillment_status} klaviyoSent={orderInfo.klaviyoSent} />

          {/* Order Items */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">Order Items</h3>
            <div className="space-y-6">
              {orderInfo.line_items.map((item) => {
                const matchedMusic = matchedMusicInfo.find((m) => m.lineItemId === item.id);
                const dbLyrics = matchedMusic?.rawLyrics || matchedMusic?.track?.lyrics || dbOrder?.lyrics;
                const lyricsProp = (item.properties || []).find((p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "lyrics")?.value;
                const lyricsContent = dbLyrics || lyricsProp || "";
                const displayProps = (item.properties || []).filter((p) => {
                  const cleanName = (p.name || "").toLowerCase().replace(/[\s_-]/g, "");
                  return cleanName !== "lyrics";
                });

                return (
                  <div key={item.id} className="border-b border-gray-100 dark:border-gray-800 pb-6 last:border-0 last:pb-0">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="font-medium text-gray-800 dark:text-white/90">{item.title}</p>
                        <p className="text-sm text-gray-500">{item.variant_title || "Default"}</p>
                        {displayProps && displayProps.length > 0 && (
                          <div className="mt-2 space-y-1 text-xs text-gray-500">
                            {displayProps.map((p, idx) => (
                              <div key={idx} className="flex">
                                <span className="font-medium mr-1 text-gray-700 dark:text-gray-400">{p.name}:</span>
                                <span>{p.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-800 dark:text-white/90">
                          {item.price} {orderInfo.currency}
                        </p>
                        <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                      </div>
                    </div>

                    {/* Collapsible Lyrics */}
                    {lyricsContent && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Song Lyrics</span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                            Lyrics Provider: {
                              (dbOrder?.creationMethod === "own_lyrics" || displayProps.some(p => p.name === "Creation Method" && p.value === "own_lyrics"))
                                ? "Customer's Own Lyrics"
                                : ((dbOrder?.storyText && dbOrder.storyText.length > 200) || (displayProps.find(p => p.name === "Story Text")?.value?.length > 200))
                                ? "Mureka AI (> 200 chars)"
                                : "Suno AI (≤ 200 chars)"
                            }
                          </span>
                        </div>
                        <CollapsibleLyrics lyrics={lyricsContent} title="Song Lyrics" defaultOpen={false} />
                      </div>
                    )}

                    {/* Show matched music track if available */}
                    {matchedMusic && matchedMusic.track && (
                      <div className="mt-4 rounded-xl bg-gray-50 p-4 border border-gray-100 dark:bg-white/[0.02] dark:border-white/[0.05]">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                              <FiMusic size={20} />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                                  Selected Music: {matchedMusic.track.title || "Unknown Title"}
                                </p>
                                {matchedMusic.isOriginalOrder && (
                                  <span className="text-[11px] font-medium text-brand-600 bg-brand-50 dark:bg-brand-950/40 px-2.5 py-0.5 rounded-full border border-brand-200 dark:border-brand-800">
                                    Linked from Original Order {matchedMusic.originalOrderNumber}
                                  </span>
                                )}
                                {matchedMusic.track.isRevision ? (
                                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                                    Final Music (Revision v{matchedMusic.track.version})
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-medium text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-300 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700">
                                    Original Track
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">
                                Music ID: {matchedMusic.musicId}
                                {matchedMusic.track.totalRevisions > 0 && ` • Total Revisions: ${matchedMusic.track.totalRevisions}`}
                              </p>
                            </div>
                          </div>
                        </div>

                        {(matchedMusic.track.audioUrl || matchedMusic.track.streamAudioUrl) && (
                          <div className="mt-3 flex flex-wrap items-center gap-4">
                            <audio
                              key={matchedMusic.track.audioUrl || matchedMusic.track.streamAudioUrl}
                              controls
                              controlsList="nodownload noremoteplayback nosaveplayback noplaybackrate nofullscreen"
                              src={matchedMusic.track.audioUrl || matchedMusic.track.streamAudioUrl}
                              className="h-10 w-full max-w-[320px]"
                            />
                            {(matchedMusic.track.audioUrl || matchedMusic.track.streamAudioUrl) && (
                              <ForceDownloadButton
                                url={matchedMusic.track.audioUrl || matchedMusic.track.streamAudioUrl}
                                filename={`${matchedMusic.track.title || "music"} - My Own Songs.mp3`}
                                className="flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-600 dark:hover:text-brand-400"
                              >
                                <FiDownload size={16} />
                                Download
                              </ForceDownloadButton>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* If music ID exists but no track found, or audio file missing */}
                    {(!matchedMusic || !matchedMusic.track || (!matchedMusic.track.audioUrl && !matchedMusic.track.streamAudioUrl)) && (
                      <div className="mt-4 rounded-xl bg-amber-50/80 p-4 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                              Music file not found in database / S3
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                              {matchedMusic?.musicId && matchedMusic.musicId !== "N/A"
                                ? `Music ID: ${matchedMusic.musicId}`
                                : "Click below to sync the generated music file or upload an audio file."}
                            </p>
                          </div>
                          <FetchMusicFileButton
                            orderId={matchedMusic?.orderId}
                            shopifyOrderId={orderInfo.id}
                            musicId={matchedMusic?.musicId !== "N/A" ? matchedMusic?.musicId : undefined}
                            taskId={matchedMusic?.taskId || undefined}
                            email={bestEmail}
                            buttonText="Fetch Music from Suno / S3"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Deliver Music Section */}
            <DeliverMusicButton order={{ ...orderInfo, email: bestEmail, currentVersion: matchedMusicInfo[0]?.currentVersion || 1 }} />
          </div>

          {(orderInfo.note || orderInfo.tags) && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Additional Info</h3>
              {orderInfo.tags && (
                <div className="mb-4">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Tags</span>
                  <div className="flex flex-wrap gap-2">
                    {orderInfo.tags.split(",").map((tag) => (
                      <Badge key={tag} size="sm" color="info">
                        {tag.trim()}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {orderInfo.note && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Order Note (Notes from customer)</span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                    {orderInfo.note}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Meta Info & Customer Info */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">Customer</h3>

            <div className="space-y-5">
              <div>
                <p className="font-medium text-brand-500 hover:text-brand-600">
                  {orderInfo.customer ? `${orderInfo.customer.first_name || ""} ${orderInfo.customer.last_name || ""}`.trim() : "No Customer"}
                </p>
                {orderInfo.customer && orderInfo.customer.orders_count !== undefined && (
                  <p className="text-sm text-gray-500 mt-1">{orderInfo.customer.orders_count} order(s)</p>
                )}
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Contact</p>
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-gray-800 dark:text-white/90">{bestEmail || orderInfo.email || orderInfo.contact_email || "N/A"}</p>
                  {orderInfo.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{orderInfo.phone}</p>}
                </div>
              </div>

              {orderInfo.shipping_address && (
                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Shipping Address</p>
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    <p>{orderInfo.shipping_address.name}</p>
                    <p>{orderInfo.shipping_address.address1}</p>
                    {orderInfo.shipping_address.address2 && <p>{orderInfo.shipping_address.address2}</p>}
                    <p>
                      {orderInfo.shipping_address.city}, {orderInfo.shipping_address.province} {orderInfo.shipping_address.zip}
                    </p>
                    <p>{orderInfo.shipping_address.country}</p>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                <Link
                  href={`/customers/${encodeURIComponent(bestEmail || orderInfo.email || orderInfo.customer?.email || "")}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-500 hover:text-brand-600 transition"
                >
                  <span>View Customer 360° Profile →</span>
                </Link>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">Summary</h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-gray-400">Created At</span>
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {new Date(orderInfo.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-gray-400">Financial</span>
                <Badge size="sm" color={orderInfo.financial_status === "paid" ? "success" : "warning"}>
                  {orderInfo.financial_status}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-gray-400">Fulfillment</span>
                <Badge size="sm" color={orderInfo.fulfillment_status === "fulfilled" ? "success" : "warning"}>
                  {orderInfo.fulfillment_status || "unfulfilled"}
                </Badge>
              </div>
              <div className="pt-3 mt-3 border-t border-gray-100 dark:border-gray-800 flex justify-between font-semibold">
                <span className="text-gray-800 dark:text-white/90">Total</span>
                <span className="text-gray-800 dark:text-white/90">
                  {orderInfo.total_price} {orderInfo.currency}
                </span>
              </div>
            </div>
          </div>

          {/* Version & Revision History */}
          {matchedMusicInfo.length > 0 && matchedMusicInfo[0]?.revisions && matchedMusicInfo[0].revisions.length > 0 && (
            <OrderRevisionHistory
              revisions={matchedMusicInfo[0].revisions}
              currentVersion={matchedMusicInfo[0].currentVersion || 1}
              activeAudioUrl={matchedMusicInfo[0].track?.audioUrl || ""}
              activeLyrics={matchedMusicInfo[0].rawLyrics || matchedMusicInfo[0].track?.lyrics || ""}
              orderTitle={matchedMusicInfo[0].track?.title || "Custom Song"}
            />
          )}
        </div>
      </div>
    </div>
  );
}
