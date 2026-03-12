import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from "react";
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

type ChartType = "candlestick" | "line";

export interface OHLCData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartMarker {
  time: Time;
  position: "belowBar" | "aboveBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
  size?: number;
}

export interface ChartOverlayLine {
  id: string;
  points: { time: Time; value: number }[];
  color: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: number; // 0=solid, 1=dotted, 2=dashed
  lastValueVisible?: boolean;
}

interface StandaloneChartProps {
  data: OHLCData[];
  chartType: ChartType;
  markers?: ChartMarker[];
  overlayLines?: ChartOverlayLine[];
  initialVisibleBars?: number;
  onTimeClick?: (time: Time) => void;
}

export interface StandaloneChartHandle {
  updateLastCandle: (price: number) => void;
  focusLatestCandles: (bars?: number) => void;
  getChart: () => IChartApi | null;
}

const EMPTY_MARKERS: ChartMarker[] = [];
const EMPTY_OVERLAY_LINES: ChartOverlayLine[] = [];

const StandaloneChart = forwardRef<StandaloneChartHandle, StandaloneChartProps>(
  ({ data, chartType, markers, overlayLines, initialVisibleBars = 120, onTimeClick }, ref) => {
    const stableMarkers = useMemo(() => markers ?? EMPTY_MARKERS, [markers]);
    const stableOverlayLines = useMemo(() => overlayLines ?? EMPTY_OVERLAY_LINES, [overlayLines]);
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
      focusLatestCandles: (bars = 120) => focusLatestRange(bars),
      getChart: () => chartRef.current,
    }));

    // ── Effect 1: Chart instance creation ──
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
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
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

      const savedRange = chart.timeScale().getVisibleRange();

      if (chartType === "candlestick") {
        mainSeries.setData(data as CandlestickData[]);
      } else {
        mainSeries.setData(data.map((d) => ({ time: d.time, value: d.close })) as LineData[]);
      }
      lastDataRef.current = data[data.length - 1];

      // Markers
      if (stableMarkers.length > 0) {
        const sorted = [...stableMarkers].sort((a, b) => (a.time as number) - (b.time as number));
        createSeriesMarkers(mainSeries, sorted.map(m => ({ ...m, size: m.size ?? 2 })));
      }

      // Remove old overlays
      for (const s of overlaySeriesRef.current) {
        chart.removeSeries(s);
      }
      overlaySeriesRef.current = [];

      // Add overlay lines
      for (const line of stableOverlayLines) {
        if (line.points.length < 2) continue;
        const lineSeries = chart.addSeries(LineSeries, {
          color: line.color,
          lineWidth: line.lineWidth ?? 2,
          lineStyle: line.lineStyle ?? 0,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: line.lastValueVisible ?? false,
        });
        lineSeries.setData(line.points.map(p => ({ time: p.time, value: p.value })) as LineData[]);
        overlaySeriesRef.current.push(lineSeries as unknown as ISeriesApi<SeriesType>);
      }

      // Restore zoom/scroll
      if (savedRange && initialFocusDoneRef.current) {
        chart.timeScale().setVisibleRange(savedRange);
      } else {
        const to = data.length - 1;
        const from = Math.max(0, to - initialVisibleBars);
        chart.timeScale().setVisibleLogicalRange({ from, to: to + 2 });
        chart.timeScale().scrollToRealTime();
        initialFocusDoneRef.current = true;
      }
    }, [data, chartType, stableMarkers, stableOverlayLines, initialVisibleBars]);

    // ── Effect 3: Click handler ──
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart || !onTimeClick) return;

      const handler = (param: { time?: Time }) => {
        if (param.time) onTimeClick(param.time);
      };

      chart.subscribeClick(handler);
      return () => chart.unsubscribeClick(handler);
    }, [onTimeClick]);

    return <div ref={chartContainerRef} className="w-full h-full" />;
  }
);

StandaloneChart.displayName = "StandaloneChart";

export default StandaloneChart;
