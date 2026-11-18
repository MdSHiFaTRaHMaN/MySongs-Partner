import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import dbConnect from "@/lib/mongoose";
import Notification from "@/models/Notification";
import User from "@/models/User";

function maskCustomerData(text) {
  if (!text || typeof text !== "string") return text;
  // Mask emails: e.g. "user@example.com" -> "****"
  let masked = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "****");
  // Mask "received from <Customer Name>"
  masked = masked.replace(/(received from\s+)([^,(]+)/gi, (match, prefix, name) => {
    if (name.trim() === "****") return match;
    return `${prefix}****`;
  });
  return masked;
}

export async function GET(request) {
  try {
    await dbConnect();

    // Check staff permissions for customer info access
    let canViewCustomerInfo = true;
    const token = request.cookies.get("admin_token")?.value;
    if (token) {
      try {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
        const { payload } = await jwtVerify(token, secret);
        if (payload?.id) {
          const user = await User.findById(payload.id).select("role permissions");
          if (user) {
            const isAdmin = user.role === "admin" || user.role === "super_admin";
            const hasCustomerInfoPerm = Array.isArray(user.permissions) && user.permissions.includes("customer_info");
            canViewCustomerInfo = isAdmin || hasCustomerInfoPerm;
          }
        }
      } catch (err) {
        console.error("JWT verify error in notifications route:", err);
      }
    }

    // Fetch the latest 30 notifications, newest first
    const rawNotifications = await Notification.find({})
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    
    const notifications = rawNotifications.map((n) => {
      if (canViewCustomerInfo) return n;
      return {
        ...n,
        title: maskCustomerData(n.title),
        message: maskCustomerData(n.message),
      };
    });

    // Count unread
    const unreadCount = notifications.filter(n => !n.isRead).length;

    return NextResponse.json({ notifications, unreadCount }, { status: 200 });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ message: "Error fetching notifications", error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    await dbConnect();
    const data = await request.json();

    if (data.action === "mark_all_read") {
      await Notification.updateMany({ isRead: false }, { $set: { isRead: true } });
      return NextResponse.json({ message: "All notifications marked as read" }, { status: 200 });
    }

    if (data.notificationId) {
      await Notification.findByIdAndUpdate(data.notificationId, { $set: { isRead: true } }, { returnDocument: 'after' });
      return NextResponse.json({ message: "Notification marked as read" }, { status: 200 });
    }

    return NextResponse.json({ message: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error updating notification:", error);
    return NextResponse.json({ message: "Error updating notification", error: error.message }, { status: 500 });
  }
}
