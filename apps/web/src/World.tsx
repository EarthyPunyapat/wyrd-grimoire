import {
  type CodexEntry,
  CodexView,
  DowntimeResult,
  type GameView,
  JournalView,
  MapView,
  MediaCandidateList,
} from "@wyrd/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { ChromeIcon } from "./icons.tsx";
import { Portrait } from "./Portrait.tsx";

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
const parseCandidates = (d: unknown) => MediaCandidateList.parse(d);

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
  const candidates = usePanel(`/campaigns/${campaignId}/media/candidates`, parseCandidates, stamp);
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => {
    if (focus) document.getElementById(`codex-${focus}`)?.scrollIntoView({ block: "start" });
  }, [focus]);
  const choose = async (entityId: string, role: "portrait" | "banner", index: number) => {
    setPicking(entityId);
    setProblem("");
    try {
      await api(`/campaigns/${campaignId}/media/${encodeURIComponent(entityId)}/choose`, (d) => d, {
        role,
        index,
      });
      candidates.reload();
      await onChanged?.();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setPicking(null);
    }
  };
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
                <div className="codex-head">
                  <Portrait id={e.id} name={e.name} kind={e.kind} size={56} />
                  <h4>{e.name}</h4>
                </div>
                {(() => {
                  const offer = candidates.data?.find((c) => c.entityId === e.id);
                  if (!offer) return null;
                  return (
                    <fieldset className="picture-picker" disabled={picking !== null}>
                      <legend>Choose a picture for {e.name}</legend>
                      {offer.hits.map((hit, i) => (
                        <button
                          key={hit.imageUrl}
                          type="button"
                          aria-label={`Use ${hit.title} from ${new URL(hit.pageUrl).host}`}
                          onClick={() => void choose(e.id, offer.role, i)}
                        >
                          <span className="picker-title">{hit.title}</span>
                          <span className="picker-host">{new URL(hit.pageUrl).host}</span>
                        </button>
                      ))}
                    </fieldset>
                  );
                })()}
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

/** Map layout constants, in SVG units drawn at 1:1 so text stays readable at any map size. */
const MAP = { col: 230, row: 112, top: 74, pad: 20 } as const;

type MapSite = MapView["sites"][number];
type MapRoute = MapView["routes"][number];

/**
 * Lay sites out by region: the PC's region first, one column per region, sites stacked down it. A road
 * between two sites in one column bows sideways so its label never sits on a site name.
 */
export function layoutMap(data: MapView) {
  const here = data.sites.find((s) => s.here);
  const regions = [...data.regions].sort(
    (a, b) => Number(b.id === here?.regionId) - Number(a.id === here?.regionId),
  );
  const columns: { id: string; name: string; sites: MapSite[] }[] = regions.map((r) => ({
    id: r.id,
    name: r.name,
    sites: data.sites.filter((s) => s.regionId === r.id),
  }));
  const loose = data.sites.filter((s) => !regions.some((r) => r.id === s.regionId));
  if (loose.length) columns.push({ id: "", name: "Elsewhere", sites: loose });
  const pos = new Map<string, { x: number; y: number; col: number }>();
  for (const [ci, column] of columns.entries()) {
    // The PC's site leads its column.
    const sites = [...column.sites].sort((a, b) => Number(b.here) - Number(a.here));
    for (const [i, site] of sites.entries())
      pos.set(site.id, { x: MAP.pad + MAP.col * ci + MAP.col / 2, y: MAP.top + i * MAP.row, col: ci });
  }
  const rows = Math.max(1, ...columns.map((c) => c.sites.length));
  const width = MAP.pad * 2 + MAP.col * Math.max(1, columns.length);
  const height = MAP.top + (rows - 1) * MAP.row + 64;
  const road = (r: MapRoute) => {
    const a = pos.get(r.a)!;
    const b = pos.get(r.b)!;
    if (a.col !== b.col) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      return { d: `M${a.x} ${a.y}L${b.x} ${b.y}`, label: { x: mx, y: my } };
    }
    // Leave and arrive from the node's side so the road never crosses the name printed under it.
    const bow = MAP.col * 0.32 * (Math.abs(b.y - a.y) > MAP.row ? 1.25 : 1);
    const cy = (a.y + b.y) / 2;
    return {
      d: `M${a.x + 11} ${a.y}Q${a.x + bow} ${cy} ${b.x + 11} ${b.y}`,
      label: { x: a.x + 11 + (bow - 11) / 2, y: cy },
    };
  };
  return { columns, pos, width, height, road };
}

const DANGER_WORD = ["", "safe", "watchful", "risky", "dangerous", "deadly"];

/** Map (spec 13): where you are, the sites you know by region and the roads between them. */
export function WorldMap({
  campaignId,
  stamp,
  onTravel,
  onCodex,
  place,
}: {
  campaignId: string;
  stamp: number;
  onTravel: (text: string) => void;
  onCodex?: (id: string) => void;
  /** Where the scene actually is, which may be somewhere the road map doesn't show. */
  place?: { location: string; zone?: string } | null;
}) {
  const { data, error } = usePanel(`/campaigns/${campaignId}/map`, parseMap, stamp);
  // Clicking a site opens what the PC knows about it, without leaving the map.
  const [selected, setSelected] = useState<MapSite | null>(null);
  const [entry, setEntry] = useState<CodexEntry | null>(null);
  const choose = (site: MapSite) => {
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
  const here = data.sites.find((s) => s.here);
  const header = (
    <header className="map-here">
      <ChromeIcon name="pin" size={20} />
      <div>
        <span className="map-here-label">You are here</span>
        <strong>{place?.location ?? here?.name ?? "Somewhere unmapped"}</strong>
        {place?.zone && <span className="small muted"> · {place.zone}</span>}
        <p className="small muted">
          {here
            ? place && place.location !== here.name
              ? `In ${here.name}${data.regions.find((r) => r.id === here.regionId) ? `, ${data.regions.find((r) => r.id === here.regionId)!.name}` : ""}.`
              : (data.regions.find((r) => r.id === here.regionId)?.name ?? "")
            : "This place isn't on the road map yet."}
        </p>
      </div>
    </header>
  );
  if (!data.sites.length)
    return (
      <section className="world-panel map-panel" aria-label="Map">
        {header}
        <p className="panel-pad muted">You don't know the lie of the land beyond this place yet.</p>
      </section>
    );
  const { columns, pos, width, height, road } = layoutMap(data);
  const roads = data.routes
    .filter((r) => here && (r.a === here.id || r.b === here.id))
    .map((r) => ({ route: r, to: data.sites.find((s) => s.id === (r.a === here!.id ? r.b : r.a))! }));
  return (
    <section className="world-panel map-panel" aria-label="Map">
      {header}
      <div className="map-layout">
        <div className="map-canvas">
          {/* biome-ignore lint/a11y/useSemanticElements: an SVG can't hold buttons; role=group exposes the site controls */}
          <svg
            className="map"
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role="group"
            aria-label={`Map of ${data.sites.map((s) => s.name).join(", ")}`}
          >
            {columns.map((c, ci) => (
              <g key={c.id || "elsewhere"} className="region">
                <rect
                  x={MAP.pad + MAP.col * ci + 8}
                  y={8}
                  width={MAP.col - 16}
                  height={height - 16}
                  rx={10}
                  className="region-panel"
                />
                <text
                  x={MAP.pad + MAP.col * ci + MAP.col / 2}
                  y={34}
                  textAnchor="middle"
                  className="region-name"
                >
                  {c.name}
                </text>
              </g>
            ))}
            {data.routes.map((r) => {
              const { d, label } = road(r);
              return (
                <g key={`${r.a}-${r.b}`} className={`route danger-${r.danger}`}>
                  <path d={d} />
                  <g transform={`translate(${label.x} ${label.y})`}>
                    <rect x={-17} y={-10} width={34} height={20} rx={10} className="route-pill" />
                    <text textAnchor="middle" y={4} className="route-label">
                      {r.days}d
                    </text>
                  </g>
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
                  {s.here && <circle cx={p.x} cy={p.y} r={17} className="here-ring" />}
                  <circle cx={p.x} cy={p.y} r={s.here ? 10 : 8} className="node" />
                  <text x={p.x} y={p.y + 28} textAnchor="middle" className="site-name">
                    {s.name}
                  </text>
                  {s.here && (
                    <text x={p.x} y={p.y - 22} textAnchor="middle" className="here-tag">
                      YOU
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <p className="map-legend small muted">
            <span className="legend-here">●</span> you · <span className="legend-visited">●</span> visited ·{" "}
            <span className="legend-unknown">○</span> heard of · dashed road = dangerous · numbers are days on
            foot
          </p>
        </div>
        <aside className="map-side">
          {selected ? (
            <div className="map-site" aria-live="polite">
              {selected.thumb && <img className="map-site-thumb" src={selected.thumb} alt={selected.name} />}
              <h4>{entry?.name ?? selected.name}</h4>
              <p className="small muted">
                {selected.kind}
                {selected.here ? " · you are here" : selected.visited ? " · visited" : " · not yet visited"}
              </p>
              {entry ? (
                <>
                  {entry.summary && <p className="small">{entry.summary}</p>}
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
                <button type="button" onClick={() => setSelected(null)}>
                  Back to roads
                </button>
              </div>
            </div>
          ) : (
            <>
              <h3>Roads from here</h3>
              {roads.length ? (
                <ul className="plain map-roads" aria-label="Roads from here">
                  {roads.map(({ route, to }) => (
                    <li key={to.id}>
                      <button
                        type="button"
                        className="act"
                        onClick={() => onTravel(`I travel to ${to.name}`)}
                      >
                        <span className="road-to">{to.name}</span>
                        <span className="cost">
                          {route.days} {route.days === 1 ? "day" : "days"} · {route.terrain}
                        </span>
                        <span
                          className={`road-danger danger-${route.danger}`}
                          role="img"
                          aria-label={`danger ${route.danger} of 5`}
                        >
                          {"●".repeat(route.danger)}
                          {"○".repeat(Math.max(0, 5 - route.danger))} {DANGER_WORD[route.danger] ?? ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">
                  {here
                    ? "No known roads lead out of here."
                    : "Find your way back to a known place to use its roads."}
                </p>
              )}
              <p className="small muted">Pick a place on the map to see what you know of it.</p>
            </>
          )}
        </aside>
      </div>
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
