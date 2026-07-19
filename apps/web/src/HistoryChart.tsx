import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateTime, formatPrice } from "./format";
import type { PricePoint } from "./types";

export function HistoryChart({
  points,
  targetPrice,
}: {
  points: PricePoint[];
  targetPrice?: number | null;
}) {
  const data = points
    .filter((p) => p.price !== null)
    .map((p) => ({
      t: new Date(p.checkedAt).getTime(),
      price: p.price as number,
      currency: p.currency,
    }));

  if (data.length === 0) {
    return <p className="stamp">Noch keine Preisdaten.</p>;
  }

  const axis = "#9ca3af";
  const ink = "#171717";
  const low = "#15803d";
  const currency = data[0]?.currency ?? "EUR";

  const prices = data.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const lowPoint = data.find((d) => d.price === minPrice)!;
  const pad = Math.max(5, (Math.max(...prices) - minPrice) * 0.15);
  const yLo = Math.min(minPrice, targetPrice ?? Infinity) - pad;
  const yHi = Math.max(...prices) + pad;

  return (
    <div style={{ width: "100%", fontFamily: "Geist Mono, monospace" }}>
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={data} margin={{ top: 12, right: 14, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ink} stopOpacity={0.1} />
              <stop offset="100%" stopColor={ink} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 5" stroke="#eee" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={(t: number) =>
              new Date(t).toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
              })
            }
            stroke={axis}
            fontSize={11}
            tickMargin={10}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[Math.floor(yLo), Math.ceil(yHi)]}
            stroke={axis}
            fontSize={11}
            width={64}
            tickFormatter={(v: number) => `${Math.round(v).toLocaleString("de-DE")} €`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: "#d4d4d4", strokeDasharray: "3 3" }}
            contentStyle={{
              background: "#ffffff",
              border: "1px solid #ececec",
              borderRadius: 10,
              color: "#171717",
              fontFamily: "Geist Mono, monospace",
              fontSize: 12,
              boxShadow: "0 8px 24px -12px rgba(17,17,17,0.25)",
            }}
            labelFormatter={(t) => formatDateTime(new Date(Number(t)).toISOString())}
            formatter={(value) => [formatPrice(Number(value), currency), "Endpreis"]}
          />
          {typeof targetPrice === "number" && (
            <ReferenceLine
              y={targetPrice}
              stroke={low}
              strokeDasharray="4 4"
              strokeOpacity={0.7}
              label={{
                value: `Ziel ${formatPrice(targetPrice, currency)}`,
                position: "insideBottomRight",
                fill: low,
                fontSize: 10,
              }}
            />
          )}
          <Area
            type="stepAfter"
            dataKey="price"
            stroke={ink}
            strokeWidth={2}
            fill="url(#priceFill)"
            dot={false}
            activeDot={{ r: 4, fill: ink }}
            isAnimationActive={false}
          />
          <ReferenceDot
            x={lowPoint.t}
            y={lowPoint.price}
            r={4}
            fill={low}
            stroke="#fff"
            strokeWidth={1.5}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
