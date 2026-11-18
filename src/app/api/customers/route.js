import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Customer from "@/models/Customer";
import { jwtVerify } from "jose";
import { isLocalOrPrivateIp } from "@/lib/security";
import { getSettings } from "@/lib/getSettings";

export const dynamic = "force-dynamic";

export async function GET(request) {
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

    await dbConnect();
    const settings = await getSettings();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const sortBy = searchParams.get("sortBy") || "";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const pageParam = parseInt(searchParams.get("page") || "1", 10);
    const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limitParam = parseInt(searchParams.get("limit") || String(settings.tableItemsPerPage || 50), 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 50 : limitParam;

    // If searching by order number, find matching emails from Order
    let matchedEmailsFromOrders = null;
    if (search) {
      const matchingOrders = await Order.find({
        $or: [
          { email: { $regex: search, $options: "i" } },
          { shopifyOrderId: { $regex: search, $options: "i" } },
          { taskId: { $regex: search, $options: "i" } },
          { musicId: { $regex: search, $options: "i" } },
        ]
      }).select("email");
      matchedEmailsFromOrders = new Set(matchingOrders.map(o => o.email.toLowerCase()));
    }

    // Group orders by email
    const aggregatedData = await Order.aggregate([
      {
        $match: {
          email: { $ne: null, $nin: ["", "unknown", "undefined"] },
        },
      },
      {
        $project: {
          email: { $toLower: "$email" },
          rawEmail: "$email",
          status: 1,
          shopifyOrderId: { $ifNull: ["$shopifyOrderId", ""] },
          musicId: { $ifNull: ["$musicId", ""] },
          createdAt: 1,
          isMusic: { $literal: true },
          isPaid: {
            $cond: [
              {
                $or: [
                  { $in: ["$status", ["paid", "fulfilled", "delivering", "ready"]] },
                  {
                    $and: [
                      { $ne: ["$shopifyOrderId", null] },
                      { $ne: ["$shopifyOrderId", ""] },
                      { $ne: ["$musicId", null] },
                      { $ne: ["$musicId", ""] },
                    ],
                  },
                ],
              },
              true,
              false,
            ],
          },
          orderKey: {
            $cond: [
              { $and: [{ $ne: ["$shopifyOrderId", null] }, { $ne: ["$shopifyOrderId", ""] }] },
              { $concat: ["shop_", { $toString: "$shopifyOrderId" }] },
              { $concat: ["music_", { $toString: "$_id" }] },
            ],
          },
        },
      },
      {
        $unionWith: {
          coll: "videoorders",
          pipeline: [
            {
              $match: {
                isDeleted: { $ne: true },
                email: { $ne: null, $nin: ["", "unknown", "undefined"] },
              },
            },
            {
              $project: {
                email: { $toLower: "$email" },
                rawEmail: "$email",
                status: 1,
                shopifyOrderId: { $ifNull: ["$shopifyOrderId", ""] },
                musicId: { $literal: "" },
                createdAt: 1,
                isMusic: { $literal: false },
                isPaid: {
                  $cond: [
                    {
                      $or: [
                        { $in: ["$status", ["paid", "fulfilled", "ready", "delivering"]] },
                        { $and: [{ $ne: ["$shopifyOrderId", null] }, { $ne: ["$shopifyOrderId", ""] }] },
                      ],
                    },
                    true,
                    false,
                  ],
                },
                orderKey: {
                  $cond: [
                    { $and: [{ $ne: ["$shopifyOrderId", null] }, { $ne: ["$shopifyOrderId", ""] }] },
                    { $concat: ["shop_", { $toString: "$shopifyOrderId" }] },
                    { $concat: ["vid_", { $toString: "$_id" }] },
                  ],
                },
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: "$email",
          rawEmail: { $first: "$rawEmail" },
          totalGenerations: {
            $sum: { $cond: ["$isMusic", 1, 0] },
          },
          paidOrderKeys: {
            $addToSet: {
              $cond: ["$isPaid", "$orderKey", null],
            },
          },
          lastOrderDate: { $max: "$createdAt" },
        },
      },
      {
        $addFields: {
          totalPurchases: {
            $size: {
              $filter: {
                input: "$paidOrderKeys",
                as: "k",
                cond: { $and: [{ $ne: ["$$k", null] }, { $ne: ["$$k", ""] }] },
              },
            },
          },
        },
      },
      {
        $sort: { lastOrderDate: -1 },
      },
    ]);

    // Fetch existing customers to merge block states
    const customers = await Customer.find({});
    const customerMap = customers.reduce((acc, c) => {
      acc[c.email.toLowerCase()] = c;
      return acc;
    }, {});

    const processedEmails = new Set();
    let results = [];

    // First include all customers who have orders
    aggregatedData.forEach(group => {
      const email = group._id;
      if (!email) return;
      const lowerEmail = email.toLowerCase();
      processedEmails.add(lowerEmail);
      const c = customerMap[lowerEmail];
      results.push({
        _id: c ? c._id.toString() : null,
        email: email,
        totalGenerations: group.totalGenerations || 0,
        totalPurchases: group.totalPurchases || 0,
        totalOrders: group.totalGenerations || 0,
        lastOrderDate: group.lastOrderDate,
        isBlocked: c ? c.isBlocked : false,
        blockReason: c ? c.blockReason : "",
        securityFlags: c ? c.securityFlags : 0,
        knownIps: c ? (c.knownIps || []).filter((ip) => !isLocalOrPrivateIp(ip)) : [],
      });
    });

    // Also include any Customer documents that don't have orders yet
    customers.forEach(c => {
      if (c.email && !processedEmails.has(c.email.toLowerCase())) {
        processedEmails.add(c.email.toLowerCase());
        results.push({
          _id: c._id ? c._id.toString() : null,
          email: c.email,
          totalGenerations: 0,
          totalPurchases: 0,
          totalOrders: 0,
          lastOrderDate: c.createdAt,
          isBlocked: c.isBlocked || false,
          blockReason: c.blockReason || "",
          securityFlags: c.securityFlags || 0,
          knownIps: (c.knownIps || []).filter((ip) => !isLocalOrPrivateIp(ip)),
        });
      }
    });

    // Apply search filtering
    if (search) {
      results = results.filter(item => {
        const matchesEmail = item.email.toLowerCase().includes(search);
        const matchesOrder = matchedEmailsFromOrders && matchedEmailsFromOrders.has(item.email.toLowerCase());
        const matchesIp = item.knownIps.some(ip => ip.includes(search));
        return matchesEmail || matchesOrder || matchesIp;
      });
    }

    // Apply sorting
    if (sortBy) {
      const isDesc = sortOrder === "desc";
      results.sort((a, b) => {
        let valA = 0;
        let valB = 0;
        if (sortBy === "generations" || sortBy === "orders") {
          valA = a.totalGenerations;
          valB = b.totalGenerations;
        } else if (sortBy === "purchases") {
          valA = a.totalPurchases;
          valB = b.totalPurchases;
        } else if (sortBy === "securityFlags" || sortBy === "abuseFlags") {
          valA = a.securityFlags;
          valB = b.securityFlags;
        } else if (sortBy === "status") {
          valA = a.isBlocked ? 1 : 0;
          valB = b.isBlocked ? 1 : 0;
        } else if (sortBy === "date") {
          valA = new Date(a.lastOrderDate || 0).getTime();
          valB = new Date(b.lastOrderDate || 0).getTime();
        }
        return isDesc ? valB - valA : valA - valB;
      });
    }

    const totalCount = results.length;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const skip = (page - 1) * limit;
    const paginatedResults = results.slice(skip, skip + limit);

    return NextResponse.json({
      success: true,
      customers: paginatedResults,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
      }
    }, { status: 200 });
  } catch (error) {
    console.error("[GetCustomers] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
