import { useState, useEffect, useRef } from "react";
import StandaloneChart, { type StandaloneChartHandle, type OHLCData } from "@/components/StandaloneChart";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";
import { CandlestickChart, TrendingUp, Loader2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Time } from "lightweight-charts";

type ChartType = "candlestick" | "line";
type TimeInterval = "minute" | "5minute" | "15minute";

const intervalOptions: { label: string; value: TimeInterval }[] = [
  { label: "1m", value: "minute" },
  { label: "5m", value: "5minute" },
  { label: "15m", value: "15minute" },
];

function getDaysBack(interval: TimeInterval): number {
  switch (interval) {
    case "minute": return 5;
    case "5minute": return 15;
    case "15minute": return 30;
  }
}

function parseExchangeTimestamp(timestamp: string): Date {
  const normalized = timestamp.trim().replace(" ", "T");
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) return new Date(normalized);
  return new Date(`${normalized}+05:30`);
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const ChartView = () => {
  const navigate = useNavigate();
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [interval, setInterval_] = useState<TimeInterval>("5minute");
  const [data, setData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const chartRef = useRef<StandaloneChartHandle>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const daysBack = getDaysBack(interval);
      const from = format(subDays(new Date(), daysBack), "yyyy-MM-dd HH:mm:ss");
      const to = format(new Date(), "yyyy-MM-dd HH:mm:ss");

      try {
        const url = `${supabaseUrl}/functions/v1/kite-historical?interval=${interval}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&instrument=NIFTY`;
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
          },
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to fetch data");
        }

        const json = await response.json();

        if (json.data?.candles) {
          const candles: OHLCData[] = json.data.candles.map(
            (c: [string, number, number, number, number, number]) => ({
              time: Math.floor(parseExchangeTimestamp(c[0]).getTime() / 1000) as unknown as Time,
              open: c[1],
              high: c[2],
              low: c[3],
              close: c[4],
            })
          );
          setData(candles);
          if (candles.length > 0) {
            const last = candles[candles.length - 1];
            const first = candles[0];
            setLastPrice(last.close);
            setPriceChange(((last.close - first.open) / first.open) * 100);
          }
        } else {
          throw new Error("Unexpected response format");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [interval]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold font-mono">NIFTY 50 — Standalone Chart</h1>
          {lastPrice !== null && (
            <span className={`text-sm font-mono ${priceChange && priceChange >= 0 ? "text-green-500" : "text-red-500"}`}>
              {lastPrice.toFixed(2)} ({priceChange !== null ? `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%` : ""})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Interval selector */}
          {intervalOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={interval === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setInterval_(opt.value)}
            >
              {opt.label}
            </Button>
          ))}

          {/* Chart type toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setChartType(chartType === "candlestick" ? "line" : "candlestick")}
          >
            {chartType === "candlestick" ? <TrendingUp className="h-4 w-4" /> : <CandlestickChart className="h-4 w-4" />}
          </Button>

          {/* Focus latest */}
          <Button variant="outline" size="sm" onClick={() => chartRef.current?.focusLatestCandles(120)}>
            Latest
          </Button>
        </div>
      </header>

      {/* Chart area */}
      <div className="flex-1 relative min-h-0" style={{ height: 'calc(100vh - 57px)' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <p className="text-destructive font-mono text-sm">{error}</p>
          </div>
        )}
        <StandaloneChart ref={chartRef} data={data} chartType={chartType} />
      </div>
    </div>
  );
};

export default ChartView;
