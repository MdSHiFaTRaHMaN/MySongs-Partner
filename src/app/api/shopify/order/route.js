import { NextResponse } from "next/server";
import { getSettings } from "@/lib/getSettings";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";

export async function PUT(request) {
  try {
    const { orderId, note, tags, email } = await request.json();
    
    if (!orderId) {
      return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
    }

    const settings = await getSettings();
    const shopDomain = settings.shopUrl1 || settings.shopUrl || "";
    if (!shopDomain || !settings.shopifyAdminApiKey) {
      return NextResponse.json({ error: "Shopify API is not configured" }, { status: 500 });
    }

    let url = shopDomain;
    if (!url.startsWith('http')) url = `https://${url}`;

    // Prepare the update payload for Shopify
    const orderPayload = {
      order: {
        id: orderId,
        note: note,
        tags: tags,
        email: email
      }
    };

    const response = await fetch(`${url}/admin/api/2024-04/orders/${orderId}.json`, {
      method: 'PUT',
      headers: {
        "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(orderPayload),
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.errors ? JSON.stringify(data.errors) : "Failed to update Shopify order" },
        { status: response.status }
      );
    }

    // Sync updated email or notes in MongoDB
    try {
      await dbConnect();
      const stringId = String(orderId);
      const updateData = {};
      if (email) updateData.email = email;
      if (note !== undefined) updateData.orderNotes = note;

      if (Object.keys(updateData).length > 0) {
        await Promise.all([
          Order.updateMany(
            { $or: [{ shopifyOrderId: stringId }, { shopifyOrderId: `#${stringId}` }] },
            { $set: updateData }
          ),
          VideoOrder.updateMany(
            { $or: [{ shopifyOrderId: stringId }, { shopifyOrderId: `#${stringId}` }] },
            { $set: updateData }
          )
        ]);
      }
    } catch (dbErr) {
      console.error("[EditOrder MongoDB Sync Warning]:", dbErr);
    }

    return NextResponse.json({ success: true, order: data.order }, { status: 200 });

  } catch (error) {
    console.error("Error updating Shopify order:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
