import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import VideoOrder from "@/models/VideoOrder";
import { getSettings } from "@/lib/getSettings";
import { sendKlaviyoVideoDelivery } from "@/lib/klaviyo";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    await dbConnect();
    const cleanId = String(id).replace(/^#/, "").trim();
    const settings = await getSettings();

    if (!settings.klaviyoApiKey) {
      return NextResponse.json(
        { success: false, error: "Klaviyo API key is not configured in Settings." },
        { status: 400 }
      );
    }

    const order = await VideoOrder.findOne({
      $or: [
        { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null },
        { videoId: cleanId },
        { videoId: id },
        { shopifyOrderId: cleanId },
        { shopifyOrderId: id },
        { shopifyOrderId: `#${cleanId}` },
        { shopifyOrderNumber: cleanId },
        { shopifyOrderNumber: id },
        { shopifyOrderNumber: `#${cleanId}` },
      ].filter(Boolean),
    });

    if (!order) {
      return NextResponse.json({ success: false, error: "Video order not found" }, { status: 404 });
    }

    if (!order.finalVideoKey && !order.finalVideoUrl) {
      return NextResponse.json(
        { success: false, error: "Please upload the completed final video before delivering to the customer." },
        { status: 400 }
      );
    }

    const klaviyoResult = await sendKlaviyoVideoDelivery(
      settings.klaviyoApiKey,
      order.email,
      order,
      order.shopifyOrderNumber || order.shopifyOrderId
    );

    if (!klaviyoResult.success) {
      return NextResponse.json(
        { success: false, error: `Klaviyo error: ${klaviyoResult.error || "Failed to send delivery event"}` },
        { status: 500 }
      );
    }

    order.status = "delivering";
    order.deliveryEmailSent = true;
    order.deliveredVersion = order.currentVersion || 1;
    await order.save();

    return NextResponse.json({
      success: true,
      message: "Delivery email event sent to Klaviyo! Shopify order will be fulfilled upon email webhook trigger.",
      order,
    });
  } catch (error) {
    console.error("[POST /api/video-orders/[id]/deliver Error]:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
