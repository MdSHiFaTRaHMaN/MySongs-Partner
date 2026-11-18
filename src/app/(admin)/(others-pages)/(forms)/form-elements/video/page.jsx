"use client";
import React, { useState, useEffect } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import { useToast } from "@/components/ui/toast/Toast";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import { FiVideo, FiPlus, FiTrash2, FiMove, FiCheck, FiSave, FiLayers } from "react-icons/fi";

export default function VideoToolsPage() {
  const showToast = useToast();
  const [options, setOptions] = useState({
    packages: [],
    rushOrderTitle: "Rush My Video Order",
    rushOrderDescription: "Order delivered in under 2 hours",
    step1Title: "Step 1: Upload your audio track",
    step1Subtitle: "Upload your custom song or any audio file you want in the music video.",
    step2Title: "Step 2: Upload photos and video clips",
    step2Subtitle: "Add your favorite pictures and short video clips to make your music video unforgettable.",
    step3Title: "Step 3: Select your package",
    step3Subtitle: "Choose your music video production package and proceed to checkout."
  });

  const [initialOptions, setInitialOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shopifyProducts, setShopifyProducts] = useState([]);
  const [fetchingProducts, setFetchingProducts] = useState(false);

  const [draggedPkg, setDraggedPkg] = useState(null);
  const [draggablePkgId, setDraggablePkgId] = useState(null);
  const [draggedFeature, setDraggedFeature] = useState({ pkgIndex: null, featureIndex: null });

  const hasChanged = JSON.stringify(options) !== JSON.stringify(initialOptions);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const res = await fetch("/api/video-options");
        const json = await res.json();
        if (json.success && json.data) {
          setOptions(json.data);
          setInitialOptions(json.data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchOptions();
  }, []);

  useEffect(() => {
    const fetchProducts = async () => {
      setFetchingProducts(true);
      try {
        const res = await fetch("/api/shopify/products");
        const json = await res.json();
        if (json.success && json.products) {
          setShopifyProducts(json.products);
        }
      } catch (err) {
        console.error("Error fetching shopify products", err);
      } finally {
        setFetchingProducts(false);
      }
    };
    fetchProducts();
  }, []);

  const handleSave = async () => {
    if (!hasChanged) return;

    if (Array.isArray(options.packages)) {
      for (let i = 0; i < options.packages.length; i++) {
        const p = options.packages[i];
        const pName = p.title || `Package #${i + 1}`;
        const cleanPrice = String(p.price ?? "").replace(/[^0-9.]/g, "").trim();
        if (cleanPrice === "") {
          showToast({ variant: "error", title: "Price Required", message: `Please provide Regular Price for ${pName}.` });
          return;
        }
        const cleanRushPrice = String(p.rushPrice ?? "").replace(/[^0-9.]/g, "").trim();
        if (cleanRushPrice === "") {
          showToast({ variant: "error", title: "Rush Price Required", message: `Please provide Rush Delivery Price for ${pName}.` });
          return;
        }
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/video-options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });
      const json = await res.json();
      if (json.success) {
        setInitialOptions(json.data);
        const syncCount = json.shopifySync?.syncedCount || 0;
        const msg = syncCount > 0 
          ? `Video options saved & ${syncCount} Shopify variant price${syncCount > 1 ? "s" : ""} synced directly to your store!`
          : "Video tools options saved successfully.";
        showToast({ variant: "success", title: "Saved!", message: msg });
      } else {
        showToast({ variant: "error", title: "Failed", message: "Failed to save options. Please try again." });
      }
    } catch (err) {
      showToast({ variant: "error", title: "Error", message: "Could not connect to server." });
    } finally {
      setSaving(false);
    }
  };

  const handleAddPackage = () => {
    const newPkg = {
      id: "video_pkg_" + Date.now(),
      title: "New Video Package",
      price: "€49.95",
      compareAtPrice: "€99.95",
      tagline: "Popular",
      features: [
        "High-Definition 1080p Cinematic Music Video",
        "Custom synchronized audio & beat transitions",
        "Ready in 24-48 Hours directly in your inbox"
      ],
      image: "https://placehold.co/400x400/f8f9fa/101828?text=New+Video+Package",
      shopifyProductId: "",
      shopifyVariantId: "",
      shopifyRushVariantId: "",
    };
    setOptions((prev) => ({
      ...prev,
      packages: [...(prev.packages || []), newPkg],
    }));
  };

  const handleRemovePackage = (index) => {
    setOptions((prev) => {
      const arr = [...(prev.packages || [])];
      arr.splice(index, 1);
      return { ...prev, packages: arr };
    });
    showToast({ variant: "warning", title: "Package Removed", message: "Don't forget to save your changes." });
  };

  const handlePackageChange = (index, field, value) => {
    setOptions((prev) => {
      const arr = [...(prev.packages || [])];
      arr[index] = { ...arr[index], [field]: value };
      return { ...prev, packages: arr };
    });
  };

  const handlePackageFeatureChange = (pkgIndex, featureIndex, value) => {
    setOptions((prev) => {
      const arr = [...(prev.packages || [])];
      const features = [...(arr[pkgIndex].features || [])];
      features[featureIndex] = value;
      arr[pkgIndex] = { ...arr[pkgIndex], features };
      return { ...prev, packages: arr };
    });
  };

  const handleAddPackageFeature = (pkgIndex) => {
    setOptions((prev) => {
      const arr = [...(prev.packages || [])];
      const features = [...(arr[pkgIndex].features || []), "New Feature"];
      arr[pkgIndex] = { ...arr[pkgIndex], features };
      return { ...prev, packages: arr };
    });
  };

  const handleRemovePackageFeature = (pkgIndex, featureIndex) => {
    setOptions((prev) => {
      const arr = [...(prev.packages || [])];
      const features = [...(arr[pkgIndex].features || [])];
      features.splice(featureIndex, 1);
      arr[pkgIndex] = { ...arr[pkgIndex], features };
      return { ...prev, packages: arr };
    });
  };

  const handleMovePackageFeature = (pkgIndex, fromIndex, toIndex) => {
    setOptions((prev) => {
      const arr = [...(prev.packages || [])];
      const features = [...(arr[pkgIndex].features || [])];
      if (toIndex < 0 || toIndex >= features.length) return prev;
      const [moved] = features.splice(fromIndex, 1);
      features.splice(toIndex, 0, moved);
      arr[pkgIndex] = { ...arr[pkgIndex], features };
      return { ...prev, packages: arr };
    });
  };

  const handleFeatureDragStart = (pkgIndex, featureIndex) => {
    setDraggedFeature({ pkgIndex, featureIndex });
  };

  const handleFeatureDrop = (pkgIndex, targetIndex) => {
    if (
      draggedFeature.pkgIndex === pkgIndex &&
      draggedFeature.featureIndex !== null &&
      draggedFeature.featureIndex !== targetIndex
    ) {
      handleMovePackageFeature(pkgIndex, draggedFeature.featureIndex, targetIndex);
    }
    setDraggedFeature({ pkgIndex: null, featureIndex: null });
  };

  const handlePackageDragStart = (index) => {
    setDraggedPkg(index);
  };

  const handlePackageDrop = (index) => {
    if (draggedPkg !== null && draggedPkg !== index) {
      setOptions((prev) => {
        const arr = [...(prev.packages || [])];
        const item = arr[draggedPkg];
        arr.splice(draggedPkg, 1);
        arr.splice(index, 0, item);
        return { ...prev, packages: arr };
      });
    }
    setDraggedPkg(null);
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="Video Tools Settings" />
      
      <div className="mb-6 flex justify-between items-center">
        <p className="text-gray-500 dark:text-gray-400">
          Manage the packages, pricing, and settings for the Video Creation Tool.
        </p>
        <div className="flex gap-2">
          {hasChanged && (
            <Button variant="outline" onClick={() => setOptions(initialOptions)}>
              Discard Changes
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || !hasChanged}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Step Headings Section */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] mb-6">
        <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-3 dark:border-gray-800">
          <FiLayers className="text-orange-500 text-lg" />
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Step Titles &amp; Descriptions</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-orange-500">Step 1 (Audio)</h4>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Title</label>
              <Input
                value={options.step1Title || ""}
                onChange={(e) => setOptions((prev) => ({ ...prev, step1Title: e.target.value }))}
                placeholder="Step 1: Upload your audio track"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Subtitle</label>
              <Input
                value={options.step1Subtitle || ""}
                onChange={(e) => setOptions((prev) => ({ ...prev, step1Subtitle: e.target.value }))}
                placeholder="Upload your custom song or audio file..."
              />
            </div>
          </div>

          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-orange-500">Step 2 (Media)</h4>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Title</label>
              <Input
                value={options.step2Title || ""}
                onChange={(e) => setOptions((prev) => ({ ...prev, step2Title: e.target.value }))}
                placeholder="Step 2: Upload photos and video clips"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Subtitle</label>
              <Input
                value={options.step2Subtitle || ""}
                onChange={(e) => setOptions((prev) => ({ ...prev, step2Subtitle: e.target.value }))}
                placeholder="Add your favorite pictures and video clips..."
              />
            </div>
          </div>

          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-orange-500">Step 3 (Package &amp; Checkout)</h4>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Title</label>
              <Input
                value={options.step3Title || ""}
                onChange={(e) => setOptions((prev) => ({ ...prev, step3Title: e.target.value }))}
                placeholder="Step 3: Select your package"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Subtitle</label>
              <Input
                value={options.step3Subtitle || ""}
                onChange={(e) => setOptions((prev) => ({ ...prev, step3Subtitle: e.target.value }))}
                placeholder="Choose your music video production package..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Video Packages Section */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] mb-6">
        <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <FiVideo className="text-orange-500 text-lg" />
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Video Packages &amp; Pricing</h2>
          </div>
          <Button
            size="sm"
            onClick={handleAddPackage}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold"
          >
            <FiPlus className="text-sm" />
            Add Package
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {(options.packages || []).map((pkg, pIdx) => {
            const currentProduct = shopifyProducts.find((p) => String(p.id) === String(pkg.shopifyProductId));
            const availableVariants = currentProduct ? currentProduct.variants || [] : [];

            return (
              <div
                key={pkg.id || pIdx}
                draggable={draggablePkgId === pkg.id}
                onDragStart={() => handlePackageDragStart(pIdx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handlePackageDrop(pIdx)}
                className={`rounded-xl border p-4 transition-all duration-200 flex flex-col justify-between ${
                  draggedPkg === pIdx
                    ? "border-orange-400 bg-orange-50/50 opacity-60 dark:bg-orange-950/20"
                    : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 shadow-sm"
                }`}
              >
                <div>
                  {/* Header Row */}
                  <div className="flex items-center justify-between mb-3 border-b border-gray-100 dark:border-gray-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        onMouseEnter={() => setDraggablePkgId(pkg.id)}
                        onMouseLeave={() => setDraggablePkgId(null)}
                        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 p-1"
                        title="Drag to reorder package"
                      >
                        <FiMove className="text-sm" />
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                        Package #{pIdx + 1}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemovePackage(pIdx)}
                      className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors text-xs font-semibold flex items-center gap-1"
                      title="Remove Package"
                    >
                      <FiTrash2 className="text-sm" />
                      <span>Remove</span>
                    </button>
                  </div>

                  {/* Primary Fields */}
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Title</label>
                      <Input
                        value={pkg.title || ""}
                        onChange={(e) => handlePackageChange(pIdx, "title", e.target.value)}
                        placeholder="Cinematic Music Video"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Tagline (Optional)</label>
                      <Input
                        value={pkg.tagline || ""}
                        onChange={(e) => handlePackageChange(pIdx, "tagline", e.target.value)}
                        placeholder="Most Popular / Recommended"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Regular Price (Standard Delivery) *</label>
                        <div className="relative flex items-center">
                          <span className="absolute left-3 text-gray-500 text-sm select-none pointer-events-none">€</span>
                          <Input
                            type="text"
                            className="pl-7"
                            placeholder="49.95"
                            value={(pkg.price || "").replace(/^€/, "")}
                            onChange={(e) => handlePackageChange(pIdx, "price", "€" + e.target.value.replace(/^€/, ""))}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-orange-600 dark:text-orange-400 block mb-1">Rush Delivery Price *</label>
                        <div className="relative flex items-center">
                          <span className="absolute left-3 text-gray-500 text-sm select-none pointer-events-none">€</span>
                          <Input
                            type="text"
                            className="pl-7"
                            placeholder="69.95"
                            value={(pkg.rushPrice || "").replace(/^€/, "")}
                            onChange={(e) => handlePackageChange(pIdx, "rushPrice", e.target.value ? "€" + e.target.value.replace(/^€/, "") : "")}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Compare At Price (Optional Original Price)</label>
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-gray-500 text-sm select-none pointer-events-none">€</span>
                        <Input
                          type="text"
                          className="pl-7"
                          placeholder="99.95"
                          value={(pkg.compareAtPrice || "").replace(/^€/, "")}
                          onChange={(e) => handlePackageChange(pIdx, "compareAtPrice", e.target.value ? "€" + e.target.value.replace(/^€/, "") : "")}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Shopify Product & Variant Links */}
                  <div className="space-y-2.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Shopify Product &amp; Variants Linking</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium">Auto-Sync</span>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                        Linked Product
                      </label>
                      <select
                        value={pkg.shopifyProductId || (shopifyProducts.find(p => p.variantId === pkg.shopifyVariantId)?.productId || "")}
                        onChange={(e) => {
                          const selectedVal = e.target.value;
                          if (!selectedVal) {
                            handlePackageChange(pIdx, "shopifyProductId", "");
                            handlePackageChange(pIdx, "shopifyVariantId", "");
                            handlePackageChange(pIdx, "shopifyRushVariantId", "");
                            return;
                          }
                          const prod = shopifyProducts.find((p) => p.productId === selectedVal || p.id === selectedVal);
                          if (prod) {
                            handlePackageChange(pIdx, "shopifyProductId", prod.productId);
                            handlePackageChange(pIdx, "shopifyVariantId", prod.variantId);
                            handlePackageChange(pIdx, "shopifyRushVariantId", prod.rushVariantId || "");
                            if (!pkg.title || pkg.title.startsWith("New Package") || pkg.title.startsWith("New Video")) {
                              handlePackageChange(pIdx, "title", prod.productTitle);
                            }
                            if (prod.price) {
                              handlePackageChange(pIdx, "price", `€${prod.price}`);
                            }
                            if (prod.rushPrice) {
                              handlePackageChange(pIdx, "rushPrice", `€${prod.rushPrice}`);
                            }
                            if (prod.image) {
                              handlePackageChange(pIdx, "image", prod.image);
                            }
                          }
                        }}
                        className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 p-2 focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="">-- None (No Shopify Link) --</option>
                        {shopifyProducts.map((prod) => (
                          <option key={prod.id || prod.productId} value={prod.productId}>
                            {prod.productTitle} {prod.price ? `(€${prod.price})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Visual indication of selected product and its 2 variants */}
                    {(() => {
                      const matchedProd = shopifyProducts.find(p => p.productId === pkg.shopifyProductId || p.variantId === pkg.shopifyVariantId);
                      const regularId = pkg.shopifyVariantId || matchedProd?.variantId || "";
                      const rushId = pkg.shopifyRushVariantId || matchedProd?.rushVariantId || "";

                      const regNum = parseFloat(String(pkg.price || "0").replace(/[^0-9.]/g, "")) || 0;
                      const rushNum = parseFloat(String(pkg.rushPrice || "0").replace(/[^0-9.]/g, "")) || 0;
                      const totalRushFormatted = (regNum + rushNum).toFixed(2);

                      if (!pkg.shopifyProductId && !pkg.shopifyVariantId && !matchedProd) return null;

                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-gray-200 dark:border-gray-700">
                          <div className="p-2 rounded bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700">
                            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">📦 Regular Delivery Variant</p>
                            <p className="text-[10px] text-gray-500 font-mono mt-0.5">ID: {regularId || "N/A"}</p>
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">Syncs to: {pkg.price || "€0.00"}</p>
                          </div>

                          <div className="p-2 rounded bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
                            <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">⚡ Rush Delivery Variant</p>
                            <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80 font-mono mt-0.5">ID: {rushId || "None in Shopify"}</p>
                            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium mt-1">Syncs to: €{totalRushFormatted}</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Package Features List */}
                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        Features ({pkg.features?.length || 0})
                      </label>
                      <span className="text-[11px] text-gray-400">Drag or use arrows to reorder</span>
                    </div>
                    <div className="space-y-2">
                      {(pkg.features || []).map((feat, fIdx) => (
                        <div
                          key={fIdx}
                          draggable
                          onDragStart={() => handleFeatureDragStart(pIdx, fIdx)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.preventDefault(); handleFeatureDrop(pIdx, fIdx); }}
                          className={`flex items-center gap-1.5 p-1 rounded-lg border transition-all ${
                            draggedFeature.pkgIndex === pIdx && draggedFeature.featureIndex === fIdx
                              ? "opacity-50 border-orange-400 bg-orange-50/50 dark:bg-orange-950/20"
                              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                        >
                          {/* Drag Handle */}
                          <div
                            className="cursor-grab active:cursor-grabbing p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            title="Drag to reorder"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                            </svg>
                          </div>

                          {/* Input Field with Hover Tooltip */}
                          <div className="flex-1 min-w-0 relative group/tooltip">
                            <Input
                              type="text"
                              value={feat}
                              onChange={(e) => handlePackageFeatureChange(pIdx, fIdx, e.target.value)}
                              placeholder={`Feature ${fIdx + 1}`}
                            />
                            {feat && feat.trim() && (
                              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:flex flex-col items-center z-50 transition-all duration-200">
                                <div className="bg-gray-900/95 dark:bg-gray-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-xl max-w-xs text-center whitespace-normal break-words border border-gray-700 backdrop-blur-sm">
                                  {feat}
                                </div>
                                <div className="w-2 h-2 bg-gray-900/95 dark:bg-gray-800 rotate-45 -mt-1 border-r border-b border-gray-700"></div>
                              </div>
                            )}
                          </div>

                          {/* Move Up Button */}
                          <button
                            type="button"
                            disabled={fIdx === 0}
                            onClick={() => handleMovePackageFeature(pIdx, fIdx, fIdx - 1)}
                            className={`p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors ${
                              fIdx === 0 ? "opacity-20 cursor-not-allowed" : "cursor-pointer"
                            }`}
                            title="Move up"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>

                          {/* Move Down Button */}
                          <button
                            type="button"
                            disabled={fIdx === (pkg.features?.length || 0) - 1}
                            onClick={() => handleMovePackageFeature(pIdx, fIdx, fIdx + 1)}
                            className={`p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors ${
                              fIdx === (pkg.features?.length || 0) - 1 ? "opacity-20 cursor-not-allowed" : "cursor-pointer"
                            }`}
                            title="Move down"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => handleRemovePackageFeature(pIdx, fIdx)}
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                            title="Remove feature"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddPackageFeature(pIdx)}
                      className="text-xs text-orange-600 hover:text-orange-700 font-semibold mt-2.5 inline-flex items-center gap-1"
                    >
                      + Add Feature
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rush Order Settings */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] mb-6">
        <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-3 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">⚡ Rush Order Settings</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Rush Order Title</label>
            <Input
              value={options.rushOrderTitle || ""}
              onChange={(e) => setOptions((prev) => ({ ...prev, rushOrderTitle: e.target.value }))}
              placeholder="Rush My Video Order"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Rush Order Description</label>
            <Input
              value={options.rushOrderDescription || ""}
              onChange={(e) => setOptions((prev) => ({ ...prev, rushOrderDescription: e.target.value }))}
              placeholder="Order delivered in under 2 hours"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
