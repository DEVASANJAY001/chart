import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
  LineSeries,
  type CandlestickData,
  type LineData,
  ColorType,
  type Time,
  type SeriesType,
  createSeriesMarkers,
} from "lightweight-charts";
import type { TradingSignal, SRLevel } from "@/lib/patternDetection";
import type { AdvancedTrendline } from "@/lib/trendlineEngine";

type ChartType = "candlestick" | "line";

export interface OHLCData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface NiftyChartProps {
  data: OHLCData[];
  chartType: ChartType;
  signals?: TradingSignal[];
  advancedTrendlines?: AdvancedTrendline[];
  srLevels?: SRLevel[];
  onSignalClick?: (signal: TradingSignal) => void;
}

export interface NiftyChartHandle {
  updateLastCandle: (price: number) => void;
  focusLatestCandles: (bars?: number) => void;
}

const NiftyChart = forwardRef<NiftyChartHandle, NiftyChartProps>(
  ({ data, chartType, signals = [], advancedTrendlines = [], srLevels = [], onSignalClick }, ref) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    const lastDataRef = useRef<OHLCData | null>(null);
    const overlaySeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
    const initialFocusDoneRef = useRef(false);

    const focusLatestRange = useCallback((bars = 120) => {
      if (!chartRef.current || data.length === 0) return;
      const to = data.length - 1;
      const from = Math.max(0, to - bars);
      chartRef.current.timeScale().setVisibleLogicalRange({ from, to: to + 2 });
      chartRef.current.priceScale("right").applyOptions({ autoScale: true });
      chartRef.current.timeScale().scrollToRealTime();
    }, [data.length]);

    useImperativeHandle(ref, () => ({
      updateLastCandle: (price: number) => {
        if (!seriesRef.current || !lastDataRef.current) return;
        const last = lastDataRef.current;
        const updated: OHLCData = {
          ...last,
          close: price,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
        };
        lastDataRef.current = updated;
        if (chartType === "candlestick") {
          seriesRef.current.update(updated as CandlestickData);
        } else {
          seriesRef.current.update({ time: updated.time, value: price } as LineData);
        }
      },
      focusLatestCandles: (bars = 120) => {
        focusLatestRange(bars);
      },
    }));

    // ── Effect 1: Chart instance creation (depends only on chartType) ──
    useEffect(() => {
      if (!chartContainerRef.current) return;
      const container = chartContainerRef.current;

      const chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "hsl(210, 20%, 55%)",
          fontFamily: "'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: "hsl(220, 14%, 14%)" },
          horzLines: { color: "hsl(220, 14%, 14%)" },
        },
        width: container.clientWidth,
        height: container.clientHeight,
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale: {
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true },
          mouseWheel: true,
          pinch: true,
        },
        crosshair: {
          vertLine: { color: "hsl(142, 60%, 45%)", width: 1, style: 2 },
          horzLine: { color: "hsl(142, 60%, 45%)", width: 1, style: 2 },
        },
        timeScale: {
          borderColor: "hsl(220, 14%, 18%)",
          timeVisible: true,
          secondsVisible: false,
          shiftVisibleRangeOnNewBar: true,
        },
        localization: {
          timeFormatter: (time: number) => {
            const d = new Date((time + 19800) * 1000);
            const h = d.getUTCHours().toString().padStart(2, "0");
            const m = d.getUTCMinutes().toString().padStart(2, "0");
            return `${h}:${m}`;
          },
        },
        rightPriceScale: { borderColor: "hsl(220, 14%, 18%)", autoScale: true },
      });

      chartRef.current = chart;
      initialFocusDoneRef.current = false;

      // Create main series
      let mainSeries: ISeriesApi<SeriesType>;
      if (chartType === "candlestick") {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: "hsl(142, 60%, 45%)",
          downColor: "hsl(0, 72%, 55%)",
          borderUpColor: "hsl(142, 60%, 45%)",
          borderDownColor: "hsl(0, 72%, 55%)",
          wickUpColor: "hsl(142, 60%, 45%)",
          wickDownColor: "hsl(0, 72%, 55%)",
        });
        mainSeries = series as unknown as ISeriesApi<SeriesType>;
      } else {
        const series = chart.addSeries(LineSeries, {
          color: "hsl(142, 60%, 45%)",
          lineWidth: 2,
        });
        mainSeries = series as unknown as ISeriesApi<SeriesType>;
      }
      seriesRef.current = mainSeries;

      const handleResize = () => {
        chart.applyOptions({ width: container.clientWidth });
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
        overlaySeriesRef.current = [];
        initialFocusDoneRef.current = false;
      };
    }, [chartType]);

    // ── Effect 2: Data & overlay updates (preserves zoom/scroll) ──
    useEffect(() => {
      const chart = chartRef.current;
      const mainSeries = seriesRef.current;
      if (!chart || !mainSeries || data.length === 0) return;

      // Save current visible time range before updating
      const savedRange = chart.timeScale().getVisibleRange();

      // Update main series data
      if (chartType === "candlestick") {
        mainSeries.setData(data as CandlestickData[]);
      } else {
        mainSeries.setData(data.map((d) => ({ time: d.time, value: d.close })) as LineData[]);
      }
      lastDataRef.current = data[data.length - 1];

      // ── Signal markers ──
      const allMarkers: Array<{
        time: Time;
        position: "belowBar" | "aboveBar";
        color: string;
        shape: "arrowUp" | "arrowDown" | "circle";
        text: string;
        size: number;
      }> = [];

      for (const sig of signals) {
        allMarkers.push({
          time: sig.time as unknown as Time,
          position: sig.direction === "bullish" ? "belowBar" : "aboveBar",
          color: "#FFD700", // Glowing Gold
          shape: sig.direction === "bullish" ? "arrowUp" : "arrowDown",
          text: `⚡ ${sig.pattern}`,
          size: 2,
        });
      }

      if (allMarkers.length > 0) {
        allMarkers.sort((a, b) => (a.time as number) - (b.time as number));
        createSeriesMarkers(mainSeries, allMarkers);
      }

      // ── Remove old overlay series ──
      for (const s of overlaySeriesRef.current) {
        chart.removeSeries(s);
      }
      overlaySeriesRef.current = [];

      // ── Support/Resistance horizontal lines ──
      for (const sr of srLevels) {
        const color = sr.type === "support" ? "hsla(210, 80%, 55%, 0.5)" : "hsla(330, 80%, 55%, 0.5)";
        const srSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: 1,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        const firstTime = data[0].time;
        const lastTime = data[data.length - 1].time;
        srSeries.setData([
          { time: firstTime, value: sr.price },
          { time: lastTime, value: sr.price },
        ] as LineData[]);
        overlaySeriesRef.current.push(srSeries as unknown as ISeriesApi<SeriesType>);
      }

      // ── Advanced Trendlines ──
      for (const tl of advancedTrendlines) {
        if (tl.points.length < 2) continue;

        let color: string;
        let lineWidth: 1 | 2 | 3 | 4 = tl.touches >= 3 ? 2 : 1;
        let lineStyle: number = 0;

        if (tl.type === "support") {
          color = tl.broken ? "hsla(142, 60%, 45%, 0.2)" : "hsl(142, 60%, 45%)";
        } else {
          color = tl.broken ? "hsla(0, 72%, 55%, 0.2)" : "hsl(0, 72%, 55%)";
        }

        if (tl.category.includes("horizontal")) {
          lineStyle = 2;
          lineWidth = 1;
        }

        const tlSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth,
          lineStyle,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        });

        const lineData: LineData[] = tl.points.map(p => ({
          time: p.time as unknown as Time,
          value: p.value
        }));

        // Extension
        if (tl.extended.time > tl.points[tl.points.length - 1].time) {
          lineData.push({
            time: tl.extended.time as unknown as Time,
            value: tl.extended.value
          });
        }

        tlSeries.setData(lineData);
        overlaySeriesRef.current.push(tlSeries as unknown as ISeriesApi<SeriesType>);
      }

      // ── Restore zoom/scroll or do initial focus ──
      if (savedRange && initialFocusDoneRef.current) {
        chart.timeScale().setVisibleRange(savedRange);
      } else {
        const to = data.length - 1;
        const from = Math.max(0, to - 120);
        chart.timeScale().setVisibleLogicalRange({ from, to: to + 2 });
        chart.timeScale().scrollToRealTime();
        initialFocusDoneRef.current = true;
      }
    }, [data, chartType, signals, advancedTrendlines, srLevels]);

    // ── Effect 3: Signal click handler ──
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart || !onSignalClick || signals.length === 0) return;

      const handler = (param: { time?: Time }) => {
        if (!param.time) return;
        const clickTime = param.time as number;
        const matched = signals.find((s) => s.time === clickTime);
        if (matched) onSignalClick(matched);
      };

      chart.subscribeClick(handler);
      return () => {
        chart.unsubscribeClick(handler);
      };
    }, [onSignalClick, signals]);

    return <div ref={chartContainerRef} className="w-full h-full" />;
  }
);

NiftyChart.displayName = "NiftyChart";

export default NiftyChart;
