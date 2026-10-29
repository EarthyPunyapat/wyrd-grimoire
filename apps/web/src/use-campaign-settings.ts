import { type CampaignSettings, CampaignSettingsView } from "@wyrd/core";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

/**
 * The campaign's saved settings (spec 12), for play-screen behaviour the server owns. A failed
 * fetch leaves the caller's defaults in place rather than blocking play.
 */
export function useCampaignSettings(campaignId: string) {
  const [settings, setSettings] = useState<CampaignSettings>();
  useEffect(() => {
    let live = true;
    api(`/campaigns/${campaignId}/settings`, CampaignSettingsView.parse)
      .then((view) => {
        if (live) setSettings(view.settings);
      })
      .catch(() => {
        // The play screen works without settings; defaults apply.
      });
    return () => {
      live = false;
    };
  }, [campaignId]);
  return settings;
}
