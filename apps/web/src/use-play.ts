import {
  AcceptedTurn,
  type Card,
  type Choice,
  GameView,
  type MechanicsLine,
  SubmitTurnInput,
  WebStreamEvent,
} from "@wyrd/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

export type Progress = { phase: "researching" | "rolling" | "simulating" | "writing"; detail?: string };

export function usePlay(view: GameView, onView: (view: GameView) => void) {
  const key = `wyrd-pending-${view.id}`;
  const [pending, setPending] = useState<string | null>(() => sessionStorage.getItem(key));
  const [sending, setSending] = useState(false);
  const [mechanics, setMechanics] = useState<MechanicsLine[]>([]);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  // The turn as it arrives, before the refreshed view replaces it.
  const [live, setLive] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [checkFlags, setCheckFlags] = useState<{ quote: string; claim: string }[]>([]);
  const retry = useRef<ReturnType<typeof SubmitTurnInput.parse> | null>(null);
  const refreshSeq = useRef(0);
  const resetLive = () => {
    setMechanics([]);
    setLive("");
    setProgress(null);
    setCards([]);
    setChoices([]);
    setCheckFlags([]);
  };
  const refresh = useCallback(async () => {
    const mine = ++refreshSeq.current;
    const updated = await api(`/campaigns/${view.id}/view`, GameView.parse);
    // Only the newest request may win; a slow older refresh must not overwrite a newer view.
    if (mine === refreshSeq.current) {
      onView(updated);
      setError("");
    }
    return updated;
  }, [view.id, onView]);
  useEffect(() => {
    if (!pending) return;
    sessionStorage.setItem(key, pending);
    const source = new EventSource(`/api/campaigns/${view.id}/turns/${pending}/stream`);
    const eventIds = new Set<string>();
    let completed = false;
    const listener = async (event: Event) => {
      if (!(event instanceof MessageEvent)) {
        if (!completed) setReconnecting(true);
        return;
      }
      if (eventIds.has(event.lastEventId)) return;
      eventIds.add(event.lastEventId);
      try {
        const data = WebStreamEvent.parse(JSON.parse(event.data));
        setReconnecting(false);
        if (data.type === "mechanics.line") setMechanics((lines) => [...lines, data.line]);
        if (data.type === "error") setError(data.message);
        if (data.type === "narration.delta") setLive((text) => text + data.delta);
        if (data.type === "narration.final") setLive(data.text);
        if (data.type === "progress") setProgress(data);
        if (data.type === "card") setCards((shown) => [...shown, data.card]);
        if (data.type === "choices") setChoices(data.choices);
        if (data.type === "check.flag") setCheckFlags(data.flags);
        if (data.type === "turn.completed") {
          completed = true;
          sessionStorage.removeItem(key);
          // Keep `pending` (and therefore busy) until the view includes the new passage, or Send
          // re-enables while `view` still lacks the turn that just finished.
          try {
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          }
          setPending(null);
          resetLive();
        }
      } catch {
        source.close();
        setPending(null);
        sessionStorage.removeItem(key);
        setError("The story stream was interrupted. Refresh the story before continuing.");
      }
    };
    // The server closes the stream after the turn's job ends, including a late structural check.
    // Keep listening for that check; a broken stream before completion is a reconnect banner.
    const ended = () => {
      if (!completed) {
        setReconnecting(true);
        return;
      }
      setReconnecting(false);
      source.close();
      void refresh().catch(() => undefined);
    };
    const types = [
      "turn.accepted",
      "mechanics.line",
      "narration.final",
      "narration.delta",
      "clarify",
      "guard.flag",
      "fallback",
      "error",
      "progress",
      "card",
      "choices",
      "model.backup",
      "check.flag",
      "turn.completed",
    ];
    for (const type of types) source.addEventListener(type, listener);
    source.addEventListener("error", ended);
    return () => source.close();
  }, [pending, key, view.id, refresh]);
  async function send(text: string, clarification?: { turnId: string; option: number }) {
    if (pending || sending) return false;
    setSending(true);
    setError("");
    resetLive();
    try {
      const existing = retry.current;
      const input =
        existing &&
        existing.input === text &&
        JSON.stringify(existing.clarification) === JSON.stringify(clarification)
          ? existing
          : SubmitTurnInput.parse({
              input: text,
              clientTurnId: Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
                n.toString(16).padStart(2, "0"),
              ).join(""),
              ...(clarification ? { clarification } : {}),
            });
      retry.current = input;
      const accepted = await api(`/campaigns/${view.id}/turns`, AcceptedTurn.parse, input);
      retry.current = null;
      setPending(accepted.turnId);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }
  async function reroll(turnId: string) {
    if (pending || sending) return;
    setSending(true);
    setError("");
    resetLive();
    try {
      const job = await api(`/campaigns/${view.id}/turns/${turnId}/reroll`, AcceptedTurn.parse, {});
      setPending(job.turnId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  /** Ask the GM to reconcile a passage's unrecorded claims; it runs as the next turn. */
  async function fix(turnId: string) {
    if (pending || sending) return;
    setSending(true);
    setError("");
    resetLive();
    try {
      const job = await api(`/campaigns/${view.id}/turns/${turnId}/fix`, AcceptedTurn.parse, {});
      setPending(job.turnId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  /** Undo a retcon while it is still the latest turn. */
  async function undo(retconId: string) {
    setError("");
    try {
      onView(await api(`/campaigns/${view.id}/retcons/${retconId}/undo`, GameView.parse, {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return {
    busy: sending || Boolean(pending),
    mechanics,
    live,
    progress,
    cards,
    choices,
    checkFlags,
    error,
    reconnecting,
    send,
    reroll,
    fix,
    undo,
    refresh,
  };
}
