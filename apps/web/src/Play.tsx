import * as Dialog from "@radix-ui/react-dialog";
import type { GameView } from "@wyrd/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { NarrativeText, narrationContext } from "./Narration.tsx";
import { Mechanics, Passage } from "./Passage.tsx";
import { Sheet } from "./Sheet.tsx";
import { usePlay } from "./use-play.ts";

export function Play({ view, onView }: { view: GameView; onView: (view: GameView) => void }) {
  const [input, setInput] = useState("");
  const [sheet, setSheet] = useState(false);
  const [math, setMath] = useState(localStorage.getItem("wyrd-math") !== "false");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const play = usePlay(view, onView);
  const last = view.turns.at(-1);
  const send = useCallback(
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
  useEffect(() => {
    if (!play.busy) textarea.current?.focus();
    bottom.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [play.busy, view.turns.length]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,[role=dialog]")) return;
      if (e.key.toLowerCase() === "c") setSheet(true);
      const choice = last?.clarification?.options[Number(e.key) - 1];
      if (choice && !play.busy) {
        e.preventDefault();
        void send(choice.label, Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [last, play.busy, send]);
  return (
    <main id="main" className="play-layout">
      <h1 className="sr-only">{view.name}</h1>
      <section className="story" aria-label="Story">
        <div className="location-bar">
          <span>
            ⌂ <strong>{view.scene?.location ?? "Between chapters"}</strong>{" "}
            {view.scene?.zone && ` / ${view.scene.zone}`}
          </span>
          <span>
            {view.scene?.weather} ·{" "}
            {Math.floor((view.gameTime % 1440) / 60)
              .toString()
              .padStart(2, "0")}
            :{(view.gameTime % 60).toString().padStart(2, "0")}
          </span>
        </div>
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
            <div className="scene-banner" aria-hidden="true">
              <svg viewBox="0 0 800 210" preserveAspectRatio="xMidYMid slice">
                <title>A map of possible paths</title>
                <path
                  className="hills"
                  d="M0 150 100 120 220 160 350 100 450 140 570 80 680 130 800 90V210H0Z"
                />
                <path
                  className="ferry"
                  d="M100 120 220 160 350 100 450 140 570 80 680 130M350 100v-55m-25 25h50m-25-15 15 15-15 15-15-15Z"
                />
              </svg>
              <span>
                {view.worldName} <small>ON THE EDGE OF SOMETHING</small>
              </span>
            </div>
            <div className="chapter-label">
              <span />
              THE STORY SO FAR
              <span />
            </div>
            {!view.turns.length && (
              <div className="opening">
                <div className="eyebrow">CHAPTER ONE</div>
                <h2>{view.scene?.location ?? view.worldName}</h2>
                <p className="prose">
                  <NarrativeText text={view.opening} names={narrationContext(view).names} />
                </p>
                <p className="opening-note">Your story begins with what you choose to do.</p>
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
                  {...(turn.id === last?.id
                    ? { onChoice: (i: number, label: string) => void send(label, i) }
                    : {})}
                />
              ))}
            </div>
            {play.busy && (
              <div className="pending" role="status">
                <Mechanics lines={play.mechanics} expanded />
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
            <div ref={bottom} />
          </div>
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="composer-inner">
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
            <div className="input-row">
              <label className="sr-only" htmlFor="action-input">
                What do you do?
              </label>
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
                placeholder="What do you do?"
                rows={2}
                maxLength={4000}
                disabled={play.busy}
              />
              <button className="primary send-button" disabled={play.busy || !input.trim()} type="submit">
                {play.busy ? "…" : "Send ↑"}
              </button>
            </div>
            <div className="composer-foot">
              <span>Enter to send · Shift + Enter for a new line</span>
              <label>
                <input
                  type="checkbox"
                  checked={math}
                  onChange={(e) => {
                    setMath(e.target.checked);
                    localStorage.setItem("wyrd-math", String(e.target.checked));
                  }}
                />
                Show the math
              </label>
            </div>
          </div>
        </form>
      </section>
      <aside className="desktop-sheet" aria-label="Character sheet">
        <div className="panel-heading">
          Character sheet{" "}
          <button type="button" onClick={() => setSheet(true)} aria-label="Expand character sheet">
            ↗
          </button>
        </div>
        <Sheet view={view} />
      </aside>
      <Dialog.Root open={sheet} onOpenChange={setSheet}>
        <div className="mobile-bar">
          <span>
            {view.pc.identity.name} · HP {view.pc.status.hp}/{view.pc.derived.hpMax}
          </span>
          <Dialog.Trigger>Sheet ↗</Dialog.Trigger>
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog sheet-dialog">
            <Dialog.Title>Character sheet</Dialog.Title>
            <Dialog.Description className="sr-only">
              Attributes, skills, wounds, and nearby people.
            </Dialog.Description>
            <Sheet view={view} />
            <Dialog.Close className="dialog-close" aria-label="Close character sheet">
              ×
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
