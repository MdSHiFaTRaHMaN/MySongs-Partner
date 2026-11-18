"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import { useToast } from "@/components/ui/toast/Toast";
import { useRouter } from "next/navigation";
import { FiSend, FiMusic, FiExternalLink, FiCheck, FiMail, FiGlobe, FiPlus, FiTrash2 } from "react-icons/fi";
import { FaSpotify, FaApple, FaYoutube, FaAmazon } from "react-icons/fa";

const PLATFORM_OPTIONS = [
  { value: "spotify", label: "Spotify Track Link", icon: FaSpotify, color: "#1DB954", placeholder: "https://open.spotify.com/track/..." },
  { value: "apple", label: "Apple Music Link", icon: FaApple, color: "#FA243C", placeholder: "https://music.apple.com/..." },
  { value: "youtube", label: "YouTube / YouTube Music", icon: FaYoutube, color: "#FF0000", placeholder: "https://youtube.com/watch?v=..." },
  { value: "amazon", label: "Amazon Music Link", icon: FaAmazon, color: "#FF9900", placeholder: "https://music.amazon.com/..." },
  { value: "other", label: "Other Platform URL", icon: FiGlobe, color: "#6366F1", placeholder: "https://..." },
];

function normalizeKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getOrderSongTitle(order, defaultVal = "") {
  if (!order) return defaultVal || "Your Custom Song";

  const items = order.line_items || [];

  // Helper to extract properties as array of { key, value }
  const extractProperties = (props) => {
    if (!props) return [];
    if (Array.isArray(props)) {
      return props.map((p) => ({
        key: normalizeKey(p.name || p.key),
        value: String(p.value || "").trim(),
      }));
    }
    if (typeof props === "object") {
      return Object.entries(props).map(([k, v]) => ({
        key: normalizeKey(k),
        value: String(v || "").trim(),
      }));
    }
    return [];
  };

  const allItemProps = items.flatMap((it) => extractProperties(it.properties));
  const noteProps = extractProperties(order.note_attributes);

  // PASS 1: Strict priority for song_title_or_recipient
  for (const p of [...allItemProps, ...noteProps]) {
    if (p.key.includes("song_title_or_recipient") && p.value) {
      return p.value;
    }
  }

  // Check direct order properties for song_title_or_recipient
  if (order.song_title_or_recipient && String(order.song_title_or_recipient).trim()) {
    return String(order.song_title_or_recipient).trim();
  }

  // PASS 2: Check for song_title, song_name, original_song
  for (const p of [...allItemProps, ...noteProps]) {
    if ((p.key === "song_title" || p.key === "song_name" || p.key === "original_song" || p.key.includes("song_title")) && p.value) {
      return p.value;
    }
  }

  // PASS 3: Check for recipient or title
  for (const p of [...allItemProps, ...noteProps]) {
    if ((p.key === "recipient" || p.key === "recipients" || p.key === "title") && p.value) {
      return p.value;
    }
  }

  // PASS 4: Direct order fields if present
  if (order.songTitle && String(order.songTitle).trim()) return String(order.songTitle).trim();
  if (order.song_title && String(order.song_title).trim()) return String(order.song_title).trim();

  // PASS 5: Default fallback or first valid non-upsell line item title
  if (defaultVal && String(defaultVal).trim()) return String(defaultVal).trim();

  for (const it of items) {
    const title = it.title || "";
    if (
      title &&
      !title.toLowerCase().includes("spotify") &&
      !title.toLowerCase().includes("streaming") &&
      !title.toLowerCase().includes("publish") &&
      !title.toLowerCase().includes("rush")
    ) {
      return title;
    }
  }

  return "Your Custom Song";
}

function getOrderCustomerName(order, fallback = "") {
  if (!order) return fallback;

  // 1. If artistName was previously saved in publishLinks
  if (order?.publishLinks?.artistName && String(order.publishLinks.artistName).trim()) {
    return String(order.publishLinks.artistName).trim();
  }

  // 2. Customer object from order
  if (order.customer) {
    const fn = (order.customer.first_name || "").trim();
    const ln = (order.customer.last_name || "").trim();
    const full = `${fn} ${ln}`.trim();
    if (full) return full;
    if (order.customer.name && String(order.customer.name).trim()) {
      return String(order.customer.name).trim();
    }
  }

  // 3. Shipping address name
  if (order.shipping_address?.name && String(order.shipping_address.name).trim()) {
    return String(order.shipping_address.name).trim();
  }

  // 4. Billing address name
  if (order.billing_address?.name && String(order.billing_address.name).trim()) {
    return String(order.billing_address.name).trim();
  }

  // 5. Direct fields on order
  if (order.customer_name && String(order.customer_name).trim()) {
    return String(order.customer_name).trim();
  }
  if (order.customerName && String(order.customerName).trim()) {
    return String(order.customerName).trim();
  }

  // 6. Line item property checking
  const items = order.line_items || [];
  for (const it of items) {
    const props = it.properties || [];
    if (Array.isArray(props)) {
      for (const p of props) {
        const k = normalizeKey(p.name || p.key);
        if (
          (k === "artist_name" ||
            k === "artist" ||
            k === "performer" ||
            k === "customer_name" ||
            k === "your_name" ||
            k === "name") &&
          p.value &&
          String(p.value).trim()
        ) {
          return String(p.value).trim();
        }
      }
    }
  }

  return fallback;
}

export default function DeliverPublishOrderButton({
  order,
  defaultSongTitle = "",
  defaultArtist = "",
  className = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const existingLinks = order?.publishLinks || {};

  const [songTitle, setSongTitle] = useState(() => getOrderSongTitle(order, defaultSongTitle));
  const [artistName, setArtistName] = useState(() => getOrderCustomerName(order, defaultArtist || ""));
  const [customMessage, setCustomMessage] = useState(
    "Great news! Your custom song is officially published and live on streaming platforms worldwide. Enjoy sharing and streaming your track with friends and family!"
  );

  // Dynamic Streaming Links
  const [streamingLinks, setStreamingLinks] = useState(() => {
    if (Array.isArray(existingLinks.links) && existingLinks.links.length > 0) {
      return existingLinks.links;
    }
    const legacy = [];
    if (existingLinks.spotifyUrl) legacy.push({ type: "spotify", url: existingLinks.spotifyUrl });
    if (existingLinks.appleMusicUrl) legacy.push({ type: "apple", url: existingLinks.appleMusicUrl });
    if (existingLinks.youtubeUrl) legacy.push({ type: "youtube", url: existingLinks.youtubeUrl });
    if (existingLinks.otherUrl) legacy.push({ type: "other", url: existingLinks.otherUrl });
    if (legacy.length > 0) return legacy;

    return [{ type: "spotify", url: "" }];
  });

  // Sync state when order updates
  useEffect(() => {
    const detected = getOrderSongTitle(order, defaultSongTitle);
    if (detected) setSongTitle(detected);

    const detectedArtist = getOrderCustomerName(order, defaultArtist || "");
    if (detectedArtist) setArtistName(detectedArtist);

    if (Array.isArray(order?.publishLinks?.links) && order.publishLinks.links.length > 0) {
      setStreamingLinks(order.publishLinks.links);
    } else {
      const pLinks = order?.publishLinks || {};
      const legacy = [];
      if (pLinks.spotifyUrl) legacy.push({ type: "spotify", url: pLinks.spotifyUrl });
      if (pLinks.appleMusicUrl) legacy.push({ type: "apple", url: pLinks.appleMusicUrl });
      if (pLinks.youtubeUrl) legacy.push({ type: "youtube", url: pLinks.youtubeUrl });
      if (pLinks.otherUrl) legacy.push({ type: "other", url: pLinks.otherUrl });
      if (legacy.length > 0) {
        setStreamingLinks(legacy);
      }
    }
  }, [order, defaultSongTitle, defaultArtist]);

  const showToast = useToast();
  const router = useRouter();

  const customerEmail = order?.email || order?.customer?.email || "";
  const customerName = order?.customer
    ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
    : order?.shipping_address?.name || "Customer";
  const orderNumber = order?.name || (order?.order_number ? `#${order.order_number}` : `#${order?.id}`);

  const activeLinks = streamingLinks.filter((l) => l.url && l.url.trim());
  const isDelivered = Boolean(existingLinks.deliveredAt || order?.deliveryEmailSent || activeLinks.length > 0);

  const addLinkRow = () => {
    const usedTypes = new Set(streamingLinks.map((l) => l.type));
    const nextOpt = PLATFORM_OPTIONS.find((p) => !usedTypes.has(p.value)) || PLATFORM_OPTIONS[PLATFORM_OPTIONS.length - 1];
    setStreamingLinks((prev) => [...prev, { type: nextOpt.value, url: "" }]);
  };

  const updateLinkRow = (index, field, value) => {
    setStreamingLinks((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeLinkRow = (index) => {
    setStreamingLinks((prev) => {
      if (prev.length <= 1) {
        return [{ type: "spotify", url: "" }];
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleDeliver = async (e) => {
    e.preventDefault();

    const validLinks = streamingLinks.filter((l) => l.url && l.url.trim());
    if (validLinks.length === 0) {
      showToast({
        variant: "warning",
        title: "Link Required",
        message: "Please enter at least one streaming link (Spotify, Apple Music, YouTube, etc.)",
      });
      return;
    }

    const spotify = validLinks.find((l) => l.type === "spotify")?.url || "";
    const apple = validLinks.find((l) => l.type === "apple")?.url || "";
    const youtube = validLinks.find((l) => l.type === "youtube")?.url || "";
    const other = validLinks.find((l) => l.type === "other" || l.type === "amazon")?.url || "";

    setSubmitting(true);
    try {
      const res = await fetch("/api/klaviyo/publish-deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: order?.id,
          shopifyOrderNumber: order?.name || (order?.order_number ? `#${order.order_number}` : order?.id),
          originalOrderNumber:
            order?.original_order_number ||
            order?.note_attributes?.find((n) => (n.name || "").toLowerCase().includes("originalorder"))?.value ||
            "",
          email: customerEmail,
          customerName: artistName?.trim() || customerName,
          songTitle,
          artistName: artistName?.trim() || customerName,
          spotifyUrl: spotify,
          appleMusicUrl: apple,
          youtubeUrl: youtube,
          otherUrl: other,
          links: validLinks,
          customMessage,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to trigger delivery email");
      }

      showToast({
        variant: "success",
        title: "Delivered Successfully!",
        message: data.message || "Publish delivery email dispatched via Klaviyo!",
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("klaviyo-publish-delivered", {
            detail: { orderId: order?.id, links: validLinks },
          })
        );
      }

      setIsOpen(false);
      router.refresh();
    } catch (err) {
      console.error("Publish delivery error:", err);
      showToast({
        variant: "error",
        title: "Delivery Failed",
        message: err.message || "Could not deliver publish links.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={`rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-white/[0.02] ${className}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                <FiGlobe size={14} />
              </span>
              <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                Deliver Published Music Links
              </h4>
              {isDelivered && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded">
                    <FiCheck size={11} /> Links Active
                  </span>
                  {order?.fulfillment_status === "fulfilled" || existingLinks.webhookConfirmed ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded">
                      <FiCheck size={11} /> Fulfilled in Shopify
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded">
                      Waiting Klaviyo Webhook
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Add Spotify, Apple Music &amp; streaming links to customer&apos;s order and dispatch via Klaviyo.
            </p>

            {/* Active Links Badges */}
            {activeLinks.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mt-2.5">
                {activeLinks.map((linkItem, idx) => {
                  const opt = PLATFORM_OPTIONS.find((p) => p.value === linkItem.type) || PLATFORM_OPTIONS[PLATFORM_OPTIONS.length - 1];
                  const Icon = opt.icon;
                  return (
                    <a
                      key={idx}
                      href={linkItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 hover:text-brand-500 shadow-2xs"
                    >
                      <Icon style={{ color: opt.color }} />
                      <span>{opt.label.replace(" Link", "")}</span>
                      <FiExternalLink size={10} />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-brand-600 transition cursor-pointer shrink-0"
          >
            <FiSend size={14} />
            <span>{isDelivered ? "Update Links / Re-send Mail" : "Enter Links & Deliver via Klaviyo"}</span>
          </button>
        </div>
      </div>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} className="max-w-xl p-6">
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                <FiGlobe size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-800 dark:text-white/90">
                  Deliver Published Music Order
                </h3>
                <p className="text-xs text-gray-500">
                  Order {orderNumber} • {customerEmail}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleDeliver} className="space-y-4">
            {/* Song Title & Artist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pub-song-title">Song Title</Label>
                <Input
                  id="pub-song-title"
                  type="text"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  placeholder="e.g. Love Song for Miranda"
                  required
                />
              </div>
              <div>
                <Label htmlFor="pub-artist">Artist / Performer Name</Label>
                <Input
                  id="pub-artist"
                  type="text"
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  placeholder="e.g. My Own Songs"
                />
              </div>
            </div>

            {/* Dynamic Streaming Platform Links */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">
                  Streaming Platform Links
                </span>
                <span className="text-[11px] text-gray-400">
                  {streamingLinks.length} {streamingLinks.length === 1 ? "platform link" : "platform links"}
                </span>
              </div>

              <div className="space-y-2.5">
                {streamingLinks.map((linkItem, idx) => {
                  const currentOpt = PLATFORM_OPTIONS.find((p) => p.value === linkItem.type) || PLATFORM_OPTIONS[0];
                  const Icon = currentOpt.icon;

                  return (
                    <div
                      key={idx}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02]"
                    >
                      {/* Platform Select */}
                      <div className="relative w-full sm:w-56 shrink-0">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Icon style={{ color: currentOpt.color }} className="text-sm" />
                        </div>
                        <select
                          value={linkItem.type}
                          onChange={(e) => updateLinkRow(idx, "type", e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-brand-500 focus:outline-hidden cursor-pointer"
                        >
                          {PLATFORM_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* URL Input */}
                      <div className="flex-1">
                        <input
                          type="url"
                          value={linkItem.url}
                          onChange={(e) => updateLinkRow(idx, "url", e.target.value)}
                          placeholder={currentOpt.placeholder}
                          className="w-full px-3 py-2 text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg placeholder:text-gray-400 focus:border-brand-500 focus:outline-hidden font-mono"
                        />
                      </div>

                      {/* Remove Button */}
                      {streamingLinks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLinkRow(idx)}
                          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer shrink-0 self-end sm:self-center"
                          title="Remove this platform link"
                        >
                          <FiTrash2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Another Link Button */}
              <button
                type="button"
                onClick={addLinkRow}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-semibold text-brand-600 dark:text-brand-400 border border-dashed border-brand-300 dark:border-brand-700 hover:bg-brand-50/50 dark:hover:bg-brand-950/20 rounded-xl transition cursor-pointer"
              >
                <FiPlus size={15} />
                <span>Add Another Link</span>
              </button>
            </div>

            {/* Standard Message Template Preview */}
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="pub-msg">Standard Klaviyo Delivery Message</Label>
              <textarea
                id="pub-msg"
                rows={3}
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-800 placeholder:text-gray-400 focus:border-brand-500 focus:outline-hidden dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
                placeholder="Message included in Klaviyo delivery email..."
              />
            </div>

            {/* Klaviyo Webhook Fulfillment Flow Info */}
            <div className="rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 p-3 text-xs text-blue-800 dark:text-blue-300">
              <div className="flex items-start gap-2.5">
                <FiMail className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400 text-sm" />
                <div className="space-y-1">
                  <p className="font-semibold text-blue-900 dark:text-blue-200">
                    Automated Klaviyo Webhook Delivery &amp; Shopify Fulfillment
                  </p>
                  <p className="text-[11px] text-blue-700 dark:text-blue-300/80 leading-relaxed">
                    Submitting will trigger the <strong>Publish_Delivered</strong> email flow in Klaviyo. After Klaviyo delivers the email, it sends a confirmation webhook back to our app to automatically mark this order as <strong>Fulfilled</strong> on Shopify.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setIsOpen(false)}
                className="rounded-lg px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-brand-600 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                    <span>Sending Delivery Mail...</span>
                  </>
                ) : (
                  <>
                    <FiSend size={14} />
                    <span>Send Delivery Mail via Klaviyo</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </>
  );
}
