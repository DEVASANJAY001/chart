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
  const tolerance = 0.005; // 0.5%
  const lastIdx = data.length - 1;
  const lastTime = getTime(data[lastIdx]);

  // ── Support trendlines (connecting swing lows) ──
  for (let i = 0; i < lows.length - 1 && trendlines.length < 8; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const p1 = lows[i], p2 = lows[j];
      if (p2.index - p1.index < 3) continue;

      const slope = (p2.value - p1.value) / (p2.index - p1.index);
      const touches = countTouches(lows, p1, p2, tolerance);

      if (touches.length >= 2) {
        const timeSlope = p2.time !== p1.time ? (p2.value - p1.value) / (p2.time - p1.time) : 0;
        const extTime = lastTime + (lastTime - p2.time) * 0.3;
        const extValue = p2.value + timeSlope * (extTime - p2.time);

        let category: AdvancedTrendline["category"];
        if (Math.abs(slope) < 0.01) category = "horizontal_support";
        else if (slope > 0) category = "uptrend";
        else category = "channel_lower";

        const strength = Math.min(100, touches.length * 20 + (p2.index - p1.index > 30 ? 20 : 0));

        trendlines.push({
          id: `sup-${i}-${j}`,
          type: "support",
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
        break;
      }
    }
  }

  // ── Resistance trendlines (connecting swing highs) ──
  for (let i = 0; i < highs.length - 1 && trendlines.length < 12; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const p1 = highs[i], p2 = highs[j];
      if (p2.index - p1.index < 3) continue;

      const slope = (p2.value - p1.value) / (p2.index - p1.index);
      const touches = countTouches(highs, p1, p2, tolerance);

      if (touches.length >= 2) {
        const timeSlope = p2.time !== p1.time ? (p2.value - p1.value) / (p2.time - p1.time) : 0;
        const extTime = lastTime + (lastTime - p2.time) * 0.3;
        const extValue = p2.value + timeSlope * (extTime - p2.time);

        let category: AdvancedTrendline["category"];
        if (Math.abs(slope) < 0.01) category = "horizontal_resistance";
        else if (slope < 0) category = "downtrend";
        else category = "channel_upper";

        const strength = Math.min(100, touches.length * 20 + (p2.index - p1.index > 30 ? 20 : 0));

        trendlines.push({
          id: `res-${i}-${j}`,
          type: "resistance",
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
        break;
      }
    }
  }

  // ── Breakout & Retest Detection ──
  for (const tl of trendlines) {
    if (tl.points.length < 2) continue;
    const lastPoint = tl.points[tl.points.length - 1];

    // Check recent candles for breakout
    for (let k = lastPoint.index + 1; k <= lastIdx; k++) {
      const expectedValue = lastPoint.value + tl.slope * (getTime(data[k]) - lastPoint.time);

      if (tl.type === "resistance" && data[k].close > expectedValue * 1.001 && data[k - 1]?.close <= expectedValue * 1.001) {
        tl.broken = true;
        tl.breakoutIndex = k;
        break;
      }
      if (tl.type === "support" && data[k].close < expectedValue * 0.999 && data[k - 1]?.close >= expectedValue * 0.999) {
        tl.broken = true;
        tl.breakoutIndex = k;
        break;
      }
    }

    // Check for retest after breakout
    if (tl.broken && tl.breakoutIndex !== undefined) {
      for (let k = tl.breakoutIndex + 1; k <= lastIdx; k++) {
        const expectedValue = lastPoint.value + tl.slope * (getTime(data[k]) - lastPoint.time);
        const retestTolerance = Math.abs(expectedValue * 0.002);

        if (Math.abs(data[k].close - expectedValue) < retestTolerance) {
          // Price returned to trendline
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

  // Sort by strength
  trendlines.sort((a, b) => b.strength - a.strength);
  return trendlines.slice(0, 8);
}

// ── Generate breakout signals from trendlines ──
export function detectTrendlineSignals(data: OHLCData[], trendlines: AdvancedTrendline[]): TrendlineBreakoutSignal[] {
  const signals: TrendlineBreakoutSignal[] = [];

  for (const tl of trendlines) {
    if (!tl.broken || tl.breakoutIndex === undefined) continue;

    const idx = tl.breakoutIndex;
    const time = getTime(data[idx]);
    const direction: "bullish" | "bearish" = tl.type === "resistance" ? "bullish" : "bearish";
    let confidence = 75 + tl.touches * 3;
    let pattern = tl.type === "resistance" ? "Trendline Breakout" : "Trendline Breakdown";

    if (tl.retested) {
      confidence = Math.min(95, confidence + 10);
      pattern += " + Retest";
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
