import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Instrument token mapping
const INSTRUMENTS: Record<string, number> = {
  'NIFTY': 256265,
  'SENSEX': 265,
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
    const interval = url.searchParams.get('interval') || 'day';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const instrument = url.searchParams.get('instrument') || 'NIFTY';

    const instrumentToken = INSTRUMENTS[instrument.toUpperCase()] || INSTRUMENTS['NIFTY'];
    const kiteUrl = `https://api.kite.trade/instruments/historical/${instrumentToken}/${interval}?from=${from}&to=${to}`;

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

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Kite historical error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
