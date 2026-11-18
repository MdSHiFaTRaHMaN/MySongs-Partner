import UserAddressCard from "@/components/user-profile/UserAddressCard";
import UserInfoCard from "@/components/user-profile/UserInfoCard";
import UserSecurityCard from "@/components/user-profile/UserSecurityCard";
import UserSessionsCard from "@/components/user-profile/UserSessionsCard";
import UserMetaCard from "@/components/user-profile/UserMetaCard";
import React from "react";

export const metadata = {
  title: "Profile | My Own Songs",
  description: "User Profile & Account Settings - My Own Songs",
};

export default function Profile() {
  return (
    <div>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-7">
          Profile &amp; Account Settings
        </h3>
        <div className="space-y-6">
          <UserMetaCard />
          <UserInfoCard />
          <UserSecurityCard />
          <UserSessionsCard />
          <UserAddressCard />
        </div>
      </div>
    </div>
  );
}
