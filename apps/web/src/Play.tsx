import * as Dialog from "@radix-ui/react-dialog";
import { type GameView, ThemeSpec } from "@wyrd/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Cards } from "./Cards.tsx";
import { CombatPanel, CombatStrip } from "./Combat.tsx";
import { ABILITIES_KEY, Hotbar } from "./Hotbar.tsx";
import { ChromeIcon } from "./icons.tsx";
import { MENU_LABEL, Menus, type MenuTab } from "./Menus.tsx";
import { NarrativeText, narrationContext, RefContext } from "./Narration.tsx";
import { Passage, RollNotes } from "./Passage.tsx";
import { MediaContext } from "./Portrait.tsx";
import { usePlayPreset } from "./presets.ts";
import { ShopWares } from "./Shop.tsx";
import { type Menu, StatusStrip } from "./StatusStrip.tsx";
import { ShopContext } from "./shop-context.ts";
import { clearThemeVars, themeVars } from "./theme.ts";
import { useCampaignSettings } from "./use-campaign-settings.ts";
import { usePlay } from "./use-play.ts";

export function Play({
  view,
  onView,
  onOpenCampaign,
  onHome,
  appSettings,
  offline,
}: {
  view: GameView;
  onView: (view: GameView) => void;
  onOpenCampaign?: (id: string) => void | Promise<void>;
  onHome?: () => void;
  /** Device, display and model settings, shown in the status screen's one Settings tab. */
  appSettings?: ReactNode;
  offline?: boolean;
}) {
  // A pack theme overrides the app's default palette (spec 13 Themes).
  useEffect(() => {
    const parsed = ThemeSpec.safeParse(view.theme);
    if (!parsed.success) return;
    const variant = document.documentElement.dataset.theme;
    const dark =
      variant === "dark" || (variant !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    const vars = themeVars(parsed.data, dark);
    for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(name, value);
    return () => clearThemeVars(document.documentElement.style, vars);
  }, [view.theme]);
  // The chosen preset themes the whole page while playing: the app bar and the menus that open over the story (D150).
  const preset = usePlayPreset();
  useEffect(() => {
    document.documentElement.dataset.preset = preset;
    return () => {
      delete document.documentElement.dataset.preset;
    };
  }, [preset]);
  const [input, setInput] = useState("");
  const [combatOpen, setCombatOpen] = useState(false);
  const [abilitiesOpen, setAbilitiesOpen] = useState(false);
  // The vendor pop-up opens only where a vendor trades (D166); it closes itself if they leave.
  const [shopOpen, setShopOpen] = useState(false);
  const shopHere = view.shop;
  const [panelOpen, setPanelOpen] = useState<MenuTab | null>(null);
  const [codexFocus, setCodexFocus] = useState<string | null>(null);
  const [legacyName, setLegacyName] = useState("");
  const [legacyError, setLegacyError] = useState("");
  // The campaign's setting seeds the device once; after that the checkbox owns this device.
  const [mathChoice, setMathChoice] = useState<boolean | null>(() => {
    const stored = localStorage.getItem("wyrd-math");
    return stored === null ? null : stored === "true";
  });
  const settings = useCampaignSettings(view.id);
  const math = mathChoice ?? settings?.narration.showMath ?? true;
  const suggestions = settings?.narration.suggestions ?? true;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const play = usePlay(view, onView);
  const activeAvatar = view.avatars.find((run) => run.status === "active");
  const [unseal, setUnseal] = useState<{ text: string; option?: number } | null>(null);
  const fill = (text: string) => {
    setInput(text);
    setCombatOpen(false);
    textarea.current?.focus();
  };
  const inCombat = !!view.combat && !view.ended;
  // Reader keeps one reading column: every menu opens over the story, never beside it (DESIGN.md).
  const openMenu = (menu: Menu) => setPanelOpen(menu);
  const openCodex = (id: string) => {
    setCodexFocus(id);
    setPanelOpen("codex");
  };
  const travel = (text: string) => {
    fill(text);
    setPanelOpen(null);
  };
  const last = view.turns.at(-1);
  const submit = useCallback(
    async (text: string, option?: number) => {
      if (!text.trim()) return;
      const accepted = await play.send(
        text,
        option !== undefined && last ? { turnId: last.id, option } : undefined,
      );
      if (accepted) setInput("");
    },
    [play.send, last],
  );
  // D134: stepping in as the sovereign during an avatar's run unseals it, so ask first.
  const send = useCallback(
    async (text: string, option?: number) => {
      if (!text.trim()) return;
      if (activeAvatar && view.pc.level === "infinite") {
        setUnseal(option === undefined ? { text } : { text, option });
        return;
      }
      await submit(text, option);
    },
    [activeAvatar, view.pc.level, submit],
  );
  const menuTurn = (text: string) => {
    setPanelOpen(null);
    void send(text);
  };
  useEffect(() => {
    if (!play.busy) textarea.current?.focus();
    bottom.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [play.busy, view.turns.length]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,[role=dialog],[contenteditable=true]"))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "c") {
        setPanelOpen("character");
        return;
      }
      // Spec 12 keyboard: C/I/Q/J/M open the status screen on that tab.
      const destinations = {
        i: "inventory",
        q: "quests",
        j: "journal",
        m: "map",
      } as const;
      if (key in destinations) {
        e.preventDefault();
        setPanelOpen(destinations[key as keyof typeof destinations]);
        return;
      }
      // Hotbar keys (spec §12): O observe, T time skip, G choices, X combat.
      if (key === "o" || key === "t") {
        e.preventDefault();
        fill(key === "o" ? "Observe " : "Time skip: ");
        return;
      }
      if (key === ABILITIES_KEY.toLowerCase()) {
        e.preventDefault();
        setAbilitiesOpen((open) => !open);
        return;
      }
      if (key === "g" && !play.busy) {
        e.preventDefault();
        void send("Give me choices");
        return;
      }
      if (key === "x" && inCombat) {
        e.preventDefault();
        setCombatOpen(true);
        return;
      }
      const choice = last?.clarification?.options[Number(e.key) - 1];
      if (choice && !play.busy) {
        e.preventDefault();
        void send(choice.label, Number(e.key) - 1);
        return;
      }
      const gmChoice = last?.choices[Number(e.key) - 1];
      if (gmChoice && !play.busy) {
        e.preventDefault();
        void send(gmChoice.label);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [last, play.busy, send, inCombat]);
  return (
    <ShopContext.Provider value={shopHere ? () => setShopOpen(true) : null}>
      <MediaContext.Provider value={view.media}>
        <RefContext.Provider value={{ known: view.known, campaignId: view.id, open: openCodex }}>
          <main id="main" className="play-layout play-reader" data-preset={preset}>
            <h1 className="sr-only">{view.name}</h1>
            <StatusStrip
              view={view}
              active={panelOpen}
              onMenu={openMenu}
              onSettings={() => setPanelOpen("settings")}
              {...(onHome ? { onHome } : {})}
              offline={Boolean(offline)}
            />
            <section className="story" aria-label="Story">
              <div className="story-scroll">
                <div className="story-inner">
                  <button
                    type="button"
                    className="story-jump sr-only"
                    onClick={() => {
                      bottom.current?.scrollIntoView({ block: "end" });
                      textarea.current?.focus();
                    }}
                  >
                    Jump to the latest passage
                  </button>
                  {view.scene?.banner && (
                    <figure className="place-banner">
                      <img src={view.scene.banner} alt={view.scene.location} />
                      <figcaption>{view.scene.location}</figcaption>
                    </figure>
                  )}
                  {!view.turns.length && (
                    <div className="opening">
                      <div className="chapter-heading">
                        <span className="chapter-numeral" aria-hidden="true">
                          I
                        </span>
                        <div>
                          <h2>{view.scene?.location ?? view.worldName}</h2>
                          <span className="chapter-locator">Chapter one · {view.worldName}</span>
                        </div>
                      </div>
                      <p className="prose">
                        <NarrativeText text={view.opening} names={narrationContext(view).names} />
                      </p>
                      <p className="opening-note">
                        Your story begins with what you choose to do, {view.address}.
                      </p>
                    </div>
                  )}
                  <div aria-live="polite" aria-relevant="additions text" aria-busy={play.busy}>
                    {view.turns.map((turn) => (
                      <Passage
                        key={turn.id}
                        turn={turn}
                        view={view}
                        busy={play.busy}
                        math={math}
                        onReroll={() => void play.reroll(turn.id)}
                        onFix={(id) => void play.fix(id)}
                        onAcceptLevel={(id) => void play.acceptLevel(id)}
                        onUndo={(id) => void play.undo(id)}
                        {...(turn.id === last?.id
                          ? {
                              onChoice: (label: string) => void send(label),
                              onClarify: (i: number, label: string) => void send(label, i),
                            }
                          : {})}
                      />
                    ))}
                  </div>
                  {play.busy && (
                    <div className="pending" role="status">
                      {play.progress && (
                        <p className="progress-line muted small">
                          {play.progress.phase === "researching"
                            ? "Researching"
                            : play.progress.phase === "rolling"
                              ? "Rolling"
                              : play.progress.phase === "simulating"
                                ? "Letting time pass"
                                : "Writing"}
                          {play.progress.detail ? `: ${play.progress.detail}` : "…"}
                        </p>
                      )}
                      {play.live && (
                        <div className="live-passage">
                          <NarrativeText text={play.live} names={narrationContext(view).names} />
                        </div>
                      )}
                      <Cards cards={play.cards} view={view} mechanics={play.mechanics} />
                      {play.choices.length > 0 && (
                        <fieldset className="gm-choices">
                          <legend className="sr-only">Choices</legend>
                          {play.choices.map((choice, i) => (
                            <button
                              type="button"
                              key={choice.label}
                              disabled={play.busy}
                              onClick={() => void send(choice.label)}
                            >
                              <kbd>{i + 1}</kbd> {choice.label}
                            </button>
                          ))}
                        </fieldset>
                      )}
                      {play.checkFlags.length > 0 && (
                        <details className="canon-check">
                          <summary>
                            <span className="canon-check-title">Canon check</span>
                            <span className="canon-check-count">{play.checkFlags.length} to review</span>
                          </summary>
                          <div className="check-flags">
                            {play.checkFlags.map((flag) => (
                              <p key={flag.quote}>
                                <q>{flag.quote}</q> — {flag.claim}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                      <RollNotes lines={play.mechanics} math resolution={view.resolution} />
                      <p>
                        <span className="pulse" aria-hidden="true">
                          ✦
                        </span>{" "}
                        The thread of fate is turning…
                      </p>
                    </div>
                  )}
                  {play.reconnecting && (
                    <p role="status" className="connection-banner">
                      Connection lost. Reconnecting to your turn…
                    </p>
                  )}
                  {play.error && (
                    <div role="alert" className="error">
                      {play.error}{" "}
                      <button type="button" onClick={() => void play.refresh().catch(() => {})}>
                        Refresh story
                      </button>
                    </div>
                  )}
                  {view.ended && (
                    <section className="obituary" aria-labelledby="obituary-title">
                      <div className="eyebrow">HERE ENDS A LIFE</div>
                      <h2 id="obituary-title">{view.pc.identity.name} is dead</h2>
                      <p className="prose">{view.ended.obituary}</p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!legacyName.trim()) return;
                          setLegacyError("");
                          try {
                            await api(`/campaigns/${view.id}/legacy`, (d) => d, {
                              characterName: legacyName.trim(),
                            });
                            setLegacyName("");
                            await play.refresh();
                          } catch (err) {
                            setLegacyError((err as Error).message);
                          }
                        }}
                      >
                        <label>
                          Legacy: a new character in the same world
                          <input
                            value={legacyName}
                            onChange={(e) => setLegacyName(e.target.value)}
                            placeholder="Their name"
                            maxLength={80}
                          />
                        </label>
                        <button className="primary" type="submit" disabled={!legacyName.trim()}>
                          Begin a new life →
                        </button>
                        {legacyError && (
                          <p role="alert" className="error">
                            {legacyError}
                          </p>
                        )}
                      </form>
                    </section>
                  )}
                  {inCombat && <CombatStrip combat={view.combat!} />}
                  <form
                    hidden={!!view.ended}
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send(input);
                    }}
                  >
                    <div className="composer-inner">
                      {shopHere && (
                        <button type="button" className="shop-here" onClick={() => setShopOpen(true)}>
                          <ChromeIcon name="coins" size={16} />
                          <span>
                            <strong>{shopHere.name}</strong>
                            {shopHere.merchant && <span className="muted"> · {shopHere.merchant}</span>}
                          </span>
                          <span className="shop-here-cta">Browse wares</span>
                        </button>
                      )}
                      {suggestions && (
                        <fieldset className="suggestions">
                          <legend className="sr-only">Suggested actions</legend>
                          {view.suggestions.map((s) => (
                            <button
                              type="button"
                              key={s}
                              disabled={play.busy}
                              onClick={() => {
                                setInput(s);
                                textarea.current?.focus();
                              }}
                            >
                              {s} <span aria-hidden="true">↗</span>
                            </button>
                          ))}
                        </fieldset>
                      )}
                      <div className="input-row">
                        <label htmlFor="action-input">What do you do?</label>
                        <textarea
                          ref={textarea}
                          id="action-input"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              void send(input);
                            }
                          }}
                          placeholder="Write your next line…  / to type, /gm to change the world"
                          rows={2}
                          maxLength={4000}
                          disabled={play.busy}
                        />
                      </div>
                      <div className="composer-foot">
                        <span>{play.busy ? "The story is being written…" : ""}</span>
                        <label>
                          <input
                            type="checkbox"
                            checked={math}
                            onChange={(e) => {
                              setMathChoice(e.target.checked);
                              localStorage.setItem("wyrd-math", String(e.target.checked));
                            }}
                          />
                          Show the math
                        </label>
                      </div>
                    </div>
                  </form>
                  <div ref={bottom} />
                </div>
              </div>
            </section>
            <Hotbar
              abilities={view.pc.abilities}
              companions={view.companions}
              level={view.pc.level}
              busy={play.busy}
              inCombat={inCombat}
              onFill={fill}
              onSend={(text) => void send(text)}
              onCombat={() => setCombatOpen(true)}
              abilitiesOpen={abilitiesOpen}
              onAbilitiesOpen={setAbilitiesOpen}
            />
            <Dialog.Root open={panelOpen !== null} onOpenChange={(o) => !o && setPanelOpen(null)}>
              <Dialog.Portal>
                <Dialog.Overlay className="overlay menu-overlay" />
                <Dialog.Content className="dialog menu-screen" data-preset={preset}>
                  <Dialog.Title>
                    {panelOpen === "settings" ? "Settings" : panelOpen ? MENU_LABEL[panelOpen] : "Status"}
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">
                    A full-screen status screen with tabs for your character, inventory, quests, journal,
                    codex, map, timeline and settings. Escape returns to the story.
                  </Dialog.Description>
                  {panelOpen && (
                    <Menus
                      view={view}
                      tab={panelOpen}
                      onTab={setPanelOpen}
                      onRefresh={async () => {
                        await play.refresh();
                      }}
                      onSend={menuTurn}
                      onTravel={travel}
                      onOpenCodex={openCodex}
                      onClose={() => setPanelOpen(null)}
                      {...(onOpenCampaign ? { onOpenCampaign } : {})}
                      codexFocus={codexFocus}
                      appSettings={appSettings}
                    />
                  )}
                  <Dialog.Close className="dialog-close menu-close" aria-label="Close status screen">
                    ×
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Dialog.Root open={shopOpen && !!shopHere} onOpenChange={setShopOpen}>
              <Dialog.Portal>
                <Dialog.Overlay className="overlay" />
                <Dialog.Content className="dialog shop-dialog" data-preset={preset}>
                  <Dialog.Title>{shopHere?.name ?? "Vendor"}</Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Buy from and sell to the vendor where you are standing.
                  </Dialog.Description>
                  {shopHere && (
                    <ShopWares
                      view={view}
                      shop={shopHere}
                      onChanged={async () => {
                        await play.refresh();
                      }}
                    />
                  )}
                  <Dialog.Close className="dialog-close" aria-label="Close shop">
                    ×
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Dialog.Root open={combatOpen} onOpenChange={setCombatOpen}>
              <Dialog.Portal>
                <Dialog.Overlay className="overlay" />
                <Dialog.Content className="dialog sheet-dialog">
                  <Dialog.Title>Combat</Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Turn order, the battlefield, and your legal actions.
                  </Dialog.Description>
                  {view.combat && (
                    <CombatPanel
                      combat={view.combat}
                      busy={play.busy}
                      onFill={fill}
                      resolution={view.resolution}
                    />
                  )}
                  <Dialog.Close className="dialog-close" aria-label="Close combat panel">
                    ×
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Dialog.Root open={unseal !== null} onOpenChange={(o) => !o && setUnseal(null)}>
              <Dialog.Portal>
                <Dialog.Overlay className="overlay" />
                <Dialog.Content className="dialog">
                  <Dialog.Title>Act as the sovereign?</Dialog.Title>
                  <Dialog.Description>
                    {activeAvatar
                      ? `${activeAvatar.name}'s run is still active.`
                      : "An avatar run is active."}{" "}
                    Stepping in as the sovereign will mark the run unsealed. Its record will show it.
                  </Dialog.Description>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      const pending = unseal;
                      setUnseal(null);
                      if (pending) void submit(pending.text, pending.option);
                    }}
                  >
                    Act as the sovereign
                  </button>
                  <Dialog.Close className="dialog-close" aria-label="Stay with the avatar">
                    Cancel
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </main>
        </RefContext.Provider>
      </MediaContext.Provider>
    </ShopContext.Provider>
  );
}
