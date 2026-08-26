import { useEffect, useState } from 'react';

interface UseSkeletonOptions {
  loading: boolean;
  hasData: boolean;
  minDisplayMs?: number; // default 300ms
  timeoutMs?: number;    // default 10000ms (10s)
}

export function useSkeleton({
  loading,
  hasData,
  minDisplayMs = 300,
  timeoutMs = 10000,
}: UseSkeletonOptions) {
  // If data already exists (cached data on disk), never show skeleton
  const [minPassed, setMinPassed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading || hasData) {
      setMinPassed(true);
      setTimedOut(false);
      return;
    }

    setMinPassed(false);
    setTimedOut(false);

    const minTimer = setTimeout(() => {
      setMinPassed(true);
    }, minDisplayMs);

    const timeoutTimer = setTimeout(() => {
      setTimedOut(true);
    }, timeoutMs);

    return () => {
      clearTimeout(minTimer);
      clearTimeout(timeoutTimer);
    };
  }, [loading, hasData, minDisplayMs, timeoutMs]);

  const showSkeleton = loading && !hasData && (!minPassed || !timedOut);

  return {
    showSkeleton: loading && !hasData && !timedOut,
    timedOut,
  };
}
