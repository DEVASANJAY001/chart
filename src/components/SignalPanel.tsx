import type { TradingSignal } from "@/lib/patternDetection";
import { X, TrendingUp, TrendingDown, Target, ShieldAlert, BarChart3 } from "lucide-react";

interface SignalPanelProps {
  signal: TradingSignal;
  onClose: () => void;
}

const SignalPanel = ({ signal, onClose }: SignalPanelProps) => {
  const isBullish = signal.direction === "bullish";

  return (
    <div className="absolute top-4 right-4 z-50 w-80 bg-card border border-border rounded-lg shadow-2xl overflow-hidden animate-in slide-in-from-right-5 duration-200">
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${isBullish ? "bg-chart-green/10" : "bg-chart-red/10"}`}>
        <div className="flex items-center gap-2">
          {isBullish ? (
            <TrendingUp className="w-4 h-4 text-chart-green" />
          ) : (
            <TrendingDown className="w-4 h-4 text-chart-red" />
          )}
          <span className="font-mono font-bold text-sm text-foreground">
            {signal.pattern}
          </span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Direction & Confidence */}
        <div className="flex items-center justify-between">
          <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${isBullish ? "bg-chart-green/15 text-chart-green" : "bg-chart-red/15 text-chart-red"}`}>
            {signal.direction.toUpperCase()}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            Confidence: <span className="text-foreground font-semibold">{signal.confidence}%</span>
          </span>
        </div>

        {/* Option Contract */}
        {signal.option && (
          <div className={`rounded-md p-2.5 border ${isBullish ? "border-chart-green/20 bg-chart-green/5" : "border-chart-red/20 bg-chart-red/5"}`}>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-xs font-mono font-semibold text-yellow-400">OPTION TRADE</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">Contract</span>
              <span className={`text-sm font-mono font-bold ${isBullish ? "text-chart-green" : "text-chart-red"}`}>
                {signal.option.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs font-mono text-muted-foreground">Action</span>
              <span className="text-xs font-mono font-semibold text-foreground">
                BUY {signal.option.type}
              </span>
            </div>
          </div>
        )}

        {/* Entry & SL */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
              <Target className="w-3 h-3" /> Entry
            </span>
            <span className="text-sm font-mono font-bold text-foreground">₹{signal.entry.toLocaleString("en-IN")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-chart-red flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Stop Loss
            </span>
            <span className="text-sm font-mono font-semibold text-chart-red">₹{signal.stopLoss.toLocaleString("en-IN")}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5 mt-1.5">
            <span className="text-xs font-mono text-muted-foreground">Risk/Reward</span>
            <span className="text-xs font-mono font-bold text-yellow-400">
              {(() => {
                const risk = Math.abs(signal.entry - signal.stopLoss);
                const reward = Math.abs(signal.target3 - signal.entry);
                return `1:${(reward / risk).toFixed(1)}`;
              })()}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1">
          <span>{new Date(signal.time * 1000).toLocaleTimeString()}</span>
          <span>Conf: {signal.confidence}%</span>
        </div>

        {/* Targets */}
        <div className="border-t border-border pt-2 space-y-1.5">
          <span className="text-xs font-mono text-muted-foreground">Targets (based on S/R)</span>
          {[
            { label: "T1", value: signal.target1 },
            { label: "T2", value: signal.target2 },
            { label: "T3", value: signal.target3 },
          ].map((t) => (
            <div key={t.label} className="flex items-center justify-between">
              <span className="text-xs font-mono text-chart-green">{t.label}</span>
              <span className="text-sm font-mono font-semibold text-chart-green">₹{t.value.toLocaleString("en-IN")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SignalPanel;
