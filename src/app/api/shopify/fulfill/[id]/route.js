import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "@/lib/getSettings";
import { fulfillShopifyOrder } from "@/lib/shopifyFulfill";

// Helper to get payload
async function getAdminPayload(request) {
  const token =
    request.cookies.get("admin_token")?.value ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (!token) return null;
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export async function POST(request, { params }) {
  try {
    // 1. Auth check
    const payload = await getAdminPayload(request);
    const cleanRole = String(payload?.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (!payload || (cleanRole !== "admin" && cleanRole !== "staff" && cleanRole !== "superadmin")) {
      return NextResponse.json({ error: "Forbidden: Not authorized to fulfill orders" }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
    }

    // 2. Load Shopify Settings
    const settings = await getSettings();
    if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) {
      return NextResponse.json({ error: "Shopify integration is not configured." }, { status: 500 });
    }

    // 3. Fulfill the order
    const fulfillResult = await fulfillShopifyOrder(id, settings);

    if (fulfillResult.success || fulfillResult.alreadyFulfilled || fulfillResult.message?.includes("Already fulfilled")) {
      // Connect to DB and update VideoOrder & Order status to fulfilled
      await dbConnect();
      const cleanId = String(id).replace(/^#/, "").trim();

      await VideoOrder.updateMany(
        {
          $or: [
            { shopifyOrderId: cleanId },
            { shopifyOrderId: `#${cleanId}` },
            { shopifyOrderNumber: cleanId },
            { shopifyOrderNumber: `#${cleanId}` },
            { videoId: cleanId },
            { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
          ].filter(Boolean),
        },
        { $set: { status: "fulfilled", deliveryEmailSent: true, deliveredAt: new Date() } }
      );

      await Order.updateMany(
        {
          $or: [
            { shopifyOrderId: cleanId },
            { shopifyOrderId: `#${cleanId}` },
            { shopifyOrderNumber: cleanId },
            { shopifyOrderNumber: `#${cleanId}` },
            { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
          ].filter(Boolean),
        },
        { $set: { status: "fulfilled", deliveryEmailSent: true } }
      );

      return NextResponse.json({
        success: true,
        message: fulfillResult.message || "Order fulfilled successfully in Shopify",
        fulfillment: fulfillResult.fulfillment,
        alreadyFulfilled: Boolean(fulfillResult.alreadyFulfilled),
      });
    }

    return NextResponse.json({ error: fulfillResult.message }, { status: 400 });
  } catch (error) {
    console.error("[Manual Fulfill API] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
