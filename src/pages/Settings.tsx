import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, Loader2, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const Settings = () => {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from("kite_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setApiKey(data.api_key);
        setAccessToken(data.access_token);
      }
      setLoading(false);
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);

    // Check if a row already exists
    const { data: existing } = await supabase
      .from("kite_settings")
      .select("id")
      .limit(1)
      .maybeSingle();

    let error;
    if (existing) {
      ({ error } = await supabase
        .from("kite_settings")
        .update({
          api_key: apiKey,
          access_token: accessToken,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id));
    } else {
      ({ error } = await supabase
        .from("kite_settings")
        .insert({
          api_key: apiKey,
          access_token: accessToken,
        }));
    }

    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success("Kite credentials saved successfully!");
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-lg mx-auto">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground font-mono text-sm mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Chart
        </button>

        <h1 className="text-2xl font-bold text-foreground font-mono mb-2">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground font-mono mb-8">
          Update your Kite Connect credentials. The access token expires daily.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 bg-card border border-border rounded-lg p-6">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                API Key
              </Label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your Kite API Key"
                  className="font-mono pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Access Token
              </Label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Enter your Kite Access Token"
                  className="font-mono pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                ⚠️ This token expires daily. Update it each morning before market opens.
              </p>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full font-mono"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Credentials
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
