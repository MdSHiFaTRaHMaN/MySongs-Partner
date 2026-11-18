"use client";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import ComponentCard from "@/components/common/ComponentCard";
import React, { useState, useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/components/ui/toast/Toast";

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

export default function CreateStaffForm() {
  const { user, loading: userLoading } = useUser();
  const showToast = useToast();
  const navOptions = getNavOptions(user?.enableVideoTool);

  // Default permissions depend on whether Video Tool is enabled
  const getDefaultPermissions = (enableVideoTool) => {
    if (enableVideoTool) {
      // Video tool staff: only see orders/video and orders/music by default, NOT /orders
      return ["/", "/orders/video", "/orders/music"];
    }
    return ["/", "/orders/music", "/customers", "/ordered-musics", "/all-musics"];
  };

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "staff",
    customRole: "",
    phone: "",
    designation: "",
    permissions: getDefaultPermissions(false), // Will update once user loads
  });
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // Update default permissions once we know if video tool is enabled
  useEffect(() => {
    if (!userLoading && user) {
      setFormData(prev => ({
        ...prev,
        permissions: prev.permissions.length > 0 ? prev.permissions : getDefaultPermissions(user.enableVideoTool),
      }));
    }
  }, [user, userLoading]);

  useEffect(() => {
    fetch("/api/roles")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.roles) setRoles(data.roles);
      })
      .catch(() => {});
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handlePermissionToggle = (path) => {
    setFormData((prev) => {
      const current = prev.permissions || [];
      const updated = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path];
      return { ...prev, permissions: updated };
    });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/auth/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (res.ok) {
        showToast({
          variant: "success",
          title: "Staff Created",
          message: `New staff member "${formData.name}" has been created successfully!`,
        });
        setSuccess("User created successfully with assigned role & navigation permissions!");
        setFormData({
          name: "",
          email: "",
          password: "",
          role: "staff",
          customRole: "",
          phone: "",
          designation: "",
          permissions: getDefaultPermissions(user?.enableVideoTool),
        });
      } else {
        setError(data.error || "Failed to create user");
        showToast({
          variant: "error",
          title: "Creation Failed",
          message: data.error || "Failed to create staff member.",
        });
      }
    } catch (err) {
      setError("An unexpected error occurred");
      showToast({
        variant: "error",
        title: "Error",
        message: "An unexpected error occurred while creating staff.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (userLoading) return <div className="p-4 text-center">Loading...</div>;

  const isStaffCreator = user?.role === "admin" || user?.role === "super_admin";

  if (!user || !isStaffCreator) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] text-center">
        <h1 className="text-6xl font-bold text-gray-800 dark:text-white/90 mb-4">401</h1>
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">Unauthorized Access</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          You do not have the required administrator privileges to create staff.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 max-w-[650px] mx-auto">
      <ComponentCard title="Create New Staff / Assign Navigation Access">
        <form onSubmit={handleCreate}>
          <div className="space-y-6">
            {error && <div className="p-3 text-sm text-red-500 bg-red-50 rounded-lg">{error}</div>}
            {success && <div className="p-3 text-sm text-green-500 bg-green-50 rounded-lg">{success}</div>}

            <div>
              <Label>
                Full Name <span className="text-error-500">*</span>
              </Label>
              <Input
                placeholder="John Doe"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div>
              <Label>
                Email <span className="text-error-500">*</span>
              </Label>
              <Input
                placeholder="john@example.com"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>

            <div>
              <Label>
                Password <span className="text-error-500">*</span>
              </Label>
              <Input
                type="password"
                placeholder="Enter password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
              />
            </div>

            <div>
              <Label>
                Role <span className="text-error-500">*</span>
              </Label>
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="w-full px-4 py-3 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:bg-gray-900 dark:border-gray-800 dark:text-white/90"
                required
              >
                <option value="admin">Admin (Full Access)</option>
                <option value="staff">Staff (Custom Permissions)</option>
              </select>
            </div>

            {formData.role === "staff" && (
              <div>
                <Label>Allowed Navigations / Features</Label>
                <p className="text-xs text-gray-500 mb-3">
                  Select which sidebar navigation options and pages this staff member can access:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-lg border border-gray-200 bg-gray-50/50 dark:bg-gray-900 dark:border-gray-800">
                  {navOptions.map((opt) => (
                    <label key={opt.path} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(formData.permissions || []).includes(opt.path)}
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
                placeholder="+1234567890"
                type="text"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
              />
            </div>

            <div>
              <Label>Designation</Label>
              <Input
                placeholder="e.g. Support Specialist / Content Editor"
                type="text"
                name="designation"
                value={formData.designation}
                onChange={handleChange}
              />
            </div>

            <div className="pt-2">
              <Button type="submit" className="w-full" size="sm" disabled={loading}>
                {loading ? "Creating..." : "Create User with Access Rights"}
              </Button>
            </div>
          </div>
        </form>
      </ComponentCard>
    </div>
  );
}
