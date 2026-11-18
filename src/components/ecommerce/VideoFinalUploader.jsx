"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FiUploadCloud, FiCheck, FiVideo, FiRefreshCw, FiAlertCircle, FiTrash2 } from "react-icons/fi";
import Button from "@/components/ui/button/Button";
import { useToast } from "@/components/ui/toast/Toast";
import { Modal } from "@/components/ui/modal";

export default function VideoFinalUploader({ order, onVideoUpdated }) {
  const showToast = useToast();
  const router = useRouter();

  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState(order?.finalVideoUrl || "");
  const [finalVideoKey, setFinalVideoKey] = useState(order?.finalVideoKey || "");

  // Sync state when order prop changes or a revision is created
  React.useEffect(() => {
    setFinalVideoUrl(order?.finalVideoUrl || "");
    setFinalVideoKey(order?.finalVideoKey || "");
  }, [order?.finalVideoUrl, order?.finalVideoKey]);

  React.useEffect(() => {
    const handleVideoUpdated = (e) => {
      if (e.detail) {
        if (e.detail.finalVideoUrl !== undefined) {
          setFinalVideoUrl(e.detail.finalVideoUrl);
        }
        if (e.detail.finalVideoKey !== undefined) {
          setFinalVideoKey(e.detail.finalVideoKey);
        }
      }
    };

    window.addEventListener("video-order-updated", handleVideoUpdated);
    return () => window.removeEventListener("video-order-updated", handleVideoUpdated);
  }, []);

  const handleFileUpload = async (file) => {
    if (!file) return;

    // Validate video type
    if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|mov|mkv|webm)$/i)) {
      showToast({ variant: "error", title: "Invalid File", message: "Please select a valid MP4 or MOV video file." });
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      let key = "";
      let url = "";

      const orderId = order?.videoId || order?.shopifyOrderId || order?._id || "";

      // 1. Direct S3 Presigned Upload (Handles any file size: 50MB, 200MB, 2GB+ without server memory limits)
      try {
        const presignRes = await fetch("/api/video-tool/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "video/mp4",
            fileType: "final_video",
            orderId: orderId,
            videoId: order?.videoId || "",
          }),
        });
        const presignData = await presignRes.json();

        if (presignData.success && presignData.uploadUrl) {
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", presignData.uploadUrl, true);
            xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                setProgress(pct);
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(`S3 direct upload failed with status ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error("Network error during direct S3 upload"));
            xhr.send(file);
          });

          key = presignData.key;
          url = presignData.url;
        } else {
          throw new Error(presignData.error || "Failed to generate presigned upload URL");
        }
      } catch (directUploadErr) {
        console.warn("Direct S3 upload fallback to backend upload:", directUploadErr);
        // Fallback to backend stream upload
        const uploadResult = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/video-tool/upload-file", true);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
          xhr.setRequestHeader("x-file-type", "final_video");
          if (orderId) xhr.setRequestHeader("x-order-id", encodeURIComponent(orderId));

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setProgress(pct);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const resData = JSON.parse(xhr.responseText);
                if (resData.success) {
                  resolve(resData);
                } else {
                  reject(new Error(resData.error || "Backend upload failed"));
                }
              } catch (err) {
                reject(new Error("Invalid response from server"));
              }
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error("Network error during backend upload"));
          xhr.send(file);
        });

        key = uploadResult.key;
        url = uploadResult.url;
      }

      // 2. Update VideoOrder in database
      const targetId = encodeURIComponent(order.videoId || order._id || order.shopifyOrderId || order.shopifyOrderNumber);
      const updateRes = await fetch(`/api/video-orders/${targetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finalVideoKey: key,
          finalVideoUrl: url,
          status: "ready", // Video is ready for delivery
        }),
      });

      const updateData = await updateRes.json();
      if (!updateRes.ok) {
        throw new Error(updateData.error || "Failed to update order with final video");
      }

      setFinalVideoKey(key);
      setFinalVideoUrl(url);
      showToast({
        variant: "success",
        title: "Video Uploaded",
        message: "Final music video has been uploaded and marked as Ready!",
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("video-order-updated", {
            detail: { finalVideoKey: key, finalVideoUrl: url, status: "ready" },
          })
        );
      }

      router.refresh();
      if (onVideoUpdated) onVideoUpdated(updateData.order);
    } catch (err) {
      console.error("Final video upload error:", err);
      showToast({
        variant: "error",
        title: "Upload Failed",
        message: err.message || "Failed to upload final video",
      });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDeleteVideo = async () => {
    setDeleting(true);
    try {
      const targetId = order.shopifyOrderId || order.videoId || order._id;
      const res = await fetch(`/api/video-orders/${targetId}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete video");
      }

      setFinalVideoKey("");
      setFinalVideoUrl("");
      setIsDeleteModalOpen(false);

      showToast({
        variant: "success",
        title: "Video Deleted",
        message: "Final video has been permanently deleted.",
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("video-order-updated", {
            detail: { finalVideoKey: "", finalVideoUrl: "", status: "created" },
          })
        );
      }

      router.refresh();
      if (onVideoUpdated) onVideoUpdated(data.order);
    } catch (error) {
      console.error("Delete video error:", error);
      showToast({
        variant: "error",
        title: "Delete Failed",
        message: error.message || "Failed to delete video",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Native Range (HTTP 206) streaming endpoint - loads instant thumbnail, plays large 50MB+ files with zero buffering lag
  const playableSrc = finalVideoKey
    ? `/api/video-tool/stream-video?key=${encodeURIComponent(finalVideoKey)}`
    : finalVideoUrl || "";

  const replaceFileInputRef = React.useRef(null);
  const browseFileInputRef = React.useRef(null);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Final Rendered Video (Editor Delivery Workspace)
        </h3>
        <p className="text-xs text-gray-500">
          Upload the finalized music video here. Once uploaded, you can deliver it to the customer via Klaviyo.
        </p>
      </div>

      {(finalVideoKey || finalVideoUrl) ? (
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden bg-black border border-gray-200 dark:border-white/[0.1] aspect-video w-full flex items-center justify-center relative group">
            <video
              key={playableSrc}
              controls
              playsInline
              preload="metadata"
              src={playableSrc}
              className="w-full h-full object-contain"
            >
              Your browser does not support the video tag.
            </video>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold dark:bg-green-500/10 dark:text-green-400">
              <FiCheck size={14} /> Final Video Ready
            </span>

            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(playableSrc, "_blank")}
              startIcon={<FiVideo size={16} />}
            >
              Open in New Tab
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => replaceFileInputRef.current?.click()}
              disabled={uploading || deleting}
              startIcon={<FiRefreshCw size={15} />}
            >
              Replace Video
            </Button>
            <input
              ref={replaceFileInputRef}
              type="file"
              accept="video/*,.mp4,.mov"
              className="hidden"
              disabled={uploading || deleting}
              onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
            />

            <Button
              size="sm"
              onClick={() => setIsDeleteModalOpen(true)}
              disabled={uploading || deleting}
              startIcon={<FiTrash2 size={15} />}
              className="bg-rose-600 hover:bg-rose-700 text-white shadow-theme-xs"
            >
              Delete Video
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            isDragOver
              ? "border-brand-500 bg-brand-50/50 dark:bg-brand-500/10"
              : "border-gray-300 dark:border-gray-700 hover:border-brand-400"
          }`}
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
              <FiUploadCloud size={28} />
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                Drag & drop the completed music video here
              </p>
              <p className="text-xs text-gray-500 mt-1">Supports MP4, MOV, WebM (up to 2GB)</p>
            </div>

            <Button
              size="sm"
              variant="primary"
              onClick={() => browseFileInputRef.current?.click()}
              disabled={uploading}
              startIcon={<FiVideo size={16} />}
              className="mt-2"
            >
              Browse Video File
            </Button>
            <input
              ref={browseFileInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.mkv"
              className="hidden"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
            />
          </div>
        </div>
      )}

      {/* Upload Progress Bar */}
      {uploading && (
        <div className="mt-4 p-4 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-100 dark:border-orange-500/20">
          <div className="flex justify-between items-center text-xs font-medium text-orange-800 dark:text-orange-300 mb-2">
            <span>Uploading final video...</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-brand-500 h-2 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Confirmation Modal to Delete Video from S3 */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} className="max-w-md p-6">
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 mx-auto">
            <FiTrash2 size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              Delete Final Video?
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              This will <strong>permanently delete</strong> the rendered music video file from your storage and reset the workspace.
            </p>
            <p className="text-xs text-rose-500 font-medium mt-1">
              This action cannot be undone.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleDeleteVideo}
              disabled={deleting}
              startIcon={<FiTrash2 size={15} />}
              className="bg-rose-600 hover:bg-rose-700 text-white shadow-theme-xs"
            >
              {deleting ? "Deleting from S3..." : "Permanently Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
