import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import Notification from "@/models/Notification";
import { getSettings } from "@/lib/getSettings";
import { sendKlaviyoMusicDelivery, sendKlaviyoVideoUploadLink } from "@/lib/klaviyo";
import { fulfillShopifyOrder } from "@/lib/shopifyFulfill";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await dbConnect();
    const settings = await getSettings();

    if (!settings.klaviyoApiKey) {
      return NextResponse.json({ success: false, error: "Klaviyo API key is not configured" }, { status: 400 });
    }

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const results = {
      healedMusicOrders: 0,
      failedMusicDeliveries: 0,
      healedVideoOrders: 0,
      errors: [],
    };

    // 1. RECONCILE MUSIC ORDERS:
    // Look for orders that have musicTracks, are paid or in production, but deliveryEmailSent is still false
    const pendingMusicOrders = await Order.find({
      $and: [
        {
          $or: [
            { "musicTracks.0": { $exists: true } },
            { "revisions.0": { $exists: true } },
          ],
        },
        {
          $or: [
            { status: { $in: ["paid", "in_production", "delivering"] } },
            { shopifyOrderId: { $exists: true, $ne: "" } },
          ],
        },
        { deliveryEmailSent: { $ne: true } },
        { createdAt: { $gte: fourteenDaysAgo } },
      ],
    }).limit(20);

    for (const order of pendingMusicOrders) {
      try {
        const orderNum = order.shopifyOrderNumber || order.orderNumber || order.shopifyOrderId || "";
        const email = (order.email || "").trim();

        if (!email || !email.includes("@")) {
          order.emailDeliveryFailed = true;
          order.emailDeliveryError = "Invalid or missing customer email";
          await order.save();
          results.failedMusicDeliveries++;
          continue;
        }

        console.log(`[Order Reconciliation] Re-dispatching music delivery for Order ${orderNum} (${email})`);

        const klaviyoResult = await sendKlaviyoMusicDelivery(
          settings.klaviyoApiKey,
          email,
          [order],
          orderNum
        );

        if (klaviyoResult.success) {
          order.deliveryEmailSent = true;
          order.status = "fulfilled";
          order.emailDeliveryFailed = false;
          order.emailDeliveryError = "";
          await order.save();
          results.healedMusicOrders++;

          // Fulfill in Shopify
          if (order.shopifyOrderId && settings.shopifyAdminApiKey && settings.shopUrl1) {
            try {
              await fulfillShopifyOrder(order.shopifyOrderId, settings);
            } catch (fErr) {
              console.warn(`[Order Reconciliation] Shopify fulfill warning for ${order.shopifyOrderId}:`, fErr.message);
            }
          }

          // Create notification
          await Notification.create({
            title: "Order Reconciled & Delivered",
            message: `Music delivery email automatically sent to ${email} for Order ${orderNum}.`,
            type: "music_delivered",
            link: `/orders/music/${order.shopifyOrderId || order._id}`,
          });
        } else {
          order.emailDeliveryFailed = true;
          order.emailDeliveryError = klaviyoResult.error || "Klaviyo rejected event delivery";
          await order.save();
          results.failedMusicDeliveries++;
          results.errors.push(`Order ${orderNum}: ${klaviyoResult.error}`);
        }
      } catch (orderErr) {
        console.error(`[Order Reconciliation] Error processing order ${order._id}:`, orderErr);
        results.errors.push(`Order ${order._id}: ${orderErr.message}`);
      }
    }

    // 2. RECONCILE VIDEO ORDERS:
    // Look for video orders where uploadLinkSent is false or uploadLink is not opened
    const pendingVideoOrders = await VideoOrder.find({
      $and: [
        {
          $or: [
            { uploadLinkSent: { $ne: true } },
            { deliveryEmailSent: { $ne: true } },
          ],
        },
        { createdAt: { $gte: fourteenDaysAgo } },
      ],
    }).limit(10);

    for (const vOrder of pendingVideoOrders) {
      try {
        const orderNum = vOrder.shopifyOrderNumber || vOrder.shopifyOrderId || "";
        const email = (vOrder.email || "").trim();

        if (email && vOrder.uploadLinkSent !== true && vOrder.mediaFiles?.length === 0) {
          if (!vOrder.uploadToken) {
            const crypto = await import("crypto");
            vOrder.uploadToken = crypto.randomBytes(24).toString("base64url");
            vOrder.uploadTokenStatus = "active";
          }

          // Auto-link audio from music order if not yet linked
          if (!vOrder.audioFile?.key && !vOrder.audioFile?.url) {
            const matchedMusic = await Order.findOne({
              $or: [
                ...(vOrder.shopifyOrderId ? [{ shopifyOrderId: vOrder.shopifyOrderId }] : []),
                ...(vOrder.shopifyOrderNumber ? [{ shopifyOrderNumber: vOrder.shopifyOrderNumber }] : []),
                ...(email ? [{ email }] : []),
              ],
            }).sort({ createdAt: -1 });

            if (matchedMusic) {
              let track = matchedMusic.musicTracks?.[0];
              if (matchedMusic.selectedDemo) {
                const fav = (matchedMusic.musicTracks || []).find((t) => t.id === matchedMusic.selectedDemo);
                if (fav) track = fav;
              }
              if (track && (track.audioUrl || track.streamAudioUrl)) {
                vOrder.audioFile = {
                  key: track.audioUrl || track.streamAudioUrl,
                  url: track.audioUrl || track.streamAudioUrl,
                  name: track.title || "Custom Song",
                  size: 0,
                };
                vOrder.originalMusicOrderId = matchedMusic._id;
              }
            }
          }

          const storeBaseUrl = settings.shopUrl1 || process.env.NEXT_PUBLIC_APP_URL || "https://myownsong.nl";
          const uploadLink = `${storeBaseUrl.replace(/\/$/, "")}/pages/create-video?token=${encodeURIComponent(vOrder.uploadToken)}`;
          const klavRes = await sendKlaviyoVideoUploadLink(
            settings.klaviyoApiKey,
            email,
            orderNum,
            uploadLink
          );

          if (klavRes.success) {
            vOrder.uploadLinkSent = true;
            vOrder.uploadLinkSentAt = new Date();
            await vOrder.save();
            results.healedVideoOrders++;
          }
        }
      } catch (vErr) {
        console.error(`[Order Reconciliation] Video order error:`, vErr);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: results,
    });
  } catch (error) {
    console.error("[Order Reconciliation Cron Error]:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
