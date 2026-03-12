import type { OHLCData } from "@/components/NiftyChart";

// ── Types ──

export interface SwingPoint {
  index: number;
  value: number;
  time: number;
  type: "high" | "low";
}

export interface AdvancedTrendline {
  id: string;
  type: "support" | "resistance";
  category: "uptrend" | "downtrend" | "horizontal_support" | "horizontal_resistance" | "channel_upper" | "channel_lower";
  points: { time: number; value: number; index: number }[];
  slope: number;
  intercept: number;
  touches: number;
  strength: number; // 0-100
  extended: { time: number; value: number }; // projected future point
  broken: boolean;
  breakoutIndex?: number;
  retested: boolean;
  retestIndex?: number;
}

export interface TrendlineBreakoutSignal {
  index: number;
  time: number;
  direction: "bullish" | "bearish";
  pattern: string;
  confidence: number;
  trendlineId: string;
}

// ── Helpers ──

function getTime(d: OHLCData): number {
  return typeof d.time === "number" ? (d.time as number) : 0;
}

// ── Swing Point Detection (2-candle lookback as specified) ──
export function detectSwingPoints(data: OHLCData[], lookback: number = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  const minMove = calculateMinMove(data);

  for (let i = lookback; i < data.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (data[i].high <= data[i - j].high || data[i].high <= data[i + j].high) isSwingHigh = false;
      if (data[i].low >= data[i - j].low || data[i].low >= data[i + j].low) isSwingLow = false;
    }

    // Filter noise: only major swings
    if (isSwingHigh) {
      const surroundingAvg = (data[i - 1].high + data[i + 1].high) / 2;
      if (data[i].high - surroundingAvg > minMove) {
        swings.push({ index: i, value: data[i].high, time: getTime(data[i]), type: "high" });
      }
    }
    if (isSwingLow) {
      const surroundingAvg = (data[i - 1].low + data[i + 1].low) / 2;
      if (surroundingAvg - data[i].low > minMove) {
        swings.push({ index: i, value: data[i].low, time: getTime(data[i]), type: "low" });
      }
    }
  }
  return swings;
}

function calculateMinMove(data: OHLCData[]): number {
  if (data.length < 20) return 0;
  let totalRange = 0;
  const start = Math.max(0, data.length - 50);
  const count = data.length - start;
  for (let i = start; i < data.length; i++) {
    totalRange += data[i].high - data[i].low;
  }
  return (totalRange / count) * 0.05; // Very low threshold to catch more swings
}

// ── Fit line through two points and count touches ──
function countTouches(
  swings: SwingPoint[],
  p1: SwingPoint,
  p2: SwingPoint,
  tolerance: number
): SwingPoint[] {
  if (p2.index === p1.index) return [];
  const slope = (p2.value - p1.value) / (p2.index - p1.index);
  const touches: SwingPoint[] = [];

  for (const s of swings) {
    const expected = p1.value + slope * (s.index - p1.index);
    if (Math.abs(s.value - expected) / expected < tolerance) {
      touches.push(s);
    }
  }
  return touches;
}

// ── Advanced Trendline Detection ──
export function detectAdvancedTrendlines(data: OHLCData[]): AdvancedTrendline[] {
  if (data.length < 20) return [];

  const swings = detectSwingPoints(data, 2);
  const highs = swings.filter(s => s.type === "high");
  const lows = swings.filter(s => s.type === "low");
  const trendlines: AdvancedTrendline[] = [];
  const tolerance = 0.003; // 0.3% - tighter tolerance for premium feel
  const lastIdx = data.length - 1;
  const lastTime = getTime(data[lastIdx]);

  // Support & Resistance Trendlines
  const detectLines = (points: SwingPoint[], type: "support" | "resistance") => {
    for (let i = 0; i < points.length - 1; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const p1 = points[i], p2 = points[j];
        if (p2.index - p1.index < 5) continue; // Minimum distance

        const slope = (p2.value - p1.value) / (p2.index - p1.index);
        
        // Directional rules
        if (type === "support" && slope < -0.8) continue;
        if (type === "resistance" && slope > 0.8) continue;

        const touches = countTouches(points, p1, p2, tolerance);
        if (touches.length >= 2) {
          const timeSlope = p2.time !== p1.time ? (p2.value - p1.value) / (p2.time - p1.time) : 0;
          const extTime = lastTime + (lastTime - p2.time) * 0.5; // Project forward
          const extValue = p2.value + timeSlope * (extTime - p2.time);

          let category: AdvancedTrendline["category"];
          const absSlope = Math.abs(slope);
          
          if (absSlope < 0.01) {
            category = type === "support" ? "horizontal_support" : "horizontal_resistance";
          } else {
            category = type === "support" ? "uptrend" : "downtrend";
          }

          const strength = Math.min(100, touches.length * 20 + (touches.length >= 3 ? 30 : 0));

          trendlines.push({
            id: `${type}-${i}-${j}`,
            type,
            category,
            points: touches.map(t => ({ time: t.time, value: t.value, index: t.index })),
            slope: timeSlope,
            intercept: p1.value - timeSlope * p1.time,
            touches: touches.length,
            strength,
            extended: { time: extTime, value: extValue },
            broken: false,
            retested: false,
          });
          break; // Avoid too many overlapping lines from same origin
        }
      }
    }
  };

  detectLines(lows, "support");
  detectLines(highs, "resistance");

  // ── Channel Detection ──
  // If we have a support and resistance roughly parallel
  for (let i = 0; i < trendlines.length; i++) {
    for (let j = i + 1; j < trendlines.length; j++) {
      const t1 = trendlines[i], t2 = trendlines[j];
      if (t1.type === t2.type) continue;
      
      const slopeDiff = Math.abs(t1.slope - t2.slope) / Math.abs((t1.slope + t2.slope) / 2 || 1);
      if (slopeDiff < 0.2) { // Roughly parallel
        if (t1.type === "support") t1.category = t1.slope > 0 ? "uptrend" : "channel_lower";
        if (t2.type === "resistance") t2.category = t2.slope < 0 ? "downtrend" : "channel_upper";
      }
    }
  }

  // ── Breakout & Retest Detection ──
  for (const tl of trendlines) {
    if (tl.points.length < 2) continue;
    const lastPoint = tl.points[tl.points.length - 1];

    for (let k = lastPoint.index + 1; k <= lastIdx; k++) {
      const expectedValue = lastPoint.value + tl.slope * (getTime(data[k]) - lastPoint.time);

      if (tl.type === "resistance" && data[k].close > expectedValue * 1.001) {
        tl.broken = true;
        tl.breakoutIndex = k;
        break;
      }
      if (tl.type === "support" && data[k].close < expectedValue * 0.999) {
        tl.broken = true;
        tl.breakoutIndex = k;
        break;
      }
    }

    if (tl.broken && tl.breakoutIndex !== undefined) {
      for (let k = tl.breakoutIndex + 1; k <= lastIdx; k++) {
        const expectedValue = lastPoint.value + tl.slope * (getTime(data[k]) - lastPoint.time);
        const retestTolerance = Math.abs(expectedValue * 0.0015);

        if (Math.abs(data[k].low - expectedValue) < retestTolerance || Math.abs(data[k].high - expectedValue) < retestTolerance) {
          if (k + 1 <= lastIdx) {
            const nextCandle = data[k + 1];
            if (tl.type === "resistance" && nextCandle.close > expectedValue) {
              tl.retested = true;
              tl.retestIndex = k;
              break;
            }
            if (tl.type === "support" && nextCandle.close < expectedValue) {
              tl.retested = true;
              tl.retestIndex = k;
              break;
            }
          }
        }
      }
    }
  }

  return trendlines.sort((a, b) => b.strength - a.strength).slice(0, 10);
}

// ── Generate breakout signals from trendlines ──
export function detectTrendlineSignals(data: OHLCData[], trendlines: AdvancedTrendline[]): TrendlineBreakoutSignal[] {
  const signals: TrendlineBreakoutSignal[] = [];

  for (const tl of trendlines) {
    if (!tl.broken || tl.breakoutIndex === undefined) continue;

    const idx = tl.breakoutIndex;
    const time = getTime(data[idx]);
    const direction: "bullish" | "bearish" = tl.type === "resistance" ? "bullish" : "bearish";
    let confidence = 70 + tl.touches * 5;
    let pattern = tl.type === "resistance" ? "Resistance Breakout" : "Support Breakdown";

    if (tl.retested) {
      confidence = Math.min(98, confidence + 15);
      pattern += " (Retested)";
    }

    signals.push({
      index: idx,
      time,
      direction,
      pattern,
      confidence: Math.min(95, confidence),
      trendlineId: tl.id,
    });
  }

  return signals;
}
