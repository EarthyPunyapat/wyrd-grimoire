import * as Dialog from "@radix-ui/react-dialog";
import { AuthStatus, CampaignCard, GameView } from "@wyrd/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { ModelSettings } from "./ModelSettings.tsx";
import { NewCampaign } from "./NewCampaign.tsx";
import { Play } from "./Play.tsx";
import { PlayPreferencesPanel } from "./PlayPreferences.tsx";
import { usePlayPreferences } from "./presets.ts";

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
  // UI 2.0 presets and dials are device preferences, applied live while a campaign is open (D150, U6).
  const [playPreferences, setPlayPreferences] = usePlayPreferences();
  const refreshAuth = useCallback(async () => {
    setAuth(await api("/auth/status", AuthStatus.parse));
  }, []);
  const refreshCards = useCallback(async () => {
    setCards(await api("/campaigns", CampaignCard.array().parse));
  }, []);
  const removeCampaign = useCallback(
    async (card: CampaignCard) => {
      if (
        !window.confirm(
          `Delete “${card.name}”? Its event log, saves and backups on this server will be removed. This cannot be undone.`,
        )
      )
        return;
      setLoading(true);
      setError("");
      try {
        await api(`/campaigns/${card.id}`, () => undefined, undefined, "DELETE");
        await refreshCards();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [refreshCards],
  );
  const openCampaign = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      setView(await api(`/campaigns/${id}/view`, GameView.parse));
      // Push a real entry so browser Back returns to the list instead of leaving the app. A
      // deep link or a back/forward to this same campaign must not add another one.
      const hash = `#campaign=${encodeURIComponent(id)}`;
      if (location.hash !== hash) history.pushState(null, "", hash);
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
  // The hash can change without a reload — history, a pasted link, another tab. Open
  // whatever campaign it now names, so deep links work after the first load too; back to a
  // hash with no campaign is a return to the list. In-page anchors (the "Skip to story"
  // link) are not navigation and must keep the player in the campaign.
  useEffect(() => {
    if (!auth?.authenticated) return;
    const onHashChange = () => {
      const id = new URLSearchParams(location.hash.slice(1)).get("campaign");
      if (id) {
        if (id !== view?.id) void openCampaign(id);
        return;
      }
      if (location.hash && location.hash !== "#") return;
      setView(undefined);
      void refreshCards().catch((e) => setError(e.message));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [auth?.authenticated, openCampaign, refreshCards, view?.id]);
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
        <Play
          view={view}
          onView={setView}
          onOpenCampaign={openCampaign}
          onHome={() => {
            setView(undefined);
            history.replaceState(null, "", location.pathname);
            void refreshCards().catch((e) => setError(e.message));
          }}
          {...(auth?.authenticated ? { onAppSettings: () => setSettings(true) } : {})}
          offline={Boolean(auth?.offline)}
        />
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
                <div className="campaign-row" key={card.id}>
                  <button
                    type="button"
                    className="campaign-card"
                    disabled={loading}
                    onClick={() => void openCampaign(card.id)}
                  >
                    <span className="card-sigil" aria-hidden="true">
                      ᚹ
                    </span>
                    <span>
                      <strong>{card.name}</strong>
                      <span>{card.characterName}</span>
                    </span>
                    <span className="card-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                  <button
                    type="button"
                    className="campaign-delete"
                    disabled={loading}
                    aria-label={`Delete ${card.name}`}
                    onClick={() => void removeCampaign(card)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-campaigns">
              <span aria-hidden="true">✧</span>
              <h3>Every story begins somewhere.</h3>
              <p>Describe a world. Discover who you could be within it.</p>
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
            <Dialog.Title>Begin a new story</Dialog.Title>
            <Dialog.Description>
              Tell us what you want to play. Review your world and character options before the adventure
              begins.
            </Dialog.Description>
            <NewCampaign
              offline={auth?.offline ?? false}
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
            <PlayPreferencesPanel value={playPreferences} onChange={setPlayPreferences} />
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
      <h1>{setupRequired ? "A key to your world." : "Welcome back."}</h1>
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
