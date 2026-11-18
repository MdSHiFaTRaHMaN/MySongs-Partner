import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "@/lib/getSettings";
import { getKlaviyoDeliveryStatus } from "@/lib/klaviyo";
import { fulfillShopifyOrder } from "@/lib/shopifyFulfill";
import { jwtVerify } from "jose";

async function verifyAdminAuth(request) {
  const token =
    request.cookies.get("admin_token")?.value ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (!token) return null;
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
  try {
    const { payload } = await jwtVerify(token, secret);
    const cleanRole = String(payload.role || "").toLowerCase().replace(/[\s_-]/g, "");
    const isValidRole =
      cleanRole === "admin" ||
      cleanRole === "staff" ||
      cleanRole === "superadmin" ||
      payload.userId ||
      payload.id;

    return isValidRole ? payload : null;
  } catch (err) {
    return null;
  }
}

export async function POST(request) {
  try {
    const auth = await verifyAdminAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { shopifyOrderId, email, orderNumber, autoFulfill = false } = body;

    if (!email) {
      return NextResponse.json({ error: "Customer email is required." }, { status: 400 });
    }

    const settings = await getSettings();
    if (!settings.klaviyoApiKey) {
      return NextResponse.json({ error: "Klaviyo API Key is not configured in Settings." }, { status: 500 });
    }

    await dbConnect();

    // 1. Check delivery status in Klaviyo
    const klaviyoStatus = await getKlaviyoDeliveryStatus(
      settings.klaviyoApiKey,
      email,
      shopifyOrderId,
      orderNumber
    );

    if (!klaviyoStatus.success) {
      return NextResponse.json({ error: klaviyoStatus.error }, { status: 400 });
    }

    let fulfillmentResult = null;

    // 2. ONLY auto-fulfill if the email was actually delivered to the customer in Klaviyo (NOT when still in flow queue/delay)
    if (autoFulfill && klaviyoStatus.emailDelivered && shopifyOrderId) {
      if (settings.shopUrl1 && settings.shopifyAdminApiKey) {
        fulfillmentResult = await fulfillShopifyOrder(shopifyOrderId, settings);
        
        if (fulfillmentResult.success || fulfillmentResult.message?.includes("Already fulfilled")) {
          const cleanId = String(shopifyOrderId).replace(/^#/, "").trim();
          // Update local MongoDB orders strictly by shopifyOrderId
          await Order.updateMany(
            {
              $or: [
                { shopifyOrderId: cleanId },
                { shopifyOrderId: `#${cleanId}` },
                { shopifyOrderNumber: cleanId },
                { shopifyOrderNumber: `#${cleanId}` },
              ],
            },
            { $set: { status: "fulfilled", deliveryEmailSent: true } }
          );

          await VideoOrder.updateMany(
            {
              $or: [
                { shopifyOrderId: cleanId },
                { shopifyOrderId: `#${cleanId}` },
                { shopifyOrderNumber: cleanId },
                { shopifyOrderNumber: `#${cleanId}` },
              ],
            },
            { $set: { status: "fulfilled", deliveryEmailSent: true, deliveredAt: new Date() } }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      klaviyoStatus,
      fulfillmentResult,
      message: klaviyoStatus.summary,
    });

  } catch (error) {
    console.error("[Klaviyo Verify Delivery API Error]:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
