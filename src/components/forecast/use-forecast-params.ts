"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * A navigation to the forecast with some of its params changed and every
 * other one as it was — so choosing a year keeps the deferrals, and deferring
 * keeps the year. Not scrolled: the chart and the table are where the person
 * already is. The server recomputes; nothing here does arithmetic.
 */
export function useForecastParams() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return {
    searchParams,
    navigate(change: (params: URLSearchParams) => void) {
      const params = new URLSearchParams(searchParams);
      change(params);

      const query = params.toString();
      router.push(query ? `/forecast?${query}` : "/forecast", {
        scroll: false,
      });
    },
  };
}
