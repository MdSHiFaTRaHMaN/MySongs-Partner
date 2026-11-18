import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Customer from "@/models/Customer";
import VideoOrder from "@/models/VideoOrder";
import User from "@/models/User";
import { getSettings } from "@/lib/getSettings";

function maskCustomerData(text) {
  if (!text || typeof text !== "string") return text;
  let masked = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "****");
  masked = masked.replace(/(For:\s+)(.+)/gi, "$1****");
  return masked;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");

    if (!q || q.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    await dbConnect();

    // Check staff permissions from JWT admin_token
    let isAdmin = true;
    let permissions = [];
    const token = request.cookies.get("admin_token")?.value;
    if (token) {
      try {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
        const { payload } = await jwtVerify(token, secret);
        if (payload?.id) {
          const user = await User.findById(payload.id).select("role permissions");
          if (user) {
            isAdmin = user.role === "admin" || user.role === "super_admin";
            permissions = Array.isArray(user.permissions) ? user.permissions : [];
          }
        }
      } catch (err) {
        console.error("JWT verify error in search route:", err);
      }
    }

    const canAccessShopifyOrders = isAdmin || permissions.includes("/orders") || permissions.includes("/orders/music") || permissions.includes("/orders/video") || permissions.includes("/orders/publish");
    const canAccessMusicOrders = isAdmin || permissions.includes("/all-musics") || permissions.includes("/ordered-musics");
    const canAccessCustomers = isAdmin || permissions.includes("/customers");
    const canViewCustomerInfo = isAdmin || permissions.includes("customer_info");

    const queryStr = q.trim();
    const regex = new RegExp(queryStr, "i");

    // 1. Fetch Matching Customers / 360 Profiles (Only if permitted)
    const customersPromise = canAccessCustomers
      ? Promise.all([
          Customer.find({ email: regex }).limit(5).select("_id email isBlocked securityFlags createdAt").lean(),
          Order.distinct("email", { email: regex }).then((emails) => (Array.isArray(emails) ? emails.slice(0, 5) : [])),
        ])
          .then(async ([dbCustomers, orderEmails]) => {
            const emailMap = new Map();

            (dbCustomers || []).forEach((c) => {
              if (c?.email && c?._id) {
                const lower = c.email.toLowerCase().trim();
                if (!emailMap.has(lower)) {
                  const custId = c._id.toString();
                  emailMap.set(lower, {
                    _id: custId,
                    type: "customer",
                    title: canViewCustomerInfo ? c.email : maskCustomerData(c.email),
                    subtitle: "Customer 360° Profile",
                    status: c.isBlocked ? "Blocked" : "Active",
                    url: `/customers/${custId}`,
                    customerEmail: c.email,
                    customer360Url: `/customers/${custId}`,
                  });
                }
              }
            });

            // For any orderEmails not yet in emailMap, resolve their Customer doc to get customer._id
            for (const email of (orderEmails || [])) {
              if (email) {
                const lower = String(email).toLowerCase().trim();
                if (!emailMap.has(lower)) {
                  let custDoc = await Customer.findOne({ email: lower }).lean();
                  if (!custDoc) {
                    try {
                      custDoc = await Customer.findOneAndUpdate(
                        { email: lower },
                        { $setOnInsert: { email: lower } },
                        { upsert: true, returnDocument: "after", lean: true }
                      );
                    } catch (e) {}
                  }

                  if (custDoc && custDoc._id) {
                    const custId = custDoc._id.toString();
                    emailMap.set(lower, {
                      _id: custId,
                      type: "customer",
                      title: canViewCustomerInfo ? custDoc.email : maskCustomerData(custDoc.email),
                      subtitle: "Customer 360° Profile",
                      status: custDoc.isBlocked ? "Blocked" : "Active",
                      url: `/customers/${custId}`,
                      customerEmail: custDoc.email,
                      customer360Url: `/customers/${custId}`,
                    });
                  }
                }
              }
            }

            return Array.from(emailMap.values()).slice(0, 5);
          })
          .catch((err) => {
            console.error("Customer search error:", err);
            return [];
          })
      : Promise.resolve([]);

    // 2. Fetch Local Orders (Only if permitted)
    const localOrdersPromise = canAccessMusicOrders
      ? Order.find({
          $or: [
            { email: regex },
            { recipientName: regex },
            { musicId: regex },
            { taskId: regex },
            { genre: regex },
            { selectedPackage: regex },
            { occasion: regex },
            { shopifyOrderId: regex },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(8)
          .select("email recipientName status occasion forWho createdAt shopifyOrderId")
          .lean()
          .then((orders) =>
            orders.map((order) => {
              const rawTitle = order.email || "No Email";
              const rawSubtitle =
                order.occasion ||
                (order.forWho === "specific" ? `For: ${order.recipientName}` : "General");
              const custEmail = order.email || "";

              return {
                _id: order._id.toString(),
                type: "local",
                title: canViewCustomerInfo ? rawTitle : maskCustomerData(rawTitle),
                subtitle: canViewCustomerInfo ? rawSubtitle : maskCustomerData(rawSubtitle),
                status: order.status,
                url: `/all-musics/${order._id}`,
                customerEmail: custEmail,
                customer360Url: custEmail ? `/customers/${encodeURIComponent(custEmail)}` : null,
              };
            })
          )
      : Promise.resolve([]);

    // 3. Fetch Shopify Orders (Only if permitted)
    const shopifyOrdersPromise = canAccessShopifyOrders
      ? getSettings().then(async (settings) => {
          if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) return [];

          let url = settings.shopUrl1;
          if (!url.startsWith("http")) url = `https://${url}`;

          let shopifyUrl = `${url}/admin/api/2024-04/orders.json?status=any`;
          const isEmail = queryStr.includes("@");
          const isNumber = !isNaN(queryStr.replace("#", ""));

          if (isEmail) {
            shopifyUrl += `&email=${encodeURIComponent(queryStr)}`;
          } else if (isNumber) {
            shopifyUrl += `&name=%23${queryStr.replace("#", "")}`;
          } else {
            shopifyUrl += `&limit=50`;
          }

          try {
            const res = await fetch(shopifyUrl, {
              headers: { "X-Shopify-Access-Token": settings.shopifyAdminApiKey },
              cache: "no-store",
            });
            if (!res.ok) return [];
            const data = await res.json();
            let orders = data.orders || [];

            if (!isEmail && !isNumber) {
              const lowerQ = queryStr.toLowerCase();
              orders = orders.filter((o) => {
                const nameMatch = o.name && o.name.toLowerCase().includes(lowerQ);
                const emailMatch = o.email && o.email.toLowerCase().includes(lowerQ);
                const custMatch =
                  o.customer &&
                  `${o.customer.first_name || ""} ${o.customer.last_name || ""}`
                    .toLowerCase()
                    .includes(lowerQ);
                return nameMatch || emailMatch || custMatch;
              });
            }

            return orders.slice(0, 5).map((order) => {
              const rawCust = order.customer
                ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
                : order.email || "";
              const custEmail = order.customer?.email || order.email || "";

              return {
                _id: `shopify-${order.id}`,
                type: "shopify",
                title: `Order ${order.name}`,
                subtitle: canViewCustomerInfo ? rawCust : maskCustomerData(rawCust || "****"),
                status: order.financial_status || order.fulfillment_status || "unknown",
                url: `/orders/${order.id}`,
                customerEmail: custEmail,
                customer360Url: custEmail ? `/customers/${encodeURIComponent(custEmail)}` : null,
              };
            });
          } catch (err) {
            console.error("Shopify fetch error:", err);
            return [];
          }
        })
      : Promise.resolve([]);

    const [customerResults, localResults, shopifyResults] = await Promise.all([
      customersPromise,
      localOrdersPromise,
      shopifyOrdersPromise,
    ]);

    const combined = [...customerResults, ...shopifyResults, ...localResults];
    return NextResponse.json({ results: combined });
  } catch (error) {
    console.error("Global search error:", error);
    return NextResponse.json({ error: "Internal server error", results: [] }, { status: 500 });
  }
}
