import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import NiftyChart, { type NiftyChartHandle, type OHLCData } from "@/components/NiftyChart";
import SignalPanel from "@/components/SignalPanel";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";
import { CandlestickChart, TrendingUp, Loader2, Wifi, WifiOff, Settings, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Time } from "lightweight-charts";
import { scanForSignals, detectSRLevels, type TradingSignal, type SRLevel } from "@/lib/patternDetection";
import { detectAdvancedTrendlines, detectTrendlineSignals, type AdvancedTrendline } from "@/lib/trendlineEngine";
import ContractsTable from "@/components/ContractsTable";

type ChartType = "candlestick" | "line";
type TimeInterval = "minute" | "5minute" | "15minute";
type Instrument = "NIFTY" | "SENSEX";

const QUOTE_KEYS: Record<Instrument, string> = {
  NIFTY: "NSE:NIFTY 50",
  SENSEX: "BSE:SENSEX",
};

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

  // If timestamp already includes timezone, native parsing is enough
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    return new Date(normalized);
  }

  // Exchange timestamp is IST when timezone is omitted
  return new Date(`${normalized}+05:30`);
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const Index = () => {
  const navigate = useNavigate();
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [interval, setInterval_] = useState<TimeInterval>("5minute");
  const [instrument, setInstrument] = useState<Instrument>("NIFTY");
  const [data, setData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showSignals, setShowSignals] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<TradingSignal | null>(null);

  const handleSignalClick = useCallback((sig: TradingSignal) => {
    setSelectedSignal(sig);
  }, []);
  const chartRef = useRef<NiftyChartHandle>(null);
  const firstOpenRef = useRef<number | null>(null);
  const pendingAutoZoomRef = useRef(false);

  // Compute advanced trendlines
  const advancedTrendlines: AdvancedTrendline[] = useMemo(() => {
    if (data.length < 20) return [];
    return detectAdvancedTrendlines(data);
  }, [data]);

  // Convert to legacy format for pattern detection compatibility
  const legacyTrendlines = useMemo(() => {
    return advancedTrendlines.map(tl => ({
      id: tl.id,
      type: tl.type,
      points: tl.points.map(p => ({ time: p.time, value: p.value })),
      slope: tl.slope,
      intercept: tl.intercept,
    }));
  }, [advancedTrendlines]);

  const srLevels: SRLevel[] = useMemo(() => {
    if (data.length < 30) return [];
    return detectSRLevels(data);
  }, [data]);

  const signals: TradingSignal[] = useMemo(() => {
    if (!showSignals || data.length < 30) return [];
    const patternSignals = scanForSignals(data, legacyTrendlines, srLevels);

    // Also add trendline breakout/retest signals
    const tlSignals = detectTrendlineSignals(data, advancedTrendlines);
    for (const tls of tlSignals) {
      // Avoid duplicates
      if (patternSignals.some(ps => Math.abs(ps.candleIndex - tls.index) < 3)) continue;
      const atr = data[tls.index].high - data[tls.index].low;
      const entry = data[tls.index].close;
      const strikeInterval = instrument === "SENSEX" ? 100 : 50;
      const atmStrike = Math.round(entry / strikeInterval) * strikeInterval;

      patternSignals.push({
        id: `tl-${tls.index}-${tls.trendlineId}`,
        time: tls.time,
        candleIndex: tls.index,
        pattern: tls.pattern,
        direction: tls.direction,
        confidence: tls.confidence,
        entry: Math.round(entry * 100) / 100,
        stopLoss: Math.round(tls.direction === "bullish" ? entry - atr * 1.5 : entry + atr * 1.5),
        target1: Math.round(tls.direction === "bullish" ? entry + atr * 1.5 : entry - atr * 1.5),
        target2: Math.round(tls.direction === "bullish" ? entry + atr * 2.5 : entry - atr * 2.5),
        target3: Math.round(tls.direction === "bullish" ? entry + atr * 3.5 : entry - atr * 3.5),
        option: {
          type: tls.direction === "bullish" ? "CE" : "PE",
          strike: atmStrike,
          symbol: `${instrument === "SENSEX" ? "SENSEX" : "NIFTY"} ${atmStrike} ${tls.direction === "bullish" ? "CE" : "PE"}`,
        },
      });
    }

    return patternSignals;
  }, [data, legacyTrendlines, srLevels, showSignals, advancedTrendlines, instrument]);

  // Fetch historical data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setSelectedSignal(null);

      const daysBack = getDaysBack(interval);
      const from = format(subDays(new Date(), daysBack), "yyyy-MM-dd HH:mm:ss");
      const to = format(new Date(), "yyyy-MM-dd HH:mm:ss");

      try {
        const url = `${supabaseUrl}/functions/v1/kite-historical?interval=${interval}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&instrument=${instrument}`;

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

        if (json.data && json.data.candles) {
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
          pendingAutoZoomRef.current = true;
          firstOpenRef.current = candles.length > 0 ? candles[0].open : null;

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
  }, [interval, instrument]);

  // Helper: get the candle bucket timestamp for a given date
  const getCandleBucket = useCallback((date: Date): number => {
    const intervalSeconds = interval === "minute" ? 60 : interval === "5minute" ? 300 : 900;
    return Math.floor(date.getTime() / 1000 / intervalSeconds) * intervalSeconds;
  }, [interval]);

  const lastCandleBucketRef = useRef<number | null>(null);

  // Keep lastCandleBucket in sync with data
  useEffect(() => {
    if (data.length > 0) {
      const lastTime = data[data.length - 1].time as unknown as number;
      lastCandleBucketRef.current = getCandleBucket(new Date(lastTime * 1000));
    }
  }, [data, getCandleBucket]);

  useEffect(() => {
    if (!pendingAutoZoomRef.current || data.length === 0 || loading) return;

    const frame = window.requestAnimationFrame(() => {
      chartRef.current?.focusLatestCandles(interval === "minute" ? 100 : 120);
      pendingAutoZoomRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [data, interval, loading]);

  // Real-time quote polling every second
  const fetchQuote = useCallback(async () => {
    try {
      const url = `${supabaseUrl}/functions/v1/kite-quote?instrument=${instrument}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
      });

      if (!response.ok) return;

      const json = await response.json();
      const quoteKey = QUOTE_KEYS[instrument];
      const quote = json.data?.[quoteKey];

      if (quote) {
        const ltp = quote.last_price;
        setLastPrice(ltp);
        setLastUpdated(new Date());

        if (firstOpenRef.current !== null) {
          setPriceChange(((ltp - firstOpenRef.current) / firstOpenRef.current) * 100);
        }

        const quoteTimestamp = typeof quote.timestamp === "string" ? parseExchangeTimestamp(quote.timestamp) : new Date();
        const currentBucket = getCandleBucket(quoteTimestamp);
        const lastBucket = lastCandleBucketRef.current;

        if (lastBucket !== null && currentBucket > lastBucket) {
          // New candle period — append a new candle
          const newCandle: OHLCData = {
            time: currentBucket as unknown as Time,
            open: ltp,
            high: ltp,
            low: ltp,
            close: ltp,
          };
          lastCandleBucketRef.current = currentBucket;
          setData(prev => [...prev, newCandle]);
        } else {
          // Same candle period — just update the chart visually (no state update to avoid full rebuild)
          chartRef.current?.updateLastCandle(ltp);
        }
      }
    } catch {
      // Silently fail for polling
    }
  }, [instrument, getCandleBucket]);

  useEffect(() => {
    if (!isLive || loading || error) return;

    const timer = window.setInterval(fetchQuote, 1000);
    fetchQuote();

    return () => window.clearInterval(timer);
  }, [isLive, loading, error, fetchQuote]);

  const isPositive = priceChange !== null && priceChange >= 0;
  const intervalLabel = interval === "minute" ? "1-min" : interval === "5minute" ? "5-min" : "15-min";

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            {/* Instrument Selector */}
            <div className="flex gap-1 bg-secondary rounded p-0.5">
              {(["NIFTY", "SENSEX"] as Instrument[]).map((inst) => (
                <button
                  key={inst}
                  onClick={() => setInstrument(inst)}
                  className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${instrument === inst
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {inst === "NIFTY" ? "NIFTY 50" : "SENSEX"}
                </button>
              ))}
            </div>
            <span className="text-xs font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded">
              {instrument === "NIFTY" ? "NSE" : "BSE"}
            </span>
            <button
              onClick={() => navigate("/settings")}
              className="ml-auto p-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsLive(!isLive)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono transition-colors ${isLive
                ? "bg-chart-green/15 text-chart-green"
                : "bg-secondary text-muted-foreground"
                }`}
              title={isLive ? "Live updates ON" : "Live updates OFF"}
            >
              {isLive ? (
                <>
                  <Wifi className="w-3 h-3" />
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-chart-green opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-chart-green"></span>
                  </span>
                  LIVE
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  PAUSED
                </>
              )}
            </button>
          </div>
          {lastPrice !== null && (
            <div className="flex items-baseline gap-3">
              <span className="text-3xl md:text-4xl font-bold text-foreground font-mono">
                ₹{lastPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              <span
                className={`text-sm font-mono font-semibold ${isPositive ? "text-chart-green" : "text-chart-red"
                  }`}
              >
                {isPositive ? "+" : ""}
                {priceChange?.toFixed(2)}%
              </span>
              {lastUpdated && (
                <span className="text-xs font-mono text-muted-foreground">
                  {format(lastUpdated, "HH:mm:ss")}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {intervalOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInterval_(opt.value)}
                  className={`px-3 py-1.5 text-xs font-mono rounded transition-colors ${interval === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex gap-1 bg-secondary rounded p-0.5">
              <button
                onClick={() => setShowSignals(!showSignals)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono rounded transition-colors ${showSignals ? "bg-yellow-500/20 text-yellow-500 border border-yellow-500/30" : "text-muted-foreground"
                  }`}
                title="Toggle Signals"
              >
                <Zap className="w-3 h-3" /> SIGNALS
              </button>
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono rounded transition-colors bg-secondary text-primary border border-primary/20`}
                title="Trendlines are automatic"
              >
                TRENDLINES
              </button>
              <button
                onClick={() => chartRef.current?.focusLatestCandles()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                title="Zoom to latest price"
              >
                <TrendingUp className="w-3 h-3" /> FOCUS
              </button>
            </div>
          </div>

          <div className="flex gap-1 bg-secondary rounded p-0.5">
            <button
              onClick={() => setChartType("candlestick")}
              className={`p-2 rounded transition-colors ${chartType === "candlestick"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
                }`}
              title="Candlestick"
            >
              <CandlestickChart className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType("line")}
              className={`p-2 rounded transition-colors ${chartType === "line"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
                }`}
              title="Line"
            >
              <TrendingUp className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Trendline Summary */}
        {advancedTrendlines.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {advancedTrendlines.map((tl) => (
              <span
                key={tl.id}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${tl.type === "support"
                  ? "border-chart-green/30 bg-chart-green/10 text-chart-green"
                  : "border-chart-red/30 bg-chart-red/10 text-chart-red"
                  } ${tl.broken ? "line-through opacity-60" : ""}`}
              >
                {tl.category.replace(/_/g, " ")} ({tl.touches} touches)
                {tl.broken && " ⚡"}
                {tl.retested && " ✓ retest"}
              </span>
            ))}
          </div>
        )}

        {/* Chart */}
        <div className="bg-card rounded-lg border border-border overflow-hidden relative">
          <div className="h-[500px] md:h-[600px]">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="text-chart-red font-mono text-sm">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInterval_(interval)}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <NiftyChart
                ref={chartRef}
                data={data}
                chartType={chartType}
                signals={showSignals ? signals : []}
                advancedTrendlines={advancedTrendlines}
                srLevels={srLevels}
                onSignalClick={handleSignalClick}
              />
            )}
          </div>
          {selectedSignal && (
            <SignalPanel
              signal={selectedSignal}
              onClose={() => setSelectedSignal(null)}
            />
          )}
        </div>

        {/* Contracts Table */}
        {showSignals && (
          <ContractsTable signals={signals} onSignalClick={handleSignalClick} />
        )}

        <p className="text-xs text-muted-foreground font-mono mt-3 text-center">
          Data via Kite Connect • {isLive ? "Live updates every 1s" : "Paused"} • {intervalLabel} candles • IST
          {showSignals && signals.length > 0 && ` • ${signals.length} signals detected`}
          {advancedTrendlines.length > 0 && ` • ${advancedTrendlines.length} trendlines`}
        </p>
      </div>
    </div>
  );
};

export default Index;
