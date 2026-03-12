import { useState, useEffect, useCallback, useRef } from "react";
import type { TradingSignal } from "@/lib/patternDetection";
import { TrendingUp, TrendingDown, Target, ShieldAlert, Loader2, RefreshCw } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface OptionQuote {
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  symbol: string;
  strike: number;
  type: string;
}

interface ContractRow {
  signal: TradingSignal;
  quote: OptionQuote | null;
  optionEntry: number | null;
  optionSL: number | null;
  optionT1: number | null;
  optionT2: number | null;
  optionT3: number | null;
}

interface ContractsTableProps {
  signals: TradingSignal[];
  onSignalClick?: (signal: TradingSignal) => void;
}

function formatTime(unix: number): string {
  const date = new Date((unix + 19800) * 1000);
  const h = date.getUTCHours().toString().padStart(2, "0");
  const m = date.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function calcOptionTargets(
  ltp: number,
  direction: "bullish" | "bearish",
  niftyEntry: number,
  niftySL: number,
  niftyT1: number,
  niftyT2: number,
  niftyT3: number
) {
  // Approximate option delta: ATM CE ~ 0.5, ATM PE ~ -0.5
  // Scale option targets proportionally to Nifty move
  const niftyRange = Math.abs(niftyT1 - niftyEntry);
  const niftySLRange = Math.abs(niftySL - niftyEntry);

  if (direction === "bullish") {
    // CE option: price moves ~50% of Nifty move for ATM
    const delta = 0.5;
    const slMove = niftySLRange * delta;
    const t1Move = niftyRange * delta;
    const t2Move = Math.abs(niftyT2 - niftyEntry) * delta;
    const t3Move = Math.abs(niftyT3 - niftyEntry) * delta;

    return {
      entry: ltp,
      sl: Math.max(0, Math.round((ltp - slMove) * 100) / 100),
      t1: Math.round((ltp + t1Move) * 100) / 100,
      t2: Math.round((ltp + t2Move) * 100) / 100,
      t3: Math.round((ltp + t3Move) * 100) / 100,
    };
  } else {
    // PE option: price moves ~50% of Nifty inverse move
    const delta = 0.5;
    const slMove = niftySLRange * delta;
    const t1Move = niftyRange * delta;
    const t2Move = Math.abs(niftyT2 - niftyEntry) * delta;
    const t3Move = Math.abs(niftyT3 - niftyEntry) * delta;

    return {
      entry: ltp,
      sl: Math.max(0, Math.round((ltp - slMove) * 100) / 100),
      t1: Math.round((ltp + t1Move) * 100) / 100,
      t2: Math.round((ltp + t2Move) * 100) / 100,
      t3: Math.round((ltp + t3Move) * 100) / 100,
    };
  }
}

const ContractsTable = ({ signals, onSignalClick }: ContractsTableProps) => {
  const [quotes, setQuotes] = useState<Record<string, OptionQuote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Build unique contract keys from signals
  const contractKeys = signals
    .filter((s) => s.option)
    .map((s) => `${s.option!.strike}${s.option!.type}`)
    .filter((v, i, a) => a.indexOf(v) === i);

  const fetchOptionQuotes = useCallback(async () => {
    if (contractKeys.length === 0) return;

    try {
      const url = `${supabaseUrl}/functions/v1/kite-option-quote?contracts=${contractKeys.join(",")}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to fetch option quotes");
      }

      const json = await response.json();
      if (json.data) {
        setQuotes(json.data);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    }
  }, [contractKeys.join(",")]);

  useEffect(() => {
    if (contractKeys.length === 0) return;

    setLoading(true);
    fetchOptionQuotes().finally(() => setLoading(false));

    // Poll every 2 seconds
    intervalRef.current = window.setInterval(fetchOptionQuotes, 2000);

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [fetchOptionQuotes]);

  // Build rows with live data
  const rows: ContractRow[] = signals.map((sig) => {
    const key = sig.option ? `${sig.option.strike}${sig.option.type}` : "";
    const quote = key ? quotes[key] || null : null;

    let optionEntry = null,
      optionSL = null,
      optionT1 = null,
      optionT2 = null,
      optionT3 = null;

    if (quote && sig.option) {
      const targets = calcOptionTargets(
        quote.ltp,
        sig.direction,
        sig.entry,
        sig.stopLoss,
        sig.target1,
        sig.target2,
        sig.target3
      );
      optionEntry = targets.entry;
      optionSL = targets.sl;
      optionT1 = targets.t1;
      optionT2 = targets.t2;
      optionT3 = targets.t3;
    }

    return { signal: sig, quote, optionEntry, optionSL, optionT1, optionT2, optionT3 };
  });

  if (signals.length === 0) return null;

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden mt-4">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Target className="w-4 h-4 text-yellow-400" />
        <h2 className="text-sm font-mono font-bold text-foreground">
          Live Option Contracts
        </h2>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {!loading && contractKeys.length > 0 && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-chart-green opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-chart-green"></span>
          </span>
        )}
        {error && (
          <span className="text-xs font-mono text-chart-red ml-2">{error}</span>
        )}
        <span className="text-xs font-mono bg-secondary text-muted-foreground px-2 py-0.5 rounded ml-auto">
          {signals.length} signal{signals.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">Time</TableHead>
              <TableHead className="font-mono text-xs">Pattern</TableHead>
              <TableHead className="font-mono text-xs">Direction</TableHead>
              <TableHead className="font-mono text-xs">Contract</TableHead>
              <TableHead className="font-mono text-xs text-right">LTP</TableHead>
              <TableHead className="font-mono text-xs text-right">Entry</TableHead>
              <TableHead className="font-mono text-xs text-right">Stop Loss</TableHead>
              <TableHead className="font-mono text-xs text-right">T1</TableHead>
              <TableHead className="font-mono text-xs text-right">T2</TableHead>
              <TableHead className="font-mono text-xs text-right">T3</TableHead>
              <TableHead className="font-mono text-xs text-center">Conf.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ signal: sig, quote, optionEntry, optionSL, optionT1, optionT2, optionT3 }) => {
              const isBullish = sig.direction === "bullish";
              const hasQuote = quote !== null;
              const changePositive = quote ? quote.change >= 0 : false;

              return (
                <TableRow
                  key={sig.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => onSignalClick?.(sig)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatTime(sig.time)}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-foreground">
                    {sig.pattern}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-mono font-semibold px-2 py-0.5 rounded ${
                        isBullish
                          ? "bg-chart-green/15 text-chart-green"
                          : "bg-chart-red/15 text-chart-red"
                      }`}
                    >
                      {isBullish ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {sig.direction.toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell>
                    {sig.option ? (
                      <div className="flex flex-col">
                        <span
                          className={`font-mono text-xs font-bold ${
                            isBullish ? "text-chart-green" : "text-chart-red"
                          }`}
                        >
                          {sig.option.symbol}
                        </span>
                        {hasQuote && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            Vol: {quote.volume.toLocaleString("en-IN")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right">
                    {hasQuote ? (
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-foreground">
                          ₹{quote.ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </span>
                        <span
                          className={`text-[10px] ${
                            changePositive ? "text-chart-green" : "text-chart-red"
                          }`}
                        >
                          {changePositive ? "+" : ""}
                          {quote.change.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right font-semibold text-foreground">
                    {optionEntry !== null
                      ? `₹${optionEntry.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                      : `₹${sig.entry.toLocaleString("en-IN")}`}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right font-semibold text-chart-red">
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" />
                      {optionSL !== null
                        ? `₹${optionSL.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                        : `₹${sig.stopLoss.toLocaleString("en-IN")}`}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right text-chart-green">
                    {optionT1 !== null
                      ? `₹${optionT1.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                      : `₹${sig.target1.toLocaleString("en-IN")}`}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right text-chart-green">
                    {optionT2 !== null
                      ? `₹${optionT2.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                      : `₹${sig.target2.toLocaleString("en-IN")}`}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right text-chart-green">
                    {optionT3 !== null
                      ? `₹${optionT3.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                      : `₹${sig.target3.toLocaleString("en-IN")}`}
                  </TableCell>
                  <TableCell className="text-center">
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        sig.confidence >= 85
                          ? "bg-chart-green/15 text-chart-green"
                          : sig.confidence >= 78
                          ? "bg-yellow-500/15 text-yellow-400"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {sig.confidence}%
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="px-4 py-2 border-t border-border">
        <p className="text-[10px] font-mono text-muted-foreground">
          Option targets calculated using ~0.5 delta (ATM). Entry = current LTP. SL & targets scaled from Nifty S/R levels. Refreshing every 2s.
        </p>
      </div>
    </div>
  );
};

export default ContractsTable;
