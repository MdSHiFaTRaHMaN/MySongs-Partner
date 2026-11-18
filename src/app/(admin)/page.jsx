import { EcommerceMetrics } from "@/components/ecommerce/EcommerceMetrics";
import React from "react";
import MonthlyTarget from "@/components/ecommerce/MonthlyTarget";
import MonthlySalesChart from "@/components/ecommerce/MonthlySalesChart";
import RecentOrders from "@/components/ecommerce/RecentOrders";
import SunoCreditCard from "@/components/ecommerce/SunoCreditCard";
import { getDashboardMetrics } from "@/lib/getDashboardMetrics";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
export const metadata = {
  title: "Dashboard | My Own Music",
  description: "Admin Dashboard for My Own Music",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export default async function Ecommerce() {
  const metrics = await getDashboardMetrics();
  const user = await getCurrentUser();

  const cleanRole = String(user?.role || "").toLowerCase().replace(/[\s_-]/g, "");
  const isSuperAdmin = cleanRole === "superadmin" || user?.role === "super_admin";
  const isAdmin = isSuperAdmin || cleanRole === "admin" || user?.role === "admin";
  const canViewDashboard = isAdmin || (Array.isArray(user?.permissions) && user.permissions.includes("/"));

  if (!canViewDashboard) {
    const fallbackRoute = (Array.isArray(user?.permissions) && user.permissions.find(p => p !== "/")) || "/unauthorized";
    return redirect(fallbackRoute);
  }


  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      {/* Metric Cards - Full Width */}
      <div className="col-span-12">
        <EcommerceMetrics 
          totalCustomers={metrics.totalCustomers} 
          totalOrders={metrics.totalOrders} 
          customersThisMonth={metrics.customersThisMonth}
          customersLastMonth={metrics.customersLastMonth}
          generatedOrdersThisMonth={metrics.generatedOrdersThisMonth}
          generatedOrdersLastMonth={metrics.generatedOrdersLastMonth}
          shopifyTotalOrders={metrics.shopifyTotalOrders}
          shopifyOrdersThisMonth={metrics.shopifyOrdersThisMonth}
          shopifyOrdersLastMonth={metrics.shopifyOrdersLastMonth}
          addedToCartTotal={metrics.addedToCartTotal}
          addedToCartThisMonth={metrics.addedToCartThisMonth}
          addedToCartLastMonth={metrics.addedToCartLastMonth}
          totalRevenue={metrics.totalRevenue}
          revenueThisMonth={metrics.revenueThisMonth}
          revenueLastMonth={metrics.revenueLastMonth}
        >
          <SunoCreditCard />
        </EcommerceMetrics>
      </div>

      {/* Charts Row */}
      <div className="col-span-12 xl:col-span-7">
        <MonthlySalesChart chartData={metrics.chartData} />
      </div>

      <div className="col-span-12 xl:col-span-5">
        <MonthlyTarget 
          revenueThisMonth={metrics.revenueThisMonth}
          revenueLastMonth={metrics.revenueLastMonth}
          revenueToday={metrics.revenueToday}
          totalRevenue={metrics.totalRevenue}
          monthlyTarget={metrics.monthlyTarget}
        />
      </div>
      <div className="col-span-12 xl:col-span-12">
        <RecentOrders recentOrders={metrics.recentOrders} />
      </div>
    </div>
  );
}
