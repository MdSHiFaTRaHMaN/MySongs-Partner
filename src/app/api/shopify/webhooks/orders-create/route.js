import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongoose";
import Notification from "@/models/Notification";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "@/lib/getSettings";
import { sendKlaviyoMusicDelivery, sendKlaviyoVideoUploadLink, sendKlaviyoBundleCoupons } from "@/lib/klaviyo";
import { fulfillShopifyOrder } from "@/lib/shopifyFulfill";
import { clearShopifyOrdersCache } from "@/lib/shopifyOrders";
import redis from "@/lib/redis";


// Helper: send Klaviyo delivery email and fulfill Shopify order
async function sendDeliveryEmail(localOrders, settings, orderData) {
  try {
    const klaviyoResult = await sendKlaviyoMusicDelivery(
      settings.klaviyoApiKey,
      orderData.email || localOrders[0].email,
      localOrders,
      orderData.order_number
    );
    if (klaviyoResult?.success) {
      await Promise.all(localOrders.map(o =>
        Order.updateOne({ _id: o._id }, { $set: { deliveryEmailSent: true, status: "delivering" } })
      ));
      console.log(`[Shopify Webhook] Music_Delivered event sent to Klaviyo for order ${orderData.id}. Status set to 'delivering'.`);
    } else {
      console.error(`[Shopify Webhook] Klaviyo delivery email failed for order ${orderData.id}.`);
    }
  } catch (e) {
    console.error(`[Shopify Webhook] sendDeliveryEmail error:`, e);
  }
}

export async function POST(request) {

  try {
    const rawBody = await request.text();
    const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
    const shopDomain = request.headers.get("X-Shopify-Shop-Domain");

    const settings = await getSettings();
    // Allow using a dedicated Webhook Secret from .env, fallback to settings
    const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET || settings.shopifySecretId;

    if (!shopifySecret) {
      console.error("[Shopify Webhook] Shopify Secret ID / Webhook Secret not configured");
      return NextResponse.json({ error: "Configuration missing" }, { status: 500 });
    }

    // Verify webhook signature
    const hash = crypto
      .createHmac("sha256", shopifySecret)
      .update(rawBody, "utf8", "hex")
      .digest("base64");

    if (hash !== hmacHeader) {
      console.error("[Shopify Webhook] HMAC validation failed.");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orderData = JSON.parse(rawBody);

    await dbConnect();

    let hasVideoOrder = false;

    // Check if the order has line items with a musicId or videoId property
    if (orderData.line_items && Array.isArray(orderData.line_items)) {
      const financialStatus = orderData.financial_status || "pending";
      // Map Shopify paid status to our system
      const newStatus = financialStatus; // "paid", "pending", "refunded" etc.

      let updatedMusic = false;

      for (const item of orderData.line_items) {
        if (item.properties && Array.isArray(item.properties)) {
          const getProp = (targetName) => {
            const target = targetName.toLowerCase().replace(/[\s_-]/g, "");
            return item.properties.find((p) => p.name?.toLowerCase().replace(/[\s_-]/g, "") === target);
          };

          // Check Order Type property (_orderType: "video" or "music")
          const orderTypeProp = getProp("ordertype");
          const isVideoLineItem = orderTypeProp?.value?.toLowerCase() === "video" || !!getProp("videoid");
          const isMusicLineItem = orderTypeProp?.value?.toLowerCase() === "music" || !!getProp("musicid");

          // Check for Video ID / Video Order
          const videoIdProp = getProp("videoid");
          if (isVideoLineItem && (videoIdProp?.value || orderTypeProp?.value?.toLowerCase() === "video")) {
            hasVideoOrder = true;
            const targetVideoId = videoIdProp?.value;
            const customerFullName = orderData.customer ? `${orderData.customer.first_name || ''} ${orderData.customer.last_name || ''}`.trim() : "";
            
            const formatProp = getProp("_video_format") || getProp("videoformat") || getProp("video_format") || getProp("aspectratio") || getProp("_aspect_ratio");
            const rawFormat = formatProp?.value || "";
            const parsedFormat = rawFormat.includes("16:9") ? "16:9" : rawFormat.includes("9:16") ? "9:16" : undefined;

            if (targetVideoId) {
              const updateFields = {
                status: newStatus === "paid" ? "in_production" : newStatus,
                shopifyOrderId: String(orderData.id),
                shopifyOrderNumber: String(orderData.name || (orderData.order_number ? `#${orderData.order_number}` : "")),
                email: orderData.email || orderData.contact_email || undefined,
                customerName: customerFullName || undefined,
              };
              if (parsedFormat) {
                updateFields.videoFormat = parsedFormat;
              }

              const vResult = await VideoOrder.findOneAndUpdate(
                { videoId: targetVideoId },
                { $set: updateFields },
                { returnDocument: 'after' }
              );
              if (vResult) {
                console.log(`[Shopify Webhook] Updated video order ${targetVideoId} → ${newStatus}`);
              }
            }
          }

          // Normalized lookup for Music ID / Music Order
          const musicIdProp = getProp("musicid");
          const audioUrlProp = getProp("audiourl");
          const lyricsProp = getProp("lyrics");
          const songTitleProp = getProp("songtitle");
          const occasionProp = getProp("occasion");

          const shopifyOrderNumStr = String(orderData.name || (orderData.order_number ? `#${orderData.order_number}` : `#${orderData.id}`));

          if (musicIdProp && musicIdProp.value) {
            const mId = String(musicIdProp.value).trim();
            const updateDoc = {
              status: newStatus,
              shopifyOrderId: String(orderData.id),
              shopifyOrderNumber: shopifyOrderNumStr,
            };
            if (orderData.email) {
              updateDoc.checkoutEmail = orderData.email;
              updateDoc.email = orderData.email; // Prioritize paid Shopify checkout email
            }
            const result = await Order.findOneAndUpdate(
              {
                $or: [
                  { musicId: mId },
                  { taskId: mId },
                  { "musicTracks.id": mId },
                  ...(mId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: mId }] : []),
                ],
              },
              { $set: updateDoc },
              { returnDocument: 'after' }
            );
            if (result) {
              updatedMusic = true;
              console.log(`[Shopify Webhook] Linked music ${mId} (Order ${shopifyOrderNumStr}) → ${newStatus}`);
            }
          }

          // If no order updated by musicId, but audioUrl is present, create or link order
          if (!updatedMusic && !hasVideoOrder && audioUrlProp?.value) {
            const newMusicId = musicIdProp?.value || `auto_${orderData.id}_${item.id}`;
            const directAudio = audioUrlProp.value;
            const existing = await Order.findOne({ $or: [{ musicId: newMusicId }, { shopifyOrderId: String(orderData.id) }] });
            if (!existing) {
              await Order.create({
                musicId: newMusicId,
                email: orderData.email || orderData.contact_email || "no-email@shopify.com",
                shopifyOrderId: String(orderData.id),
                shopifyOrderNumber: shopifyOrderNumStr,
                status: newStatus,
                occasion: occasionProp?.value || "custom-song",
                lyrics: lyricsProp?.value || "",
                musicTracks: [
                  {
                    id: "track_1",
                    title: songTitleProp?.value || item.title || "Custom Song",
                    audioUrl: directAudio,
                    streamAudioUrl: directAudio,
                  }
                ],
                selectedDemo: "track_1",
              });
              updatedMusic = true;
              console.log(`[Shopify Webhook] Auto-created order record for Shopify Order #${orderData.order_number}`);
            }
          }
        }
      }

      // Check if order has publish items or references an original order
      const hasPublishOrOriginal = (orderData.line_items || []).some((item) => {
        const props = item.properties || [];
        const normTitle = (item.title || "").toLowerCase();
        const hasProp = props.some((p) => {
          const k = (p.name || "").toLowerCase().replace(/[\s_-]/g, "");
          const v = String(p.value || "").toLowerCase();
          if (k.includes("streamingpackage") && v.includes("video")) return false;
          return k.includes("originalorder") || (k.includes("streamingpackage") && !v.includes("video")) || k.includes("publish");
        });
        return hasProp || normTitle.includes("publish") || (normTitle.includes("streaming") && !normTitle.includes("video")) || normTitle.includes("spotify");
      });

      // Fallback: if no musicId property found, not video, and not publish order, try matching by customer email
      if (!updatedMusic && !hasVideoOrder && !hasPublishOrOriginal && orderData.email) {
        const shopifyOrderNumStr = String(orderData.name || (orderData.order_number ? `#${orderData.order_number}` : `#${orderData.id}`));
        const itemsToFulfill = orderData.line_items ? orderData.line_items.length : 1;
        const fallbackOrders = await Order.find({
          email: orderData.email,
          status: { $in: ["in_cart", "created", "pending_payment", "pending"] },
        }).sort({ createdAt: -1 }).limit(itemsToFulfill);

        for (const fOrder of fallbackOrders) {
          await Order.updateOne(
            { _id: fOrder._id },
            { $set: { status: newStatus, shopifyOrderId: String(orderData.id), shopifyOrderNumber: shopifyOrderNumStr } }
          );
          console.log(`[Shopify Webhook] Fallback: updated ${fOrder._id} for ${orderData.email} → ${newStatus}`);
        }
      }

      // ── Bundled Klaviyo Automation & Auto Fulfill for Music ──
      const shopifyOrderNumStr = String(orderData.name || (orderData.order_number ? `#${orderData.order_number}` : `#${orderData.id}`));

      if (newStatus === "paid") {
        const localOrders = await Order.find({
          $or: [
            { shopifyOrderId: String(orderData.id) },
            { shopifyOrderNumber: shopifyOrderNumStr },
          ],
        });

        if (localOrders.length > 0) {
          const allReady = localOrders.every(o => o.musicTracks && o.musicTracks.length > 0 && o.musicTracks[0].audioUrl);
          const anyUnsent = localOrders.some(o => !o.deliveryEmailSent);

          if (allReady && anyUnsent) {
            // Tracks already in DB — send delivery email immediately
            await sendDeliveryEmail(localOrders, settings, orderData);
          } else if (anyUnsent) {
            console.log(`[Shopify Webhook] Tracks not ready yet for order ${orderData.id}. Worker will fulfill when ready.`);
          }
        }

        // ── AUTOMATION: Music Video Upsell Selected ──
        const hasVideoLineItem = (orderData.line_items || []).some((item) => {
          const title = String(item.title || "").toLowerCase();
          const props = item.properties || [];
          return (
            title.includes("video") ||
            props.some((p) => {
              const k = String(p.name || "").toLowerCase().replace(/[\s_-]/g, "");
              const v = String(p.value || "").toLowerCase();
              return k.includes("videoid") || k.includes("videoformat") || (k.includes("ordertype") && v === "video") || v.includes("video");
            })
          );
        });

        if (hasVideoLineItem && orderData.email && settings.klaviyoApiKey) {
          const cleanOrderNum = String(orderData.order_number || orderData.name || orderData.id).replace(/^#/, "");
          const rawDomain = settings.shopUrl1 || "https://myownsongs.com";
          const baseDomain = rawDomain.startsWith("http") ? rawDomain.replace(/\/$/, "") : `https://${rawDomain.replace(/\/$/, "")}`;

          try {
            // Find associated Music Order to auto-link the generated music track to this video order
            const linkedMusicOrder = await Order.findOne({
              $or: [
                { shopifyOrderId: String(orderData.id) },
                { shopifyOrderNumber: shopifyOrderNumStr },
                { shopifyOrderNumber: cleanOrderNum },
                { shopifyOrderNumber: `#${cleanOrderNum}` },
                ...(orderData.email ? [{ email: orderData.email }] : []),
              ],
            }).sort({ createdAt: -1 });

            let autoAudioFile = null;
            if (linkedMusicOrder) {
              let chosenTrack = linkedMusicOrder.musicTracks?.[0];
              if (linkedMusicOrder.selectedDemo) {
                const fav = (linkedMusicOrder.musicTracks || []).find((t) => t.id === linkedMusicOrder.selectedDemo);
                if (fav) chosenTrack = fav;
              }
              if (chosenTrack && (chosenTrack.audioUrl || chosenTrack.streamAudioUrl)) {
                autoAudioFile = {
                  key: chosenTrack.audioUrl || chosenTrack.streamAudioUrl,
                  url: chosenTrack.audioUrl || chosenTrack.streamAudioUrl,
                  name: chosenTrack.title || (linkedMusicOrder.recipientName ? `${linkedMusicOrder.recipientName}'s Song` : "Custom Song"),
                  size: 0,
                };
              }
            }

            // Generate a secure single-use URL-safe Base64 token
            const freshUploadToken = crypto.randomBytes(24).toString("base64url");
            const uploadUrl = `${baseDomain}/pages/create-video?token=${freshUploadToken}`;

            // Ensure VideoOrder exists in database in unfulfilled / in_production state with auto-selected audio
            const updateDoc = {
              email: orderData.email,
              customerName: orderData.customer ? `${orderData.customer.first_name || ""} ${orderData.customer.last_name || ""}`.trim() : "",
              shopifyOrderId: String(orderData.id),
              shopifyOrderNumber: shopifyOrderNumStr,
              status: "in_production", // Always unfulfilled in dashboard
              deliveryEmailSent: false,
              uploadToken: freshUploadToken,
              uploadTokenStatus: "active",
            };

            if (autoAudioFile) {
              updateDoc.audioFile = autoAudioFile;
            }
            if (linkedMusicOrder?._id) {
              updateDoc.originalMusicOrderId = linkedMusicOrder._id;
            }

            await VideoOrder.findOneAndUpdate(
              {
                $or: [
                  { shopifyOrderId: String(orderData.id) },
                  { shopifyOrderNumber: shopifyOrderNumStr },
                ],
              },
              {
                $setOnInsert: {
                  videoId: `vid_upsell_${orderData.id}`,
                  selectedPackage: "Music Video Upsell",
                },
                $set: updateDoc,
              },
              { upsert: true, returnDocument: 'after' }
            );

            // Dispatch Klaviyo Video Upload Link Flow (with clean token, NO email in URL)
            await sendKlaviyoVideoUploadLink(settings.klaviyoApiKey, orderData.email, cleanOrderNum, uploadUrl);
            console.log(`[Shopify Webhook] Video_Upload_Required event sent to Klaviyo for order #${cleanOrderNum} with single-use token.`);
          } catch (vErr) {
            console.error("[Shopify Webhook] Video upsell automation error:", vErr);
          }
        }

        // ── AUTOMATION: Pro-Song Bundle (3 Free Coupons) ──
        const isProBundleOrder = (orderData.line_items || []).some((item) => {
          const title = String(item.title || "").toLowerCase();
          const props = item.properties || [];
          return (
            title.includes("pro-song bundle") ||
            title.includes("pro song bundle") ||
            title.includes("3 free coupon") ||
            title.includes("3 gratis") ||
            (title.includes("pro") && title.includes("bundle")) ||
            props.some((p) => {
              const str = (String(p.name || "") + " " + String(p.value || "")).toLowerCase();
              return str.includes("pro-song bundle") || str.includes("coupon");
            })
          );
        });

        if (isProBundleOrder && orderData.email && settings.klaviyoApiKey) {
          const cleanOrderNum = String(orderData.order_number || orderData.name || orderData.id).replace(/^#/, "");
          // Generate 3 unique secure coupon codes
          const coupon1 = `PRO-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
          const coupon2 = `PRO-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
          const coupon3 = `PRO-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
          const coupons = [coupon1, coupon2, coupon3];

          try {
            await sendKlaviyoBundleCoupons(settings.klaviyoApiKey, orderData.email, coupons, cleanOrderNum);
            console.log(`[Shopify Webhook] Pro_Bundle_Coupons_Issued sent to Klaviyo for order #${cleanOrderNum}: ${coupons.join(", ")}`);

            await Notification.create({
              title: "3 Pro-Song Bundle Coupons Sent",
              message: `Generated and sent 3 free coupons (${coupons.join(", ")}) to ${orderData.email} for Order #${cleanOrderNum}!`,
              type: "shopify_order",
              link: `/orders/music/${orderData.id}`,
            });
          } catch (cErr) {
            console.error("[Shopify Webhook] Pro-bundle coupon automation error:", cErr);
          }
        }
      }

    }
    
    // Create notification
    await Notification.create({
      title: hasVideoOrder ? "New Music Video Order" : "Shopify Order Update",
      message: `Order #${orderData.order_number} (${orderData.financial_status}) by ${orderData.email || 'a customer'} for $${orderData.total_price}`,
      type: hasVideoOrder ? "video_order" : "shopify_order",
      link: hasVideoOrder ? `/orders/video/${orderData.id}` : `/orders/music/${orderData.id}`
    });

    // Invalidate dashboard and shopify caches so fresh data is visible immediately
    try {
      await clearShopifyOrdersCache();
      await redis.del("cache:dashboard:metrics");
    } catch (e) {
      console.warn("[Shopify Webhook] Cache invalidation notice:", e.message);
    }

    return NextResponse.json({ success: true }, { status: 200 });

  } catch (error) {
    console.error("[Shopify Webhook] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
