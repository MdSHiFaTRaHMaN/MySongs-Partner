"use client";
import React, { useState, useEffect, useCallback } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import { useToast } from "@/components/ui/toast/Toast";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import { FiMusic, FiPlus, FiTrash2, FiMove, FiCheck, FiSave, FiLayers, FiArrowUp, FiArrowDown, FiZap, FiGlobe } from "react-icons/fi";

export default function FormElements() {
  const showToast = useToast();
  const [options, setOptions] = useState({
    occasions: [],
    genres: [],
    voices: [],
    moods: [],
    packages: [],
    upsells: [],
    rushOrderTitle: "Rush My Order",
    rushOrderDescription: "Order delivered in 60 minutes",
  });
  
  const [initialOptions, setInitialOptions] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [shopifyProducts, setShopifyProducts] = useState([]);
  const [fetchingProducts, setFetchingProducts] = useState(false);

  // For adding new simple texts
  const [newInputs, setNewInputs] = useState({
    occasions: "",
    genres: "",
    voices: "",
    moods: "",
  });

  const [draggedSimple, setDraggedSimple] = useState({ category: null, index: null });
  const [draggedPkg, setDraggedPkg] = useState(null);
  const [draggablePkgId, setDraggablePkgId] = useState(null);
  const [draggedFeature, setDraggedFeature] = useState({ pkgIndex: null, featureIndex: null });
  
  const handleSimpleDragStart = (category, index) => {
    setDraggedSimple({ category, index });
  };
  const handleSimpleDrop = (category, index) => {
    if (draggedSimple.category === category && draggedSimple.index !== null && draggedSimple.index !== index) {
      setOptions((prev) => {
        const arr = [...prev[category]];
        const draggedItem = arr[draggedSimple.index];
        arr.splice(draggedSimple.index, 1);
        arr.splice(index, 0, draggedItem);
        return { ...prev, [category]: arr };
      });
    }
    setDraggedSimple({ category: null, index: null });
  };

  const handleMovePackageFeature = (pkgIndex, fromIndex, toIndex) => {
    setOptions((prev) => {
      const arr = [...prev.packages];
      const features = [...arr[pkgIndex].features];
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

  // Calculate if options have changed
  const hasChanged = JSON.stringify(options) !== JSON.stringify(initialOptions);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const res = await fetch("/api/form-options");
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

  const fetchProducts = useCallback(async () => {
    setFetchingProducts(true);
    try {
      const res = await fetch("/api/shopify/products", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.products)) {
        setShopifyProducts(json.products);
      } else {
        console.warn("[Shopify Products] Fetch error:", json.error);
        if (json.error) {
          showToast({
            variant: "error",
            title: "Shopify Products",
            message: json.error,
          });
        }
      }
    } catch (err) {
      console.error("Error fetching shopify products", err);
    } finally {
      setFetchingProducts(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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
      const res = await fetch("/api/form-options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });
      const json = await res.json();
      if (json.success) {
        setInitialOptions(json.data);
        const syncCount = json.shopifySync?.syncedCount || 0;
        const msg = syncCount > 0 
          ? `Options saved & ${syncCount} Shopify variant price${syncCount > 1 ? "s" : ""} synced directly to your store!`
          : "Options saved successfully.";
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

  const handleAddSimple = (category) => {
    const val = newInputs[category].trim();
    if (!val) return;
    setOptions((prev) => ({
      ...prev,
      [category]: [...prev[category], val],
    }));
    setNewInputs((prev) => ({ ...prev, [category]: "" }));
  };

  const handleRemoveSimple = (category, index) => {
    setOptions((prev) => {
      const arr = [...prev[category]];
      arr.splice(index, 1);
      return { ...prev, [category]: arr };
    });
  };

  const handleAddPackage = () => {
    const newPkg = {
      id: "pkg_" + Date.now(),
      title: "New Package",
      price: "€0.00",
      tagline: "",
      features: ["Feature 1"],
      image: "https://placehold.co/400x400/f8f9fa/101828?text=New+Package",
      shopifyProductId: "",
      shopifyVariantId: "",
    };
    setOptions((prev) => ({
      ...prev,
      packages: [...prev.packages, newPkg],
    }));
  };

  const handleRemovePackage = (index) => {
    setOptions((prev) => {
      const arr = [...prev.packages];
      arr.splice(index, 1);
      return { ...prev, packages: arr };
    });
    showToast({ variant: "warning", title: "Package Removed", message: "Don't forget to save your changes." });
  };

  const handlePackageChange = (index, field, value) => {
    setOptions((prev) => {
      const arr = [...prev.packages];
      arr[index] = { ...arr[index], [field]: value };
      return { ...prev, packages: arr };
    });
  };

  const handlePackageFeatureChange = (pkgIndex, featureIndex, value) => {
    setOptions((prev) => {
      const arr = [...prev.packages];
      const features = [...arr[pkgIndex].features];
      features[featureIndex] = value;
      arr[pkgIndex] = { ...arr[pkgIndex], features };
      return { ...prev, packages: arr };
    });
  };

  const handleAddPackageFeature = (pkgIndex) => {
    setOptions((prev) => {
      const arr = [...prev.packages];
      arr[pkgIndex] = { ...arr[pkgIndex], features: [...arr[pkgIndex].features, "New Feature"] };
      return { ...prev, packages: arr };
    });
  };

  // ---- Dynamic Upsells Handlers ----
  const handleAddUpsell = () => {
    const newUpsell = {
      id: "upsell_" + Date.now(),
      title: "New Upsell Option",
      subtext: "Stream it anytime and share it with friends and family",
      price: "€19.95",
      type: "product",
      shopifyProductId: "",
      shopifyVariantId: "",
      enabled: true,
      defaultSelected: false,
      order: (options.upsells || []).length,
    };
    setOptions((prev) => ({
      ...prev,
      upsells: [...(prev.upsells || []), newUpsell],
    }));
  };

  const handleRemoveUpsell = (index) => {
    setOptions((prev) => {
      const arr = [...(prev.upsells || [])];
      arr.splice(index, 1);
      return { ...prev, upsells: arr };
    });
  };

  const handleUpsellChange = (index, field, value) => {
    setOptions((prev) => {
      const arr = [...(prev.upsells || [])];
      arr[index] = { ...arr[index], [field]: value };
      return { ...prev, upsells: arr };
    });
  };

  const handleMoveUpsell = (fromIndex, toIndex) => {
    setOptions((prev) => {
      const arr = [...(prev.upsells || [])];
      if (toIndex < 0 || toIndex >= arr.length) return prev;
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return { ...prev, upsells: arr };
    });
  };

  const handleRemovePackageFeature = (pkgIndex, featureIndex) => {
    setOptions((prev) => {
      const arr = [...prev.packages];
      const features = [...arr[pkgIndex].features];
      features.splice(featureIndex, 1);
      arr[pkgIndex] = { ...arr[pkgIndex], features };
      return { ...prev, packages: arr };
    });
  };

  if (loading) return <LoadingSpinner minHeight="min-h-[60vh]" />;

  const renderSimpleManager = (title, category) => (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{title}</h3>
      <div className="mb-4 flex flex-wrap gap-2">
        {options[category].map((item, idx) => (
          <div 
            key={idx} 
            draggable
            onDragStart={() => handleSimpleDragStart(category, idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleSimpleDrop(category, idx); }}
            className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-500 dark:bg-brand-500/10 dark:text-brand-400 cursor-move border border-transparent hover:border-brand-500 transition-colors"
          >
            <span>{item}</span>
            <button
              onClick={() => handleRemoveSimple(category, idx)}
              className="ml-1 rounded-full p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-600 dark:hover:bg-brand-500/20"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          value={newInputs[category]}
          onChange={(e) => setNewInputs((prev) => ({ ...prev, [category]: e.target.value }))}
          placeholder={`Add new ${title.toLowerCase()}`}
        />
        <Button size="sm" onClick={() => handleAddSimple(category)}>Add</Button>
      </div>
    </div>
  );

  return (
    <div>
      <PageBreadcrumb pageTitle="Music Tools Settings" />
      
      <div className="mb-6 flex justify-between items-center">
        <p className="text-gray-500 dark:text-gray-400">
          Manage the selectable options, genres, moods, and packages for the Custom Song Builder.
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 mb-6">
        {renderSimpleManager("Occasions", "occasions")}
        {renderSimpleManager("Genres", "genres")}
        {renderSimpleManager("Voices", "voices")}
        {renderSimpleManager("Moods", "moods")}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Packages</h3>
          <Button size="sm" variant="outline" onClick={handleAddPackage}>+ Add Package</Button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {options.packages.map((pkg, pIdx) => (
            <div 
              key={pIdx} 
              draggable={draggablePkgId === pIdx}
              onDragStart={() => setDraggedPkg(pIdx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedPkg !== null && draggedPkg !== pIdx) {
                  setOptions((prev) => {
                    const arr = [...prev.packages];
                    const draggedItem = arr[draggedPkg];
                    arr.splice(draggedPkg, 1);
                    arr.splice(pIdx, 0, draggedItem);
                    return { ...prev, packages: arr };
                  });
                }
                setDraggedPkg(null);
              }}
              className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 hover:border-brand-500 transition-colors bg-white dark:bg-gray-800"
            >
              <div className="flex items-center justify-between mb-3 border-b border-gray-100 dark:border-gray-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <span
                    onMouseEnter={() => setDraggablePkgId(pkg.id || pIdx)}
                    onMouseLeave={() => setDraggablePkgId(null)}
                    className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 p-1"
                    title="Drag to reorder package"
                  >
                    <FiMove className="text-sm" />
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
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
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">ID (Used internally)</label>
                  <Input type="text" value={pkg.id || ""} onChange={(e) => handlePackageChange(pIdx, "id", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Title</label>
                  <Input type="text" value={pkg.title || ""} onChange={(e) => handlePackageChange(pIdx, "title", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Tagline (Optional)</label>
                  <Input type="text" value={pkg.tagline || ""} onChange={(e) => handlePackageChange(pIdx, "tagline", e.target.value)} placeholder="Most Popular / Recommended" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Regular Price (Standard Delivery) *</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-gray-500 text-sm select-none pointer-events-none">€</span>
                      <Input
                        type="text"
                        className="pl-7"
                        placeholder="9.00"
                        value={(pkg.price || "").replace(/^€/, "")}
                        onChange={(e) => handlePackageChange(pIdx, "price", "€" + e.target.value.replace(/^€/, ""))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-brand-600 dark:text-brand-400 block mb-1">Rush Delivery Price *</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-gray-500 text-sm select-none pointer-events-none">€</span>
                      <Input
                        type="text"
                        className="pl-7"
                        placeholder="19.00"
                        value={(pkg.rushPrice || "").replace(/^€/, "")}
                        onChange={(e) => handlePackageChange(pIdx, "rushPrice", e.target.value ? "€" + e.target.value.replace(/^€/, "") : "")}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">Compare At Price (Optional Original / Strikethrough Price)</label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-gray-500 text-sm select-none pointer-events-none">€</span>
                    <Input
                      type="text"
                      className="pl-7"
                      placeholder="49.95"
                      value={(pkg.compareAtPrice || "").replace(/^€/, "")}
                      onChange={(e) => handlePackageChange(pIdx, "compareAtPrice", e.target.value ? "€" + e.target.value.replace(/^€/, "") : "")}
                    />
                  </div>
                </div>
              </div>

                <div className="rounded-lg border border-dashed border-gray-300 p-3.5 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Shopify Product &amp; Variants Linking</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium">Auto-Sync</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); fetchProducts(); }}
                      disabled={fetchingProducts}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 hover:underline disabled:opacity-50"
                      title="Reload Shopify Products"
                    >
                      <svg className={`w-3 h-3 ${fetchingProducts ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {fetchingProducts ? "Loading..." : "Reload Products"}
                    </button>
                  </div>
                  <p className="mb-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    Selecting a Shopify product will automatically map and sync prices to its <strong>Regular</strong> and <strong>Rush Delivery</strong> variants when saved.
                  </p>
                  
                  <div className="mb-3">
                    <label className="text-xs text-gray-600 dark:text-gray-300 block mb-1 font-medium">Linked Shopify Product</label>
                    <select 
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-800 dark:bg-gray-800 dark:text-white/90"
                      onChange={(e) => {
                        const selectedVal = e.target.value;
                        if (!selectedVal) {
                          handlePackageChange(pIdx, "shopifyProductId", "");
                          handlePackageChange(pIdx, "shopifyVariantId", "");
                          handlePackageChange(pIdx, "shopifyRushVariantId", "");
                          return;
                        }
                        const prod = shopifyProducts.find(p => p.productId === selectedVal || p.id === selectedVal);
                        if (prod) {
                          handlePackageChange(pIdx, "shopifyProductId", prod.productId);
                          handlePackageChange(pIdx, "shopifyVariantId", prod.variantId);
                          handlePackageChange(pIdx, "shopifyRushVariantId", prod.rushVariantId || "");
                          handlePackageChange(pIdx, "title", prod.productTitle);
                          if (prod.price) handlePackageChange(pIdx, "price", `€${prod.price}`);
                          if (prod.rushPrice) handlePackageChange(pIdx, "rushPrice", `€${prod.rushPrice}`);
                          handlePackageChange(pIdx, "image", prod.image || "");
                        }
                      }}
                      value={pkg.shopifyProductId || (shopifyProducts.find(p => p.variantId === pkg.shopifyVariantId)?.productId || "")}
                    >
                      <option value="">-- None --</option>
                      {pkg.shopifyProductId && !shopifyProducts.some(p => p.productId === pkg.shopifyProductId) && (
                        <option value={pkg.shopifyProductId}>
                          {pkg.title || `Linked Product (${pkg.shopifyProductId})`}
                        </option>
                      )}
                      {shopifyProducts.map(prod => (
                        <option key={prod.id} value={prod.productId}>
                          {prod.productTitle}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Visual indication of selected product and its 2 variants */}
                  {(() => {
                    const matchedProd = shopifyProducts.find(p => p.productId === pkg.shopifyProductId || p.variantId === pkg.shopifyVariantId);
                    const regularId = pkg.shopifyVariantId || matchedProd?.variantId || "";
                    const rushId = pkg.shopifyRushVariantId || matchedProd?.rushVariantId || "";
                    const displayTitle = pkg.title || matchedProd?.productTitle || "Shopify Product";
                    const displayImg = pkg.image || matchedProd?.image;

                    const regNum = parseFloat(String(pkg.price || "0").replace(/[^0-9.]/g, "")) || 0;
                    const rushNum = parseFloat(String(pkg.rushPrice || "0").replace(/[^0-9.]/g, "")) || 0;
                    const totalRushFormatted = (regNum + rushNum).toFixed(2);

                    if (!pkg.shopifyProductId && !pkg.shopifyVariantId && !matchedProd) return null;

                    return (
                      <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 space-y-2.5">
                        <div className="flex items-center gap-3">
                          {displayImg && (
                            <img src={displayImg} alt={displayTitle} className="w-10 h-10 rounded object-cover border border-gray-200 dark:border-gray-600" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{displayTitle}</p>
                            <p className="text-xs text-gray-400">Product ID: {pkg.shopifyProductId || matchedProd?.productId}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-gray-100 dark:border-gray-700/60">
                          <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700">
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
                      </div>
                    );
                  })()}
                </div>
                
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Features ({pkg.features.length})
                    </label>
                    <span className="text-[11px] text-gray-400">Drag or use arrows to reorder</span>
                  </div>
                  <div className="space-y-2">
                    {pkg.features.map((feat, fIdx) => (
                      <div
                        key={fIdx}
                        draggable
                        onDragStart={() => handleFeatureDragStart(pIdx, fIdx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); handleFeatureDrop(pIdx, fIdx); }}
                        className={`flex items-center gap-1.5 p-1 rounded-lg border transition-all ${
                          draggedFeature.pkgIndex === pIdx && draggedFeature.featureIndex === fIdx
                            ? "opacity-50 border-brand-400 bg-brand-50/50 dark:bg-brand-950/20"
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
                          disabled={fIdx === pkg.features.length - 1}
                          onClick={() => handleMovePackageFeature(pIdx, fIdx, fIdx + 1)}
                          className={`p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors ${
                            fIdx === pkg.features.length - 1 ? "opacity-20 cursor-not-allowed" : "cursor-pointer"
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
                    className="text-xs text-brand-500 hover:text-brand-600 font-semibold mt-2.5 inline-flex items-center gap-1"
                  >
                    + Add Feature
                  </button>
                </div>
              </div>
            ))}
          </div>
      </div>

      {/* Upsell Options Management Section */}
      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                <FiZap size={16} />
              </span>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white/90">
                Upsell Options (Checkout Add-ons)
              </h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Manage add-on checkboxes displayed below package selection (e.g. <strong>Song on Spotify &amp; Apple Music</strong>, <strong>Rush My Order</strong>). Add, remove, edit, or reorder upsells and link them directly to Shopify products.
            </p>
          </div>

          <Button
            size="sm"
            onClick={handleAddUpsell}
            className="flex items-center gap-1.5 shrink-0"
          >
            <FiPlus size={14} />
            <span>Add Upsell Option</span>
          </Button>
        </div>

        {/* Upsell Cards List */}
        <div className="space-y-4">
          {(options.upsells || []).map((upsell, uIdx) => {
            const isRushType = upsell.type === "rush";
            const matchedShopifyProduct = shopifyProducts.find(
              (p) => String(p.productId) === String(upsell.shopifyProductId) || String(p.id) === String(upsell.shopifyProductId)
            );

            return (
              <div
                key={upsell.id || uIdx}
                className="rounded-xl border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/40 p-4 space-y-4 transition-all duration-200 hover:border-brand-200 dark:hover:border-gray-700"
              >
                {/* Header: Reorder controls, Title preview, Delete */}
                <div className="flex items-center justify-between gap-2 border-b border-gray-200/60 dark:border-gray-800 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Reorder Up/Down */}
                    <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-0.5">
                      <button
                        type="button"
                        disabled={uIdx === 0}
                        onClick={() => handleMoveUpsell(uIdx, uIdx - 1)}
                        className="p-1 text-gray-500 hover:text-brand-500 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        title="Move Up"
                      >
                        <FiArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={uIdx === (options.upsells || []).length - 1}
                        onClick={() => handleMoveUpsell(uIdx, uIdx + 1)}
                        className="p-1 text-gray-500 hover:text-brand-500 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        title="Move Down"
                      >
                        <FiArrowDown size={13} />
                      </button>
                    </div>

                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold">
                      #{uIdx + 1}
                    </span>

                    <span className="text-sm font-bold text-gray-800 dark:text-white truncate">
                      {upsell.title || "Untitled Upsell"}
                    </span>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                        isRushType
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      }`}
                    >
                      {isRushType ? "Rush Delivery" : "Shopify Product"}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Enabled toggle */}
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={upsell.enabled !== false}
                        onChange={(e) => handleUpsellChange(uIdx, "enabled", e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="hidden sm:inline">Active</span>
                    </label>

                    {/* Pre-selected toggle */}
                    <label
                      className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none"
                      title="If checked, this upsell will be selected by default when customers view the checkout options."
                    >
                      <input
                        type="checkbox"
                        checked={upsell.defaultSelected === true}
                        onChange={(e) => handleUpsellChange(uIdx, "defaultSelected", e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="hidden sm:inline">Pre-selected</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => handleRemoveUpsell(uIdx)}
                      className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition rounded hover:bg-red-50 dark:hover:bg-red-950/20"
                      title="Remove Upsell"
                    >
                      <FiTrash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Form Fields: Title, Subtext, Price, Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">
                      Title *
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. Song on Spotify & Apple Music"
                      value={upsell.title || ""}
                      onChange={(e) => handleUpsellChange(uIdx, "title", e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">
                      Subtext / Description
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. Stream it anytime and share it with friends"
                      value={upsell.subtext || ""}
                      onChange={(e) => handleUpsellChange(uIdx, "subtext", e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">
                      Price (Display)
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. €19.95"
                      value={upsell.price || ""}
                      onChange={(e) => handleUpsellChange(uIdx, "price", e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">
                      Upsell Type
                    </label>
                    <select
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-500 dark:border-gray-800 dark:bg-gray-800 dark:text-white/90"
                      value={upsell.type || "product"}
                      onChange={(e) => handleUpsellChange(uIdx, "type", e.target.value)}
                    >
                      <option value="product">Shopify Product (Add to Cart)</option>
                      <option value="rush">Rush Delivery (Faster Processing)</option>
                    </select>
                  </div>
                </div>

                {/* Shopify Product Link for Product Upsells */}
                {!isRushType && (
                  <div className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-700 bg-white/70 dark:bg-gray-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Link to Shopify Product
                      </label>
                      {fetchingProducts && <span className="text-[11px] text-brand-500">Loading Shopify catalog...</span>}
                    </div>

                    <select
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-500 dark:border-gray-800 dark:bg-gray-800 dark:text-white/90"
                      value={upsell.shopifyProductId || ""}
                      onChange={(e) => {
                        const selId = e.target.value;
                        if (!selId) {
                          handleUpsellChange(uIdx, "shopifyProductId", "");
                          handleUpsellChange(uIdx, "shopifyVariantId", "");
                          return;
                        }
                        const prod = shopifyProducts.find((p) => p.productId === selId || p.id === selId);
                        if (prod) {
                          handleUpsellChange(uIdx, "shopifyProductId", prod.productId);
                          handleUpsellChange(uIdx, "shopifyVariantId", prod.variantId);
                          if (!upsell.title || upsell.title === "New Upsell Option") {
                            handleUpsellChange(uIdx, "title", prod.productTitle);
                          }
                          if (prod.price && (!upsell.price || upsell.price === "€0.00")) {
                            handleUpsellChange(uIdx, "price", `€${prod.price}`);
                          }
                        }
                      }}
                    >
                      <option value="">-- Select Shopify Product to Link --</option>
                      {shopifyProducts.map((prod) => (
                        <option key={prod.id} value={prod.productId}>
                          {prod.productTitle} {prod.price ? `(€${prod.price})` : ""}
                        </option>
                      ))}
                    </select>

                    {matchedShopifyProduct && (
                      <div className="flex items-center gap-3 pt-2 text-xs text-gray-600 dark:text-gray-300">
                        {matchedShopifyProduct.image && (
                          <img
                            src={matchedShopifyProduct.image}
                            alt=""
                            className="h-8 w-8 rounded object-cover border border-gray-200 dark:border-gray-700"
                          />
                        )}
                        <div>
                          <span className="font-semibold text-gray-800 dark:text-white">
                            {matchedShopifyProduct.productTitle}
                          </span>
                          <span className="text-gray-400 font-mono ml-2">
                            (ID: {matchedShopifyProduct.productId} • Variant: {upsell.shopifyVariantId || matchedShopifyProduct.variantId})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {(!options.upsells || options.upsells.length === 0) && (
            <div className="p-8 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 text-center text-gray-400 text-xs italic">
              No upsells configured. Click &quot;Add Upsell Option&quot; above to create your first add-on.
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-6 flex justify-end gap-2">
        {hasChanged && (
          <Button variant="outline" onClick={() => setOptions(initialOptions)}>
            Discard Changes
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving || !hasChanged}>
          {saving ? "Saving..." : "Save All Changes"}
        </Button>
      </div>
    </div>
  );
}