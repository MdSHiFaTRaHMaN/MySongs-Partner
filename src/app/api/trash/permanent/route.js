import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import { collectMusicOrderS3Keys, collectVideoOrderS3Keys, deleteS3KeysBatch } from "@/lib/trashCleanup";
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

export async function DELETE(request) {
  const isAuth = await verifyAdminAuth();
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const type = url.searchParams.get("type");

    if (!id) {
      return NextResponse.json({ error: "Missing order ID" }, { status: 400 });
    }

    await dbConnect();

    if (type === "video") {
      const videoOrder = await VideoOrder.findById(id);
      if (!videoOrder) {
        return NextResponse.json({ error: "Video order not found" }, { status: 404 });
      }

      // 1. Purge S3 files
      const s3Keys = collectVideoOrderS3Keys(videoOrder);
      await deleteS3KeysBatch(s3Keys);

      // 2. Permanently delete DB record
      await VideoOrder.findByIdAndDelete(id);

      return NextResponse.json({
        success: true,
        message: "Video order and all assets permanently deleted",
      });
    } else {
      const order = await Order.findById(id);
      if (!order) {
        return NextResponse.json({ error: "Music order not found" }, { status: 404 });
      }

      // 1. Purge S3 files
      const s3Keys = collectMusicOrderS3Keys(order);
      await deleteS3KeysBatch(s3Keys);

      // 2. Permanently delete DB record
      await Order.findByIdAndDelete(id);

      return NextResponse.json({
        success: true,
        message: "Music order and all audio files permanently deleted",
      });
    }
  } catch (error) {
    console.error("[DELETE /api/trash/permanent Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to delete permanently" }, { status: 500 });
  }
}
