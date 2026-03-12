CREATE TABLE public.kite_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text NOT NULL DEFAULT '',
  access_token text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Insert a single row for settings
INSERT INTO public.kite_settings (api_key, access_token) VALUES ('', '');

-- No RLS needed - edge functions use service role key
ALTER TABLE public.kite_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read/update (since no auth in this app)
CREATE POLICY "Allow public read" ON public.kite_settings FOR SELECT USING (true);
CREATE POLICY "Allow public update" ON public.kite_settings FOR UPDATE USING (true);