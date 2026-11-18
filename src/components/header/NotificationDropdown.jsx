"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState, useEffect } from "react";
import { FiX } from "react-icons/fi";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";
import { useUser } from "@/context/UserContext";

export default function NotificationDropdown() {
  const router = useRouter();
  const { user } = useUser();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const canViewCustomerInfo = isAdmin || (Array.isArray(user?.permissions) && user.permissions.includes("customer_info"));

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastQueue, setToastQueue] = useState([]);
  const lastNotifIds = React.useRef(new Set());

  const maskCustomerText = (text) => {
    if (canViewCustomerInfo || !text || typeof text !== "string") return text;
    let masked = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "****");
    masked = masked.replace(/(received from\s+)([^,(]+)/gi, (match, prefix, name) => {
      if (name.trim() === "****") return match;
      return `${prefix}****`;
    });
    return masked;
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        const fetchedNotifs = data.notifications || [];
        setNotifications(fetchedNotifs);
        setUnreadCount(data.unreadCount || 0);

        // Check for new notifications to show toast (Admin/Super Admin only)
        if (isAdmin) {
          const currentIds = new Set(fetchedNotifs.map(n => n._id));
          if (lastNotifIds.current.size > 0) {
            const newNotifs = fetchedNotifs.filter(n => !n.isRead && !lastNotifIds.current.has(n._id));
            if (newNotifs.length > 0) {
              setToastQueue(prev => [...prev, ...newNotifs]);
            }
          }
          lastNotifIds.current = currentIds;
        }
      }
    } catch (err) {
      console.error("Failed to fetch notifications", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    // Poll every 15 seconds
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, []);

  // Automatically dismiss toasts after 5 seconds
  useEffect(() => {
    if (toastQueue.length > 0) {
      const timer = setTimeout(() => {
        setToastQueue(prev => prev.slice(1));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toastQueue]);

  function toggleDropdown() {
    setIsOpen(!isOpen);
  }

  function closeDropdown() {
    setIsOpen(false);
  }

  const markAllAsRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" })
      });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (err) {
      console.error("Failed to mark notifications as read", err);
    }
  };

  const markSingleAsRead = async (id) => {
    try {
      await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_single_read", notificationId: id })
      });
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark single notification as read", err);
    }
  };

  // Helper to format time ago
  const timeAgo = (dateString) => {
    const date = new Date(dateString);
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " yrs ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " mo ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hr ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " min ago";
    return Math.floor(seconds) + " sec ago";
  };

  const getIconColor = (type) => {
    switch (type) {
      case 'shopify_order': return 'bg-brand-500';
      case 'music_generated': return 'bg-success-500';
      case 'music_started': return 'bg-brand-400';
      case 'added_to_cart': return 'bg-warning-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="relative">
      <button
        className="relative dropdown-toggle flex items-center justify-center text-gray-500 transition-colors bg-white border border-gray-200 rounded-full hover:text-gray-700 h-11 w-11 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={toggleDropdown}
      >
        <span
          className={`absolute right-0 top-0.5 z-10 h-2 w-2 rounded-full bg-orange-400 ${unreadCount === 0 ? "hidden" : "flex"
            }`}
        >
          <span className="absolute inline-flex w-full h-full bg-orange-400 rounded-full opacity-75 animate-ping"></span>
        </span>
        <svg
          className="fill-current"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H4.37504H15.625H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C16.375 5.9004 13.9174 3.20733 10.75 2.83613V2.29248ZM14.875 14.4591V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="absolute -right-[240px] mt-[17px] flex h-[480px] w-[350px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark sm:w-[361px] lg:right-0"
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dark:border-gray-700">
          <h5 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Notifications {unreadCount > 0 && <span className="ml-1 text-sm font-medium text-orange-500">({unreadCount})</span>}
          </h5>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs font-medium text-brand-500 hover:text-brand-600 transition"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={toggleDropdown}
              className="text-gray-500 transition dropdown-toggle dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <svg
                className="fill-current"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>
        <ul className="flex flex-col h-auto overflow-y-auto custom-scrollbar">
          {notifications.length === 0 ? (
            <li className="p-4 text-center text-gray-500 text-sm">
              No new notifications
            </li>
          ) : (
            notifications.map((notification) => {
              // Handle old Shopify order links that pointed directly to Shopify Admin
              let notificationLink = notification.link || "#";
              if (notification.type === 'shopify_order' && notificationLink.includes('/admin/orders/')) {
                const parts = notificationLink.split('/admin/orders/');
                if (parts.length > 1) {
                  notificationLink = `/orders/${parts[1]}`;
                }
              }

              return (
                <li key={notification._id}>
                  <DropdownItem
                    tag="a"
                    onItemClick={() => { markSingleAsRead(notification._id); closeDropdown(); }}
                    className={`flex gap-3 rounded-lg border-b border-gray-100 p-3 px-4.5 py-3 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5 ${!notification.isRead ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}`}
                    href={notificationLink}
                  >
                    <span className="relative block w-10 h-10 rounded-full z-1 max-w-10 bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {notification.type === 'shopify_order' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />}
                        {notification.type === 'music_generated' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />}
                        {notification.type === 'music_started' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />}
                        {notification.type === 'added_to_cart' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />}
                        {(!['shopify_order', 'music_generated', 'music_started', 'added_to_cart'].includes(notification.type)) && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
                      </svg>

                      <span className={`absolute bottom-0 right-0 z-10 h-2.5 w-full max-w-2.5 rounded-full border-[1.5px] border-white dark:border-gray-900 ${getIconColor(notification.type)}`}></span>
                    </span>

                    <span className="block w-full">
                      <span className="mb-1 block text-theme-sm text-gray-500 dark:text-gray-400">
                        <span className="font-medium text-gray-800 dark:text-white/90">
                          {maskCustomerText(notification.title)}
                        </span>
                        <br />
                        <span>{maskCustomerText(notification.message)}</span>
                      </span>

                      <span className="flex items-center gap-2 text-gray-500 text-theme-xs dark:text-gray-400">
                        <span>{timeAgo(notification.createdAt)}</span>
                        {!notification.isRead && (
                          <>
                            <span className="w-1 h-1 bg-brand-400 rounded-full"></span>
                            <span className="text-brand-500 font-medium text-[10px]">New</span>
                          </>
                        )}
                      </span>
                    </span>
                  </DropdownItem>
                </li>
              );
            })
          )}
        </ul>
      </Dropdown>

      {/* Toast Container (Admin/Super Admin only) */}
      {isAdmin && toastQueue.length > 0 && (
        <div className="fixed bottom-5 right-5 z-[999999] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
          {/* Header Action: Count & Hide All Button (Only when more than 1 notification) */}
          {toastQueue.length > 1 && (
            <div className="flex items-center justify-between pointer-events-auto px-3 py-2 bg-white/95 dark:bg-gray-800/95 rounded-xl shadow-md border border-gray-200/80 dark:border-gray-700/80 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-brand-500 animate-pulse"></span>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  Notifications {toastQueue.length > 4 ? `(4 of ${toastQueue.length})` : `(${toastQueue.length})`}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setToastQueue([]);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                title="Hide all notifications"
              >
                <FiX className="w-4 h-4 text-red-500" />
                <span>Hide All</span>
              </button>
            </div>
          )}

          {toastQueue.slice(0, 4).map((toast, index) => {
            const handleToastClick = () => {
              markSingleAsRead(toast._id);
              setToastQueue(prev => prev.filter(t => t._id !== toast._id));

              let link = toast.link;
              if (!link || link === "#") {
                if (toast.type === "shopify_order") link = "/orders";
                else if (toast.type === "music_generated" || toast.type === "music_started") link = "/ordered-musics";
                else if (toast.type === "added_to_cart") link = "/customers";
              } else if (toast.type === "shopify_order" && link.includes("/admin/orders/")) {
                const parts = link.split("/admin/orders/");
                if (parts.length > 1) {
                  link = `/orders/${parts[1]}`;
                }
              }

              if (link && link !== "#") {
                router.push(link);
              }
            };

            return (
              <div
                key={toast._id + "-" + index}
                onClick={handleToastClick}
                className="group flex items-center gap-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 shadow-theme-lg rounded-xl p-4 border border-gray-100 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-600 pointer-events-auto transform transition-all duration-200 translate-y-0 opacity-100 cursor-pointer select-none active:scale-[0.99]"
                role="button"
                tabIndex={0}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 shadow-xs ${getIconColor(toast.type)}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {toast.type === 'shopify_order' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />}
                    {toast.type === 'music_generated' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />}
                    {toast.type === 'music_started' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />}
                    {toast.type === 'added_to_cart' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />}
                    {(!['shopify_order', 'music_generated', 'music_started', 'added_to_cart'].includes(toast.type)) && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
                  </svg>
                </div>
                <div className="flex-1 min-w-[200px] max-w-[250px]">
                  <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors truncate">
                    {maskCustomerText(toast.title)}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                    {maskCustomerText(toast.message)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setToastQueue(prev => prev.filter(t => t._id !== toast._id));
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer shrink-0"
                  title="Close notification"
                  aria-label="Close"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
