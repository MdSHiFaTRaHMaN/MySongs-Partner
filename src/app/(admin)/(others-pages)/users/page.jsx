import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import UsersTable from "@/components/tables/UsersTable";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import React, { Suspense } from "react";
import { getSettings } from "@/lib/getSettings";

export const metadata = {
  title: "Users Management | Admin Dashboard",
  description: "View and manage all users",
};

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const settings = await getSettings();
  const tableItemsPerPage = Number(settings?.tableItemsPerPage) || 50;

  return (
    <div>
      <PageBreadcrumb pageTitle="All Users" />
      <Suspense fallback={<LoadingSpinner />}>
        <UsersTable itemsPerPageDefault={tableItemsPerPage} />
      </Suspense>
    </div>
  );
}
