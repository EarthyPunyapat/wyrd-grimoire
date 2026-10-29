import {
  BranchesView,
  type HistoryBranch,
  ImportResult,
  SavesView,
  type SaveView,
  TimelineView,
} from "@wyrd/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";

type Props = {
  campaignId: string;
  /** Changes whenever the story moves on, so the timeline reloads with the view. */
  stamp: number;
  onChanged: () => void | Promise<void>;
  onOpenCampaign?: (id: string) => void | Promise<void>;
};

const branchName = (branch: HistoryBranch) =>
  branch.label ?? (branch.id === "main" ? "Main thread" : `Branch ${branch.id.slice(0, 8)}`);

const message = (data: unknown) =>
  data && typeof data === "object" && "error" in data
    ? String(data.error)
    : "The request could not be completed";

/** Timeline / branches (spec 13, spec 14): turns, rewind, branches, named saves and portability. */
export function Timeline({ campaignId, stamp, onChanged, onOpenCampaign }: Props) {
  const [timeline, setTimeline] = useState<TimelineView | null>(null);
  const [saves, setSaves] = useState<SavesView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextTimeline, nextSaves] = await Promise.all([
        api(`/campaigns/${campaignId}/timeline`, TimelineView.parse),
        api(`/campaigns/${campaignId}/saves`, SavesView.parse),
      ]);
      setTimeline(nextTimeline);
      setSaves(nextSaves);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [campaignId]);
  useEffect(() => {
    void stamp;
    void load();
  }, [load, stamp]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rewind = (turnId: string) =>
    run(async () => {
      const next = await api(`/campaigns/${campaignId}/rewind`, TimelineView.parse, { turnId });
      setTimeline(next);
      setSaves(await api(`/campaigns/${campaignId}/saves`, SavesView.parse));
      await onChanged();
    });

  const activate = (branchId: string) =>
    run(async () => {
      await api(`/campaigns/${campaignId}/branches/${branchId}/activate`, BranchesView.parse, {});
      await load();
      await onChanged();
    });

  const save = () =>
    run(async () => {
      if (!saveName.trim()) return;
      setSaves(await api(`/campaigns/${campaignId}/saves`, SavesView.parse, { name: saveName.trim() }));
      setSaveName("");
    });

  // Loading the active head is just a refresh; loading anything else rewinds or switches threads,
  // so ask first. Later turns stay on their branch and can be reopened from the timeline.
  const isLatestPoint = (item: SaveView) =>
    item.branchId === timeline?.activeBranchId &&
    item.seq === timeline.branches.find((b) => b.id === item.branchId)?.head;

  const loadSave = (item: SaveView) =>
    run(async () => {
      if (
        !isLatestPoint(item) &&
        !window.confirm(
          `Load “${item.name}”? Everything after it stays on its own thread, which you can reopen here.`,
        )
      )
        return;
      const next = await api(
        `/campaigns/${campaignId}/saves/${encodeURIComponent(item.id)}/load`,
        TimelineView.parse,
        {},
      );
      setTimeline(next);
      setSaves(await api(`/campaigns/${campaignId}/saves`, SavesView.parse));
      await onChanged();
    });

  const download = () =>
    run(async () => {
      const response = await fetch(`/api/campaigns/${campaignId}/export`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Wyrd": "1" },
      });
      if (!response.ok) throw new Error(message(await response.json().catch(() => null)));
      const disposition = response.headers.get("content-disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "campaign.wyrd";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    });

  const upload = (file: File) =>
    run(async () => {
      const response = await fetch("/api/campaigns/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Wyrd": "1", "Content-Type": "application/octet-stream" },
        body: file,
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(message(data));
      const imported = ImportResult.parse(data);
      if (onOpenCampaign) await onOpenCampaign(imported.id);
      else {
        location.hash = `#campaign=${encodeURIComponent(imported.id)}`;
        location.reload();
      }
    });

  if (!timeline)
    return error ? (
      <p role="alert" className="error panel-pad">
        {error}
      </p>
    ) : (
      <p className="panel-pad muted">Reading the thread…</p>
    );

  const locked = timeline.hardcore;
  return (
    <section className="world-panel timeline" aria-label="Timeline">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {locked && (
        <p className="small muted">
          Hardcore: this thread cannot be rewound, branched, or switched to an earlier one.
        </p>
      )}
      <div className="timeline-branches">
        <label>
          Timeline
          <select
            value={timeline.activeBranchId}
            disabled={busy || locked}
            onChange={(e) => void activate(e.target.value)}
          >
            {timeline.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branchName(branch)}
                {branch.active ? " (active)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="small muted">
          {timeline.turns.length} {timeline.turns.length === 1 ? "turn" : "turns"}
        </span>
      </div>
      <ol className="plain timeline-turns">
        {timeline.turns.map((turn) => (
          <li key={turn.id}>
            <div className="timeline-turn">
              <p>
                <strong>{turn.input}</strong>
              </p>
              {turn.narration && (
                <details>
                  <summary>Narration</summary>
                  <p>{turn.narration}</p>
                </details>
              )}
              <button
                type="button"
                disabled={busy || locked || turn.seq <= 1}
                onClick={() => void rewind(turn.id)}
                aria-label={`Rewind to before ${turn.input}`}
              >
                ⟲ Rewind to before this
              </button>
            </div>
          </li>
        ))}
      </ol>
      {!timeline.turns.length && <p className="small muted">No turns on this thread yet.</p>}
      <h3>Named saves</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Save name
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            maxLength={120}
            placeholder="Before the crypt"
          />
        </label>
        <button className="primary" type="submit" disabled={busy || !saveName.trim()}>
          Save here
        </button>
      </form>
      <ul className="plain timeline-saves">
        {saves?.saves.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>
            <span className="small muted">
              {" "}
              · {item.autosave ? "autosave" : "save"} · {new Date(item.createdAt).toLocaleString()}
            </span>{" "}
            <button
              type="button"
              disabled={busy || locked}
              onClick={() => void loadSave(item)}
              aria-label={`Load save ${item.name}`}
            >
              Load
            </button>
          </li>
        ))}
      </ul>
      {!saves?.saves.length && <p className="small muted">No saves yet.</p>}
      <h3>Portability</h3>
      <div className="timeline-portability">
        <button type="button" disabled={busy} onClick={() => void download()}>
          Export .wyrd
        </button>
        <label>
          Import a .wyrd archive
          <input
            type="file"
            accept=".wyrd,application/zip"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      </div>
    </section>
  );
}
