import { NextResponse } from "next/server";
import { getSettings } from "@/lib/getSettings";
import { sendKlaviyoPublishDelivery } from "@/lib/klaviyo";
import { fulfillShopifyOrder } from "@/lib/shopifyFulfill";
import dbConnect from "@/lib/mongoose";
import Notification from "@/models/Notification";
import Order from "@/models/Order";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      shopifyOrderId,
      shopifyOrderNumber,
      email,
      customerName,
      songTitle,
      artistName,
      spotifyUrl,
      appleMusicUrl,
      youtubeUrl,
      otherUrl,
      links = [],
      customMessage,
      fulfillOnShopify = true,
    } = body;

    if (!email) {
      return NextResponse.json({ success: false, error: "Customer email is required" }, { status: 400 });
    }

    if (!spotifyUrl && !appleMusicUrl && !youtubeUrl && !otherUrl) {
      return NextResponse.json(
        { success: false, error: "Please provide at least one streaming link (Spotify, Apple Music, YouTube, etc.)" },
        { status: 400 }
      );
    }

    await dbConnect();
    const settings = await getSettings();

    if (!settings.klaviyoApiKey) {
      return NextResponse.json(
        { success: false, error: "Klaviyo API Key is not configured. Please set it in Settings." },
        { status: 400 }
      );
    }

    const cleanShopifyId = shopifyOrderId ? String(shopifyOrderId).replace(/^#/, "").trim() : "";
    const cleanOrderNum = shopifyOrderNumber ? String(shopifyOrderNumber).replace(/^#/, "").trim() : cleanShopifyId;

    // 1. Send Publish_Delivered event to Klaviyo
    const klaviyoResult = await sendKlaviyoPublishDelivery(
      settings.klaviyoApiKey,
      email,
      {
        spotifyUrl,
        appleMusicUrl,
        youtubeUrl,
        otherUrl,
        links,
        songTitle: songTitle || "Published Song",
        artistName: artistName || "",
        customMessage: customMessage || "",
        customerName: customerName || "",
        shopifyOrderId: cleanShopifyId,
        shopifyOrderNumber: cleanOrderNum,
      },
      cleanOrderNum
    );

    if (!klaviyoResult.success) {
      return NextResponse.json(
        { success: false, error: klaviyoResult.error || "Failed to dispatch Klaviyo delivery event" },
        { status: 500 }
      );
    }

    // 2. Optional Immediate Shopify fulfillment (only if explicitly requested via immediateFulfill)
    let shopifyFulfilled = false;
    if (body.immediateFulfill && cleanShopifyId && settings.shopifyAdminApiKey && settings.shopUrl1) {
      try {
        const fulfillRes = await fulfillShopifyOrder(cleanShopifyId, settings);
        shopifyFulfilled = fulfillRes.success;
      } catch (fErr) {
        console.warn("[publish-deliver] Immediate Shopify fulfillment notice:", fErr.message);
      }
    }

    // 3. Save Notification
    try {
      await Notification.create({
        title: "Music Publish Delivery Email Dispatched",
        message: `Published links for ${email} (Order #${cleanOrderNum}) were sent to Klaviyo. Shopify fulfillment will trigger automatically upon Klaviyo webhook confirmation.`,
        type: "publish_delivered",
        link: `/orders/publish/${cleanShopifyId}`,
      });
    } catch (notifErr) {
      console.warn("[publish-deliver] Notification creation warning:", notifErr.message);
    }

    // 4. Update or Upsert MongoDB Order record for this publish order
    try {
      const orderNumFormatted = cleanOrderNum ? `#${cleanOrderNum.replace(/^#/, "")}` : `#${cleanShopifyId}`;
      const possibleIds = [
        cleanShopifyId,
        `#${cleanShopifyId}`,
        cleanOrderNum,
        `#${cleanOrderNum}`,
        orderNumFormatted,
      ].filter(Boolean);

      const publishLinksData = {
        spotifyUrl: spotifyUrl || "",
        appleMusicUrl: appleMusicUrl || "",
        youtubeUrl: youtubeUrl || "",
        otherUrl: otherUrl || "",
        links: Array.isArray(links) ? links : [],
        songTitle: songTitle || "",
        artistName: artistName || "",
        deliveredAt: new Date(),
        webhookConfirmed: Boolean(shopifyFulfilled),
        fulfillmentStatus: shopifyFulfilled ? "fulfilled" : "waiting_klaviyo_webhook",
      };

      await Order.findOneAndUpdate(
        {
          $or: [
            { shopifyOrderId: { $in: possibleIds } },
            { shopifyOrderNumber: { $in: possibleIds } },
          ],
        },
        {
          $set: {
            email: email,
            shopifyOrderId: String(cleanShopifyId),
            shopifyOrderNumber: orderNumFormatted,
            deliveryEmailSent: true,
            publishLinks: publishLinksData,
            publishStatus: "delivered",
            status: shopifyFulfilled ? "fulfilled" : "delivering",
          },
          $setOnInsert: {
            taskId: `publish_${cleanShopifyId || Date.now()}`,
            musicId: `publish_${cleanShopifyId || Date.now()}`,
            selectedPackage: "publish",
            orderNotes: "Publish on all streaming platforms",
          },
        },
        { upsert: true, new: true }
      );

      // If this order references an original music order, also update publishLinks on the original order
      const originalRef = body.originalOrderNumber || body.originalOrderId;
      if (originalRef) {
        const cleanOrig = String(originalRef).replace(/^#/, "").trim();
        await Order.updateMany(
          {
            $or: [
              { shopifyOrderId: cleanOrig },
              { shopifyOrderId: `#${cleanOrig}` },
              { shopifyOrderNumber: cleanOrig },
              { shopifyOrderNumber: `#${cleanOrig}` },
              { musicId: cleanOrig },
            ],
          },
          {
            $set: {
              publishLinks: publishLinksData,
            },
          }
        );
      }
    } catch (dbErr) {
      console.error("[publish-deliver] Error saving DB Order record:", dbErr);
    }

    return NextResponse.json({
      success: true,
      message: shopifyFulfilled
        ? "Music Publish Delivery email dispatched and order fulfilled on Shopify!"
        : "Music Publish Delivery email dispatched via Klaviyo! Shopify fulfillment will trigger automatically once Klaviyo confirms email delivery via webhook.",
      shopifyFulfilled,
      waitingWebhook: !shopifyFulfilled,
    });
  } catch (error) {
    console.error("[publish-deliver] Error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
