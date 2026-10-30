import { type CodexEntry, CodexView, DowntimeResult, type GameView, JournalView, MapView } from "@wyrd/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";

/** Loads a world panel and reloads it when the story moves on (`stamp` changes). */
export function usePanel<T>(path: string, parse: (d: unknown) => T, stamp: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api(path, parse)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [path, parse]);
  useEffect(() => {
    void stamp;
    load();
  }, [load, stamp]);
  return { data, setData, error, reload: load };
}

const parseJournal = (d: unknown) => JournalView.parse(d);
const parseCodex = (d: unknown) => CodexView.parse(d);
const parseMap = (d: unknown) => MapView.parse(d);

/** Quest lines for the Quests tab (U4). */
function QuestList({ quests }: { quests: JournalView["quests"] }) {
  if (!quests.length) return <p className="small muted">No quests taken on yet.</p>;
  return (
    <ul className="quests">
      {quests.map((q) => (
        <li key={q.id} className={q.status}>
          <strong>{q.title}</strong> <span className="small">({q.status})</span>
          <p className="small">{q.stage}</p>
          <ul>
            {q.objectives.map((o) => (
              <li key={o.text}>
                {o.met ? "☑" : "☐"} {o.text}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Quests as their own status-screen tab (spec §12, U4). */
export function Quests({ campaignId, stamp }: { campaignId: string; stamp: number }) {
  const { data, error } = usePanel(`/campaigns/${campaignId}/journal`, parseJournal, stamp);
  if (error)
    return (
      <p role="alert" className="error panel-pad">
        {error}
      </p>
    );
  if (!data) return <p className="panel-pad muted">Opening the quest list…</p>;
  const open = data.quests.filter((q) => q.status !== "done" && q.status !== "failed");
  const closed = data.quests.filter((q) => q.status === "done" || q.status === "failed");
  return (
    <section className="world-panel quest-panel" aria-label="Quests">
      <h3>Open quests</h3>
      <QuestList quests={open} />
      {closed.length > 0 && (
        <>
          <h3>Closed</h3>
          <QuestList quests={closed} />
        </>
      )}
    </section>
  );
}

/** Journal (spec 07): recap, leads, clocks, rumours, the summary pyramid and notes. */
export function Journal({
  campaignId,
  stamp,
  skills = [],
  present = [],
}: {
  campaignId: string;
  stamp: number;
  /** The PC's skills, so training is picked from a list rather than typed as an id. */
  skills?: GameView["skills"];
  /** People in the scene who could teach. */
  present?: { id: string; name: string }[];
}) {
  const { data, setData, error, reload } = usePanel(`/campaigns/${campaignId}/journal`, parseJournal, stamp);
  const [notes, setNotes] = useState<string | null>(null);
  if (error)
    return (
      <p role="alert" className="error panel-pad">
        {error}
      </p>
    );
  if (!data) return <p className="panel-pad muted">Opening the journal…</p>;
  const levels = ["arc", "chapter", "scene"] as const;
  return (
    <section className="world-panel" aria-label="Journal">
      <p className="small muted">{data.date}</p>
      {data.recap && (
        <div className="recap">
          <h3>Previously</h3>
          <p>{data.recap.replace(/^Previously… /, "")}</p>
        </div>
      )}
      {data.leads.length > 0 && (
        <>
          <h3>Leads</h3>
          <ul className="plain">
            {data.leads.map((l) => (
              <li key={l.id}>
                <strong>{l.title}</strong>: {l.summary}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.clocks.length > 0 && (
        <>
          <h3>Looming</h3>
          {data.clocks.map((c) => (
            <div key={c.name} className="clock">
              <span>{c.name}</span>
              <span className="pips" role="img" aria-label={`${c.filled} of ${c.segments}`}>
                {Array.from({ length: c.segments }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                  <i key={i} className={i < c.filled ? "on" : ""} />
                ))}
              </span>
            </div>
          ))}
        </>
      )}
      {data.rumours.length > 0 && (
        <>
          <h3>Rumours you've heard</h3>
          <ul className="plain">
            {data.rumours.map((r) => (
              <li key={r}>“{r}”</li>
            ))}
          </ul>
        </>
      )}
      {data.summaries.length > 0 && (
        <>
          <h3>The story so far</h3>
          {levels.map((level) =>
            data.summaries
              .filter((s) => s.level === level)
              .reverse()
              .slice(0, level === "scene" ? 8 : 4)
              .map((s) => (
                <details key={s.id} className={`summary ${level}`}>
                  <summary>
                    {level} · {s.text.slice(0, 60)}…
                  </summary>
                  <p>{s.text}</p>
                </details>
              )),
          )}
        </>
      )}
      <h3>
        <label htmlFor="journal-notes">Your notes</label>
      </h3>
      <textarea
        id="journal-notes"
        value={notes ?? data.notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes === null) return;
          void api(`/campaigns/${campaignId}/notes`, (d) => d, { notes }, "PUT");
        }}
        rows={5}
      />
      <button
        type="button"
        onClick={async () => setData(await api(`/campaigns/${campaignId}/end-session`, parseJournal, {}))}
      >
        End session
      </button>
      <Downtime
        campaignId={campaignId}
        skills={skills}
        present={present}
        research={data.research}
        onDone={reload}
        onResearch={(journal) => setData(journal)}
      />
    </section>
  );
}

/** Codex (spec 07): everything the PC knows, how they learned it, pin and retcon. */
export function Codex({
  campaignId,
  stamp,
  focus,
  watched = [],
  onChanged,
}: {
  campaignId: string;
  stamp: number;
  focus?: string | null;
  watched?: string[];
  onChanged?: () => void | Promise<void>;
}) {
  const { data, setData, error } = usePanel(`/campaigns/${campaignId}/codex`, parseCodex, stamp);
  const [query, setQuery] = useState("");
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    if (focus) document.getElementById(`codex-${focus}`)?.scrollIntoView({ block: "start" });
  }, [focus]);
  if (error)
    return (
      <p role="alert" className="error panel-pad">
        {error}
      </p>
    );
  if (!data) return <p className="panel-pad muted">Opening the codex…</p>;
  // The fact id is one path segment; the verb after it is literal path, not part of the id.
  const act = async (factId: string, verb: "pin" | "retcon", body: unknown) => {
    setProblem("");
    try {
      setData(
        await api(`/campaigns/${campaignId}/facts/${encodeURIComponent(factId)}/${verb}`, parseCodex, body),
      );
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const shown = data.entries.filter(
    (e) => !query || `${e.name} ${e.summary}`.toLowerCase().includes(query.toLowerCase()),
  );
  const kinds = [...new Set(shown.map((e) => e.kind))];
  return (
    <section className="world-panel" aria-label="Codex">
      <label>
        How people address you
        <span className="inline-form">
          <input
            value={address ?? data.address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={40}
          />
          <button
            type="button"
            disabled={!address || address === data.address}
            onClick={async () => {
              await api(`/campaigns/${campaignId}/address`, (d) => d, { address });
              setData({ ...data, address: address ?? data.address });
              setAddress(null);
            }}
          >
            Save
          </button>
        </span>
      </label>
      <label>
        Search what you know
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className="small muted">
        {data.pins} of 20 facts pinned. Pinned facts are always in the narrator's mind.
      </p>
      {problem && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}
      {kinds.map((kind) => (
        <div key={kind}>
          <h3 className="codex-kind">{kind}s</h3>
          {shown
            .filter((e) => e.kind === kind)
            .map((e) => (
              <article
                key={e.id}
                id={`codex-${e.id}`}
                className={`codex-entry${focus === e.id ? " focus" : ""}`}
              >
                <h4>{e.name}</h4>
                <button
                  type="button"
                  aria-pressed={watched.includes(e.id)}
                  disabled={watchBusy !== null}
                  onClick={async () => {
                    setWatchBusy(e.id);
                    setProblem("");
                    try {
                      await api(
                        `/campaigns/${campaignId}/watch/${encodeURIComponent(e.id)}`,
                        (d) => d,
                        { watch: !watched.includes(e.id) },
                        "PUT",
                      );
                      await onChanged?.();
                    } catch (error) {
                      setProblem((error as Error).message);
                    } finally {
                      setWatchBusy(null);
                    }
                  }}
                >
                  {watched.includes(e.id) ? "Unwatch" : "Watch"} {e.name}
                </button>
                <p className="small">{e.summary}</p>
                <p className="small muted">
                  Known: {e.how}
                  {e.standing ? ` · ${e.standing}` : ""}
                </p>
                <ul className="facts">
                  {e.facts.map((f) => (
                    <li key={f.id}>
                      {editing?.id === f.id ? (
                        <form
                          className="inline-form"
                          onSubmit={(ev) => {
                            ev.preventDefault();
                            void act(f.id, "retcon", { value: editing.value }).then(() => setEditing(null));
                          }}
                        >
                          <input
                            aria-label={`Correct ${f.predicate}`}
                            value={editing.value}
                            onChange={(ev) => setEditing({ id: f.id, value: ev.target.value })}
                          />
                          <button type="submit">Save</button>
                          <button type="button" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <span>
                            <em>{f.predicate}:</em> {f.value} <span className="muted small">({f.how})</span>
                          </span>
                          <span className="fact-tools">
                            <button
                              type="button"
                              aria-pressed={f.pinned}
                              aria-label={`${f.pinned ? "Unpin" : "Pin"} ${f.predicate} of ${e.name}`}
                              onClick={() => void act(f.id, "pin", { pinned: !f.pinned })}
                            >
                              {f.pinned ? "★" : "☆"}
                            </button>
                            {f.editable && (
                              <button
                                type="button"
                                aria-label={`Retcon ${f.predicate} of ${e.name}`}
                                onClick={() => setEditing({ id: f.id, value: f.value })}
                              >
                                ✎
                              </button>
                            )}
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
        </div>
      ))}
    </section>
  );
}

/** Map (spec 13): known sites by region, the roads between them; pick one to travel. */
export function WorldMap({
  campaignId,
  stamp,
  onTravel,
  onCodex,
}: {
  campaignId: string;
  stamp: number;
  onTravel: (text: string) => void;
  onCodex?: (id: string) => void;
}) {
  const { data, error } = usePanel(`/campaigns/${campaignId}/map`, parseMap, stamp);
  // Clicking a site opens what the PC knows about it, without leaving the map.
  const [selected, setSelected] = useState<MapView["sites"][number] | null>(null);
  const [entry, setEntry] = useState<CodexEntry | null>(null);
  const choose = (site: MapView["sites"][number]) => {
    setSelected(site);
    setEntry(null);
    api(`/campaigns/${campaignId}/codex`, parseCodex)
      .then((codex) => setEntry(codex.entries.find((e) => e.id === site.id) ?? null))
      .catch(() => setEntry(null));
  };
  if (error)
    return (
      <p role="alert" className="error panel-pad">
        {error}
      </p>
    );
  if (!data) return <p className="panel-pad muted">Unrolling the map…</p>;
  if (!data.sites.length)
    return <p className="panel-pad muted">You don't know the lie of the land beyond this place yet.</p>;
  const cols = Math.max(1, data.regions.length);
  const w = 330;
  const colW = w / cols;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [ci, r] of data.regions.entries()) {
    for (const [i, s] of data.sites.filter((x) => x.regionId === r.id).entries())
      pos.set(s.id, { x: colW * ci + colW / 2, y: 50 + i * 70 });
  }
  for (const [i, s] of data.sites.filter((x) => !pos.has(x.id)).entries())
    pos.set(s.id, { x: w / 2, y: 50 + i * 70 });
  const h = Math.max(...[...pos.values()].map((p) => p.y)) + 50;
  const here = data.sites.find((s) => s.here);
  return (
    <section className="world-panel" aria-label="Map">
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG can't hold buttons; role=group exposes the site controls */}
      <svg
        className="map"
        viewBox={`0 0 ${w} ${h}`}
        role="group"
        aria-label={`Map of ${data.sites.map((s) => s.name).join(", ")}`}
      >
        {data.regions.map((r, ci) => (
          <text key={r.id} x={colW * ci + colW / 2} y={18} textAnchor="middle" className="region">
            {r.name}
          </text>
        ))}
        {data.routes.map((r) => {
          const a = pos.get(r.a)!;
          const b = pos.get(r.b)!;
          return (
            <g key={`${r.a}-${r.b}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`route danger-${r.danger}`} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className="route-label">
                {r.days}d
              </text>
            </g>
          );
        })}
        {data.sites.map((s) => {
          const p = pos.get(s.id)!;
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG groups can't be <button> elements
            <g
              key={s.id}
              className={`site${s.here ? " here" : ""}${s.visited ? " visited" : ""}${selected?.id === s.id ? " selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${s.name}${s.here ? " (you are here)" : ""}`}
              onClick={() => choose(s)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choose(s);
                }
              }}
            >
              <circle cx={p.x} cy={p.y} r={s.here ? 9 : 7} />
              <text x={p.x} y={p.y + 22} textAnchor="middle">
                {s.name}
              </text>
            </g>
          );
        })}
      </svg>
      {selected && (
        <div className="map-site" aria-live="polite">
          <h4>{entry?.name ?? selected.name}</h4>
          {entry ? (
            <>
              <p className="small">{entry.summary}</p>
              <p className="small muted">Known: {entry.how}</p>
              {entry.facts.length > 0 && (
                <ul className="plain">
                  {entry.facts.slice(0, 4).map((f) => (
                    <li key={f.id} className="small">
                      <em>{f.predicate}:</em> {f.value}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="small muted">What you know of {selected.name} is still taking shape.</p>
          )}
          <div className="map-site-actions">
            {!selected.here && (
              <button
                type="button"
                className="act"
                onClick={() => {
                  onTravel(`I travel to ${selected.name}`);
                  setSelected(null);
                }}
              >
                Travel here
              </button>
            )}
            {onCodex && (
              <button type="button" onClick={() => onCodex(selected.id)}>
                Open codex entry
              </button>
            )}
          </div>
        </div>
      )}
      <h3>Roads from here</h3>
      <ul className="plain" aria-label="Roads from here">
        {data.routes
          .filter((r) => here && (r.a === here.id || r.b === here.id))
          .map((r) => {
            const to = data.sites.find((s) => s.id === (r.a === here!.id ? r.b : r.a))!;
            return (
              <li key={to.id}>
                <button type="button" className="act" onClick={() => onTravel(`I travel to ${to.name}`)}>
                  {to.name}
                  <span className="cost">
                    {r.days} days · {r.terrain} · danger {r.danger}/5
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

/** Downtime (spec 06): the safe-place activities the engine resolves between adventures. */
function Downtime({
  campaignId,
  skills,
  present,
  research,
  onDone,
  onResearch,
}: {
  campaignId: string;
  skills: GameView["skills"];
  present: { id: string; name: string }[];
  research: JournalView["research"];
  onDone: () => void;
  onResearch: (journal: JournalView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [topic, setTopic] = useState("");
  const [train, setTrain] = useState("");
  const [teacher, setTeacher] = useState("");
  const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const trainId = train || sortedSkills[0]?.id || "";
  const open = research.filter((r) => r.filled < r.segments);
  const done = research.filter((r) => r.filled >= r.segments);
  // A topic already on the list continues its clock instead of starting another (D162).
  const existing = research.find((r) => r.name.trim().toLowerCase() === topic.trim().toLowerCase());
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/campaigns/${campaignId}/downtime`, DowntimeResult.parse, body, "POST");
      setNote(result.summary);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const abandon = async (clockId: string, name: string) => {
    if (!window.confirm(`Abandon your research into ${name}? Its progress is lost.`)) return;
    setBusy(true);
    setError("");
    try {
      onResearch(
        await api(
          `/campaigns/${campaignId}/research/${encodeURIComponent(clockId)}`,
          parseJournal,
          undefined,
          "DELETE",
        ),
      );
      setNote(`You set aside your research into ${name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="downtime">
      <h3>Downtime</h3>
      <p className="small muted">Time passes in a safe place. Choose how to spend it.</p>
      <div className="downtime-actions">
        <button type="button" disabled={busy} onClick={() => run({ action: { type: "work" } })}>
          Work a day
        </button>
        <button type="button" disabled={busy} onClick={() => run({ action: { type: "carouse" } })}>
          Carouse
        </button>
        <button type="button" disabled={busy} onClick={() => run({ action: { type: "recover" } })}>
          Recover
        </button>
      </div>
      <form
        className="downtime-actions"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trainId) return;
          void run({ action: { type: "train", skill: trainId, ...(teacher ? { teacherId: teacher } : {}) } });
        }}
      >
        <label>
          Train a skill
          <select value={trainId} onChange={(e) => setTrain(e.target.value)} disabled={!sortedSkills.length}>
            {sortedSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
                {skill.display ? ` (${skill.display})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Teacher
          <select value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">Alone (slow)</option>
            {present.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !trainId}>
          Train
        </button>
      </form>
      <section className="research" aria-labelledby="research-heading">
        <h4 id="research-heading">Research</h4>
        {open.length > 0 ? (
          <ul className="plain research-list">
            {open.map((r) => (
              <li key={r.id} className="research-row">
                <span className="research-name">{r.name}</span>
                <span className="pips" role="img" aria-label={`${r.filled} of ${r.segments}`}>
                  {Array.from({ length: r.segments }, (_, i) => (
                    <i key={i} className={i < r.filled ? "on" : ""} />
                  ))}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Continue researching ${r.name}`}
                  onClick={() => run({ action: { type: "research", topic: r.name, clockId: r.id } })}
                >
                  Continue
                </button>
                <button
                  type="button"
                  className="danger-link"
                  disabled={busy}
                  aria-label={`Abandon research into ${r.name}`}
                  onClick={() => void abandon(r.id, r.name)}
                >
                  Abandon
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No research under way.</p>
        )}
        {done.length > 0 && <p className="small muted">Finished: {done.map((r) => r.name).join(", ")}</p>}
        <form
          className="downtime-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (!topic.trim()) return;
            void run({
              action: {
                type: "research",
                topic: topic.trim(),
                ...(existing ? { clockId: existing.id } : {}),
              },
            }).then(() => setTopic(""));
          }}
        >
          <label>
            New topic
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="the old well" />
          </label>
          <button
            type="submit"
            disabled={
              busy || !topic.trim() || (existing !== undefined && existing.filled >= existing.segments)
            }
          >
            {existing ? "Continue" : "Begin research"}
          </button>
        </form>
      </section>
      {note && <p className="small">{note}</p>}
      {error && (
        <p role="alert" className="error small">
          {error}
        </p>
      )}
    </div>
  );
}
