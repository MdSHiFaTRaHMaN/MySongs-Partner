import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import Notification from "@/models/Notification";
import { getSettings } from "@/lib/getSettings";
import { fulfillShopifyOrder } from "@/lib/shopifyFulfill";
import { withCORS, handleOptions } from "@/lib/cors";

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();
    const settings = await getSettings();

    const body = await request.json().catch(() => ({}));
    const rawEmail = body.email || body.person?.email || "";
    const email = rawEmail.trim().toLowerCase();
    const rawShopifyOrderId = body.shopifyOrderId || body.orderId || body.shopifyOrderNumber || "";
    const cleanShopifyOrderId = String(rawShopifyOrderId).replace(/^#/, "").trim();
    const musicId = (body.musicId || "").trim();
    const videoId = (body.videoId || "").trim();
    const orderType = (body.orderType || body.type || "").trim().toLowerCase();

    console.log(`[Klaviyo Webhook] Fulfillment trigger received for email: ${email}, shopifyOrderId: ${cleanShopifyOrderId}, musicId: ${musicId}, videoId: ${videoId}, orderType: ${orderType}`);

    if (!email && !cleanShopifyOrderId && !musicId && !videoId) {
      return withCORS(
        NextResponse.json(
          { success: false, error: "Missing email, shopifyOrderId, musicId, or videoId in request payload" },
          { status: 400 }
        ),
        origin
      );
    }

    // ── Dedicated Branch for Music Publish Orders ──
    if (orderType === "publish" && cleanShopifyOrderId) {
      console.log(`[Klaviyo Webhook] Processing Music Publish order fulfillment for #${cleanShopifyOrderId}...`);
      const fulfillResult = await fulfillShopifyOrder(cleanShopifyOrderId, settings);

      if (fulfillResult.success || fulfillResult.message?.includes("Already fulfilled")) {
        // Update local MongoDB Order if it exists
        try {
          const matchedOrder = await Order.findOne({
            $or: [
              { shopifyOrderId: cleanShopifyOrderId },
              { shopifyOrderId: `#${cleanShopifyOrderId}` },
              { shopifyOrderNumber: cleanShopifyOrderId },
              { shopifyOrderNumber: `#${cleanShopifyOrderId}` },
            ],
          });

          if (matchedOrder) {
            matchedOrder.status = "fulfilled";
            matchedOrder.deliveryEmailSent = true;
            if (!matchedOrder.publishLinks) matchedOrder.publishLinks = {};
            matchedOrder.publishLinks.fulfilledAt = new Date();
            matchedOrder.publishLinks.webhookConfirmed = true;
            matchedOrder.markModified("publishLinks");
            await matchedOrder.save();
          }
        } catch (dbErr) {
          console.warn("[Klaviyo Webhook] DB update warning for publish order:", dbErr.message);
        }

        // Create Admin Notification
        await Notification.create({
          title: "Music Publish Order Fulfilled via Klaviyo",
          message: `Publish Order #${cleanShopifyOrderId} for ${email || "customer"} was successfully fulfilled in Shopify after Klaviyo delivery confirmation.`,
          type: "publish_delivered",
          link: `/orders/publish/${cleanShopifyOrderId}`,
        }).catch((err) => console.error("Notification creation error:", err));

        console.log(`[Klaviyo Webhook] Successfully fulfilled Music Publish order #${cleanShopifyOrderId}`);
        return withCORS(
          NextResponse.json({
            success: true,
            message: "Music Publish order fulfilled successfully on Shopify",
            shopifyOrderId: cleanShopifyOrderId,
            orderType: "publish",
          }),
          origin
        );
      } else {
        console.error(`[Klaviyo Webhook] Shopify fulfillment failed for publish order #${cleanShopifyOrderId}:`, fulfillResult.message);
        return withCORS(
          NextResponse.json(
            { success: false, error: fulfillResult.message || "Failed to fulfill publish order in Shopify" },
            { status: 500 }
          ),
          origin
        );
      }
    }

    let targetOrder = null;
    let isVideoOrder = false;
    let isPublishOrder = false;

    // Check VideoOrder first if videoId is provided
    if (videoId) {
      targetOrder = await VideoOrder.findOne({ videoId });
      if (targetOrder) isVideoOrder = true;
    }

    // 1. Try matching by exact shopifyOrderId in VideoOrder or Order
    if (!targetOrder && cleanShopifyOrderId) {
      targetOrder = await VideoOrder.findOne({
        $or: [
          { shopifyOrderId: cleanShopifyOrderId },
          { shopifyOrderId: `#${cleanShopifyOrderId}` },
          { shopifyOrderNumber: cleanShopifyOrderId },
          { shopifyOrderNumber: `#${cleanShopifyOrderId}` },
        ]
      });
      if (targetOrder) {
        isVideoOrder = true;
      } else {
        targetOrder = await Order.findOne({
          $or: [
            { shopifyOrderId: cleanShopifyOrderId },
            { shopifyOrderId: `#${cleanShopifyOrderId}` },
            { shopifyOrderNumber: cleanShopifyOrderId },
            { shopifyOrderNumber: `#${cleanShopifyOrderId}` }
          ]
        });
        if (targetOrder?.publishLinks) {
          isPublishOrder = true;
        }
      }
    }

    // 2. Try matching by musicId if not found yet
    if (!targetOrder && musicId) {
      targetOrder = await Order.findOne({ musicId: musicId });
    }

    // 3. Fallback to latest delivering/paid order by email
    if (!targetOrder && email) {
      targetOrder = await VideoOrder.findOne({
        email: { $regex: `^${email}$`, $options: "i" },
        status: { $in: ["delivering", "ready", "paid", "in_production", "created"] }
      }).sort({ createdAt: -1 });

      if (targetOrder) {
        isVideoOrder = true;
      } else {
        targetOrder = await Order.findOne({
          email: { $regex: `^${email}$`, $options: "i" },
          status: { $in: ["delivering", "paid", "created"] }
        }).sort({ createdAt: -1 });
      }
    }

    // 4. If no DB order found, but cleanShopifyOrderId exists, attempt direct Shopify fulfillment
    if (!targetOrder && cleanShopifyOrderId) {
      console.log(`[Klaviyo Webhook] No matching local DB order, attempting direct Shopify fulfillment for #${cleanShopifyOrderId}...`);
      const directFulfillRes = await fulfillShopifyOrder(cleanShopifyOrderId, settings);

      if (directFulfillRes.success || directFulfillRes.message?.includes("Already fulfilled")) {
        await Notification.create({
          title: "Shopify Order Fulfilled via Klaviyo",
          message: `Order #${cleanShopifyOrderId} for ${email || "customer"} was fulfilled in Shopify after Klaviyo webhook confirmation.`,
          type: "order_fulfilled",
          link: `/orders/publish/${cleanShopifyOrderId}`,
        }).catch((err) => console.error("Notification creation error:", err));

        return withCORS(
          NextResponse.json({
            success: true,
            message: "Order fulfilled directly on Shopify",
            shopifyOrderId: cleanShopifyOrderId,
            orderType: "shopify",
          }),
          origin
        );
      } else {
        console.warn(`[Klaviyo Webhook] Direct fulfillment failed for #${cleanShopifyOrderId}:`, directFulfillRes.message);
      }
    }

    if (!targetOrder) {
      console.warn(`[Klaviyo Webhook] No matching order found for email: ${email}, shopifyOrderId: ${cleanShopifyOrderId}, musicId: ${musicId}, videoId: ${videoId}`);
      return withCORS(
        NextResponse.json(
          { success: false, error: "Matching order not found" },
          { status: 404 }
        ),
        origin
      );
    }

    // Determine the shopifyOrderId to fulfill
    const orderToFulfillId = targetOrder.shopifyOrderId || cleanShopifyOrderId;

    if (!orderToFulfillId) {
      console.warn(`[Klaviyo Webhook] Order ${targetOrder._id} does not have a linked shopifyOrderId yet.`);
      targetOrder.status = "delivering";
      targetOrder.deliveryEmailSent = true;
      await targetOrder.save();

      return withCORS(
        NextResponse.json(
          { success: false, message: "Order status updated to delivering, but no shopifyOrderId is linked to fulfill in Shopify." },
          { status: 200 }
        ),
        origin
      );
    }

    // Execute Shopify fulfillment
    console.log(`[Klaviyo Webhook] Fulfilling order ${orderToFulfillId} in Shopify...`);
    const fulfillResult = await fulfillShopifyOrder(orderToFulfillId, settings);

    if (fulfillResult.success || fulfillResult.message?.includes("Already fulfilled")) {
      targetOrder.status = "fulfilled";
      targetOrder.deliveryEmailSent = true;
      if (isVideoOrder) {
        targetOrder.deliveredAt = new Date();
      }
      if (isPublishOrder) {
        if (!targetOrder.publishLinks) targetOrder.publishLinks = {};
        targetOrder.publishLinks.fulfilledAt = new Date();
        targetOrder.publishLinks.webhookConfirmed = true;
        targetOrder.markModified("publishLinks");
      }
      await targetOrder.save();

      // Determine notification title and link
      const notifTitle = isVideoOrder
        ? "Video Order Fulfilled via Klaviyo"
        : isPublishOrder
          ? "Music Publish Order Fulfilled via Klaviyo"
          : "Music Order Fulfilled via Klaviyo";
      
      const notifLink = isVideoOrder
        ? `/orders/video/${targetOrder.shopifyOrderId || targetOrder._id}`
        : isPublishOrder
          ? `/orders/publish/${targetOrder.shopifyOrderId || orderToFulfillId}`
          : `/ordered-musics/${targetOrder._id}`;

      // Create admin notification
      await Notification.create({
        title: notifTitle,
        message: `Order #${orderToFulfillId} for ${targetOrder.email} was fulfilled after Klaviyo delivery confirmation.`,
        type: isPublishOrder ? "publish_delivered" : "order_fulfilled",
        link: notifLink,
      }).catch(err => console.error("Notification creation error:", err));

      console.log(`[Klaviyo Webhook] Successfully fulfilled ${isPublishOrder ? "publish" : isVideoOrder ? "video" : "music"} order #${orderToFulfillId} for ${targetOrder.email}`);

      return withCORS(
        NextResponse.json({
          success: true,
          message: "Shopify order fulfilled successfully",
          shopifyOrderId: orderToFulfillId,
          orderId: targetOrder._id,
          orderType: isPublishOrder ? "publish" : isVideoOrder ? "video" : "music"
        }),
        origin
      );
    } else {
      console.error(`[Klaviyo Webhook] Shopify fulfillment failed for order #${orderToFulfillId}:`, fulfillResult.message);
      return withCORS(
        NextResponse.json(
          { success: false, error: fulfillResult.message || "Failed to fulfill order in Shopify" },
          { status: 500 }
        ),
        origin
      );
    }
  } catch (error) {
    console.error("[Klaviyo Webhook] Error processing fulfillment:", error);
    return withCORS(
      NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 }),
      origin
    );
  }
}
