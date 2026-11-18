import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { orderId, orderNumber, status } = body;

    if (!orderId && !orderNumber) {
      return NextResponse.json({ success: false, error: "Order ID or Number is required" }, { status: 400 });
    }

    if (!["pending", "in_progress", "delivered"].includes(status)) {
      return NextResponse.json({ success: false, error: "Invalid status value" }, { status: 400 });
    }

    await dbConnect();

    const cleanId = orderId ? String(orderId).replace(/^#/, "").trim() : "";
    const cleanNum = orderNumber ? String(orderNumber).replace(/^#/, "").trim() : "";

    const searchConditions = [
      ...(cleanId ? [{ shopifyOrderId: cleanId }, { shopifyOrderId: `#${cleanId}` }] : []),
      ...(cleanNum ? [{ shopifyOrderNumber: cleanNum }, { shopifyOrderNumber: `#${cleanNum}` }] : []),
    ];

    const updateData = {
      publishStatus: status,
    };

    if (status === "in_progress") {
      updateData.uploadedToSpotifyAt = new Date();
    } else if (status === "pending") {
      updateData.uploadedToSpotifyAt = null;
    }

    const updated = await Order.findOneAndUpdate(
      { $or: searchConditions },
      {
        $set: updateData,
        $setOnInsert: {
          shopifyOrderId: cleanId || cleanNum,
          shopifyOrderNumber: cleanNum ? `#${cleanNum}` : `#${cleanId}`,
          email: body.email || "customer@example.com",
          taskId: `publish_${cleanId || Date.now()}`,
          musicId: `publish_${cleanId || Date.now()}`,
          selectedPackage: "publish",
        },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      success: true,
      publishStatus: updated.publishStatus,
      uploadedToSpotifyAt: updated.uploadedToSpotifyAt,
    });
  } catch (err) {
    console.error("[Publish Status API Error]:", err);
    return NextResponse.json({ success: false, error: err.message || "Failed to update publish status" }, { status: 500 });
  }
}
