import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

export const dynamic = "force-dynamic";

async function verifyAdminAuth() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return false;
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const { payload } = await jwtVerify(token, secret);
    return payload?.role === "admin" || payload?.role === "super_admin";
  } catch (e) {
    return false;
  }
}

export async function POST(request) {
  const isAuth = await verifyAdminAuth();
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, type } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Missing order ID" }, { status: 400 });
    }

    await dbConnect();

    if (type === "video") {
      const videoOrder = await VideoOrder.findById(id);
      if (!videoOrder) {
        return NextResponse.json({ error: "Video order not found" }, { status: 404 });
      }
      videoOrder.isDeleted = false;
      videoOrder.deletedAt = null;
      videoOrder.deletedBy = "";
      await videoOrder.save();

      return NextResponse.json({ success: true, message: "Video order restored successfully" });
    } else {
      const order = await Order.findById(id);
      if (!order) {
        return NextResponse.json({ error: "Music order not found" }, { status: 404 });
      }
      order.isDeleted = false;
      order.deletedAt = null;
      order.deletedBy = "";
      await order.save();

      return NextResponse.json({ success: true, message: "Music order restored successfully" });
    }
  } catch (error) {
    console.error("[POST /api/trash/restore Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to restore order" }, { status: 500 });
  }
}
