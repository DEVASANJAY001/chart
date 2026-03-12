import type { OHLCData } from "@/components/NiftyChart";

export interface OptionContract {
  type: "CE" | "PE";
  strike: number;
  symbol: string;
}

export interface TradingSignal {
  id: string;
  time: number;
  candleIndex: number;
  pattern: string;
  direction: "bullish" | "bearish";
  confidence: number;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  option?: OptionContract;
}

export interface Trendline {
  id: string;
  type: "support" | "resistance";
  points: { time: number; value: number }[];
  slope: number;
  intercept: number;
}

export interface SRLevel {
  id: string;
  type: "support" | "resistance";
  price: number;
  strength: number; // number of touches
  startTime: number;
  endTime: number;
}

interface SwingPoint {
  index: number;
  value: number;
  time: number;
  type: "high" | "low";
}

// ── Helpers ──

function getTime(d: OHLCData): number {
  return typeof d.time === "number" ? (d.time as number) : 0;
}

function bodySize(c: OHLCData): number {
  return Math.abs(c.close - c.open);
}

function isBullish(c: OHLCData): boolean {
  return c.close > c.open;
}

function isBearish(c: OHLCData): boolean {
  return c.close < c.open;
}

function candleRange(c: OHLCData): number {
  return c.high - c.low;
}

// ── Swing Point Detection ──
function detectSwingPoints(data: OHLCData[], lookback: number = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < data.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (data[i].high <= data[i - j].high || data[i].high <= data[i + j].high) isSwingHigh = false;
      if (data[i].low >= data[i - j].low || data[i].low >= data[i + j].low) isSwingLow = false;
    }
    if (isSwingHigh) swings.push({ index: i, value: data[i].high, time: getTime(data[i]), type: "high" });
    if (isSwingLow) swings.push({ index: i, value: data[i].low, time: getTime(data[i]), type: "low" });
  }
  return swings;
}

// ── EMA ──
function calcEMA(data: OHLCData[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  ema[0] = data[0].close;
  for (let i = 1; i < data.length; i++) {
    ema[i] = data[i].close * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

// ── ATR ──
function calcATR(data: OHLCData[], period: number = 14): number[] {
  const atr: number[] = new Array(data.length).fill(0);
  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    if (i < period) {
      atr[i] = tr;
    } else if (i === period) {
      let sum = 0;
      for (let j = 1; j <= period; j++) {
        sum += Math.max(
          data[j].high - data[j].low,
          Math.abs(data[j].high - data[j - 1].close),
          Math.abs(data[j].low - data[j - 1].close)
        );
      }
      atr[i] = sum / period;
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

function avgBodySize(data: OHLCData[], end: number, period: number = 14): number {
  let sum = 0;
  const start = Math.max(0, end - period);
  for (let i = start; i <= end; i++) {
    sum += bodySize(data[i]);
  }
  return sum / (end - start + 1);
}

// ── Trend Detection ──
function getTrend(data: OHLCData[], end: number, ema20: number[], ema50: number[]): number {
  if (end < 5) return 0;
  const emaUp = ema20[end] > ema50[end];
  const emaDown = ema20[end] < ema50[end];
  const lookback = Math.min(20, end);
  const slice = data.slice(end - lookback, end + 1);
  const swings = detectSwingPoints(slice, 3);
  const highs = swings.filter(s => s.type === "high");
  const lows = swings.filter(s => s.type === "low");

  let higherHighs = false, lowerHighs = false, lowerLows = false, higherLows = false;
  if (highs.length >= 2) {
    higherHighs = highs[highs.length - 1].value > highs[0].value;
    lowerHighs = highs[highs.length - 1].value < highs[0].value;
  }
  if (lows.length >= 2) {
    lowerLows = lows[lows.length - 1].value < lows[0].value;
    higherLows = lows[lows.length - 1].value > lows[0].value;
  }
  if (emaUp && (higherHighs || higherLows)) return 1;
  if (emaDown && (lowerHighs || lowerLows)) return -1;
  return 0;
}

function isStrongCandle(c: OHLCData, avgBody: number): boolean {
  return bodySize(c) > avgBody * 1.5;
}

// ══════════════════════════════════════════════════════════
// SUPPORT / RESISTANCE LEVEL DETECTION (horizontal zones)
// ══════════════════════════════════════════════════════════
export function detectSRLevels(data: OHLCData[]): SRLevel[] {
  if (data.length < 30) return [];

  const swings = detectSwingPoints(data, 3);
  const levels: SRLevel[] = [];
  const tolerance = 0.005; // 0.5% zone

  // Group swing points into clusters
  const allValues = swings.map(s => ({ value: s.value, time: s.time, type: s.type }));
  allValues.sort((a, b) => a.value - b.value);

  const used = new Set<number>();
  
  for (let i = 0; i < allValues.length; i++) {
    if (used.has(i)) continue;
    
    const cluster: typeof allValues = [allValues[i]];
    used.add(i);
    
    for (let j = i + 1; j < allValues.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(allValues[j].value - allValues[i].value) / allValues[i].value < tolerance) {
        cluster.push(allValues[j]);
        used.add(j);
      }
    }
    
    // Need at least 2 touches for a level
    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((s, c) => s + c.value, 0) / cluster.length;
      const times = cluster.map(c => c.time);
      const lastPrice = data[data.length - 1].close;
      
      levels.push({
        id: `sr-${Math.round(avgPrice)}`,
        type: avgPrice > lastPrice ? "resistance" : "support",
        price: Math.round(avgPrice * 100) / 100,
        strength: cluster.length,
        startTime: Math.min(...times),
        endTime: Math.max(...times),
      });
    }
  }

  // Sort by strength and keep top 10
  levels.sort((a, b) => b.strength - a.strength);
  return levels.slice(0, 10);
}

// ══════════════════════════════════════════════════════════
// OPTION CONTRACT SUGGESTION
// ══════════════════════════════════════════════════════════
function getOptionContract(
  direction: "bullish" | "bearish",
  currentPrice: number,
  srLevels: SRLevel[]
): OptionContract {
  // Nifty options have 50-point strike intervals
  const strikeInterval = 50;
  
  if (direction === "bullish") {
    // Buy CE — ATM or slightly ITM
    const atmStrike = Math.round(currentPrice / strikeInterval) * strikeInterval;
    // Find nearest resistance for context
    const nearestResistance = srLevels
      .filter(s => s.type === "resistance" && s.price > currentPrice)
      .sort((a, b) => a.price - b.price)[0];
    
    // Use ATM strike, or one step ITM if near support
    const strike = nearestResistance 
      ? Math.round(currentPrice / strikeInterval) * strikeInterval
      : atmStrike;
    
    return {
      type: "CE",
      strike,
      symbol: `NIFTY ${strike} CE`,
    };
  } else {
    // Buy PE — ATM or slightly ITM  
    const atmStrike = Math.round(currentPrice / strikeInterval) * strikeInterval;
    const nearestSupport = srLevels
      .filter(s => s.type === "support" && s.price < currentPrice)
      .sort((a, b) => b.price - a.price)[0];
    
    const strike = nearestSupport
      ? Math.round(currentPrice / strikeInterval) * strikeInterval
      : atmStrike;
    
    return {
      type: "PE",
      strike,
      symbol: `NIFTY ${strike} PE`,
    };
  }
}

// ══════════════════════════════════════════════════════════
// TRENDLINE DETECTION
// ══════════════════════════════════════════════════════════
export function detectTrendlines(data: OHLCData[]): Trendline[] {
  if (data.length < 20) return [];
  const swings = detectSwingPoints(data, 3);
  const highs = swings.filter(s => s.type === "high");
  const lows = swings.filter(s => s.type === "low");
  const trendlines: Trendline[] = [];

  for (let i = 0; i < lows.length - 1 && trendlines.length < 3; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const p1 = lows[i], p2 = lows[j];
      if (p2.index - p1.index < 5) continue;
      const slope = (p2.value - p1.value) / (p2.index - p1.index);
      if (slope < -0.5) continue;
      let touches = 0;
      for (const l of lows) {
        const expected = p1.value + slope * (l.index - p1.index);
        if (Math.abs(l.value - expected) / expected < 0.004) touches++;
      }
      if (touches >= 2) {
        trendlines.push({
          id: `sup-${i}-${j}`, type: "support",
          points: [{ time: p1.time, value: p1.value }, { time: p2.time, value: p2.value }],
          slope, intercept: p1.value - slope * p1.index,
        });
        break;
      }
    }
  }

  for (let i = 0; i < highs.length - 1 && trendlines.length < 5; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const p1 = highs[i], p2 = highs[j];
      if (p2.index - p1.index < 5) continue;
      const slope = (p2.value - p1.value) / (p2.index - p1.index);
      if (slope > 0.5) continue;
      let touches = 0;
      for (const h of highs) {
        const expected = p1.value + slope * (h.index - p1.index);
        if (Math.abs(h.value - expected) / expected < 0.004) touches++;
      }
      if (touches >= 2) {
        trendlines.push({
          id: `res-${i}-${j}`, type: "resistance",
          points: [{ time: p1.time, value: p1.value }, { time: p2.time, value: p2.value }],
          slope, intercept: p1.value - slope * p1.index,
        });
        break;
      }
    }
  }

  return trendlines;
}

// ══════════════════════════════════════════════════════════
// PATTERN DETECTORS
// ══════════════════════════════════════════════════════════

function detectDoubleBottom(data: OHLCData[], end: number, swings: SwingPoint[]): { found: boolean; confidence: number } {
  if (end < 30) return { found: false, confidence: 0 };
  const lows = swings.filter(s => s.type === "low" && s.index <= end && s.index > end - 50);
  const highs = swings.filter(s => s.type === "high" && s.index <= end && s.index > end - 50);
  if (lows.length < 2 || highs.length < 1) return { found: false, confidence: 0 };

  for (let i = 0; i < lows.length - 1; i++) {
    const l1 = lows[i], l2 = lows[i + 1];
    if (l2.index - l1.index < 10) continue;
    const pctDiff = Math.abs(l1.value - l2.value) / l1.value;
    if (pctDiff > 0.004) continue;
    const necklineHigh = highs.find(h => h.index > l1.index && h.index < l2.index);
    if (!necklineHigh) continue;
    const bouncePercent = (necklineHigh.value - Math.min(l1.value, l2.value)) / Math.min(l1.value, l2.value);
    if (bouncePercent < 0.005) continue;
    if (data[end].close > necklineHigh.value && data[end - 1].close <= necklineHigh.value) {
      const conf = 78 + (pctDiff < 0.002 ? 5 : 0) + (bouncePercent > 0.01 ? 4 : 0);
      return { found: true, confidence: Math.min(92, conf) };
    }
  }
  return { found: false, confidence: 0 };
}

function detectDoubleTop(data: OHLCData[], end: number, swings: SwingPoint[]): { found: boolean; confidence: number } {
  if (end < 30) return { found: false, confidence: 0 };
  const highs = swings.filter(s => s.type === "high" && s.index <= end && s.index > end - 50);
  const lows = swings.filter(s => s.type === "low" && s.index <= end && s.index > end - 50);
  if (highs.length < 2 || lows.length < 1) return { found: false, confidence: 0 };

  for (let i = 0; i < highs.length - 1; i++) {
    const h1 = highs[i], h2 = highs[i + 1];
    if (h2.index - h1.index < 10) continue;
    const pctDiff = Math.abs(h1.value - h2.value) / h1.value;
    if (pctDiff > 0.004) continue;
    const necklineLow = lows.find(l => l.index > h1.index && l.index < h2.index);
    if (!necklineLow) continue;
    const bouncePercent = (Math.max(h1.value, h2.value) - necklineLow.value) / necklineLow.value;
    if (bouncePercent < 0.005) continue;
    if (data[end].close < necklineLow.value && data[end - 1].close >= necklineLow.value) {
      const conf = 78 + (pctDiff < 0.002 ? 5 : 0) + (bouncePercent > 0.01 ? 4 : 0);
      return { found: true, confidence: Math.min(92, conf) };
    }
  }
  return { found: false, confidence: 0 };
}

function detectBullFlag(data: OHLCData[], end: number, avgBody: number): { found: boolean; confidence: number } {
  if (end < 20) return { found: false, confidence: 0 };
  const poleEnd = end - 5;
  const poleStart = Math.max(0, poleEnd - 10);
  if (poleStart >= poleEnd) return { found: false, confidence: 0 };
  const poleGain = data[poleEnd].close - data[poleStart].close;
  const polePct = poleGain / data[poleStart].close;
  if (polePct < 0.008) return { found: false, confidence: 0 };
  let strongBullCount = 0;
  for (let i = poleStart; i <= poleEnd; i++) { if (isBullish(data[i]) && bodySize(data[i]) > avgBody) strongBullCount++; }
  if (strongBullCount < 3) return { found: false, confidence: 0 };
  const flagStart = poleEnd + 1, flagEnd = end - 1;
  if (flagEnd <= flagStart) return { found: false, confidence: 0 };
  let flagHigh = -Infinity, flagLow = Infinity, smallCandleCount = 0;
  for (let i = flagStart; i <= flagEnd; i++) {
    flagHigh = Math.max(flagHigh, data[i].high);
    flagLow = Math.min(flagLow, data[i].low);
    if (bodySize(data[i]) < avgBody * 0.8) smallCandleCount++;
  }
  const flagRange = (flagHigh - flagLow) / flagLow;
  if (flagRange > polePct * 0.5) return { found: false, confidence: 0 };
  if (smallCandleCount < (flagEnd - flagStart + 1) * 0.5) return { found: false, confidence: 0 };
  if (data[end].close > flagHigh && isBullish(data[end]) && isStrongCandle(data[end], avgBody)) {
    return { found: true, confidence: 82 };
  }
  return { found: false, confidence: 0 };
}

function detectBearFlag(data: OHLCData[], end: number, avgBody: number): { found: boolean; confidence: number } {
  if (end < 20) return { found: false, confidence: 0 };
  const poleEnd = end - 5;
  const poleStart = Math.max(0, poleEnd - 10);
  if (poleStart >= poleEnd) return { found: false, confidence: 0 };
  const poleLoss = data[poleEnd].close - data[poleStart].close;
  const polePct = Math.abs(poleLoss) / data[poleStart].close;
  if (poleLoss >= 0 || polePct < 0.008) return { found: false, confidence: 0 };
  let strongBearCount = 0;
  for (let i = poleStart; i <= poleEnd; i++) { if (isBearish(data[i]) && bodySize(data[i]) > avgBody) strongBearCount++; }
  if (strongBearCount < 3) return { found: false, confidence: 0 };
  const flagStart = poleEnd + 1, flagEnd = end - 1;
  if (flagEnd <= flagStart) return { found: false, confidence: 0 };
  let flagHigh = -Infinity, flagLow = Infinity, smallCandleCount = 0;
  for (let i = flagStart; i <= flagEnd; i++) {
    flagHigh = Math.max(flagHigh, data[i].high);
    flagLow = Math.min(flagLow, data[i].low);
    if (bodySize(data[i]) < avgBody * 0.8) smallCandleCount++;
  }
  const flagRange = (flagHigh - flagLow) / flagLow;
  if (flagRange > polePct * 0.5) return { found: false, confidence: 0 };
  if (smallCandleCount < (flagEnd - flagStart + 1) * 0.5) return { found: false, confidence: 0 };
  if (data[end].close < flagLow && isBearish(data[end]) && isStrongCandle(data[end], avgBody)) {
    return { found: true, confidence: 80 };
  }
  return { found: false, confidence: 0 };
}

function detectAscendingTriangle(data: OHLCData[], end: number, swings: SwingPoint[], avgBody: number): { found: boolean; confidence: number } {
  if (end < 25) return { found: false, confidence: 0 };
  const highs = swings.filter(s => s.type === "high" && s.index <= end && s.index > end - 40);
  const lows = swings.filter(s => s.type === "low" && s.index <= end && s.index > end - 40);
  if (highs.length < 3 || lows.length < 2) return { found: false, confidence: 0 };
  const recentHighs = highs.slice(-3);
  const highValues = recentHighs.map(h => h.value);
  const avgHigh = highValues.reduce((a, b) => a + b, 0) / highValues.length;
  const highRange = (Math.max(...highValues) - Math.min(...highValues)) / avgHigh;
  if (highRange > 0.002) return { found: false, confidence: 0 };
  const recentLows = lows.slice(-2);
  if (recentLows[1].value <= recentLows[0].value) return { found: false, confidence: 0 };
  if (data[end].close > avgHigh && data[end - 1].close <= avgHigh && isStrongCandle(data[end], avgBody)) {
    return { found: true, confidence: 84 };
  }
  return { found: false, confidence: 0 };
}

function detectDescendingTriangle(data: OHLCData[], end: number, swings: SwingPoint[], avgBody: number): { found: boolean; confidence: number } {
  if (end < 25) return { found: false, confidence: 0 };
  const highs = swings.filter(s => s.type === "high" && s.index <= end && s.index > end - 40);
  const lows = swings.filter(s => s.type === "low" && s.index <= end && s.index > end - 40);
  if (lows.length < 3 || highs.length < 2) return { found: false, confidence: 0 };
  const recentLows = lows.slice(-3);
  const lowValues = recentLows.map(l => l.value);
  const avgLow = lowValues.reduce((a, b) => a + b, 0) / lowValues.length;
  const lowRange = (Math.max(...lowValues) - Math.min(...lowValues)) / avgLow;
  if (lowRange > 0.002) return { found: false, confidence: 0 };
  const recentHighs = highs.slice(-2);
  if (recentHighs[1].value >= recentHighs[0].value) return { found: false, confidence: 0 };
  if (data[end].close < avgLow && data[end - 1].close >= avgLow && isStrongCandle(data[end], avgBody)) {
    return { found: true, confidence: 83 };
  }
  return { found: false, confidence: 0 };
}

function detectLiquiditySweep(data: OHLCData[], end: number, swings: SwingPoint[], avgBody: number): { found: boolean; confidence: number; direction: "bullish" | "bearish" } {
  if (end < 15) return { found: false, confidence: 0, direction: "bullish" };
  const lows = swings.filter(s => s.type === "low" && s.index <= end - 1 && s.index > end - 20);
  const highs = swings.filter(s => s.type === "high" && s.index <= end - 1 && s.index > end - 20);
  if (lows.length >= 1) {
    const keyLow = Math.min(...lows.map(l => l.value));
    const curr = data[end];
    if (curr.low < keyLow && curr.close > keyLow && isBullish(curr) && isStrongCandle(curr, avgBody) && (keyLow - curr.low) > avgBody * 0.3) {
      return { found: true, confidence: 76, direction: "bullish" };
    }
  }
  if (highs.length >= 1) {
    const keyHigh = Math.max(...highs.map(h => h.value));
    const curr = data[end];
    if (curr.high > keyHigh && curr.close < keyHigh && isBearish(curr) && isStrongCandle(curr, avgBody) && (curr.high - keyHigh) > avgBody * 0.3) {
      return { found: true, confidence: 76, direction: "bearish" };
    }
  }
  return { found: false, confidence: 0, direction: "bullish" };
}

function detectTrendlineBreakout(data: OHLCData[], end: number, trendlines: Trendline[], avgBody: number): { found: boolean; confidence: number; direction: "bullish" | "bearish"; pattern: string } {
  if (end < 2) return { found: false, confidence: 0, direction: "bullish", pattern: "" };
  const curr = data[end], prev = data[end - 1];
  const t = getTime(curr), tPrev = getTime(prev);
  for (const tl of trendlines) {
    if (tl.points.length < 2) continue;
    const p1 = tl.points[0], p2 = tl.points[1];
    const timeDiff = p2.time - p1.time;
    if (timeDiff === 0) continue;
    const slope = (p2.value - p1.value) / timeDiff;
    const expectedNow = p1.value + slope * (t - p1.time);
    const expectedPrev = p1.value + slope * (tPrev - p1.time);
    if (tl.type === "resistance" && curr.close > expectedNow * 1.001 && prev.close <= expectedPrev * 1.001 && isBullish(curr) && isStrongCandle(curr, avgBody)) {
      return { found: true, confidence: 80, direction: "bullish", pattern: "Trendline Breakout" };
    }
    if (tl.type === "support" && curr.close < expectedNow * 0.999 && prev.close >= expectedPrev * 0.999 && isBearish(curr) && isStrongCandle(curr, avgBody)) {
      return { found: true, confidence: 80, direction: "bearish", pattern: "Trendline Breakdown" };
    }
  }
  return { found: false, confidence: 0, direction: "bullish", pattern: "" };
}

// S/R based signal targets
function calcSRTargets(
  direction: "bullish" | "bearish",
  entry: number,
  currentATR: number,
  srLevels: SRLevel[]
) {
  let sl: number, t1: number, t2: number, t3: number;
  
  if (direction === "bullish") {
    // SL below nearest support
    const nearestSupport = srLevels
      .filter(s => s.type === "support" && s.price < entry)
      .sort((a, b) => b.price - a.price)[0];
    sl = nearestSupport ? Math.round(nearestSupport.price - currentATR * 0.5) : Math.round(entry - currentATR * 1.5);
    
    // Targets at resistance levels
    const resistances = srLevels
      .filter(s => s.type === "resistance" && s.price > entry)
      .sort((a, b) => a.price - b.price);
    t1 = resistances[0] ? Math.round(resistances[0].price) : Math.round(entry + currentATR * 1.5);
    t2 = resistances[1] ? Math.round(resistances[1].price) : Math.round(entry + currentATR * 2.5);
    t3 = resistances[2] ? Math.round(resistances[2].price) : Math.round(entry + currentATR * 3.5);
  } else {
    const nearestResistance = srLevels
      .filter(s => s.type === "resistance" && s.price > entry)
      .sort((a, b) => a.price - b.price)[0];
    sl = nearestResistance ? Math.round(nearestResistance.price + currentATR * 0.5) : Math.round(entry + currentATR * 1.5);
    
    const supports = srLevels
      .filter(s => s.type === "support" && s.price < entry)
      .sort((a, b) => b.price - a.price);
    t1 = supports[0] ? Math.round(supports[0].price) : Math.round(entry - currentATR * 1.5);
    t2 = supports[1] ? Math.round(supports[1].price) : Math.round(entry - currentATR * 2.5);
    t3 = supports[2] ? Math.round(supports[2].price) : Math.round(entry - currentATR * 3.5);
  }
  
  return { sl, t1, t2, t3 };
}

// ══════════════════════════════════════════════════════════
// MAIN SIGNAL SCANNER
// ══════════════════════════════════════════════════════════
export function scanForSignals(data: OHLCData[], trendlines: Trendline[], srLevels: SRLevel[] = []): TradingSignal[] {
  if (data.length < 20) return [];

  const signals: TradingSignal[] = [];
  const ema20 = calcEMA(data, 20);
  const ema50 = calcEMA(data, 50);
  const atr = calcATR(data, 14);
  const allSwings = detectSwingPoints(data, 3);

  const MIN_SIGNAL_GAP = 8;
  let lastSignalIndex = -MIN_SIGNAL_GAP;

  const addSignal = (
    index: number,
    pattern: string,
    direction: "bullish" | "bearish",
    confidence: number
  ): boolean => {
    if (index - lastSignalIndex < MIN_SIGNAL_GAP) return false;

    const t = getTime(data[index]);
    const curr = data[index];
    const currentATR = atr[index] || candleRange(curr);
    if (currentATR === 0) return false;

    const trend = getTrend(data, index, ema20, ema50);
    if (direction === "bullish" && trend === 1) confidence = Math.min(95, confidence + 5);
    if (direction === "bearish" && trend === -1) confidence = Math.min(95, confidence + 5);
    if (direction === "bullish" && trend === -1) confidence -= 8;
    if (direction === "bearish" && trend === 1) confidence -= 8;
    if (confidence < 65) return false;

    const entry = curr.close;
    const { sl, t1, t2, t3 } = calcSRTargets(direction, entry, currentATR, srLevels);
    const option = getOptionContract(direction, entry, srLevels);

    signals.push({
      id: `sig-${index}-${pattern.replace(/\s/g, "")}`,
      time: t,
      candleIndex: index,
      pattern,
      direction,
      confidence,
      entry: Math.round(entry * 100) / 100,
      stopLoss: sl,
      target1: t1,
      target2: t2,
      target3: t3,
      option,
    });

    lastSignalIndex = index;
    return true;
  };

  const scanStart = Math.max(20, data.length - 500);

  for (let i = scanStart; i < data.length; i++) {
    if (i - lastSignalIndex < MIN_SIGNAL_GAP) continue;
    const ab = avgBodySize(data, i);

    const bf = detectBullFlag(data, i, ab);
    if (bf.found) { addSignal(i, "Bull Flag", "bullish", bf.confidence); continue; }
    const brf = detectBearFlag(data, i, ab);
    if (brf.found) { addSignal(i, "Bear Flag", "bearish", brf.confidence); continue; }
    const at = detectAscendingTriangle(data, i, allSwings, ab);
    if (at.found) { addSignal(i, "Ascending Triangle", "bullish", at.confidence); continue; }
    const dst = detectDescendingTriangle(data, i, allSwings, ab);
    if (dst.found) { addSignal(i, "Descending Triangle", "bearish", dst.confidence); continue; }
    const db = detectDoubleBottom(data, i, allSwings);
    if (db.found) { addSignal(i, "Double Bottom", "bullish", db.confidence); continue; }
    const dt = detectDoubleTop(data, i, allSwings);
    if (dt.found) { addSignal(i, "Double Top", "bearish", dt.confidence); continue; }
    const ls = detectLiquiditySweep(data, i, allSwings, ab);
    if (ls.found) { addSignal(i, "Liquidity Sweep", ls.direction, ls.confidence); continue; }
    const tlb = detectTrendlineBreakout(data, i, trendlines, ab);
    if (tlb.found) { addSignal(i, tlb.pattern, tlb.direction, tlb.confidence); }
  }

  return signals;
}
