import { NextResponse } from "next/server";
import { getSettings } from "@/lib/getSettings";
import { sendKlaviyoVideoUploadLink } from "@/lib/klaviyo";
import { jwtVerify } from "jose";

export async function POST(request) {
  try {
    const token =
      request.cookies.get("admin_token")?.value ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
      await jwtVerify(token, secret);
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const body = await request.json();
    const { orderNumber, email, uploadUrl, isReminder } = body;

    if (!email || !uploadUrl) {
      return NextResponse.json({ error: "Missing required fields (email, uploadUrl)" }, { status: 400 });
    }

    const settings = await getSettings();
    if (!settings.klaviyoApiKey) {
      return NextResponse.json({ error: "Klaviyo API Key not configured in Settings" }, { status: 400 });
    }

    const result = await sendKlaviyoVideoUploadLink(
      settings.klaviyoApiKey,
      email,
      orderNumber,
      uploadUrl,
      { isReminder: Boolean(isReminder) }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to send Klaviyo event" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Upload link email sent to ${email} successfully!`,
    });
  } catch (err) {
    console.error("[send-upload-link API Error]:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
