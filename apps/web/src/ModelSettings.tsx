import {
  ChatGptLink,
  ConnectionStatus,
  ModelList,
  ProviderKeyInput,
  UsageRecord,
  WyrdConfig,
} from "@wyrd/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";

const slots = {
  plan: "ChatGPT plan (prose)",
  deepseek: "Fast model (parsing and checks)",
  local: "Local models",
  anthropic: "Anthropic",
  best: "Highest quality",
} as const;
type Slot = keyof typeof slots;
const ROLES = [
  ["parser", "Action parsing"],
  ["narrator", "Narration"],
  ["guard", "Canon guard"],
  ["worldGen", "World generation"],
  ["sessionZero", "Character interview"],
  ["npcDialogue", "NPC dialogue"],
  ["summarizer", "Summaries"],
] as const;
export function ModelSettings() {
  const [tab, setTab] = useState("Models");
  const [config, setConfig] = useState<WyrdConfig>();
  const [connection, setConnection] = useState<ReturnType<typeof ConnectionStatus.parse>>();
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const loadModels = useCallback(async (id: string) => {
    try {
      const result = await api(`/providers/${encodeURIComponent(id)}/models`, ModelList.parse);
      setModels((current) => ({ ...current, [id]: result.map((m) => m.id) }));
    } catch {
      // Keep the typed field usable; the explicit Refresh button reports the reason.
    }
  }, []);
  const refresh = useCallback(async () => {
    const [cfg, status, usage] = await Promise.all([
      api("/providers", WyrdConfig.parse),
      api("/connection", ConnectionStatus.parse),
      api("/usage", UsageRecord.array().parse),
    ]);
    setConfig(cfg);
    setConnection(status);
    setRecords(usage);
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  // Load the model list for providers already assigned, so a real dropdown is ready.
  useEffect(() => {
    if (!config) return;
    const ids = new Set<string>();
    if (config.preset === "single") {
      const primary = config.models.deepseek?.provider;
      if (primary) ids.add(primary);
    } else {
      for (const value of [...Object.values(config.models), ...Object.values(config.routing)])
        if (value?.provider) ids.add(value.provider);
    }
    for (const id of ids) if (!(id in models)) void loadModels(id);
  }, [config, models, loadModels]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function target(slot: Slot, provider: string, model: string) {
    if (!config) return;
    const next = { ...config.models };
    if (provider) next[slot] = { provider, model };
    else delete next[slot];
    setConfig({ ...config, models: next });
  }
  return (
    <div className="model-settings">
      <nav className="settings-tabs" aria-label="Model and connection settings">
        {["Models", "Connection", "Usage"].map((name) => (
          <button
            type="button"
            aria-current={tab === name ? "page" : undefined}
            key={name}
            onClick={() => {
              setTab(name);
              setError("");
              setMessage("");
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="connection-banner">
          {message}
        </p>
      )}
      {!config || !connection ? (
        <p role="status">Loading settings…</p>
      ) : tab === "Models" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const used =
                config.preset === "single"
                  ? (["deepseek"] as Slot[])
                  : (Object.keys(config.models) as Slot[]).filter((slot) => config.models[slot]);
              for (const slot of used) {
                const value = config.models[slot];
                if (!value?.model.trim() || value.model.startsWith("PICK-WITH"))
                  throw new Error(`Choose a model for ${slots[slot]}.`);
              }
              setConfig(await api("/providers", WyrdConfig.parse, config, "PUT"));
              setConnection(await api("/connection", ConnectionStatus.parse));
              setMessage("Model settings saved. New turns will use these routes.");
            });
          }}
        >
          <p className="muted">
            One model for everything sends every job — parsing, narration, world generation, guards and
            summaries — to the Fast model below. Balanced splits prose onto the ChatGPT plan and keeps the
            fast model for checks. Fallbacks take over when a provider fails.
          </p>
          {config.providers.deepseek && (
            <div className="connection-banner">
              <strong>Only using DeepSeek?</strong>{" "}
              <button
                type="button"
                onClick={() =>
                  setConfig({
                    ...config,
                    preset: "single",
                    models: {
                      ...config.models,
                      deepseek: {
                        provider: "deepseek",
                        model:
                          (models.deepseek ?? []).find((m) => m.includes("flash")) ??
                          (models.deepseek ?? [])[0] ??
                          "deepseek-flash",
                      },
                    },
                    routing: {},
                  })
                }
              >
                Use DeepSeek for everything
              </button>
            </div>
          )}
          <label>
            Routing preset
            <select
              value={config.preset}
              onChange={(e) => setConfig({ ...config, preset: e.target.value as WyrdConfig["preset"] })}
            >
              <option value="single">One model for everything</option>
              <option value="balanced">Balanced</option>
              <option value="cheap">Cheap</option>
              <option value="maxQuality">Maximum quality</option>
              <option value="fullyLocal">Fully local</option>
            </select>
          </label>
          {Object.entries(config.providers).map(([id, provider]) => (
            <div className="provider-row" key={id}>
              <h3>{id}</h3>
              {provider.kind === "openai-compatible" && (
                <label>
                  Endpoint
                  <input
                    value={provider.baseUrl}
                    type="url"
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        providers: { ...config.providers, [id]: { ...provider, baseUrl: e.target.value } },
                      })
                    }
                    required
                  />
                </label>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api("/providers", WyrdConfig.parse, config, "PUT");
                    const result = await api(`/providers/${encodeURIComponent(id)}/models`, ModelList.parse);
                    setModels((current) => ({ ...current, [id]: result.map((m) => m.id) }));
                    setMessage(`Found ${result.length} models for ${id}.`);
                  })
                }
              >
                List {id} models
              </button>
            </div>
          ))}
          {Object.entries(slots).map(([name, label]) => {
            const slot = name as Slot;
            if (config.preset === "single" && slot !== "deepseek") return null;
            const chosen = config.models[slot];
            return (
              <fieldset className="model-slot" key={name}>
                <legend>{label}</legend>
                <div className="form-row">
                  <label>
                    Provider
                    <select
                      value={chosen?.provider ?? ""}
                      onChange={(e) =>
                        target(
                          slot,
                          e.target.value,
                          chosen?.model.startsWith("PICK-WITH") ? "" : (chosen?.model ?? ""),
                        )
                      }
                    >
                      <option value="">Not used</option>
                      {Object.keys(config.providers).map((id) => (
                        <option key={id}>{id}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor={`model-${slot}`}>
                    Model
                    {(models[chosen?.provider ?? ""] ?? []).length ? (
                      <select
                        id={`model-${slot}`}
                        value={chosen?.model.startsWith("PICK-WITH") ? "" : (chosen?.model ?? "")}
                        disabled={!chosen}
                        onChange={(e) => target(slot, chosen?.provider ?? "", e.target.value)}
                        required={Boolean(chosen)}
                      >
                        <option value="">Choose a model…</option>
                        {(models[chosen?.provider ?? ""] ?? []).map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`model-${slot}`}
                        list={`models-${slot}`}
                        value={chosen?.model.startsWith("PICK-WITH") ? "" : (chosen?.model ?? "")}
                        disabled={!chosen}
                        onChange={(e) => target(slot, chosen?.provider ?? "", e.target.value)}
                        required={Boolean(chosen)}
                        placeholder="Choose or enter a model ID"
                      />
                    )}
                  </label>
                  <button
                    type="button"
                    disabled={busy || !chosen}
                    onClick={() => {
                      if (!chosen) return;
                      void act(async () => {
                        await loadModels(chosen.provider);
                        setMessage(`Refreshed ${chosen.provider} models.`);
                      });
                    }}
                  >
                    Refresh models
                  </button>
                </div>
              </fieldset>
            );
          })}
          <details>
            <summary>Per-role overrides</summary>
            {ROLES.map(([role, roleLabel]) => (
              <fieldset className="model-slot" key={role}>
                <legend>{roleLabel}</legend>
                <label>
                  Primary provider
                  <select
                    value={config.routing[role]?.provider ?? ""}
                    onChange={(e) => {
                      const routing = { ...config.routing };
                      if (e.target.value)
                        routing[role] = { provider: e.target.value, model: "", fallbacks: [] };
                      else delete routing[role];
                      setConfig({ ...config, routing });
                      if (e.target.value) void loadModels(e.target.value);
                    }}
                  >
                    <option value="">Use preset</option>
                    {Object.keys(config.providers).map((id) => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
                {config.routing[role] && (
                  <>
                    <label htmlFor={`role-model-${role}`}>
                      Primary model
                      {(models[config.routing[role].provider] ?? []).length ? (
                        <select
                          id={`role-model-${role}`}
                          value={config.routing[role].model}
                          required
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              routing: {
                                ...config.routing,
                                [role]: { ...config.routing[role]!, model: e.target.value },
                              },
                            })
                          }
                        >
                          <option value="">Choose a model…</option>
                          {(models[config.routing[role].provider] ?? []).map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`role-model-${role}`}
                          value={config.routing[role].model}
                          required
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              routing: {
                                ...config.routing,
                                [role]: { ...config.routing[role]!, model: e.target.value },
                              },
                            })
                          }
                          placeholder="Model ID"
                        />
                      )}
                    </label>
                    <div className="form-row">
                      <label>
                        Fallback provider
                        <select
                          value={config.routing[role].fallbacks[0]?.provider ?? ""}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              routing: {
                                ...config.routing,
                                [role]: {
                                  ...config.routing[role]!,
                                  fallbacks: e.target.value ? [{ provider: e.target.value, model: "" }] : [],
                                },
                              },
                            })
                          }
                        >
                          <option value="">None</option>
                          {Object.keys(config.providers).map((id) => (
                            <option key={id}>{id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Fallback model
                        <input
                          value={config.routing[role].fallbacks[0]?.model ?? ""}
                          disabled={!config.routing[role].fallbacks.length}
                          required={Boolean(config.routing[role].fallbacks.length)}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              routing: {
                                ...config.routing,
                                [role]: {
                                  ...config.routing[role]!,
                                  fallbacks: [
                                    { ...config.routing[role]!.fallbacks[0]!, model: e.target.value },
                                  ],
                                },
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  </>
                )}
              </fieldset>
            ))}
          </details>
          <button type="submit" className="primary" disabled={busy}>
            Save model settings
          </button>
        </form>
      ) : tab === "Connection" ? (
        <div>
          <h3>ChatGPT plan</h3>
          <p>
            {connection.chatgptConnected
              ? `Connected${connection.email ? ` as ${connection.email}` : ""}.`
              : "ChatGPT is not connected."}
          </p>
          {!connection.hostLocal && (
            <p>Open Wyrd on the host PC at localhost to connect accounts or add provider keys.</p>
          )}
          {connection.offline && (
            <p className="connection-banner">
              Offline preview is active. No real model calls or account changes are made.
            </p>
          )}
          <button
            type="button"
            disabled={busy || connection.offline || !connection.hostLocal || connection.connecting}
            onClick={() =>
              void act(async () => {
                const value = await api("/providers/chatgpt/connect", ChatGptLink.parse, {});
                const url = new URL(value.url);
                if (url.origin !== "https://auth.openai.com")
                  throw new Error("Unexpected sign-in destination");
                setLink(value.url);
              })
            }
          >
            Continue with ChatGPT
          </button>
          {link && (
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                Open ChatGPT sign-in ↗
              </a>
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await refresh();
                setMessage("Connection status refreshed.");
              })
            }
          >
            Refresh connection status
          </button>
          {connection.error && (
            <p className="error" role="alert">
              {connection.error}
            </p>
          )}
          {Object.entries(config.providers)
            .filter(([, p]) => "apiKeySecret" in p && p.apiKeySecret)
            .map(([id]) => (
              <form
                className="key-form"
                key={id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const key = String(new FormData(form).get("key"));
                  void act(async () => {
                    await api(
                      `/providers/${encodeURIComponent(id)}/secret`,
                      () => undefined,
                      ProviderKeyInput.parse({ key }),
                    );
                    form.reset();
                    setMessage(`Saved the ${id} key on the host.`);
                  });
                }}
              >
                <label>
                  {id} API key
                  <input
                    type="password"
                    name="key"
                    required
                    autoComplete="new-password"
                    disabled={connection.offline || !connection.hostLocal}
                  />
                </label>
                <button type="submit" disabled={busy || connection.offline || !connection.hostLocal}>
                  Save {id} key
                </button>
              </form>
            ))}
        </div>
      ) : (
        <UsageTable records={records} refresh={() => void act(refresh)} />
      )}
    </div>
  );
}

function UsageTable({ records, refresh }: { records: UsageRecord[]; refresh: () => void }) {
  const [group, setGroup] = useState<"provider" | "role" | "model">("provider");
  const [from, setFrom] = useState("");
  const filtered = from ? records.filter((r) => r.at.slice(0, 10) >= from) : records;
  const rows = new Map<
    string,
    { calls: number; tokens: number; cost: number; plan: number; failed: number }
  >();
  for (const r of filtered) {
    const row = rows.get(r[group]) ?? { calls: 0, tokens: 0, cost: 0, plan: 0, failed: 0 };
    row.calls++;
    row.tokens += r.input + r.output;
    row.failed += Number(!r.ok);
    if (r.costEstimate === "plan") row.plan++;
    else row.cost += r.costEstimate;
    rows.set(r[group], row);
  }
  return (
    <div>
      <div className="form-row">
        <label>
          Group by
          <select value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
            <option value="provider">Provider</option>
            <option value="role">Role</option>
            <option value="model">Model</option>
          </select>
        </label>
        <label>
          From date
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      </div>
      <p className="muted">
        Up to 1,000 most recent calls. Estimates use configured prices; ChatGPT plan usage is shown
        separately.
      </p>
      {!rows.size ? (
        <p>No model calls recorded yet.</p>
      ) : (
        <div className="usage-scroll">
          <table>
            <caption>Recorded model usage</caption>
            <thead>
              <tr>
                <th scope="col">{group}</th>
                <th scope="col">Calls</th>
                <th scope="col">Tokens</th>
                <th scope="col">Failed</th>
                <th scope="col">API estimate</th>
                <th scope="col">Plan calls</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].map(([name, row]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{row.calls}</td>
                  <td>{row.tokens.toLocaleString()}</td>
                  <td>{row.failed}</td>
                  <td>${row.cost.toFixed(4)}</td>
                  <td>{row.plan}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={refresh}>
        Refresh usage
      </button>
    </div>
  );
}
