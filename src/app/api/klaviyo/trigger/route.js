import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { getSettings } from "@/lib/getSettings";
import { sendKlaviyoMusicDelivery } from "@/lib/klaviyo";
import { generatePresignedUrl } from "@/lib/s3";
import { jwtVerify } from "jose";

export async function POST(request) {
  try {
    // Auth check using jose
    const token =
      request.cookies.get("admin_token")?.value ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";

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

    const body = await request.json();
    const { shopifyOrderId, email, orderNumber, lineItems } = body;

    if (!shopifyOrderId || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const settings = await getSettings();
    if (!settings.klaviyoApiKey) {
      return NextResponse.json({ error: "Klaviyo API Key not configured in Settings." }, { status: 500 });
    }

    await dbConnect();

    let items = Array.isArray(lineItems) ? lineItems : [];

    // If lineItems not supplied in payload, fetch from Shopify Admin API
    if (items.length === 0 && settings.shopUrl1 && settings.shopifyAdminApiKey) {
      try {
        let url = settings.shopUrl1;
        if (!url.startsWith("http")) url = `https://${url}`;
        const shRes = await fetch(`${url}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
          headers: {
            "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        if (shRes.ok) {
          const shData = await shRes.json();
          items = shData.order?.line_items || [];
        }
      } catch (e) {
        console.error("[Klaviyo Trigger Shopify Fetch Error]:", e);
      }
    }

    // Extract all musicIds and audio properties from line items
    const musicIds = [];
    const directAudioItems = [];

    for (const item of items) {
      const props = item.properties || [];
      const getProp = (name) => {
        const target = name.toLowerCase().replace(/[\s_-]/g, "");
        return props.find((p) => p.name?.toLowerCase().replace(/[\s_-]/g, "") === target);
      };

      const musicIdProp = getProp("musicid");
      const audioUrlProp = getProp("audiourl");
      const lyricsProp = getProp("lyrics");
      const songTitleProp = getProp("songtitle");
      const occasionProp = getProp("occasion");

      if (musicIdProp?.value) {
        musicIds.push(musicIdProp.value);
      }

      if (audioUrlProp?.value) {
        directAudioItems.push({
          musicId: musicIdProp?.value || `auto_${shopifyOrderId}_${item.id}`,
          audioUrl: audioUrlProp.value,
          lyrics: lyricsProp?.value || "",
          title: songTitleProp?.value || item.title || "Custom Song",
          occasion: occasionProp?.value || "custom-song",
        });
      }
    }

    // 1. Find in MongoDB by musicId
    let localOrders = [];
    if (musicIds.length > 0) {
      localOrders = await Order.find({ musicId: { $in: musicIds } });
    }

    // 2. Fallback: Find by shopifyOrderId
    if (localOrders.length === 0) {
      localOrders = await Order.find({ shopifyOrderId: String(shopifyOrderId) });
    }

    // 3. Fallback: Find by email
    if (localOrders.length === 0 && email) {
      const emailMatches = await Order.find({ email }).sort({ createdAt: -1 });
      if (emailMatches.length > 0) {
        localOrders = emailMatches;
      }
    }

    // 4. Fallback: If no order record exists in MongoDB, create from line item direct audio properties
    if (localOrders.length === 0 && directAudioItems.length > 0) {
      for (const dItem of directAudioItems) {
        const createdOrder = await Order.create({
          musicId: dItem.musicId,
          email: email,
          shopifyOrderId: String(shopifyOrderId),
          status: "paid",
          occasion: dItem.occasion,
          lyrics: dItem.lyrics,
          musicTracks: [
            {
              id: "track_1",
              title: dItem.title,
              audioUrl: dItem.audioUrl,
              streamAudioUrl: dItem.audioUrl,
            },
          ],
          selectedDemo: "track_1",
        });
        localOrders.push(createdOrder);
      }
    }

    if (!localOrders || localOrders.length === 0) {
      return NextResponse.json(
        { error: "No matching music order or audio track found in database." },
        { status: 404 }
      );
    }

    // Ensure shopifyOrderId is linked in MongoDB
    await Order.updateMany(
      { _id: { $in: localOrders.map((o) => o._id) } },
      { $set: { shopifyOrderId: String(shopifyOrderId) } }
    );

    // Make sure presigned audio URLs are available for any relative S3 paths
    for (const ord of localOrders) {
      if (ord.musicTracks && Array.isArray(ord.musicTracks)) {
        for (const trk of ord.musicTracks) {
          if (trk.audioUrl && !trk.audioUrl.startsWith("http")) {
            trk.audioUrl = await generatePresignedUrl(trk.audioUrl, 604800);
          }
          if (trk.streamAudioUrl && !trk.streamAudioUrl.startsWith("http")) {
            trk.streamAudioUrl = await generatePresignedUrl(trk.streamAudioUrl, 604800);
          }
        }
      }
    }

    // Send Klaviyo event
    const klaviyoResult = await sendKlaviyoMusicDelivery(
      settings.klaviyoApiKey,
      email,
      localOrders,
      orderNumber
    );

    if (klaviyoResult?.success) {
      // Mark as sent and status to delivering
      await Promise.all(
        localOrders.map((o) =>
          Order.updateOne(
            { _id: o._id },
            { $set: { deliveryEmailSent: true, deliveredVersion: o.currentVersion || 1, status: "delivering" } }
          )
        )
      );

      return NextResponse.json({
        success: true,
        message: "Successfully sent Klaviyo event! Order status set to 'delivering'. Awaiting Klaviyo Webhook for fulfillment.",
      });
    } else {
      return NextResponse.json(
        { error: `Klaviyo Error: ${klaviyoResult?.error || "Unknown Klaviyo error"}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[Klaviyo Trigger API Error]:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
