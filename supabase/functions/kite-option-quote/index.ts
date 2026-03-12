import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get nearest weekly expiry (Thursday) for Nifty options
function getNearestExpiry(): string {
  const now = new Date();
  // IST offset
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay(); // 0=Sun, 4=Thu
  const diff = (4 - day + 7) % 7; // days until next Thursday
  const expiry = new Date(ist);
  expiry.setUTCDate(ist.getUTCDate() + (diff === 0 ? 0 : diff));

  const yy = String(expiry.getUTCFullYear()).slice(-2);
  const mon = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getUTCDate()).padStart(2, "0");
  return `${yy}${mon}${dd}`;
}

// Build Kite NFO trading symbol
function buildSymbol(strike: number, type: "CE" | "PE"): string {
  const expiry = getNearestExpiry();
  return `NIFTY${expiry}${strike}${type}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: settings, error: dbError } = await supabase
      .from('kite_settings')
      .select('api_key, access_token')
      .limit(1)
      .single();

    if (dbError || !settings?.api_key || !settings?.access_token) {
      throw new Error('Kite credentials not configured. Please update them in Settings.');
    }

    // Parse contracts from query params: contracts=23600CE,23600PE,23650CE
    const url = new URL(req.url);
    const contractsParam = url.searchParams.get('contracts') || '';
    
    if (!contractsParam) {
      return new Response(JSON.stringify({ error: 'No contracts specified' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contracts = contractsParam.split(',').map(c => c.trim()).filter(Boolean);
    
    // Build instrument query string for Kite API
    const instruments = contracts.map(c => {
      const match = c.match(/^(\d+)(CE|PE)$/);
      if (!match) return null;
      const strike = parseInt(match[1]);
      const type = match[2] as "CE" | "PE";
      const symbol = buildSymbol(strike, type);
      return { key: c, instrument: `NFO:${symbol}`, strike, type, symbol };
    }).filter(Boolean);

    if (instruments.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid contract format. Use: 23600CE,23600PE' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Kite quote API supports multiple instruments
    const queryStr = instruments.map(i => `i=${encodeURIComponent(i!.instrument)}`).join('&');
    const kiteUrl = `https://api.kite.trade/quote?${queryStr}`;

    const response = await fetch(kiteUrl, {
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${settings.api_key}:${settings.access_token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Kite API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    // Map response back to our contract keys
    const result: Record<string, {
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
    }> = {};

    for (const inst of instruments) {
      if (!inst) continue;
      const quoteData = data.data?.[inst.instrument];
      if (quoteData) {
        result[inst.key] = {
          ltp: quoteData.last_price,
          open: quoteData.ohlc?.open || 0,
          high: quoteData.ohlc?.high || 0,
          low: quoteData.ohlc?.low || 0,
          close: quoteData.ohlc?.close || 0,
          volume: quoteData.volume || 0,
          change: quoteData.net_change || 0,
          symbol: inst.symbol,
          strike: inst.strike,
          type: inst.type,
        };
      }
    }

    return new Response(JSON.stringify({ status: 'success', data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Kite option quote error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
