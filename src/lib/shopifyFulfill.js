/**
 * Programmatically fulfills a Shopify order.
 * 
 * @param {string|number} orderId - The Shopify Order ID
 * @param {object} settings - The global settings object containing shopifyAdminApiKey and shopUrl1
 * @returns {object} - { success: boolean, message: string, fulfillment: object|null }
 */
export async function fulfillShopifyOrder(orderId, settings) {
  if (!settings || !settings.shopUrl1 || !settings.shopifyAdminApiKey) {
    console.error("[Shopify Fulfill] Shopify integration is not configured.");
    return { success: false, message: "Shopify API not configured" };
  }

  let url = settings.shopUrl1;
  if (!url.startsWith('http')) url = `https://${url}`;

  const headers = {
    "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
    "Content-Type": "application/json"
  };

  let realOrderId = String(orderId).replace(/^#/, "").trim();

  try {
    // If orderId is a short order number (e.g. 1166) instead of internal 13-digit ID, resolve it via Shopify search
    const isLikelyOrderNumber = !/^\d{10,}$/.test(realOrderId);

    if (isLikelyOrderNumber) {
      try {
        const searchRes = await fetch(`${url}/admin/api/2024-04/orders.json?name=${encodeURIComponent('#' + realOrderId)}&status=any`, {
          headers,
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const found = searchData.orders && searchData.orders[0];
          if (found) {
            console.log(`[Shopify Fulfill] Resolved order #${realOrderId} -> Shopify ID ${found.id}`);
            realOrderId = String(found.id);
          }
        }
      } catch (e) {
        console.warn("[Shopify Fulfill] Failed to resolve order number to Shopify ID:", e);
      }
    }

    // 1. Get fulfillment_orders for this order
    let fulfillmentOrdersRes = await fetch(`${url}/admin/api/2024-04/orders/${realOrderId}/fulfillment_orders.json`, {
      method: "GET",
      headers,
    });

    // Fallback if 404: try searching Shopify order by name without '#' prefix
    if (!fulfillmentOrdersRes.ok && fulfillmentOrdersRes.status === 404) {
      try {
        const searchRes = await fetch(`${url}/admin/api/2024-04/orders.json?name=${encodeURIComponent(realOrderId)}&status=any`, {
          headers,
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const found = searchData.orders && searchData.orders[0];
          if (found && String(found.id) !== realOrderId) {
            realOrderId = String(found.id);
            fulfillmentOrdersRes = await fetch(`${url}/admin/api/2024-04/orders/${realOrderId}/fulfillment_orders.json`, {
              method: "GET",
              headers,
            });
          }
        }
      } catch (e) {
        console.warn("[Shopify Fulfill] Fallback order search failed:", e);
      }
    }

    if (!fulfillmentOrdersRes.ok) {
      const errorText = await fulfillmentOrdersRes.text();
      console.error("[Shopify Fulfill] Failed to fetch fulfillment orders:", errorText);
      return { success: false, message: "Failed to retrieve fulfillment orders from Shopify" };
    }

    const fulfillmentOrdersData = await fulfillmentOrdersRes.json();
    const fulfillmentOrders = fulfillmentOrdersData.fulfillment_orders;

    if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
      console.error("[Shopify Fulfill] No fulfillment orders found for this order.");
      console.error("[Shopify Fulfill] THIS USUALLY MEANS YOUR SHOPIFY APP IS MISSING PERMISSIONS!");
      console.error("[Shopify Fulfill] Please go to Shopify Admin > Settings > Apps > Custom Apps > Your App > API Credentials > Edit, and add 'write_merchant_managed_fulfillment_orders' and 'read_merchant_managed_fulfillment_orders' scopes.");
      return { success: false, message: "Missing 'merchant_managed_fulfillment_orders' API permission in Shopify App." };
    }

    // Find a fulfillable order
    const fulfillableOrder = fulfillmentOrders.find(fo => 
      fo.status.toUpperCase() === 'OPEN' || fo.status.toUpperCase() === 'IN_PROGRESS'
    );
    if (!fulfillableOrder) {
      console.warn("[Shopify Fulfill] No open fulfillment orders available. It is already fulfilled in Shopify.");
      return {
        success: true,
        alreadyFulfilled: true,
        message: "Order is already fulfilled in Shopify or has no open fulfillments",
        fulfillment: null
      };
    }

    const fulfillmentOrderId = fulfillableOrder.id;
    const fulfillmentOrderLineItems = fulfillableOrder.line_items.map(item => ({
      id: item.id,
      quantity: item.quantity
    }));

    // 2. Create the Fulfillment
    const fulfillmentPayload = {
      fulfillment: {
        message: "Order fulfilled automatically via Music Dashboard integration.",
        notify_customer: false, // We already sent the email via Klaviyo
        line_items_by_fulfillment_order: [
          {
            fulfillment_order_id: fulfillmentOrderId,
            fulfillment_order_line_items: fulfillmentOrderLineItems
          }
        ]
      }
    };

    const fulfillRes = await fetch(`${url}/admin/api/2024-04/fulfillments.json`, {
      method: "POST",
      headers,
      body: JSON.stringify(fulfillmentPayload)
    });

    const fulfillData = await fulfillRes.json();

    if (!fulfillRes.ok) {
      console.error("[Shopify Fulfill] Failed to create fulfillment:", fulfillData);
      return { success: false, message: "Failed to fulfill order in Shopify", details: fulfillData };
    }

    console.log(`[Shopify Fulfill] Successfully fulfilled order ${orderId}`);
    return { success: true, message: "Order fulfilled successfully", fulfillment: fulfillData.fulfillment };

  } catch (error) {
    console.error("[Shopify Fulfill] Network error during fulfillment:", error);
    return { success: false, message: "Network error during fulfillment" };
  }
}
