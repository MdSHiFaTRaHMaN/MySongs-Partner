"use client";

import React, { useState, useEffect, Suspense } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { useToast } from "@/components/ui/toast/Toast";
import { useUser } from "@/context/UserContext";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const { user, loading: userLoading } = useUser();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);
  const activeTab = searchParams.get("tab") || "security"; // "security" or "integrations"
  const [initialData, setInitialData] = useState(null);
  const [runningTrashCleanup, setRunningTrashCleanup] = useState(false);
  const [trashCleanupResult, setTrashCleanupResult] = useState(null);

  const handleTabChange = (newTab) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
    if (newTab && newTab !== "security") {
      params.set("tab", newTab);
    } else {
      params.delete("tab");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const [formData, setFormData] = useState({
    shopifySecretId: "",
    shopifyClientId: "",
    shopifyAdminApiKey: "",
    shopUrl1: "",
    shopUrl2: "",
    sunoApiKey: "",
    sunoModel: "V3_5",
    activeAiProvider: "suno",
    murekaApiKey: "",
    murekaModel: "mureka-9.5",
    notificationEmail: "",
    contactPhone: "",
    klaviyoApiKey: "",
    previewDurationSeconds: 45,
    rateLimitPerMinute: 0,
    rateLimitPerHour: 0,
    rateLimitPerDay: 10,
    rateLimitPerMonth: 0,
    autoBlockEnabled: false,
    autoBlockGenerationCount: 5,
    autoBlockRequiredPurchases: 0,
    tableItemsPerPage: 50,
    trashBinRetentionDays: 30,
  });

  const handleRunCleanup = async () => {
    setRunningCleanup(true);
    setCleanupResult(null);
    try {
      const res = await fetch("/api/cron/s3-cleanup?days=30", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setCleanupResult(data);
        showToast({
          variant: "success",
          title: "S3 Cleanup Completed",
          message: data.message || `Deleted ${data.deletedFilesCount || 0} files.`,
        });
      } else {
        throw new Error(data.error || "Cleanup failed");
      }
    } catch (err) {
      console.error(err);
      showToast({
        variant: "error",
        title: "Cleanup Failed",
        message: err.message || "An error occurred during S3 cleanup.",
      });
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleRunTrashCleanup = async () => {
    setRunningTrashCleanup(true);
    setTrashCleanupResult(null);
    try {
      const days = formData.trashBinRetentionDays || 30;
      const res = await fetch(`/api/cron/trash-cleanup?days=${days}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTrashCleanupResult(data);
        showToast({
          variant: "success",
          title: "Trash Cleanup Completed",
          message: data.message || `Cleaned up expired orders & files.`,
        });
      } else {
        throw new Error(data.error || "Trash cleanup failed");
      }
    } catch (err) {
      console.error(err);
      showToast({
        variant: "error",
        title: "Trash Cleanup Failed",
        message: err.message || "An error occurred during Trash Bin cleanup.",
      });
    } finally {
      setRunningTrashCleanup(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        const newFormData = {
          shopifySecretId: data.shopifySecretId || "",
          shopifyClientId: data.shopifyClientId || "",
          shopifyAdminApiKey: data.shopifyAdminApiKey || "",
          shopUrl1: data.shopUrl1 || "",
          shopUrl2: data.shopUrl2 || "",
          sunoApiKey: data.sunoApiKey || "",
          sunoModel: data.sunoModel || "V3_5",
          activeAiProvider: data.activeAiProvider || "suno",
          murekaApiKey: data.murekaApiKey || "",
          murekaModel: data.murekaModel || "mureka-9.5",
          notificationEmail: data.notificationEmail || "",
          contactPhone: data.contactPhone || "",
          klaviyoApiKey: data.klaviyoApiKey || "",
          previewDurationSeconds: data.previewDurationSeconds ?? 45,
          rateLimitPerMinute: data.rateLimitPerMinute ?? 0,
          rateLimitPerHour: data.rateLimitPerHour ?? 0,
          rateLimitPerDay: data.rateLimitPerDay ?? 10,
          rateLimitPerMonth: data.rateLimitPerMonth ?? 0,
          autoBlockEnabled: data.autoBlockEnabled ?? false,
          autoBlockGenerationCount: data.autoBlockGenerationCount ?? 5,
          autoBlockRequiredPurchases: data.autoBlockRequiredPurchases ?? 0,
          tableItemsPerPage: data.tableItemsPerPage ?? 50,
          trashBinRetentionDays: data.trashBinRetentionDays ?? 30,
        };
        setFormData(newFormData);
        setInitialData(newFormData);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      showToast({ variant: "error", title: "Error", message: "Failed to load settings" });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.type === 'number') {
      value = value === "" ? 0 : Number(value);
    }
    setFormData({ ...formData, [e.target.name]: value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setInitialData(formData);
        showToast({ variant: "success", title: "Success", message: "Settings updated successfully!" });
      } else {
        const errorData = await res.json();
        showToast({ variant: "error", title: "Error", message: errorData.message || "Failed to update settings" });
      }
    } catch (error) {
      console.error("Error updating settings:", error);
      showToast({ variant: "error", title: "Error", message: "An error occurred while updating settings" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || userLoading) return <LoadingSpinner minHeight="min-h-[400px]" />;

  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] text-center">
        <h1 className="text-6xl font-bold text-gray-800 dark:text-white/90 mb-4">401</h1>
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">Unauthorized Access</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          You do not have the required administrator privileges to view or edit platform settings.
        </p>
      </div>
    );
  }

  const isModified = initialData && JSON.stringify(formData) !== JSON.stringify(initialData);

  return (
    <div className="space-y-6">
      <PageBreadcrumb pageTitle="Platform Settings" />

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        <button
          type="button"
          className={`px-4 py-2 font-semibold text-sm transition-colors cursor-pointer ${
            activeTab === "security"
              ? "border-b-2 border-brand-500 text-brand-500"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
          onClick={() => handleTabChange("security")}
        >
          Security & Limits
        </button>
        <button
          type="button"
          className={`px-4 py-2 font-semibold text-sm transition-colors cursor-pointer ${
            activeTab === "integrations"
              ? "border-b-2 border-brand-500 text-brand-500"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
          onClick={() => handleTabChange("integrations")}
        >
          Integrations & API
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        
        {activeTab === "security" && (
          <div className="space-y-6 animate-fade-in">
            {/* Music Preview Settings */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <h4 className="mb-6 text-lg font-semibold text-gray-800 dark:text-white/90">
                Music Preview Settings
              </h4>
              <div className="grid grid-cols-1 gap-6">
                <div className="col-span-1 md:col-span-1">
                  <Label>Preview Duration (Seconds)</Label>
                  <Input
                    type="number"
                    name="previewDurationSeconds"
                    value={formData.previewDurationSeconds}
                    onChange={handleChange}
                    placeholder="e.g. 45"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The duration of the audio preview generated for users.
                  </p>
                </div>
              </div>
            </div>

            {/* Generation Limits */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <h4 className="mb-6 text-lg font-semibold text-gray-800 dark:text-white/90">
                Generation Limits
              </h4>
              <p className="mb-4 text-sm text-gray-500">Set rate limits for music generation per user (0 means unlimited).</p>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
                <div className="col-span-1">
                  <Label>Per Minute</Label>
                  <Input
                    type="number"
                    name="rateLimitPerMinute"
                    value={formData.rateLimitPerMinute}
                    onChange={handleChange}
                    placeholder="0"
                  />
                </div>
                <div className="col-span-1">
                  <Label>Per Hour</Label>
                  <Input
                    type="number"
                    name="rateLimitPerHour"
                    value={formData.rateLimitPerHour}
                    onChange={handleChange}
                    placeholder="0"
                  />
                </div>
                <div className="col-span-1">
                  <Label>Per Day (24h)</Label>
                  <Input
                    type="number"
                    name="rateLimitPerDay"
                    value={formData.rateLimitPerDay}
                    onChange={handleChange}
                    placeholder="10"
                  />
                </div>
                <div className="col-span-1">
                  <Label>Per Month (30d)</Label>
                  <Input
                    type="number"
                    name="rateLimitPerMonth"
                    value={formData.rateLimitPerMonth}
                    onChange={handleChange}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            {/* Table & Display Settings */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <h4 className="mb-6 text-lg font-semibold text-gray-800 dark:text-white/90">
                Table &amp; Pagination Settings
              </h4>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="col-span-1">
                  <Label>Table Items Per Page</Label>
                  <Input
                    type="number"
                    name="tableItemsPerPage"
                    value={formData.tableItemsPerPage}
                    onChange={handleChange}
                    placeholder="50"
                    min="5"
                    max="500"
                  />
                  <p className="mt-1 text-xs text-gray-400">Controls how many rows appear per page on All Music, Ordered Music, Customers, and Orders tables.</p>
                </div>
              </div>
            </div>

            {/* Unified Trash Bin & AWS S3 Storage Lifecycle */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
                    Trash Bin &amp; AWS S3 Storage Lifecycle
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
                    Unpurchased songs and deleted music/video orders are moved to the Trash Bin and automatically purged along with all AWS S3 media files after this retention period.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  type="button"
                  onClick={handleRunTrashCleanup}
                  disabled={runningTrashCleanup}
                >
                  {runningTrashCleanup ? "Cleaning Storage & Trash..." : "Run Storage & Trash Cleanup Now"}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="col-span-1">
                  <Label>Auto-Delete Retention (Days)</Label>
                  <Input
                    type="number"
                    name="trashBinRetentionDays"
                    value={formData.trashBinRetentionDays}
                    onChange={handleChange}
                    placeholder="30"
                    min="1"
                    max="365"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Number of days items remain in Trash Bin before permanent deletion of database records and AWS S3 files (e.g. 7, 15, 30, 60 days).
                  </p>
                </div>
              </div>

              {trashCleanupResult && (
                <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-xs space-y-1 font-mono">
                  <p className="font-semibold">{trashCleanupResult.message}</p>
                  <p className="text-[11px] opacity-80">
                    Moved to Trash: {trashCleanupResult.movedToTrashCount || 0} &bull; Purged Music Orders: {trashCleanupResult.deletedMusicOrdersCount} &bull; Purged Video Orders: {trashCleanupResult.deletedVideoOrdersCount} &bull; Deleted S3 Files: {trashCleanupResult.deletedS3FilesCount}
                  </p>
                </div>
              )}
            </div>

            {/* Auto-Block Logic */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <h4 className="mb-6 text-lg font-semibold text-gray-800 dark:text-white/90">
                Auto-Block System
              </h4>
              <div className="grid grid-cols-1 gap-6">
                <div className="col-span-1 flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="autoBlockEnabled"
                    name="autoBlockEnabled"
                    checked={formData.autoBlockEnabled}
                    onChange={handleChange}
                    className="w-5 h-5 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  <Label htmlFor="autoBlockEnabled" className="mb-0 cursor-pointer">Enable Auto-Block System</Label>
                </div>
                {formData.autoBlockEnabled && (
                  <div className="col-span-1 grid grid-cols-1 gap-6 lg:grid-cols-2 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
                    <div className="col-span-1">
                      <Label>Generation Threshold</Label>
                      <Input
                        type="number"
                        name="autoBlockGenerationCount"
                        value={formData.autoBlockGenerationCount}
                        onChange={handleChange}
                        placeholder="e.g. 5"
                      />
                      <p className="mt-1 text-xs text-gray-500">Block users who generate this many songs...</p>
                    </div>
                    <div className="col-span-1">
                      <Label>Required Purchases</Label>
                      <Input
                        type="number"
                        name="autoBlockRequiredPurchases"
                        value={formData.autoBlockRequiredPurchases}
                        onChange={handleChange}
                        placeholder="e.g. 0"
                      />
                      <p className="mt-1 text-xs text-gray-500">...while having this many (or fewer) purchases.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "integrations" && (
          <div className="space-y-6 animate-fade-in">
            {/* Shopify Integration Settings */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <h4 className="mb-6 text-lg font-semibold text-gray-800 dark:text-white/90">
                Shopify Integration
              </h4>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="col-span-1">
                  <Label>Shopify Secret ID</Label>
                  <Input
                    type="password"
                    name="shopifySecretId"
                    value={formData.shopifySecretId}
                    onChange={handleChange}
                    placeholder="Enter Shopify Secret ID"
                  />
                </div>
                <div className="col-span-1">
                  <Label>Shopify Client ID</Label>
                  <Input
                    type="password"
                    name="shopifyClientId"
                    value={formData.shopifyClientId}
                    onChange={handleChange}
                    placeholder="Enter Shopify Client ID"
                  />
                </div>
                <div className="col-span-1 lg:col-span-2">
                  <Label>Shopify Admin API Access Key</Label>
                  <Input
                    type="password"
                    name="shopifyAdminApiKey"
                    value={formData.shopifyAdminApiKey}
                    onChange={handleChange}
                    placeholder="shpat_..."
                  />
                </div>
                <div className="col-span-1 lg:col-span-2">
                  <Label>Shop URL</Label>
                  <Input
                    type="password"
                    name="shopUrl1"
                    value={formData.shopUrl1}
                    onChange={handleChange}
                    placeholder="e.g., https://your-store.myshopify.com"
                  />
                </div>
                <div className="col-span-1 lg:col-span-2">
                  <Label>Host URL</Label>
                  <Input
                    type="password"
                    name="shopUrl2"
                    value={formData.shopUrl2}
                    onChange={handleChange}
                    placeholder="e.g., https://your-domain.com"
                  />
                </div>
              </div>
            </div>

            {/* AI Integration Settings */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                    AI Music Generator Provider
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Select which AI provider is actively used to generate custom songs across the storefront
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <label
                    className={`cursor-pointer px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-2 transition ${
                      formData.activeAiProvider === "suno"
                        ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="activeAiProvider"
                      value="suno"
                      checked={formData.activeAiProvider === "suno"}
                      onChange={handleChange}
                      className="hidden"
                    />
                    <span>Suno AI</span>
                    {formData.activeAiProvider === "suno" && <span className="h-2 w-2 rounded-full bg-brand-500"></span>}
                  </label>

                  <label
                    className={`cursor-pointer px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-2 transition ${
                      formData.activeAiProvider === "mureka"
                        ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="activeAiProvider"
                      value="mureka"
                      checked={formData.activeAiProvider === "mureka"}
                      onChange={handleChange}
                      className="hidden"
                    />
                    <span>Mureka AI</span>
                    {formData.activeAiProvider === "mureka" && <span className="h-2 w-2 rounded-full bg-brand-500"></span>}
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Suno AI Configuration Card */}
                <div className={`p-4 rounded-xl border transition ${
                  formData.activeAiProvider === "suno"
                    ? "border-brand-300 bg-brand-50/30 dark:border-brand-800/60 dark:bg-brand-950/10"
                    : "border-gray-200 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-900/20"
                } space-y-4`}>
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="font-semibold text-sm text-gray-800 dark:text-white flex items-center gap-2">
                      Suno AI Configuration
                    </span>
                    {formData.activeAiProvider === "suno" && (
                      <span className="text-[10px] uppercase font-bold tracking-wider bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full dark:bg-brand-900/40 dark:text-brand-300">
                        Active Provider
                      </span>
                    )}
                  </div>

                  <div>
                    <Label>Suno API Key</Label>
                    <Input
                      type="password"
                      name="sunoApiKey"
                      value={formData.sunoApiKey}
                      onChange={handleChange}
                      placeholder="Enter Suno API Key"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">API Key for Suno AI music generation</p>
                  </div>

                  <div>
                    <Label>Suno AI Model</Label>
                    <div className="relative">
                      <select
                        name="sunoModel"
                        value={formData.sunoModel || "V3_5"}
                        onChange={handleChange}
                        className="h-11 w-full appearance-none rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                      >
                        <option value="V3_5">Suno v3.5 (Recommended - High Quality)</option>
                        <option value="V3_0">Suno v3.0 (Standard)</option>
                        <option value="V2_0">Suno v2.0 (Legacy)</option>
                        <option value="V4_0">Suno v4.0 (Experimental)</option>
                        <option value="V4_5">Suno v4.5 (Experimental)</option>
                      </select>
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                        ▼
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Choose which Suno engine model to use for song generation</p>
                  </div>
                </div>

                {/* Mureka AI Configuration Card */}
                <div className={`p-4 rounded-xl border transition ${
                  formData.activeAiProvider === "mureka"
                    ? "border-brand-300 bg-brand-50/30 dark:border-brand-800/60 dark:bg-brand-950/10"
                    : "border-gray-200 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-900/20"
                } space-y-4`}>
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="font-semibold text-sm text-gray-800 dark:text-white flex items-center gap-2">
                      Mureka AI Configuration
                    </span>
                    {formData.activeAiProvider === "mureka" && (
                      <span className="text-[10px] uppercase font-bold tracking-wider bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full dark:bg-brand-900/40 dark:text-brand-300">
                        Active Provider
                      </span>
                    )}
                  </div>

                  <div>
                    <Label>Mureka AI API Key (platform.mureka.ai)</Label>
                    <Input
                      type="password"
                      name="murekaApiKey"
                      value={formData.murekaApiKey}
                      onChange={handleChange}
                      placeholder="Enter Mureka API Key"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Platform / Service API Key for Mureka AI</p>
                  </div>

                  <div>
                    <Label>Mureka AI Model</Label>
                    <div className="relative">
                      <select
                        name="murekaModel"
                        value={formData.murekaModel || "mureka-9.5"}
                        onChange={handleChange}
                        className="h-11 w-full appearance-none rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                      >
                        <option value="auto">Auto (Recommended - Best Quality)</option>
                        <option value="mureka-9.5">Mureka v9.5 (State of the Art)</option>
                        <option value="mureka-7.6">Mureka v7.6 (Standard)</option>
                        <option value="mureka-7.5">Mureka v7.5 (Fast)</option>
                      </select>
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                        ▼
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Choose the active model version used by Mureka AI</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Klaviyo Integration Settings */}
            <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6 bg-white dark:bg-white/[0.03]">
              <h4 className="mb-6 text-lg font-semibold text-gray-800 dark:text-white/90">
                Klaviyo Integration
              </h4>
              <div className="grid grid-cols-1 gap-6">
                <div className="col-span-1">
                  <Label>Klaviyo Private API Key</Label>
                  <Input
                    type="password"
                    name="klaviyoApiKey"
                    value={formData.klaviyoApiKey}
                    onChange={handleChange}
                    placeholder="pk_..."
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => fetchSettings()} disabled={!isModified || saving}>
            Discard Changes
          </Button>
          <Button type="submit" disabled={!isModified || saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>

      </form>
    </div>
  );
}
