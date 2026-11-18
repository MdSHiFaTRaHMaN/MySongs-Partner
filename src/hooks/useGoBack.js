"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

const useGoBack = (defaultFallback = "/") => {
  const router = useRouter();

  const goBack = useCallback(
    (customFallback) => {
      const fallback = customFallback || defaultFallback;
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push(fallback);
      }
    },
    [router, defaultFallback]
  );

  return goBack;
};

export default useGoBack;
