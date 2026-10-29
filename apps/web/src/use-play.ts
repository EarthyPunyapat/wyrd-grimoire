import { AcceptedTurn, GameView, type MechanicsLine, SubmitTurnInput, WebStreamEvent } from "@wyrd/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

export function usePlay(view: GameView, onView: (view: GameView) => void) {
  const key = `wyrd-pending-${view.id}`;
  const [pending, setPending] = useState<string | null>(() => sessionStorage.getItem(key));
  const [sending, setSending] = useState(false);
  const [mechanics, setMechanics] = useState<MechanicsLine[]>([]);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const retry = useRef<ReturnType<typeof SubmitTurnInput.parse> | null>(null);
  const refreshSeq = useRef(0);
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
    const listener = async (event: Event) => {
      if (!(event instanceof MessageEvent)) {
        setReconnecting(true);
        return;
      }
      if (eventIds.has(event.lastEventId)) return;
      eventIds.add(event.lastEventId);
      try {
        const data = WebStreamEvent.parse(JSON.parse(event.data));
        setReconnecting(false);
        if (data.type === "mechanics.line") setMechanics((lines) => [...lines, data.line]);
        if (data.type === "error") setError(data.message);
        if (data.type === "turn.completed") {
          source.close();
          sessionStorage.removeItem(key);
          // Keep `pending` (and therefore busy) until the view includes the new passage, or Send
          // re-enables while `view` still lacks the turn that just finished.
          try {
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          }
          setPending(null);
        }
      } catch {
        source.close();
        setPending(null);
        sessionStorage.removeItem(key);
        setError("The story stream was interrupted. Refresh the story before continuing.");
      }
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
      "turn.completed",
    ];
    for (const type of types) source.addEventListener(type, listener);
    return () => source.close();
  }, [pending, key, view.id, refresh]);
  async function send(text: string, clarification?: { turnId: string; option: number }) {
    if (pending || sending) return false;
    setSending(true);
    setError("");
    setMechanics([]);
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
    setMechanics([]);
    try {
      const job = await api(`/campaigns/${view.id}/turns/${turnId}/reroll`, AcceptedTurn.parse, {});
      setPending(job.turnId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return { busy: sending || Boolean(pending), mechanics, error, reconnecting, send, reroll, refresh };
}
