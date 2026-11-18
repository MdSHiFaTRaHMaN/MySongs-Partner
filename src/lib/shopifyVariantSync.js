import { getSettings } from "@/lib/getSettings";

/**
 * Syncs package prices and compare-at prices from Form Elements directly to Shopify Product Variants via Admin API.
 * @param {Array} packages - Array of package objects containing shopifyVariantId, price, compareAtPrice
 * @returns {Promise<{success: boolean, syncedCount: number, results: Array}>}
 */
export async function syncPackageVariantsToShopify(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    return { success: true, syncedCount: 0, results: [] };
  }

  const settings = await getSettings();
  if (!settings || !settings.shopUrl1 || !settings.shopifyAdminApiKey) {
    console.warn("[Shopify Variant Sync] Shopify Admin API not configured in settings.");
    return { success: false, error: "Shopify Admin API not configured", syncedCount: 0, results: [] };
  }

  let shopDomain = settings.shopUrl1;
  if (shopDomain.startsWith("http")) {
    shopDomain = new URL(shopDomain).hostname;
  }

  const results = [];
  let syncedCount = 0;

  for (const pkg of packages) {
    // 1. Sync Regular Variant
    const variantId = pkg.shopifyVariantId;
    if (variantId) {
      const rawPrice = pkg.price !== undefined && pkg.price !== null ? String(pkg.price).replace(/[^0-9.]/g, "").trim() : "";
      const rawComparePrice = pkg.compareAtPrice !== undefined && pkg.compareAtPrice !== null ? String(pkg.compareAtPrice).replace(/[^0-9.]/g, "").trim() : "";

      if (rawPrice !== "") {
        const variantPayload = {
          variant: {
            id: parseInt(variantId, 10) || variantId,
            price: rawPrice,
          },
        };

        if (rawComparePrice && parseFloat(rawComparePrice) > 0) {
          variantPayload.variant.compare_at_price = rawComparePrice;
        } else {
          variantPayload.variant.compare_at_price = null;
        }

        try {
          const res = await fetch(`https://${shopDomain}/admin/api/2024-04/variants/${variantId}.json`, {
            method: "PUT",
            headers: {
              "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(variantPayload),
          });

          if (res.ok) {
            const resData = await res.json();
            syncedCount++;
            results.push({ variantId, type: "regular", success: true, price: rawPrice, compareAtPrice: rawComparePrice, data: resData.variant });
            console.log(`[Shopify Variant Sync Success] Updated Regular variant ${variantId} -> Price: €${rawPrice}`);
          } else {
            const errText = await res.text();
            console.error(`[Shopify Variant Sync Error] Failed Regular variant ${variantId} (${res.status}):`, errText);
            results.push({ variantId, type: "regular", success: false, status: res.status, error: errText });
          }
        } catch (fetchErr) {
          console.error(`[Shopify Variant Sync Network Error] (${variantId}):`, fetchErr);
          results.push({ variantId, type: "regular", success: false, error: fetchErr.message });
        }
      }
    }

    // 2. Sync Rush Variant (Combined Price = Regular Price + Rush Delivery Fee)
    const rushVariantId = pkg.shopifyRushVariantId;
    if (rushVariantId && (pkg.rushPrice !== undefined && pkg.rushPrice !== null)) {
      const rawPriceNum = pkg.price ? (parseFloat(String(pkg.price).replace(/[^0-9.]/g, "")) || 0) : 0;
      const rawRushNum = pkg.rushPrice ? (parseFloat(String(pkg.rushPrice).replace(/[^0-9.]/g, "")) || 0) : 0;
      const totalRushPrice = (rawPriceNum + rawRushNum).toFixed(2);

      const rawComparePriceNum = pkg.compareAtPrice ? (parseFloat(String(pkg.compareAtPrice).replace(/[^0-9.]/g, "")) || 0) : 0;
      const rawRushCompareNum = pkg.rushCompareAtPrice ? (parseFloat(String(pkg.rushCompareAtPrice).replace(/[^0-9.]/g, "")) || 0) : 0;
      const totalRushComparePrice = rawRushCompareNum > 0
        ? rawRushCompareNum.toFixed(2)
        : (rawComparePriceNum > 0 ? (rawComparePriceNum + rawRushNum).toFixed(2) : "");

      if (totalRushPrice !== "" && !isNaN(parseFloat(totalRushPrice))) {
        const rushPayload = {
          variant: {
            id: parseInt(rushVariantId, 10) || rushVariantId,
            price: totalRushPrice,
          },
        };

        if (totalRushComparePrice && parseFloat(totalRushComparePrice) > parseFloat(totalRushPrice)) {
          rushPayload.variant.compare_at_price = totalRushComparePrice;
        } else {
          rushPayload.variant.compare_at_price = null;
        }

        try {
          const res = await fetch(`https://${shopDomain}/admin/api/2024-04/variants/${rushVariantId}.json`, {
            method: "PUT",
            headers: {
              "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(rushPayload),
          });

          if (res.ok) {
            const resData = await res.json();
            syncedCount++;
            results.push({ variantId: rushVariantId, type: "rush", success: true, price: totalRushPrice, compareAtPrice: totalRushComparePrice, data: resData.variant });
            console.log(`[Shopify Variant Sync Success] Updated Rush variant ${rushVariantId} -> Total Price: €${totalRushPrice} (€${rawPriceNum} regular + €${rawRushNum} rush)`);
          } else {
            const errText = await res.text();
            console.error(`[Shopify Variant Sync Error] Failed Rush variant ${rushVariantId} (${res.status}):`, errText);
            results.push({ variantId: rushVariantId, type: "rush", success: false, status: res.status, error: errText });
          }
        } catch (fetchErr) {
          console.error(`[Shopify Variant Sync Network Error] (${rushVariantId}):`, fetchErr);
          results.push({ variantId: rushVariantId, type: "rush", success: false, error: fetchErr.message });
        }
      }
    }
  }

  return { success: true, syncedCount, results };
}
