import React, { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  formatter: (val: number) => string;
  durationMs?: number;
}

export function AnimatedNumber({
  value,
  formatter,
  durationMs = 420,
}: AnimatedNumberProps) {
  const safeTarget = Number.isFinite(value) ? value : 0;
  const [displayValue, setDisplayValue] = useState<number>(safeTarget);
  const currentRef = useRef<number>(safeTarget);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || durationMs <= 0) {
      currentRef.current = safeTarget;
      setDisplayValue(safeTarget);
      return;
    }

    const from = currentRef.current;
    const delta = safeTarget - from;
    if (Math.abs(delta) < 0.0001) {
      currentRef.current = safeTarget;
      setDisplayValue(safeTarget);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      // Smooth easeOutCubic settling curve
      const eased = 1 - Math.pow(1 - t, 3);
      const nextVal = from + delta * eased;
      currentRef.current = nextVal;
      setDisplayValue(nextVal);
      if (t < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        currentRef.current = safeTarget;
        setDisplayValue(safeTarget);
      }
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [safeTarget, durationMs]);

  return <>{formatter(displayValue)}</>;
}
