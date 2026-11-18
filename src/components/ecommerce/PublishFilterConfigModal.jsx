"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import { useToast } from "@/components/ui/toast/Toast";
import { useRouter } from "next/navigation";
import { FiFilter, FiPlus, FiTrash2, FiSettings, FiCheck } from "react-icons/fi";

export default function PublishFilterConfigModal({
  initialKeywords = [],
  initialProductIds = [],
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [keywords, setKeywords] = useState(
    initialKeywords.length > 0
      ? initialKeywords
      : ["Music on Spotify", "Spotify & Apple Music", "Spotify", "Apple Music", "Streaming", "Publish"]
  );
  const [newKeyword, setNewKeyword] = useState("");
  const [saving, setSaving] = useState(false);

  const toast = useToast();
  const router = useRouter();

  const handleAddKeyword = (e) => {
    if (e) e.preventDefault();
    const val = newKeyword.trim();
    if (!val) return;
    if (keywords.some((k) => k.toLowerCase() === val.toLowerCase())) {
      toast({ variant: "warning", title: "Already Exists", message: "This product keyword is already in the filter." });
      return;
    }
    setKeywords([...keywords, val]);
    setNewKeyword("");
  };

  const handleRemoveKeyword = (index) => {
    setKeywords(keywords.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publishProductKeywords: keywords,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to save filter configuration");
      }

      toast({
        variant: "success",
        title: "Filter Configured",
        message: "Publish order product filters updated successfully!",
      });
      setIsOpen(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast({
        variant: "error",
        title: "Error",
        message: err.message || "Could not save filter configuration.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700/60 transition shadow-2xs cursor-pointer shrink-0"
      >
        <FiSettings size={13} className="text-brand-500" />
        <span>Configure Publish Products</span>
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} className="max-w-md p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
              <FiFilter size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-800 dark:text-white/90">
                Configure Publish Products
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Only orders containing products with these titles will show in this filter.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex gap-2">
              <Input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddKeyword(e)}
                placeholder="e.g. Spotify & Apple Music"
                className="text-xs"
              />
              <Button size="sm" variant="primary" onClick={handleAddKeyword} className="shrink-0">
                <FiPlus size={14} />
                <span>Add</span>
              </Button>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {keywords.map((kw, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-lg border border-gray-100 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-900/40 text-xs"
                >
                  <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{kw}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(idx)}
                    className="text-gray-400 hover:text-red-500 transition p-1 cursor-pointer"
                  >
                    <FiTrash2 size={13} />
                  </button>
                </div>
              ))}
              {keywords.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4 italic">
                  No keywords added. All orders without songs will appear.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-gray-100 dark:border-gray-800">
            <Button size="sm" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
