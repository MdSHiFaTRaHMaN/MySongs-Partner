import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Role from "@/models/Role";

const MONGODB_URI = process.env.MONGODB_URI;

async function connectDB() {
  if (mongoose.connection.readyState >= 1) return;
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not defined");
  await mongoose.connect(MONGODB_URI);
}

export async function GET() {
  try {
    await connectDB();
    const roles = await Role.find().sort({ createdAt: -1 });
    return NextResponse.json({ success: true, roles });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await connectDB();
    const body = await req.json();
    const { name, description, permissions } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: "Role name is required" }, { status: 400 });
    }

    const existing = await Role.findOne({ name });
    if (existing) {
      existing.description = description || existing.description;
      existing.permissions = permissions || existing.permissions;
      await existing.save();
      return NextResponse.json({ success: true, role: existing });
    }

    const newRole = await Role.create({
      name,
      description: description || "",
      permissions: permissions || [],
    });

    return NextResponse.json({ success: true, role: newRole });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
