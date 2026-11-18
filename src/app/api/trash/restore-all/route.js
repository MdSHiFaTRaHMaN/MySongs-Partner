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
    if (!token) return null;

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export async function POST(request) {
  const user = await verifyAdminAuth();
  const cleanRole = String(user?.role || "").toLowerCase().replace(/[\s_-]/g, "");
  if (!user || (cleanRole !== "admin" && cleanRole !== "superadmin")) {
    return NextResponse.json({ error: "Unauthorized. Admin privileges required." }, { status: 401 });
  }

  try {
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const targetType = body.type || "all"; // "all" | "music" | "video"

    let restoredMusicCount = 0;
    let restoredVideoCount = 0;

    if (targetType === "all" || targetType === "music") {
      const musicRes = await Order.updateMany(
        { isDeleted: true },
        {
          $set: {
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
          },
        }
      );
      restoredMusicCount = musicRes.modifiedCount || 0;
    }

    if (targetType === "all" || targetType === "video") {
      const videoRes = await VideoOrder.updateMany(
        { isDeleted: true },
        {
          $set: {
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
          },
        }
      );
      restoredVideoCount = videoRes.modifiedCount || 0;
    }

    return NextResponse.json({
      success: true,
      restoredMusicCount,
      restoredVideoCount,
      totalRestored: restoredMusicCount + restoredVideoCount,
      message: `Successfully restored ${restoredMusicCount} music orders and ${restoredVideoCount} video orders from Trash Bin.`,
    });
  } catch (error) {
    console.error("[POST /api/trash/restore-all Error]:", error);
    return NextResponse.json(
      { error: error.message || "Failed to restore all orders" },
      { status: 500 }
    );
  }
}
