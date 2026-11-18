"use client";

import React, { useState } from "react";
import { useToast } from "@/components/ui/toast/Toast";
import {
  FiCopy,
  FiCheck,
  FiExternalLink,
  FiUploadCloud,
  FiMail,
  FiLoader,
  FiRefreshCw,
  FiLock,
  FiUnlock,
} from "react-icons/fi";

export default function VideoUploadLinkCard({
  orderId,
  orderNumber,
  customerEmail,
  shopUrl = "https://myownsongs.com",
  mediaCount = 0,
  uploadToken: initialToken = "",
  uploadTokenStatus: initialStatus = "active",
  lastSubmittedAt = null,
  allowMusicRegeneration: initialAllowMusicRegen = true,
}) {
  const [currentToken, setCurrentToken] = useState(initialToken);
  const [tokenStatus, setTokenStatus] = useState(initialStatus);
  const [musicRegenAllowed, setMusicRegenAllowed] = useState(initialAllowMusicRegen);
  const [copied, setCopied] = useState(false);
  const [sendingMail, setSendingMail] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [togglingMusicRegen, setTogglingMusicRegen] = useState(false);
  const showToast = useToast();

  const cleanShopUrl = (shopUrl || "").replace(/\/$/, "");
  const cleanOrderNum = String(orderNumber || "").replace(/^#/, "").trim();
  const effectiveOrderId = orderId || cleanOrderNum;

  // Single-Use secure URL using URL-safe Base64 token (NO customer email in URL!)
  const uploadUrl = currentToken
    ? `${cleanShopUrl}/pages/create-video?token=${encodeURIComponent(currentToken)}`
    : `${cleanShopUrl}/pages/create-video?id=${encodeURIComponent(effectiveOrderId)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(uploadUrl);
      setCopied(true);
      showToast({
        variant: "success",
        title: "Link Copied!",
        message: "Customer video upload link copied to clipboard.",
      });
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      showToast({
        variant: "error",
        title: "Copy Failed",
        message: "Could not copy link to clipboard.",
      });
    }
  };

  const handleGenerateNewToken = async () => {
    setGeneratingToken(true);
    try {
      const res = await fetch(`/api/video-orders/${effectiveOrderId}/generate-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate new token");
      }
      setCurrentToken(data.uploadToken);
      setTokenStatus(data.uploadTokenStatus || "active");
      showToast({
        variant: "success",
        title: "New Link Generated!",
        message: "A fresh one-time upload link has been created and is now active.",
      });
    } catch (err) {
      showToast({
        variant: "error",
        title: "Generation Failed",
        message: err.message || "Could not generate new upload link.",
      });
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleToggleStatus = async (targetAction) => {
    setTogglingStatus(true);
    try {
      const res = await fetch(`/api/video-orders/${effectiveOrderId}/generate-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: targetAction }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to ${targetAction} portal`);
      }
      setTokenStatus(data.uploadTokenStatus);
      showToast({
        variant: "success",
        title: targetAction === "unlock" ? "Portal Reopened!" : "Portal Locked!",
        message: data.message || `Upload portal is now ${data.uploadTokenStatus}.`,
      });
    } catch (err) {
      showToast({
        variant: "error",
        title: "Action Failed",
        message: err.message || "Could not update portal status.",
      });
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleToggleMusicRegen = async () => {
    setTogglingMusicRegen(true);
    const nextVal = !musicRegenAllowed;
    try {
      const res = await fetch(`/api/video-orders/${effectiveOrderId}/generate-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_music_regen", allowMusicRegeneration: nextVal }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update music regeneration setting");
      }
      setMusicRegenAllowed(data.allowMusicRegeneration);
      showToast({
        variant: "success",
        title: data.allowMusicRegeneration ? "Music Regeneration ON" : "Music Regeneration OFF",
        message: data.allowMusicRegeneration
          ? "Customer can now regenerate / change music on their upload portal page."
          : "Customer cannot regenerate music on their upload portal page.",
      });
    } catch (err) {
      showToast({
        variant: "error",
        title: "Toggle Failed",
        message: err.message || "Could not toggle music regeneration.",
      });
    } finally {
      setTogglingMusicRegen(false);
    }
  };

  const handleSendEmail = async () => {
    if (!customerEmail) {
      showToast({
        variant: "warning",
        title: "No Email Address",
        message: "Customer email is missing for this order.",
      });
      return;
    }

    setSendingMail(true);
    try {
      const res = await fetch("/api/video-tool/send-upload-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: cleanOrderNum,
          email: customerEmail,
          uploadUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to dispatch upload link email");
      }
      showToast({
        variant: "success",
        title: "Email Sent!",
        message: `Upload link sent to ${customerEmail} via Klaviyo.`,
      });
    } catch (err) {
      showToast({
        variant: "error",
        title: "Dispatch Failed",
        message: err.message || "Failed to send upload link email.",
      });
    } finally {
      setSendingMail(false);
    }
  };

  const isPortalActive = tokenStatus === "active";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03] space-y-4 shadow-xs">
      {/* Header and Status Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-gray-800 dark:text-white/90 flex items-center gap-2">
          <FiUploadCloud className="text-brand-500" size={18} />
          <span>Customer Video Upload Portal</span>
        </h3>
        <div className="flex items-center gap-2">
          {/* Portal Open/Closed Badge */}
          {isPortalActive ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Portal Open (1 Submission Allowed)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30">
              <FiLock size={11} />
              Portal Closed / Locked (Submitted)
            </span>
          )}

          {/* Files Uploaded Badge */}
          {mediaCount > 0 ? (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400">
              ✓ {mediaCount} Files Uploaded
            </span>
          ) : (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              Waiting for Upload
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        This is a <strong>secure single-use link</strong> with no email exposed. The customer can upload photos &
        videos and edit notes once. When submitted, the link locks automatically. To allow further edits, generate a new
        link or reopen below.
      </p>

      {/* Music Regeneration Control for Customer Portal */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold text-sm">
            🎵
          </div>
          <div>
            <div className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <span>Customer Music Regeneration</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                musicRegenAllowed 
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300" 
                  : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border border-gray-300"
              }`}>
                {musicRegenAllowed ? "ON (Allowed)" : "OFF (Disabled)"}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              When ON, this customer can regenerate or switch music tracks on their upload page. Turn OFF to freeze the music track.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={togglingMusicRegen}
          onClick={handleToggleMusicRegen}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition shadow-xs ${
            musicRegenAllowed
              ? "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900"
              : "bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600"
          } disabled:opacity-50`}
        >
          {togglingMusicRegen ? <FiLoader className="animate-spin" size={12} /> : null}
          <span>{musicRegenAllowed ? "Turn OFF Regeneration" : "Turn ON Regeneration"}</span>
        </button>
      </div>

      {/* Link Input Bar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={uploadUrl}
          className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-mono text-gray-700 outline-none select-all dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-600 transition shadow-xs cursor-pointer"
        >
          {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      {/* Actions & Portal Control */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          {/* Email button */}
          <button
            type="button"
            disabled={sendingMail}
            onClick={handleSendEmail}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition cursor-pointer disabled:opacity-50"
          >
            {sendingMail ? <FiLoader className="animate-spin" size={13} /> : <FiMail size={13} />}
            <span>{sendingMail ? "Sending..." : "Email Link via Klaviyo"}</span>
          </button>

          {/* Open in new tab */}
          <a
            href={uploadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition"
          >
            <FiExternalLink size={13} />
            <span>Open Link in New Tab</span>
          </a>
        </div>

        {/* Portal Reopen / Lock Controls */}
        <div className="flex items-center gap-2">
          {isPortalActive ? (
            <button
              type="button"
              disabled={togglingStatus}
              onClick={() => handleToggleStatus("lock")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 transition cursor-pointer disabled:opacity-50"
              title="Lock customer portal now so customer cannot upload or edit"
            >
              <FiLock size={13} />
              <span>Lock Portal</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={togglingStatus}
              onClick={() => handleToggleStatus("unlock")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300 transition cursor-pointer disabled:opacity-50"
              title="Reopen existing link for 1 more submission"
            >
              <FiUnlock size={13} />
              <span>Reopen Existing Link</span>
            </button>
          )}

          {/* Generate New Fresh Token Button */}
          <button
            type="button"
            disabled={generatingToken}
            onClick={handleGenerateNewToken}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 text-white px-3 py-1.5 text-xs font-semibold hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition cursor-pointer shadow-xs disabled:opacity-50"
            title="Generate a brand new unique one-time link"
          >
            <FiRefreshCw className={generatingToken ? "animate-spin" : ""} size={13} />
            <span>{generatingToken ? "Generating..." : "Generate New Link"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
