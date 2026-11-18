import dbConnect from "./mongoose.js";
import Order from "../models/Order.js";
import { getSettings } from "./getSettings.js";
import { fetchAllShopifyOrders } from "./shopifyOrders.js";
import redis from "./redis.js";

const DASHBOARD_CACHE_KEY = "cache:dashboard:metrics";
const DASHBOARD_CACHE_TTL = 60; // 60 seconds

export async function clearDashboardMetricsCache() {
  try {
    await redis.del(DASHBOARD_CACHE_KEY);
  } catch (err) {
    console.error("[clearDashboardMetricsCache error]:", err);
  }
}

export async function getDashboardMetrics() {
  // 1. Check Redis cache first for sub-millisecond response
  try {
    const cached = await redis.get(DASHBOARD_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn("[getDashboardMetrics] Redis cache get failed, computing fresh:", e.message);
  }

  await dbConnect();

  try {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    
    // Fair Period-to-Date (PTD) comparison: compare 1st-to-current date of this month with 1st-to-same date of last month
    const currentDayOfMonth = now.getDate();
    const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const targetDayPrevMonth = Math.min(currentDayOfMonth, lastDayOfPrevMonth);

    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const samePeriodLastMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      targetDayPrevMonth,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    );

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const todayUTCStr = now.toISOString().slice(0, 10);
    const todayLocalStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const startOfTodayMs = startOfToday.getTime();
    const startOfTodayUTCMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

    const startOfThisMonthMs = startOfThisMonth.getTime();
    const startOfThisMonthUTCMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
    const startOfLastMonthMs = startOfLastMonth.getTime();
    const samePeriodLastMonthEndMs = samePeriodLastMonthEnd.getTime();

    // For MonthlySalesChart (aggregate up to 60 days)
    const nowForChart = new Date();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(nowForChart.getDate() - 59);
    sixtyDaysAgo.setHours(0, 0, 0, 0);

    // Run all MongoDB queries concurrently in parallel with Promise.all
    const [
      settings,
      totalOrders,
      distinctCustomers,
      generatedOrdersThisMonth,
      generatedOrdersLastMonth,
      customersThisMonthList,
      customersLastMonthList,
      paidOrdersThisMonth,
      paidOrdersLastMonth,
      paidOrdersToday,
      totalPaidOrders,
      addedToCartTotal,
      addedToCartThisMonth,
      addedToCartLastMonth,
      dailyOrdersAgg,
    ] = await Promise.all([
      getSettings(),
      Order.countDocuments({}),
      Order.distinct("email"),
      Order.countDocuments({ createdAt: { $gte: startOfThisMonth } }),
      Order.countDocuments({ createdAt: { $gte: startOfLastMonth, $lte: samePeriodLastMonthEnd } }),
      Order.distinct("email", { createdAt: { $gte: startOfThisMonth } }),
      Order.distinct("email", { createdAt: { $gte: startOfLastMonth, $lte: samePeriodLastMonthEnd } }),
      Order.countDocuments({
        status: { $in: ["paid", "fulfilled", "complete", "completed"] },
        createdAt: { $gte: startOfThisMonth }
      }),
      Order.countDocuments({
        status: { $in: ["paid", "fulfilled", "complete", "completed"] },
        createdAt: { $gte: startOfLastMonth, $lte: samePeriodLastMonthEnd }
      }),
      Order.countDocuments({
        status: { $in: ["paid", "fulfilled", "complete", "completed"] },
        createdAt: { $gte: startOfToday }
      }),
      Order.countDocuments({
        status: { $in: ["paid", "fulfilled", "complete", "completed"] }
      }),
      Order.countDocuments({ status: "in_cart" }),
      Order.countDocuments({ status: "in_cart", createdAt: { $gte: startOfThisMonth } }),
      Order.countDocuments({ status: "in_cart", createdAt: { $gte: startOfLastMonth, $lte: samePeriodLastMonthEnd } }),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: sixtyDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            },
            count: { $sum: 1 }
          }
        }
      ]),
    ]);

    const totalCustomers = distinctCustomers.length;
    const customersThisMonth = customersThisMonthList.length;
    const customersLastMonth = customersLastMonthList.length;

    // Shopify metrics
    let shopifyRecentOrders = [];
    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    let revenueToday = 0;
    let shopifyTotalOrders = 0;
    let shopifyOrdersThisMonth = 0;
    let shopifyOrdersLastMonth = 0;

    let totalRevenue = 0;

    if (settings.shopUrl1 && settings.shopifyAdminApiKey) {
      try {
        const allFetchedOrders = await fetchAllShopifyOrders(settings);
        shopifyTotalOrders = allFetchedOrders.length;

        // Sort descending by date so recent orders are first
        allFetchedOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        shopifyRecentOrders = allFetchedOrders.slice(0, 5);

        allFetchedOrders.forEach((order) => {
          if (order.cancelled_at) return;
          const price = parseFloat(order.total_price) || 0;
          const orderDate = new Date(order.created_at);
          const orderTimeMs = orderDate.getTime();
          const orderDateYMD = order.created_at ? order.created_at.slice(0, 10) : "";

          totalRevenue += price;

          // Check Today (matches local date, UTC date, or timestamp >= start of today)
          const isToday =
            orderTimeMs >= startOfTodayMs ||
            orderTimeMs >= startOfTodayUTCMs ||
            orderDateYMD === todayUTCStr ||
            orderDateYMD === todayLocalStr;

          if (isToday) {
            revenueToday += price;
          }

          // Check This Month vs Same Period Last Month (Period-To-Date)
          const isThisMonth =
            orderTimeMs >= startOfThisMonthMs ||
            orderTimeMs >= startOfThisMonthUTCMs ||
            (orderDate.getFullYear() === now.getFullYear() && orderDate.getMonth() === now.getMonth());

          if (isThisMonth) {
            revenueThisMonth += price;
            shopifyOrdersThisMonth += 1;
          } else if (orderTimeMs >= startOfLastMonthMs && orderTimeMs <= samePeriodLastMonthEndMs) {
            revenueLastMonth += price;
            shopifyOrdersLastMonth += 1;
          }
        });
      } catch (err) {
        console.error("Error fetching Shopify orders for dashboard metrics:", err);
      }
    }

    const AVG_ORDER_PRICE = 29.95; // Default digital package price fallback
    const dbRevenueThisMonth = paidOrdersThisMonth * AVG_ORDER_PRICE;
    const dbRevenueLastMonth = paidOrdersLastMonth * AVG_ORDER_PRICE;
    const dbRevenueToday = paidOrdersToday * AVG_ORDER_PRICE;
    const dbTotalRevenue = totalPaidOrders * AVG_ORDER_PRICE;

    // Use max of Shopify vs DB calculations so metrics are always dynamically populated
    revenueThisMonth = Math.max(revenueThisMonth, dbRevenueThisMonth);
    revenueLastMonth = Math.max(revenueLastMonth, dbRevenueLastMonth);
    revenueToday = Math.max(revenueToday, dbRevenueToday);
    totalRevenue = Math.max(totalRevenue, dbTotalRevenue);

    const buildChartData = (days) => {
      const categories = [];
      const seriesData = [];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);
      
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const found = dailyOrdersAgg.find(item => item._id === dateStr);
        
        let label = "";
        if (days === 7) {
          label = d.toLocaleDateString("en-US", { weekday: 'short' });
        } else {
          label = d.toLocaleDateString("en-US", { month: 'short', day: 'numeric' });
        }
        
        categories.push(label);
        seriesData.push(found ? found.count : 0);
      }
      return { categories, series: seriesData };
    };

    const metricsResult = {
      totalOrders,
      totalCustomers,
      recentOrders: shopifyRecentOrders,
      chartData: {
        '7_days': buildChartData(7),
        '30_days': buildChartData(30),
        '60_days': buildChartData(60),
      },
      revenueThisMonth,
      revenueLastMonth,
      revenueToday,
      totalRevenue,
      customersThisMonth,
      customersLastMonth,
      generatedOrdersThisMonth,
      generatedOrdersLastMonth,
      shopifyTotalOrders,
      shopifyOrdersThisMonth,
      shopifyOrdersLastMonth,
      addedToCartTotal,
      addedToCartThisMonth,
      addedToCartLastMonth,
      monthlyTarget: settings.monthlyTarget
    };

    // Cache the completed dashboard metrics in Redis
    try {
      await redis.set(DASHBOARD_CACHE_KEY, JSON.stringify(metricsResult), "EX", DASHBOARD_CACHE_TTL);
    } catch (e) {
      console.warn("[getDashboardMetrics] Failed to cache metrics in Redis:", e.message);
    }

    return metricsResult;
  } catch (error) {
    console.error("Error fetching dashboard metrics:", error);
    return {
      totalOrders: 0,
      totalCustomers: 0,
      recentOrders: [],
      chartData: { categories: [], series: [] },
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      revenueToday: 0,
      totalRevenue: 0,
      customersThisMonth: 0,
      customersLastMonth: 0,
      generatedOrdersThisMonth: 0,
      generatedOrdersLastMonth: 0,
      shopifyTotalOrders: 0,
      shopifyOrdersThisMonth: 0,
      shopifyOrdersLastMonth: 0,
      addedToCartTotal: 0,
      addedToCartThisMonth: 0,
      addedToCartLastMonth: 0,
      monthlyTarget: 20000
    };
  }
}
