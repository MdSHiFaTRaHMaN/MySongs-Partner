"use client";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { FiLock, FiArrowLeft, FiSend } from "react-icons/fi";

const NAV_LABELS = {
  "/": "Dashboard",
  "/orders": "Shopify Orders",
  "/customers": "Customers CRM",
  "/ordered-musics": "Customer Choice Music",
  "/all-musics": "All Music",
  "/users": "Staff Management",
  "/trash": "Trash Bin",
  "/form-elements": "Form Elements",
};

function UnauthorizedContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const path = searchParams.get("path") || "/";
  const labelFromQuery = searchParams.get("label");
  const label = labelFromQuery || NAV_LABELS[path] || path;

  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRequestAccess() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedPath: path,
          requestedPathLabel: label,
          reason,
        }),
      });
      const data = await res.json();
      if (res.ok || (data.success && data.message?.includes("already pending"))) {
        setSubmitted(true);
      } else {
        setError(data.error || "Failed to submit request. Please try again.");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">

        {/* Lock Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-orange-50 dark:bg-orange-500/10">
          <FiLock className="text-orange-500 text-4xl" />
        </div>

        <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
          Access Restricted
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">
          You don&apos;t have permission to access:
        </p>
        <div className="inline-block mb-6 rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-semibold text-orange-500">
          {label}
        </div>

        {!submitted ? (
          <>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-5">
              You can request access from the administrator. Optionally add a reason for your request.
            </p>

            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for requesting access (optional)..."
              className="w-full mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 dark:bg-gray-900 dark:border-gray-700 dark:text-white/90 resize-none"
            />

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-500 dark:bg-red-500/10">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.07]"
              >
                <FiArrowLeft /> Go Back
              </button>

              <button
                onClick={handleRequestAccess}
                disabled={loading}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
              >
                <FiSend />
                {loading ? "Sending..." : "Request Access"}
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-green-200 bg-green-50 dark:bg-green-500/10 dark:border-green-500/20 p-6">
            <div className="text-4xl mb-3">✅</div>
            <h3 className="text-lg font-bold text-green-700 dark:text-green-400 mb-1">
              Request Sent!
            </h3>
            <p className="text-sm text-green-600 dark:text-green-300 mb-4">
              Your access request for <strong>{label}</strong> has been sent to the administrator for review.
            </p>
            <button
              onClick={() => {
                if (typeof window !== "undefined" && window.history.length > 1) {
                  router.back();
                } else {
                  router.push("/");
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
            >
              <FiArrowLeft /> Go Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[80vh] items-center justify-center text-gray-500">Loading...</div>}>
      <UnauthorizedContent />
    </Suspense>
  );
}
