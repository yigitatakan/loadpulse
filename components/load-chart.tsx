"use client";

export type ChartPoint = {
  second: number;
  requests: number;
  errors: number;
  avgLatency: number;
};

export type ChartSeries = {
  label: string;
  points: ChartPoint[];
  color?: string;
};

const WIDTH = 760;
const PAD = { top: 18, right: 16, bottom: 30, left: 52 };

function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatTick(value: number, metric: "latency" | "requests"): string {
  if (metric === "latency") {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
    return `${Math.round(value)}ms`;
  }
  return new Intl.NumberFormat("en-US", { notation: value >= 10000 ? "compact" : "standard" }).format(
    Math.round(value),
  );
}

export default function LoadChart({
  series,
  metric,
  height = 240,
}: {
  series: ChartSeries[];
  metric: "latency" | "requests";
  height?: number;
}) {
  const visible = series.filter((item) => item.points.length > 0);
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  if (visible.length === 0) {
    return (
      <div
        className="grid place-items-center rounded-xl border border-dashed border-border/80 bg-muted/40 text-[13px] text-muted-foreground"
        style={{ height }}
      >
        Waiting for the first second of data…
      </div>
    );
  }

  const maxSecond = Math.max(
    1,
    ...visible.flatMap((item) => item.points.map((point) => point.second)),
  );
  const values = visible.flatMap((item) =>
    item.points.map((point) => (metric === "latency" ? point.avgLatency : point.requests)),
  );
  const rawMax = values.length > 0 ? Math.max(...values) : 0;
  const yMax = niceMax(rawMax || (metric === "latency" ? 100 : 1));

  const x = (second: number) => PAD.left + (second / maxSecond) * innerW;
  const y = (value: number) => PAD.top + innerH - Math.min(1, Math.max(0, value / yMax)) * innerH;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => yMax * fraction);
  const tickCount = Math.min(5, maxSecond + 1);
  const secondTicks = Array.from({ length: tickCount }, (_, index) =>
    Math.round((index * maxSecond) / Math.max(1, tickCount - 1)),
  ).filter((value, index, all) => all.indexOf(value) === index);

  const barWidth = Math.max(2, Math.min(20, (innerW / Math.max(1, maxSecond)) * 0.55));
  const label =
    metric === "latency" ? "Average response time per second" : "Requests and errors per second";

  return (
    <div>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
      >
        <title>{label}</title>
        <g>
          {gridValues.map((value) => (
            <g key={`grid-${value}`}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 10}
                y={y(value) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {formatTick(value, metric)}
              </text>
            </g>
          ))}
        </g>

        <g>
          {secondTicks.map((second) => (
            <text
              key={`tick-${second}`}
              x={x(second)}
              y={height - 10}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted-foreground)"
            >
              {second}s
            </text>
          ))}
        </g>

        {metric === "latency"
          ? visible.map((item, index) => {
              const color = item.color ?? (index === 0 ? "var(--chart-1)" : "var(--chart-2)");
              const points = [...item.points].sort((a, b) => a.second - b.second);
              const line = points
                .map(
                  (point, pointIndex) =>
                    `${pointIndex === 0 ? "M" : "L"}${x(point.second).toFixed(1)},${y(point.avgLatency).toFixed(1)}`,
                )
                .join(" ");
              const first = points[0];
              const last = points[points.length - 1];
              const area = `${line} L${x(last.second).toFixed(1)},${y(0).toFixed(1)} L${x(first.second).toFixed(1)},${y(0).toFixed(1)} Z`;
              return (
                <g key={item.label} style={{ color }}>
                  <path d={area} fill="currentColor" fillOpacity={0.12} />
                  <path
                    d={line}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {points.map((point) => (
                    <circle
                      key={`${item.label}-${point.second}`}
                      cx={x(point.second)}
                      cy={y(point.avgLatency)}
                      r={2.5}
                      fill="currentColor"
                    />
                  ))}
                </g>
              );
            })
          : visible.map((item, index) => {
              const color = item.color ?? (index === 0 ? "var(--chart-1)" : "var(--chart-2)");
              return (
                <g key={item.label}>
                  {item.points.map((point) => {
                    const top = y(point.requests);
                    const baseline = y(0);
                    const errorTop = y(Math.max(0, point.requests - point.errors));
                    return (
                      <g key={`${item.label}-${point.second}`}>
                        <rect
                          x={x(point.second) - barWidth / 2}
                          y={top}
                          width={barWidth}
                          height={Math.max(1, baseline - top)}
                          rx={2}
                          fill={color}
                          fillOpacity={0.85}
                        />
                        {point.errors > 0 ? (
                          <rect
                            x={x(point.second) - barWidth / 2}
                            y={top}
                            width={barWidth}
                            height={Math.max(1, errorTop - top)}
                            rx={2}
                            fill="var(--destructive)"
                          />
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              );
            })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 px-1 text-[11px] text-muted-foreground">
        {visible.map((item, index) => (
          <span key={`legend-${item.label}`} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: item.color ?? (index === 0 ? "var(--chart-1)" : "var(--chart-2)") }}
            />
            {item.label}
          </span>
        ))}
        {metric === "requests" ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: "var(--destructive)" }} />
            Failed requests
          </span>
        ) : null}
      </div>
    </div>
  );
}
