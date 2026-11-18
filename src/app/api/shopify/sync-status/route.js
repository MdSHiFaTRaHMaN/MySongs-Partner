import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "@/lib/getSettings";
import { jwtVerify } from "jose";
import { sendKlaviyoMusicDelivery } from "@/lib/klaviyo";
import { fulfillShopifyOrder } from "@/lib/shopifyFulfill";

import { fetchAllShopifyOrders } from "@/lib/shopifyOrders";

export async function POST(request) {
  try {
    // Auth check using jose (same pattern as other routes)
    const token = request.cookies.get("admin_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    let payload;
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
      const { payload: decoded } = await jwtVerify(token, secret);
      payload = decoded;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const cleanRole = String(payload.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (cleanRole !== "admin" && cleanRole !== "staff" && cleanRole !== "superadmin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await getSettings();
    if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) {
      return NextResponse.json({ error: "Shopify API not configured" }, { status: 500 });
    }

    await dbConnect();

    const shopifyOrders = await fetchAllShopifyOrders(settings);

    let updatedCount = 0;
    const updates = [];

    for (const shopifyOrder of shopifyOrders) {
      const financialStatus = shopifyOrder.financial_status || "pending";
      let musicIdFound = false;

      const shopifyOrderNumStr = String(shopifyOrder.name || (shopifyOrder.order_number ? `#${shopifyOrder.order_number}` : `#${shopifyOrder.id}`));

      for (const item of shopifyOrder.line_items || []) {
        const getProp = (targetName) => {
          const target = targetName.toLowerCase().replace(/[\s_-]/g, "");
          return (item.properties || []).find((p) => p.name?.toLowerCase().replace(/[\s_-]/g, "") === target);
        };

        const orderTypeProp = getProp("ordertype");
        const isVideoLineItem = orderTypeProp?.value?.toLowerCase() === "video" || !!getProp("videoid");

        // Sync Video Orders
        const videoIdProp = getProp("videoid");
        if (isVideoLineItem && videoIdProp?.value) {
          const vResult = await VideoOrder.findOneAndUpdate(
            { videoId: videoIdProp.value },
            {
              $set: {
                status: financialStatus === "paid" ? "in_production" : financialStatus,
                shopifyOrderId: String(shopifyOrder.id),
                shopifyOrderNumber: shopifyOrderNumStr,
              }
            },
            { returnDocument: 'after' }
          );
          if (vResult) {
            updatedCount++;
            updates.push({ videoId: videoIdProp.value, status: financialStatus });
          }
        }

        const musicIdProp = getProp("musicid");
        const audioUrlProp = getProp("audiourl");
        const lyricsProp = getProp("lyrics");
        const songTitleProp = getProp("songtitle");
        const occasionProp = getProp("occasion");

        if (musicIdProp && musicIdProp.value) {
          const existingOrder = await Order.findOne({ musicId: musicIdProp.value });
          const targetStatus = (existingOrder?.status === "delivering" || existingOrder?.status === "fulfilled")
            ? existingOrder.status
            : (shopifyOrder.fulfillment_status === "fulfilled" ? "fulfilled" : financialStatus);

          const result = await Order.findOneAndUpdate(
            { musicId: musicIdProp.value },
            { $set: { status: targetStatus, shopifyOrderId: String(shopifyOrder.id), shopifyOrderNumber: shopifyOrderNumStr } },
            { returnDocument: 'after' }
          );
          if (result) {
            musicIdFound = true;
            updatedCount++;
            updates.push({ musicId: musicIdProp.value, status: targetStatus });
          }
        }

        // If not found in DB by musicId, but has audioUrl, auto-upsert
        if (!musicIdFound && audioUrlProp?.value) {
          const newMusicId = musicIdProp?.value || `auto_${shopifyOrder.id}_${item.id}`;
          const directAudio = audioUrlProp.value;
          const existing = await Order.findOne({ $or: [{ musicId: newMusicId }, { shopifyOrderId: String(shopifyOrder.id) }] });
          if (!existing) {
            await Order.create({
              musicId: newMusicId,
              email: shopifyOrder.email || shopifyOrder.contact_email || "no-email@shopify.com",
              shopifyOrderId: String(shopifyOrder.id),
              shopifyOrderNumber: shopifyOrderNumStr,
              status: financialStatus,
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
            musicIdFound = true;
            updatedCount++;
          }
        }
      }

      if (!musicIdFound && shopifyOrder.email) {
        const itemsToFulfill = shopifyOrder.line_items ? shopifyOrder.line_items.length : 1;
        const fallbackOrders = await Order.find({
          email: shopifyOrder.email,
          status: { $in: ["in_cart", "created", "pending_payment", "pending"] },
        }).sort({ createdAt: -1 }).limit(itemsToFulfill);

        for (const fOrder of fallbackOrders) {
          await Order.updateOne(
            { _id: fOrder._id },
            { $set: { status: financialStatus, shopifyOrderId: String(shopifyOrder.id), shopifyOrderNumber: shopifyOrderNumStr } }
          );
          console.log(`[Shopify Sync Status] Fallback: updated ${fOrder._id} for ${shopifyOrder.email} → ${financialStatus}`);
          updatedCount++;
        }
        if (fallbackOrders.length > 0) {
          updates.push({ email: shopifyOrder.email, status: financialStatus, count: fallbackOrders.length });
        }
      }

      // ── Bundled Klaviyo Automation & Auto Fulfill ──
      if (financialStatus === "paid") {
        const localOrders = await Order.find({ shopifyOrderId: shopifyOrder.id });
        if (localOrders.length > 0) {
          const allReady = localOrders.every(o => o.musicTracks && o.musicTracks.length > 0 && o.musicTracks[0].audioUrl);
          const anyUnsent = localOrders.some(o => !o.deliveryEmailSent);

          if (allReady && anyUnsent) {
            const klaviyoResult = await sendKlaviyoMusicDelivery(
              settings.klaviyoApiKey,
              shopifyOrder.email || localOrders[0].email,
              localOrders
            );

            if (klaviyoResult?.success) {
              await Promise.all(localOrders.map(o => 
                Order.updateOne({ _id: o._id }, { $set: { deliveryEmailSent: true, status: "delivering" } })
              ));
              console.log(`[Shopify Sync] Music_Delivered event sent to Klaviyo for order ${shopifyOrder.id}. Status set to 'delivering'.`);
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${updatedCount} music orders from ${shopifyOrders.length} Shopify orders`,
      updates,
    });
  } catch (error) {
    console.error("[Sync Shopify Status] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
