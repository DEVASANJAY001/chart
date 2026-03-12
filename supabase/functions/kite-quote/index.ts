import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QUOTE_SYMBOLS: Record<string, string> = {
  'NIFTY': 'NSE:NIFTY 50',
  'SENSEX': 'BSE:SENSEX',
};

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

    const url = new URL(req.url);
    const instrument = url.searchParams.get('instrument') || 'NIFTY';
    const quoteSymbol = QUOTE_SYMBOLS[instrument.toUpperCase()] || QUOTE_SYMBOLS['NIFTY'];

    const response = await fetch(
      `https://api.kite.trade/quote?i=${encodeURIComponent(quoteSymbol)}`,
      {
        headers: {
          'X-Kite-Version': '3',
          'Authorization': `token ${settings.api_key}:${settings.access_token}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Kite API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Kite quote error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
