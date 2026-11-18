import redis from "./redis.js";

const CACHE_KEY = "cache:shopify:orders:all";
const CACHE_TTL_SECONDS = 120; // 2 minutes cache

/**
 * Invalidate the cached Shopify orders (e.g., when a webhook arrives or an order is fulfilled).
 */
export async function clearShopifyOrdersCache() {
  try {
    await redis.del(CACHE_KEY);
  } catch (err) {
    console.error("[clearShopifyOrdersCache error]:", err);
  }
}

/**
 * Fetches all orders from Shopify Admin REST API handling cursor pagination.
 * Utilizes a 2-minute Redis cache to avoid slow sequential API crawls on every request.
 *
 * @param {object} settings - Settings with shopUrl1 and shopifyAdminApiKey
 * @param {number} maxOrders - Maximum orders to fetch (default: 0 for all orders)
 * @param {boolean} forceRefresh - If true, bypasses Redis cache and fetches fresh from Shopify
 * @returns {Promise<Array>} - Array of Shopify orders
 */
export async function fetchAllShopifyOrders(settings, maxOrders = 0, forceRefresh = false) {
  if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) {
    throw new Error("Shopify integration is not configured. Please add Shop URL and Admin API Key in Settings.");
  }

  // 1. Check Redis cache first if requesting full list without forced refresh
  if (maxOrders === 0 && !forceRefresh) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn("[fetchAllShopifyOrders] Redis cache get failed, proceeding with direct fetch:", e.message);
    }
  }

  let url = settings.shopUrl1;
  if (!url.startsWith("http")) url = `https://${url}`;

  let orders = [];
  let nextUrl = `${url}/admin/api/2024-04/orders.json?status=any&limit=250`;
  const maxLimit = maxOrders > 0 ? maxOrders : 50000;

  while (nextUrl && orders.length < maxLimit) {
    const response = await fetch(nextUrl, {
      headers: {
        "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (!data.orders || !Array.isArray(data.orders)) {
      break;
    }

    orders = orders.concat(data.orders);

    // Parse Shopify pagination Link header
    const linkHeader = response.headers.get("link") || response.headers.get("Link");
    nextUrl = null;

    if (linkHeader) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
      if (match && match[1]) {
        nextUrl = match[1];
      }
    }
  }

  // 2. Cache successful full fetch in Redis
  if (maxOrders === 0 && orders.length > 0) {
    try {
      await redis.set(CACHE_KEY, JSON.stringify(orders), "EX", CACHE_TTL_SECONDS);
    } catch (e) {
      console.warn("[fetchAllShopifyOrders] Redis cache set failed:", e.message);
    }
  }

  return orders;
}
