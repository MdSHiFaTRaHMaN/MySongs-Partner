"use client";
import { useEffect, useRef, useState } from "react";

/**
 * StickySidebar - Reliable sticky sidebar using fixed positioning.
 * Works regardless of parent overflow settings.
 */
export default function StickySidebar({ children, headerOffset = 80 }) {
  const sentinelRef = useRef(null);
  const sidebarRef = useRef(null);
  const [style, setStyle] = useState({});

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const sidebar = sidebarRef.current;
    if (!sentinel || !sidebar) return;

    const updatePosition = () => {
      const sentinelRect = sentinel.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const parentRect = sidebar.parentElement?.getBoundingClientRect();

      if (!parentRect) return;

      const distanceScrolled = headerOffset - sentinelRect.top;

      if (distanceScrolled > 0) {
        // How far can we push the sidebar down (to not exceed parent bottom)
        const maxPush = parentRect.height - sidebarRect.height;
        const clampedPush = Math.min(distanceScrolled, maxPush);
        setStyle({
          transform: `translateY(${clampedPush}px)`,
          transition: "transform 0.05s linear",
        });
      } else {
        setStyle({ transform: "translateY(0px)" });
      }
    };

    const onScroll = () => requestAnimationFrame(updatePosition);
    const onResize = () => requestAnimationFrame(updatePosition);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    updatePosition();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [headerOffset]);

  return (
    <div className="relative w-full">
      {/* Sentinel marks the original top position */}
      <div ref={sentinelRef} style={{ position: "absolute", top: 0, height: 0, width: 0 }} />
      <div ref={sidebarRef} className="space-y-6 w-full" style={style}>
        {children}
      </div>
    </div>
  );
}
