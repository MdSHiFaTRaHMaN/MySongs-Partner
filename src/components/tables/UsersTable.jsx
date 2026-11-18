"use client";
import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../ui/table";
import Badge from "../ui/badge/Badge";
import { Modal } from "../ui/modal";
import Input from "../form/input/InputField";
import Label from "../form/Label";
import Button from "../ui/button/Button";
import { useUser } from "@/context/UserContext";
import Pagination from "./Pagination";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import { useToast } from "@/components/ui/toast/Toast";
import { FiTrash2, FiAlertTriangle } from "react-icons/fi";

const getNavOptions = (enableVideoTool) => [
  { label: "Dashboard (Home)", path: "/" },
  { label: "Music Orders", path: "/orders/music" },
  ...(enableVideoTool ? [{ label: "Video Orders", path: "/orders/video" }] : []),
  { label: "Other Orders", path: "/orders/publish" },
  { label: "Customers CRM", path: "/customers" },
  { label: "Customer Info", path: "customer_info" },
  { label: "Customer Choice Music", path: "/ordered-musics" },
  { label: "All Music", path: "/all-musics" },
  { label: "Staff Management", path: "/users" },
  { label: "Trash Bin", path: "/trash" },
  { label: "Music Tools", path: "/form-elements" },
  ...(enableVideoTool ? [{ label: "Video Tools", path: "/form-elements/video" }] : []),
];

export default function UsersTable({ itemsPerPageDefault = 50 }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { user, loading: userLoading } = useUser();
  const showToast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const activeTab = searchParams.get("tab") || "users"; // "users" or "requests"
  const itemsPerPage = Number(itemsPerPageDefault) > 0 ? Number(itemsPerPageDefault) : 50;

  const handleTabChange = (newTab) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
    if (newTab && newTab !== "users") {
      params.set("tab", newTab);
    } else {
      params.delete("tab");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Access Requests state
  const [accessRequests, setAccessRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  // Edit Modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState("");

  // Delete Modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/auth/users");
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to fetch users");
    } finally {
      setLoading(false);
    }
  };

  const fetchAccessRequests = async () => {
    setRequestsLoading(true);
    try {
      const res = await fetch("/api/access-requests");
      const data = await res.json();
      if (res.ok) {
        setAccessRequests(data.requests || []);
      }
    } catch (err) {
      console.error("Failed to fetch access requests:", err);
    } finally {
      setRequestsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchAccessRequests();
  }, []);

  const handleEditClick = (u) => {
    setEditingUser({
      ...u,
      permissions: Array.isArray(u.permissions) ? u.permissions : [],
    });
    setUpdateError("");
    setIsEditModalOpen(true);
  };

  const handleInputChange = (e) => {
    setEditingUser({ ...editingUser, [e.target.name]: e.target.value });
  };

  const handlePermissionToggle = (path) => {
    if (!editingUser) return;
    const current = editingUser.permissions || [];
    const updated = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path];
    setEditingUser({ ...editingUser, permissions: updated });
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    setUpdateLoading(true);
    setUpdateError("");

    try {
      const res = await fetch(`/api/auth/users/${editingUser._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingUser),
      });

      const data = await res.json();
      if (res.ok) {
        setUsers(users.map((u) => (u._id === data.user._id ? data.user : u)));
        setIsEditModalOpen(false);
        showToast({
          variant: "success",
          title: "User Updated",
          message: `Staff member "${data.user?.name || editingUser.name}" details & permissions updated successfully!`,
        });
      } else {
        setUpdateError(data.error || "Failed to update user");
        showToast({
          variant: "error",
          title: "Update Failed",
          message: data.error || "Failed to update user.",
        });
      }
    } catch (err) {
      setUpdateError("An unexpected error occurred");
      showToast({
        variant: "error",
        title: "Error",
        message: "An unexpected error occurred while updating.",
      });
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleDeleteClick = (userItem) => {
    setUserToDelete(userItem);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setDeleteLoading(true);

    try {
      const res = await fetch(`/api/auth/users/${userToDelete._id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (res.ok) {
        setUsers(users.filter((u) => u._id !== userToDelete._id));
        setIsDeleteModalOpen(false);
        showToast({
          variant: "success",
          title: "User Deleted",
          message: `User "${userToDelete.name || userToDelete.email}" has been deleted successfully!`,
        });
      } else {
        showToast({
          variant: "error",
          title: "Delete Failed",
          message: data.error || "Failed to delete user.",
        });
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Error",
        message: "An unexpected error occurred while deleting the user.",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleReviewRequest = async (requestId, action) => {
    try {
      const res = await fetch("/api/access-requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      if (res.ok) {
        fetchAccessRequests();
        fetchUsers(); // Refresh users to get updated permissions
        showToast({
          variant: "success",
          title: action === "approve" ? "Access Approved" : "Request Rejected",
          message: action === "approve"
            ? "Access permissions have been granted to the staff member."
            : "Access request has been declined.",
        });
      } else {
        showToast({
          variant: "error",
          title: "Action Failed",
          message: "Failed to review request.",
        });
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Error",
        message: "Error reviewing request.",
      });
    }
  };

  if (loading || userLoading) return <LoadingSpinner minHeight="min-h-[400px]" />;

  const cleanUserRole = String(user?.role || "").toLowerCase().replace(/[\s_-]/g, "");
  const isStaffManager = cleanUserRole === "admin" || cleanUserRole === "superadmin";

  if (!user || !isStaffManager) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] text-center">
        <h1 className="text-6xl font-bold text-gray-800 dark:text-white/90 mb-4">401</h1>
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">Unauthorized Access</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          You do not have the required administrator privileges to view or manage staff.
        </p>
      </div>
    );
  }

  if (error) return <div className="p-4 text-center text-red-500">{error}</div>;

  const visibleUsers = users.filter((u) => {
    const r = String(u.role || "").toLowerCase().replace(/[\s_-]/g, "");
    return r !== "superadmin";
  });
  const pendingRequestsCount = accessRequests.filter((r) => r.status === "pending").length;

  return (
    <>
      {/* Tabs Bar */}
      <div className="flex items-center gap-4 mb-6 border-b border-gray-200 dark:border-gray-800 pb-3">
        <button
          onClick={() => handleTabChange("users")}
          className={`text-sm font-semibold pb-1 border-b-2 transition-colors cursor-pointer ${
            activeTab === "users"
              ? "border-brand-500 text-brand-500"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          All Users ({visibleUsers.length})
        </button>

        <button
          onClick={() => handleTabChange("requests")}
          className={`text-sm font-semibold pb-1 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
            activeTab === "requests"
              ? "border-brand-500 text-brand-500"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          Access Requests
          {pendingRequestsCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {pendingRequestsCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "users" ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="max-w-full overflow-x-auto">
            <div className="min-w-[1102px]">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      User
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Email
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Role
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Status
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Designation
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-end text-theme-xs dark:text-gray-400">
                      Action
                    </TableCell>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {visibleUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((userItem) => (
                    <TableRow key={userItem._id}>
                      <TableCell className="px-5 py-4 sm:px-6 text-start">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center justify-center mr-3 overflow-hidden rounded-full h-11 w-11 shrink-0 bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400 font-bold text-lg">
                            {userItem?.avatar ? (
                              <Image
                                width={44}
                                height={44}
                                src={userItem.avatar}
                                alt="User"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              userItem?.name ? userItem.name.charAt(0).toUpperCase() : "U"
                            )}
                          </span>
                          <div>
                            <span className="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                              {userItem.name}
                            </span>
                            <span className="block text-gray-500 text-theme-xs dark:text-gray-400">
                              {userItem.phone || "No phone"}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                        {userItem.email}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                        <span className="capitalize">{userItem.role}</span>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                        <Badge
                          size="sm"
                          color={
                            userItem.status === "active"
                              ? "success"
                              : userItem.status === "suspended"
                                ? "error"
                                : "warning"
                          }
                        >
                          {userItem.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                        {userItem.designation || "N/A"}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-gray-500 text-end text-theme-sm dark:text-gray-400">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => handleEditClick(userItem)}
                            className="text-brand-500 hover:text-brand-600 font-semibold transition-colors"
                          >
                            Edit
                          </button>
                          {String(userItem.role || "").toLowerCase().replace(/[\s_-]/g, "") !== "admin" && String(userItem.role || "").toLowerCase().replace(/[\s_-]/g, "") !== "superadmin" && (
                            <button
                              onClick={() => handleDeleteClick(userItem)}
                              className="text-red-500 hover:text-red-600 font-semibold transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      ) : (
        /* Access Requests List Tab */
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03] p-4 sm:p-6">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">
            Staff Feature Access Requests
          </h3>
          {requestsLoading ? (
            <div className="py-6 text-center text-sm text-gray-500">Loading requests...</div>
          ) : accessRequests.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500">No access requests found.</div>
          ) : (
            <div className="space-y-3">
              {accessRequests.map((reqItem) => (
                <div
                  key={reqItem._id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border border-gray-100 bg-gray-50/50 dark:bg-gray-900 dark:border-gray-800 gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-800 dark:text-white">
                        {reqItem.userName || reqItem.userEmail}
                      </span>
                      <span className="text-xs text-gray-400">({reqItem.userEmail})</span>
                      <Badge
                        size="sm"
                        color={
                          reqItem.status === "approved"
                            ? "success"
                            : reqItem.status === "rejected"
                              ? "error"
                              : "warning"
                        }
                      >
                        {reqItem.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      Requested Access to: <strong className="text-brand-500">{reqItem.requestedPathLabel || reqItem.requestedPath}</strong> ({reqItem.requestedPath})
                    </p>
                    {reqItem.reason && (
                      <p className="text-xs text-gray-500 italic mt-0.5">&quot;{reqItem.reason}&quot;</p>
                    )}
                  </div>

                  {reqItem.status === "pending" && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleReviewRequest(reqItem._id, "approve")}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                      >
                        Approve Access
                      </button>
                      <button
                        onClick={() => handleReviewRequest(reqItem._id, "reject")}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "users" && Math.ceil(visibleUsers.length / itemsPerPage) > 1 && (
        <div className="flex items-center justify-center p-4 mt-4">
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(visibleUsers.length / itemsPerPage)}
            onPageChange={(page) => setCurrentPage(page)}
          />
        </div>
      )}

      {/* Modal: Edit User (Includes Navigation Permissions Selection) */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        className="max-w-lg w-full p-6 sm:p-8"
      >
        <h3 className="mb-4 text-xl font-semibold text-gray-800 dark:text-white">
          Edit User Rights &amp; Access
        </h3>
        {editingUser && (
          <form onSubmit={handleUpdateSubmit} className="space-y-4">
            {updateError && (
              <div className="p-3 text-sm text-red-500 bg-red-50 rounded-lg">{updateError}</div>
            )}

            <div>
              <Label>Full Name</Label>
              <Input
                name="name"
                value={editingUser.name || ""}
                onChange={handleInputChange}
                required
              />
            </div>

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                name="email"
                value={editingUser.email || ""}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Role</Label>
                <select
                  name="role"
                  value={editingUser.role || "staff"}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:bg-gray-900 dark:border-gray-800 dark:text-white/90"
                  required
                >
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </div>

              <div>
                <Label>Status</Label>
                <select
                  name="status"
                  value={editingUser.status || "active"}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:bg-gray-900 dark:border-gray-800 dark:text-white/90"
                  required
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            {/* Navigation Access Rights Checkboxes */}
            {editingUser.role === "staff" && (
              <div>
                <Label>Navigation &amp; Feature Access Rights</Label>
                <p className="text-xs text-gray-500 mb-2">
                  Select which pages this staff user is permitted to open:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-lg border border-gray-200 bg-gray-50/50 dark:bg-gray-900 dark:border-gray-800 max-h-48 overflow-y-auto">
                  {getNavOptions(user?.enableVideoTool).map((opt) => (
                    <label key={opt.path} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(editingUser.permissions || []).includes(opt.path)}
                        onChange={() => handlePermissionToggle(opt.path)}
                        className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label>Phone Number</Label>
              <Input
                name="phone"
                value={editingUser.phone || ""}
                onChange={handleInputChange}
              />
            </div>

            <div>
              <Label>Designation</Label>
              <Input
                name="designation"
                value={editingUser.designation || ""}
                onChange={handleInputChange}
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateLoading}>
                {updateLoading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Delete User Confirmation */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        className="max-w-md p-6"
      >
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 mx-auto">
            <FiTrash2 size={24} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800 dark:text-white/90">
              Delete Staff Member?
            </h4>
            <p className="text-xs text-gray-500 mt-2">
              Are you sure you want to delete <strong className="text-gray-800 dark:text-white">{userToDelete?.name || userToDelete?.email}</strong>? This user will lose all dashboard access immediately.
            </p>
            <p className="text-xs text-rose-500 font-medium mt-1">
              This action cannot be undone.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmDelete}
              disabled={deleteLoading}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleteLoading ? "Deleting..." : "Permanently Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
