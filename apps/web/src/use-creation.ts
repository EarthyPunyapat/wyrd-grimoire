import { CreationView, type DraftSheet } from "@wyrd/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

/**
 * The character being built for a world draft. Edits show at once and save shortly after; the
 * server's reply (preview and issues) replaces the view unless a newer edit has been made since.
 */
export function useCreation(draftId: string | undefined) {
  const [view, setView] = useState<CreationView>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    if (!draftId) return;
    try {
      setView(await api(`/world-drafts/${draftId}/creation`, CreationView.parse));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [draftId]);

  const save = useCallback(
    async (draft: DraftSheet) => {
      if (!draftId) return;
      const mine = ++seq.current;
      setSaving(true);
      try {
        const next = await api(`/world-drafts/${draftId}/sheet`, CreationView.parse, draft, "PUT");
        if (mine === seq.current) {
          setView(next);
          setError("");
        }
      } catch (e) {
        if (mine === seq.current) setError((e as Error).message);
      } finally {
        if (mine === seq.current) setSaving(false);
      }
    },
    [draftId],
  );

  const edit = useCallback(
    (draft: DraftSheet) => {
      setView((v) => (v ? { ...v, draft } : v));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(draft), 250);
    },
    [save],
  );

  /** Saves any pending edit now; resolves once the server has the latest draft. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (view) await save(view.draft);
  }, [save, view]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { view, setView, load, edit, save, flush, error, saving };
}
