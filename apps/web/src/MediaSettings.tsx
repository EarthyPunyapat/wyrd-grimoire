import { MediaSettings } from "@wyrd/core";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

/** Settings → Media (D168): web pictures, the ComfyUI on the main PC, and where pictures are kept. */
export function MediaSettingsPanel({ initial }: { initial?: MediaSettings }) {
  const [settings, setSettings] = useState<MediaSettings | null>(initial ?? null);
  const [comfyUrl, setComfyUrl] = useState(initial?.comfyUrl ?? "");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initial) return;
    api("/settings/media", MediaSettings.parse)
      .then((s) => {
        setSettings(s);
        setComfyUrl(s.comfyUrl ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, [initial]);
  const save = async (patch: Partial<MediaSettings>) => {
    setError("");
    setStatus("");
    try {
      const next = await api("/settings/media", MediaSettings.parse, patch, "PUT");
      setSettings(next);
      setStatus("Saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!settings) return <p className="muted small">{error || "Loading media settings…"}</p>;
  return (
    <fieldset className="media-settings">
      <legend>Pictures</legend>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.webImages}
          onChange={(e) => void save({ webImages: e.target.checked })}
        />
        Pictures from the web (the story's source wiki, and Wikipedia for places)
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(comfyUrl.trim() ? { comfyUrl: comfyUrl.trim() } : {});
        }}
      >
        <label>
          ComfyUI on your main PC
          <input
            type="url"
            value={comfyUrl}
            onChange={(e) => setComfyUrl(e.target.value)}
            placeholder="http://192.168.1.20:8188"
          />
        </label>
        <p className="small muted">
          Export your portrait workflow in API format as <code>portrait.json</code>, with a{" "}
          <code>portrait.map.json</code>, into <code>{settings.workflowsDir}</code>.
        </p>
        <button type="submit" disabled={!comfyUrl.trim()}>
          Save address
        </button>
        <button
          type="button"
          disabled={busy || !settings.comfyUrl}
          onClick={async () => {
            setBusy(true);
            setError("");
            setStatus("Generating a test picture…");
            try {
              await api("/settings/media/test", (d) => d, {});
              setStatus("ComfyUI made a test picture.");
            } catch (e) {
              setStatus("");
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Test generation
        </button>
      </form>
      <p className="small muted">OpenAI images: not available yet.</p>
      <p className="small muted">Pictures are kept on this server in the WYRD_HOME media-cache folder.</p>
      {status && <p className="small status-note">{status}</p>}
      {error && (
        <p role="alert" className="error small">
          {error}
        </p>
      )}
    </fieldset>
  );
}
