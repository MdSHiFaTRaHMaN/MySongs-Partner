import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Customer from "@/models/Customer";
import { withCORS, handleOptions } from "@/lib/cors";
import { isValidPublicIp, cleanIp, getClientIp } from "@/lib/security";

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    const { email, clientIp } = await request.json();

    if (!email) {
      return withCORS(NextResponse.json({ error: "Email is required" }, { status: 400 }), origin);
    }

    const effectiveIp = (clientIp && isValidPublicIp(clientIp) ? cleanIp(clientIp) : null) || getClientIp(request);
    const isPublic = isValidPublicIp(effectiveIp);

    await dbConnect();

    if (isPublic) {
      await Customer.findOneAndUpdate(
        { email },
        {
          $addToSet: { knownIps: effectiveIp },
        },
        { upsert: true }
      );
    }

    // Check if Customer (Email OR IP) is blocked
    const orConditions = [];
    if (email) {
      orConditions.push({ email: email, isBlocked: true });
      orConditions.push({ email: email, blockedUntil: { $gt: new Date() } });
    }
    if (isPublic) {
      orConditions.push({ knownIps: effectiveIp, isBlocked: true });
      orConditions.push({ knownIps: effectiveIp, blockedUntil: { $gt: new Date() } });
    }

    if (orConditions.length > 0) {
      const blockedCustomer = await Customer.findOne({ $or: orConditions });
      if (blockedCustomer) {
        const reason = blockedCustomer.blockReason || "Your account has been restricted from generating music.";
        return withCORS(NextResponse.json({ isBlocked: true, error: reason }, { status: 403 }), origin);
      }
    }

    return withCORS(NextResponse.json({ success: true, ip: effectiveIp }), origin);
  } catch (err) {
    console.error("[associate-ip] Error:", err);
    return withCORS(NextResponse.json({ error: "Internal server error" }, { status: 500 }), origin);
  }
}
