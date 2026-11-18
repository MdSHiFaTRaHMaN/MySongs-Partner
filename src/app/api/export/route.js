import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Customer from "@/models/Customer";

export const dynamic = "force-dynamic";

function escapeCSV(field) {
  if (field === null || field === undefined) return '""';
  const stringified = String(field).replace(/"/g, '""');
  return `"${stringified}"`;
}

export async function GET(request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "customers"; // "customers" or "orders" or "musics"

    if (type === "orders" || type === "musics") {
      const orders = await Order.find({}).sort({ createdAt: -1 });

      const headers = [
        "Order ID",
        "Email",
        "Occasion",
        "Genre",
        "Voice",
        "Mood",
        "Package",
        "Status",
        "Lyrics",
        "Created Date & Time",
      ];

      const csvRows = [headers.join(",")];

      orders.forEach((o) => {
        const row = [
          escapeCSV(o.shopifyOrderId || o.taskId || o.musicId || "N/A"),
          escapeCSV(o.email || ""),
          escapeCSV(o.occasion || ""),
          escapeCSV(o.genre || ""),
          escapeCSV(o.voice || ""),
          escapeCSV(o.mood || ""),
          escapeCSV(o.selectedPackage || ""),
          escapeCSV(o.status || ""),
          escapeCSV(o.lyrics || ""),
          escapeCSV(o.createdAt ? new Date(o.createdAt).toLocaleString("en-US", { timeZone: "UTC" }) : ""),
        ];
        csvRows.push(row.join(","));
      });

      const csvContent = csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${type}_export_${Date.now()}.csv"`,
        },
      });
    }

    // Default: Customer CRM analytics export
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
          lyrics: { $ifNull: ["$lyrics", ""] },
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
                lyrics: { $literal: "" },
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
          allLyrics: {
            $push: {
              $cond: [
                { $and: [{ $ne: ["$lyrics", ""] }, { $ne: ["$lyrics", null] }] },
                "$lyrics",
                "$$REMOVE",
              ],
            },
          },
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
      { $sort: { lastOrderDate: -1 } },
    ]);

    const customers = await Customer.find({});
    const customerMap = customers.reduce((acc, c) => {
      acc[c.email.toLowerCase()] = c;
      return acc;
    }, {});

    const headers = [
      "Customer Email",
      "Total Generations",
      "Total Purchases",
      "Abuse Flags",
      "Status",
      "Last Active Date & Time",
      "All Lyrics",
    ];

    const csvRows = [headers.join(",")];
    const processedEmails = new Set();

    aggregatedData.forEach((group) => {
      const email = group.rawEmail || group._id;
      if (!email) return;
      const lower = email.toLowerCase();
      processedEmails.add(lower);
      const c = customerMap[lower];

      const row = [
        escapeCSV(email),
        escapeCSV(group.totalGenerations || 0),
        escapeCSV(group.totalPurchases || 0),
        escapeCSV(c ? c.securityFlags || 0 : 0),
        escapeCSV(c && c.isBlocked ? "Blocked" : "Active"),
        escapeCSV(group.lastOrderDate ? new Date(group.lastOrderDate).toLocaleString("en-US", { timeZone: "UTC" }) : ""),
        escapeCSV((group.allLyrics || []).filter(Boolean).join(" | \n")),
      ];
      csvRows.push(row.join(","));
    });

    customers.forEach((c) => {
      if (c.email && !processedEmails.has(c.email.toLowerCase())) {
        processedEmails.add(c.email.toLowerCase());
        const row = [
          escapeCSV(c.email),
          escapeCSV(0),
          escapeCSV(0),
          escapeCSV(c.securityFlags || 0),
          escapeCSV(c.isBlocked ? "Blocked" : "Active"),
          escapeCSV(c.createdAt ? new Date(c.createdAt).toLocaleString("en-US", { timeZone: "UTC" }) : ""),
          escapeCSV(""),
        ];
        csvRows.push(row.join(","));
      }
    });

    const csvContent = csvRows.join("\n");
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customers_export_${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error("[ExportAPI] Error:", error);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
