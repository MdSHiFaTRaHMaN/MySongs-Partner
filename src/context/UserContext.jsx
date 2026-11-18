"use client";
import React, { createContext, useContext, useState, useEffect } from "react";

const UserContext = createContext();

export function UserProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("cached_user");
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }
    return null;
  });
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        try {
          localStorage.setItem("cached_user", JSON.stringify(data.user));
        } catch (e) {}
      } else {
        if (res.status === 401 || res.status === 404) {
          try {
            localStorage.removeItem("cached_user");
            await fetch("/api/auth/logout", { method: "POST" });
            if (typeof window !== "undefined" && window.location.pathname !== "/signin") {
              window.location.href = "/signin";
            }
          } catch (e) {
            console.error("Auto-logout failed", e);
          }
        }
        setUser(null);
      }
    } catch (err) {
      console.error("Failed to fetch user", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Clean URL bar from ugly Shopify query parameters (?host=...&shop=...)
    if (typeof window !== "undefined" && window.location.search) {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.has("host") || searchParams.has("shop") || searchParams.has("hmac")) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
    fetchUser();
  }, []);

  const mutateUser = (updatedUser) => {
    setUser(updatedUser);
    try {
      if (updatedUser) {
        localStorage.setItem("cached_user", JSON.stringify(updatedUser));
      } else {
        localStorage.removeItem("cached_user");
      }
    } catch (e) {}
  };

  return (
    <UserContext.Provider value={{ user, loading, fetchUser, mutateUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
