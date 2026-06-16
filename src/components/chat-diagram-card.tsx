"use client";

import { type CSSProperties, type ReactElement } from "react";

import type { ChatDiagramChartSpec } from "@/domains/chat/diagram";

const diagramColors = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4d7c0f",
] as const;

export function ChatDiagramCard({
  diagram,
}: {
  readonly diagram: ChatDiagramChartSpec;
}): ReactElement {
  return (
    <figure className="mt-2 overflow-hidden rounded-lg border border-border bg-background/70 p-3">
      <figcaption className="mb-2 text-xs font-bold text-foreground">
        {diagram.title}
      </figcaption>
      {diagram.type === "pie" ? (
        <PieDiagram diagram={diagram} />
      ) : diagram.type === "line" ? (
        <LineDiagram diagram={diagram} />
      ) : (
        <BarDiagram diagram={diagram} />
      )}
    </figure>
  );
}

function BarDiagram({
  diagram,
}: {
  readonly diagram: ChatDiagramChartSpec;
}): ReactElement {
  const chart = getCartesianChartMetrics(diagram);
  const barGap = 8;
  const barWidth = Math.max(
    10,
    (chart.plotWidth - barGap * (diagram.data.length - 1)) /
      diagram.data.length,
  );

  return (
    <svg
      role="img"
      aria-label={diagram.title}
      viewBox="0 0 520 280"
      className="aspect-[13/7] w-full"
    >
      <CartesianAxes chart={chart} diagram={diagram} />
      {diagram.data.map((datum, index) => {
        const valueY = getCartesianValueY(datum.value, chart);
        const height = Math.abs(valueY - chart.zeroY);
        const x = chart.left + index * (barWidth + barGap);
        const y = Math.min(valueY, chart.zeroY);

        return (
          <g key={`${getDiagramDatumLabel(datum)}-${index}`}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx="4"
              fill={diagramColors[index % diagramColors.length]}
            />
            <text
              x={x + barWidth / 2}
              y={chart.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {truncateDiagramAxisLabel(getDiagramDatumLabel(datum))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineDiagram({
  diagram,
}: {
  readonly diagram: ChatDiagramChartSpec;
}): ReactElement {
  const chart = getCartesianChartMetrics(diagram);
  const pointGap =
    diagram.data.length > 1
      ? chart.plotWidth / (diagram.data.length - 1)
      : chart.plotWidth;
  const points = diagram.data.map((datum, index) => {
    const x = chart.left + index * pointGap;
    const y = getCartesianValueY(datum.value, chart);
    return { x, y, datum };
  });
  const polylinePoints = points
    .map((point): string => `${point.x},${point.y}`)
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={diagram.title}
      viewBox="0 0 520 280"
      className="aspect-[13/7] w-full"
    >
      <CartesianAxes chart={chart} diagram={diagram} />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={diagramColors[0]}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <g key={`${getDiagramDatumLabel(point.datum)}-${index}`}>
          <circle cx={point.x} cy={point.y} r="4" fill={diagramColors[0]} />
          <text
            x={point.x}
            y={chart.bottom + 16}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {truncateDiagramAxisLabel(getDiagramDatumLabel(point.datum))}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PieDiagram({
  diagram,
}: {
  readonly diagram: ChatDiagramChartSpec;
}): ReactElement {
  const positiveData = diagram.data.filter((datum): boolean => datum.value > 0);
  const total = positiveData.reduce(
    (totalValue, datum): number => totalValue + datum.value,
    0,
  );
  if (total <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No positive values are available for this pie chart.
      </p>
    );
  }
  const gradientStops = positiveData.reduce(
    (
      state: {
        readonly accumulatedPercent: number;
        readonly stops: readonly string[];
      },
      datum,
      index,
    ) => {
      const percent = (datum.value / total) * 100;
      const start = state.accumulatedPercent;
      const end = start + percent;
      const color = diagramColors[index % diagramColors.length];
      return {
        accumulatedPercent: end,
        stops: [...state.stops, `${color} ${start}% ${end}%`],
      };
    },
    { accumulatedPercent: 0, stops: [] as readonly string[] },
  ).stops;
  const pieStyle: CSSProperties = {
    background: `conic-gradient(${gradientStops.join(", ")})`,
  };

  return (
    <div className="grid gap-3 sm:grid-cols-[160px_1fr] sm:items-center">
      <div
        role="img"
        aria-label={diagram.title}
        className="mx-auto aspect-square w-36 rounded-full border border-border"
        style={pieStyle}
      />
      <div className="grid gap-1.5">
        {positiveData.map((datum, index) => (
          <div
            key={`${getDiagramDatumLabel(datum)}-${index}`}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: diagramColors[index % diagramColors.length],
                }}
              />
              <span className="truncate">{getDiagramDatumLabel(datum)}</span>
            </span>
            <span className="shrink-0 font-semibold text-foreground">
              {formatDiagramValue(datum.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CartesianAxes({
  chart,
  diagram,
}: {
  readonly chart: ReturnType<typeof getCartesianChartMetrics>;
  readonly diagram: ChatDiagramChartSpec;
}): ReactElement {
  return (
    <g>
      <line
        x1={chart.left}
        y1={chart.zeroY}
        x2={chart.right}
        y2={chart.zeroY}
        stroke="currentColor"
        className="text-border"
      />
      <line
        x1={chart.left}
        y1={chart.top}
        x2={chart.left}
        y2={chart.bottom}
        stroke="currentColor"
        className="text-border"
      />
      <text
        x={chart.left}
        y={chart.top - 8}
        className="fill-muted-foreground text-[10px]"
      >
        {diagram.axisYTitle ?? formatDiagramValue(chart.maxValue)}
      </text>
      {chart.minValue < 0 && (
        <text
          x={chart.left}
          y={chart.bottom + 16}
          className="fill-muted-foreground text-[10px]"
        >
          {formatDiagramValue(chart.minValue)}
        </text>
      )}
      {diagram.axisXTitle && (
        <text
          x={(chart.left + chart.right) / 2}
          y={272}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {diagram.axisXTitle}
        </text>
      )}
    </g>
  );
}

function getCartesianChartMetrics(diagram: ChatDiagramChartSpec): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly plotHeight: number;
  readonly plotWidth: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly valueRange: number;
  readonly zeroY: number;
} {
  const top = 26;
  const right = 18;
  const bottom = 224;
  const left = 42;
  const values = diagram.data.map((datum): number => datum.value);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const valueRange = maxValue - minValue || 1;
  const plotHeight = bottom - top;
  const zeroY = bottom - ((0 - minValue) / valueRange) * plotHeight;

  return {
    top,
    right: 520 - right,
    bottom,
    left,
    plotHeight,
    plotWidth: 520 - right - left,
    minValue,
    maxValue,
    valueRange,
    zeroY,
  };
}

function getCartesianValueY(
  value: number,
  chart: ReturnType<typeof getCartesianChartMetrics>,
): number {
  return (
    chart.bottom - ((value - chart.minValue) / chart.valueRange) * chart.plotHeight
  );
}

function getDiagramDatumLabel(
  datum: ChatDiagramChartSpec["data"][number],
): string {
  return datum.category ?? datum.time ?? "Item";
}

function truncateDiagramAxisLabel(value: string): string {
  return value.length > 14 ? `${value.slice(0, 12)}...` : value;
}

function formatDiagramValue(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
  }).format(value);
}
