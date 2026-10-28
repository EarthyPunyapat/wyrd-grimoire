import * as Dialog from "@radix-ui/react-dialog";
import {
  AuthStatus,
  CampaignCard,
  CreatedCampaign,
  GameView,
  QuickStartInput,
  QuickStartOptions,
} from "@wyrd/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { ModelSettings } from "./ModelSettings.tsx";
import { Play } from "./Play.tsx";

export function App() {
  const [auth, setAuth] = useState<ReturnType<typeof AuthStatus.parse>>();
  const [cards, setCards] = useState<CampaignCard[]>([]);
  const [view, setView] = useState<GameView>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("wyrd-theme") ?? "system");
  const [font, setFont] = useState(localStorage.getItem("wyrd-font") ?? "normal");
  const refreshAuth = useCallback(async () => {
    setAuth(await api("/auth/status", AuthStatus.parse));
  }, []);
  const refreshCards = useCallback(async () => {
    setCards(await api("/campaigns", CampaignCard.array().parse));
  }, []);
  const openCampaign = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      setView(await api(`/campaigns/${id}/view`, GameView.parse));
      history.replaceState(null, "", `#campaign=${encodeURIComponent(id)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshAuth().catch((e) => setError(e.message));
  }, [refreshAuth]);
  useEffect(() => {
    if (auth?.authenticated) {
      void refreshCards().catch((e) => setError(e.message));
      const id = new URLSearchParams(location.hash.slice(1)).get("campaign");
      if (id) void openCampaign(id);
    }
  }, [auth, refreshCards, openCampaign]);
  useEffect(() => {
    const lock = () => {
      setAuth((a) => (a ? { ...a, authenticated: false } : a));
      setView(undefined);
    };
    window.addEventListener("wyrd:locked", lock);
    return () => window.removeEventListener("wyrd:locked", lock);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.font = font;
    localStorage.setItem("wyrd-theme", theme);
    localStorage.setItem("wyrd-font", font);
  }, [theme, font]);
  return (
    <div className={view ? "frame" : "home-frame"}>
      <a className="skip-link" href="#main">
        Skip to story
      </a>
      <header className="topbar">
        <button
          type="button"
          className="wordmark"
          onClick={() => {
            setView(undefined);
            history.replaceState(null, "", location.pathname);
            void refreshCards().catch((e) => setError(e.message));
          }}
          aria-label="Wyrd Grimoire home"
        >
          <span aria-hidden="true">ᚹ</span> Wyrd <i>Grimoire</i>
        </button>
        {view && <span className="campaign-title">{view.name}</span>}
        <div className="top-tools">
          {auth?.offline && <span className="mode-badge">Offline preview</span>}
          {auth?.authenticated && (
            <button type="button" onClick={() => setSettings(true)}>
              Settings
            </button>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="error global-error">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              void refreshAuth().catch((e) => setError(e.message));
            }}
          >
            Reconnect
          </button>
        </p>
      )}
      {!auth ? (
        <main id="main" className="home">
          <p role="status">Opening your grimoire…</p>
        </main>
      ) : !auth.authenticated ? (
        <Unlock setupRequired={auth.setupRequired} onUnlock={refreshAuth} />
      ) : view ? (
        <Play view={view} onView={setView} />
      ) : (
        <main id="main" className="home">
          <div className="eyebrow">A GRIMOIRE OF FATE</div>
          <h1>
            Your next chapter
            <br />
            <em>is unwritten.</em>
          </h1>
          <p className="lead">
            A world that remembers. Dice that decide.
            <br />
            The rest is yours to discover.
          </p>
          <div className="section-heading">
            <h2>Your campaigns</h2>
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              + New campaign
            </button>
          </div>
          {cards.length ? (
            <div className="campaign-list">
              {cards.map((card) => (
                <button
                  type="button"
                  className="campaign-card"
                  key={card.id}
                  disabled={loading}
                  onClick={() => void openCampaign(card.id)}
                >
                  <span className="card-sigil" aria-hidden="true">
                    ᚹ
                  </span>
                  <span>
                    <strong>{card.name}</strong>
                    <span>{card.characterName} · Ashford Ferry</span>
                  </span>
                  <span className="card-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-campaigns">
              <span aria-hidden="true">✧</span>
              <h3>Every story begins somewhere.</h3>
              <p>Make a character and take your first steps into Ashford Ferry.</p>
              <button type="button" onClick={() => setCreating(true)}>
                Begin a new story →
              </button>
            </div>
          )}
          <p className="home-note">Code keeps the rules. The storyteller gives them a voice.</p>
        </main>
      )}
      <Dialog.Root open={creating} onOpenChange={setCreating}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title>A night at Ashford</Dialog.Title>
            <Dialog.Description>
              A missing ferryman, a rain-swollen river, and a village with something to hide. A hand-authored
              fantasy adventure.
            </Dialog.Description>
            <NewCampaign
              onCreate={(id) => {
                setCreating(false);
                void openCampaign(id);
              }}
            />
            <Dialog.Close className="dialog-close" aria-label="Close new campaign">
              ×
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={settings} onOpenChange={setSettings}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title>Make yourself at home</Dialog.Title>
            <Dialog.Description>Reading and connection preferences for this device.</Dialog.Description>
            <label>
              Appearance
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="system">Follow device</option>
                <option value="light">Stone vellum</option>
                <option value="dark">After dark</option>
              </select>
            </label>
            <label>
              Story type size
              <select value={font} onChange={(e) => setFont(e.target.value)}>
                <option value="normal">Comfortable</option>
                <option value="large">Large print</option>
              </select>
            </label>
            <ModelSettings />
            <button
              type="button"
              onClick={() => {
                void api("/auth/logout", () => undefined, {})
                  .then(() => {
                    setSettings(false);
                    setView(undefined);
                    return refreshAuth();
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              Lock grimoire
            </button>
            <Dialog.Close className="dialog-close" aria-label="Close settings">
              ×
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Unlock({ setupRequired, onUnlock }: { setupRequired: boolean; onUnlock: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main id="main" className="unlock home">
      <div className="eyebrow">THE STORY AWAITS</div>
      <h1>{setupRequired ? "A key to your world." : "Welcome back, traveller."}</h1>
      <p>
        {setupRequired
          ? "On the host PC, choose a passcode of at least 12 characters. Use it to unlock this grimoire from your other devices."
          : "Enter your passcode to pick up the thread."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const passcode = String(new FormData(e.currentTarget).get("passcode"));
          try {
            await api(setupRequired ? "/auth/setup" : "/auth/login", () => undefined, { passcode });
            await onUnlock();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Passcode
          <input
            name="passcode"
            type="password"
            autoComplete={setupRequired ? "new-password" : "current-password"}
            required
            minLength={setupRequired ? 12 : 1}
            maxLength={256}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Opening…" : setupRequired ? "Set passcode & enter" : "Unlock grimoire"}
        </button>
      </form>
    </main>
  );
}

function NewCampaign({ onCreate }: { onCreate: (id: string) => void }) {
  const [options, setOptions] = useState<ReturnType<typeof QuickStartOptions.parse>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ancestry, setAncestry] = useState("human");
  const [archetype, setArchetype] = useState("cutpurse");
  useEffect(() => {
    void api("/packs", QuickStartOptions.parse)
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const input = QuickStartInput.parse(Object.fromEntries(new FormData(e.currentTarget)));
          const created = await api("/campaigns", CreatedCampaign.parse, input);
          onCreate(created.id);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Campaign name
        <input name="name" defaultValue="A Night at Ashford" required maxLength={100} />
      </label>
      <label>
        Character name
        <input name="characterName" defaultValue="Wren" required maxLength={80} />
      </label>
      <div className="form-row">
        <label>
          Ancestry
          <select name="ancestry" value={ancestry} onChange={(e) => setAncestry(e.target.value)}>
            {options?.ancestries.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Archetype
          <select name="archetype" value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            {options?.archetypes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">Quick start · fantasy-core · d100 · standard rules</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy || !options}>
        {busy ? "Preparing your story…" : "Step into Ashford Ferry →"}
      </button>
    </form>
  );
}
