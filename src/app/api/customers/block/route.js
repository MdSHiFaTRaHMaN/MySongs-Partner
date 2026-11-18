import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Customer from "@/models/Customer";
import { jwtVerify } from "jose";

export async function PUT(request) {
  try {
    // Verify admin
    const token = request.cookies.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    let payload;
    try {
      const { payload: jwtPayload } = await jwtVerify(token, secret);
      payload = jwtPayload;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const cleanRole = String(payload.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (cleanRole !== "admin" && cleanRole !== "staff" && cleanRole !== "superadmin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { email, isBlocked, blockReason } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    await dbConnect();

    // Upsert customer
    const customer = await Customer.findOneAndUpdate(
      { email: cleanEmail },
      {
        $set: { isBlocked, blockReason: blockReason || "" },
        $setOnInsert: { email: cleanEmail }
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({ success: true, customer }, { status: 200 });
  } catch (error) {
    console.error("[BlockCustomer] Error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
