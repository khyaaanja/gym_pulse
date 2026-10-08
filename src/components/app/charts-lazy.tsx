"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type * as Charts from "./charts";

/**
 * The charts, loaded on demand. Recharts is the largest library in the app (~370 KB of JS) and its responsive
 * container measures the browser before drawing, so server rendering never painted anything for it anyway. Loading
 * it after the page is interactive costs nothing visible; the wrapper reserves the chart's height so nothing shifts.
 */
const LazyAttendance = dynamic(() => import("./charts").then((m) => m.AttendanceChart), { ssr: false });
const LazyMagnitude = dynamic(() => import("./charts").then((m) => m.MagnitudeBars), { ssr: false });

export function AttendanceChart(props: ComponentProps<typeof Charts.AttendanceChart>) {
  return (
    <div style={{ minHeight: props.height ?? 220 }}>
      <LazyAttendance {...props} />
    </div>
  );
}

export function MagnitudeBars(props: ComponentProps<typeof Charts.MagnitudeBars>) {
  return (
    <div style={{ minHeight: props.height ?? 220 }}>
      <LazyMagnitude {...props} />
    </div>
  );
}
