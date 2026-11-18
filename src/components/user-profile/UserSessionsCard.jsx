"use client";

import React, { useState, useEffect } from "react";
import { 
  FiMonitor, 
  FiSmartphone, 
  FiTablet, 
  FiLogOut, 
  FiShield, 
  FiCheckCircle, 
  FiRefreshCw, 
  FiAlertTriangle,
  FiGlobe,
  FiClock
} from "react-icons/fi";
import Button from "@/components/ui/button/Button";
import Badge from "@/components/ui/badge/Badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast/Toast";

export default function UserSessionsCard() {
  const showToast = useToast();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Modal States
  const [sessionToRevoke, setSessionToRevoke] = useState(null);
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  const [isRevokeAllModalOpen, setIsRevokeAllModalOpen] = useState(false);

  const fetchSessions = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch("/api/users/sessions");
      const data = await res.json();
      if (res.ok && data.success) {
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleRevokeSingle = async () => {
    if (!sessionToRevoke) return;
    setRevoking(true);

    try {
      const res = await fetch(`/api/users/sessions?sessionId=${sessionToRevoke.sessionId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSessions((prev) => prev.filter((s) => s.sessionId !== sessionToRevoke.sessionId));
        setIsRevokeModalOpen(false);
        setSessionToRevoke(null);

        showToast({
          variant: "success",
          title: "Device Logged Out",
          message: `${sessionToRevoke.browser} on ${sessionToRevoke.os} has been logged out.`,
        });

        // If user logged out of their own current device, reload to sign in page
        if (data.isCurrent) {
          window.location.href = "/signin";
        }
      } else {
        showToast({
          variant: "error",
          title: "Action Failed",
          message: data.error || "Failed to log out device.",
        });
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Error",
        message: "An unexpected error occurred.",
      });
    } finally {
      setRevoking(false);
    }
  };

  const handleRevokeAllOther = async () => {
    setRevoking(true);

    try {
      const res = await fetch("/api/users/sessions?allOther=true", {
        method: "DELETE",
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSessions((prev) => prev.filter((s) => s.isCurrent));
        setIsRevokeAllModalOpen(false);

        showToast({
          variant: "success",
          title: "All Other Devices Logged Out",
          message: "All other active sessions have been immediately revoked.",
        });
      } else {
        showToast({
          variant: "error",
          title: "Action Failed",
          message: data.error || "Failed to log out other devices.",
        });
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Error",
        message: "An unexpected error occurred.",
      });
    } finally {
      setRevoking(false);
    }
  };

  const getDeviceIcon = (deviceType = "") => {
    const type = deviceType.toLowerCase();
    if (type === "mobile") return <FiSmartphone size={22} />;
    if (type === "tablet") return <FiTablet size={22} />;
    return <FiMonitor size={22} />;
  };

  const formatLastActive = (dateString, isCurrent) => {
    if (isCurrent) return "Active Now";
    if (!dateString) return "Recently";
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 2) return "Just now";
      if (diffMins < 60) return `${diffMins} minutes ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return "Recently";
    }
  };

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  if (loading) {
    return (
      <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 mt-6 animate-pulse bg-gray-100 dark:bg-gray-800/50 h-[220px]" />
    );
  }

  return (
    <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 bg-white dark:bg-white/[0.03] lg:p-6 mt-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Active Devices &amp; Sessions
            </h4>
            <Badge size="sm" color="success">
              {sessions.length} {sessions.length === 1 ? "Device Active" : "Devices Active"}
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Manage logged-in devices. Log out any unrecognized devices to keep your dashboard secure.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => fetchSessions(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03] transition disabled:opacity-50"
          >
            <FiRefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>

          {otherSessionsCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsRevokeAllModalOpen(true)}
              className="flex items-center gap-1.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
            >
              <FiShield size={14} />
              Log Out All Other Devices ({otherSessionsCount})
            </Button>
          )}
        </div>
      </div>

      {/* Device List */}
      <div className="mt-5 space-y-3.5">
        {sessions.map((sess) => (
          <div
            key={sess.sessionId || sess._id}
            className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border transition-all ${
              sess.isCurrent
                ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/5 shadow-xs"
                : "border-gray-200 bg-gray-50/50 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40 dark:hover:bg-gray-900/80"
            } gap-4`}
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  sess.isCurrent
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                    : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                }`}
              >
                {getDeviceIcon(sess.device)}
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                    {sess.browser} on {sess.os}
                  </span>
                  {sess.isCurrent && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400">
                      <FiCheckCircle size={12} /> This Device
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1 flex-wrap font-mono">
                  <span className="flex items-center gap-1">
                    <FiGlobe size={12} />
                    {sess.ip}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <FiClock size={12} />
                    {formatLastActive(sess.lastActive, sess.isCurrent)}
                  </span>
                  <span>•</span>
                  <span className="text-[11px] text-gray-400">
                    {sess.device}
                  </span>
                </div>
              </div>
            </div>

            {/* Action */}
            <div className="self-end sm:self-center">
              {sess.isCurrent ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-1">
                  Active Session
                </span>
              ) : (
                <button
                  onClick={() => {
                    setSessionToRevoke(sess);
                    setIsRevokeModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-gray-800 dark:text-rose-400 dark:hover:bg-rose-500/10 transition"
                >
                  <FiLogOut size={13} />
                  Log Out
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation Modal: Log Out Single Device */}
      <Modal
        isOpen={isRevokeModalOpen}
        onClose={() => setIsRevokeModalOpen(false)}
        className="max-w-md p-6"
      >
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 mx-auto">
            <FiLogOut size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              Log Out this Device?
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              Are you sure you want to log out from{" "}
              <strong className="text-gray-800 dark:text-white">
                {sessionToRevoke?.browser} on {sessionToRevoke?.os} (IP: {sessionToRevoke?.ip})
              </strong>
              ? The user on that device will be immediately signed out.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRevokeModalOpen(false)}
              disabled={revoking}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRevokeSingle}
              disabled={revoking}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {revoking ? "Logging out..." : "Log Out Device"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal: Log Out All Other Devices */}
      <Modal
        isOpen={isRevokeAllModalOpen}
        onClose={() => setIsRevokeAllModalOpen(false)}
        className="max-w-md p-6"
      >
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 mx-auto">
            <FiShield size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              Log Out All Other Devices?
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              This will immediately sign out all <strong>{otherSessionsCount}</strong> other active
              devices. You will stay signed in only on this current browser.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRevokeAllModalOpen(false)}
              disabled={revoking}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRevokeAllOther}
              disabled={revoking}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {revoking ? "Revoking..." : "Log Out All Other Devices"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
