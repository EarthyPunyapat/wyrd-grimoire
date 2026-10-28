import { join } from "node:path";
import {
  type CampaignSettingsInput,
  defaultTuning,
  type EventDraft,
  type EventEnvelope,
  parseEventPayload,
} from "@wyrd/core";
import {
  buildSheet,
  createActor,
  createCampaign,
  type GameState,
  reduce,
  startingEquipment,
  type TurnContext,
  unwrap,
} from "@wyrd/engine";
import { loadPack, loadWorld, skillCatalog, worldEvents } from "../../src/index.ts";

const PACK_DIR = join(import.meta.dir, "../../../../packs/fantasy-core");
export const pack = loadPack(PACK_DIR).pack!;
export const tavern = loadWorld(PACK_DIR, "tavern-brawl").world!;

/** A tavern-brawl campaign with a hunter PC (bow, axe, leather) and optional companion. */
export class Fight {
  events: EventEnvelope[] = [];
  state!: GameState;
  ctx: TurnContext;

  constructor(
    opts: {
      seed?: number | string;
      settings?: CampaignSettingsInput;
      archetype?: string;
      companion?: boolean;
    } = {},
  ) {
    this.commit([
      unwrap(
        createCampaign({
          name: "Brawl",
          packIds: ["fantasy-core"],
          settings: opts.settings ?? {},
          seed: opts.seed ?? 1,
        }),
      ),
    ]);
    const a = pack.archetypes[`fantasy-core:${opts.archetype ?? "hunter"}`]!;
    const sheet = (id: string, name: string) =>
      buildSheet(
        {
          id,
          identity: { name, ancestry: "fantasy-core:human" },
          attributes: a.suggestedAttributes,
          skills: Object.fromEntries(Object.entries(a.skills).map(([k, v]) => [k, { trained: v }])),
          talents: [a.talent],
          equipment: startingEquipment(a.kit, pack.items),
        },
        this.state.campaign.settings,
        defaultTuning,
      );
    this.commit(unwrap(createActor(this.state, sheet("pc", "Wren"), "pc")));
    const party = ["pc"];
    if (opts.companion) {
      const s = buildSheet(
        {
          id: "ally",
          identity: { name: "Doran", ancestry: "fantasy-core:human" },
          attributes: pack.archetypes["fantasy-core:sellsword"]!.suggestedAttributes,
          skills: Object.fromEntries(
            Object.entries(pack.archetypes["fantasy-core:sellsword"]!.skills).map(([k, v]) => [
              k,
              { trained: v },
            ]),
          ),
          equipment: startingEquipment(pack.archetypes["fantasy-core:sellsword"]!.kit, pack.items),
        },
        this.state.campaign.settings,
        defaultTuning,
      );
      this.commit(unwrap(createActor(this.state, s, "companion")));
      party.push("ally");
    }
    this.commit(worldEvents(tavern, party));
    const entities = new Map(tavern.entities.map((e) => [e.id, e]));
    this.ctx = {
      skills: skillCatalog([pack]),
      tuning: defaultTuning,
      items: pack.items,
      bodyPlans: pack.bodyPlans,
      creatures: pack.creatures,
      nameOf: (id) =>
        this.state.actors[id]?.sheet.identity.name ??
        entities.get(id)?.name ??
        this.state.scene?.zones.find((z) => z.id === id)?.name ??
        this.state.scene?.zones.flatMap((z) => z.props).find((p) => p.id === id)?.name ??
        Object.values(pack.items)
          .flatMap((t) => Object.values(t))
          .find((i) => i.id === id)?.name ??
        id,
      combatInfo: (id) => {
        const e = entities.get(id);
        const d = (e?.data ?? {}) as Record<string, unknown>;
        return {
          ...(typeof d.statBlock === "string" ? { statBlock: d.statBlock } : {}),
          ...(typeof d.group === "string" ? { group: d.group } : {}),
          ...(d.leader === true ? { leader: true } : {}),
          ...(typeof d.intent === "string" ? { intent: d.intent as never } : {}),
          canFight: !e || e.kind === "npc" || e.kind === "creature",
        };
      },
    };
  }

  commit(drafts: EventDraft[]): this {
    for (const d of drafts) {
      const e = {
        id: `evt-${this.events.length + 1}`,
        campaignId: "c",
        branchId: "main",
        seq: this.events.length + 1,
        turnId: null,
        type: d.type,
        payload: parseEventPayload(d.type, d.payload),
        source: d.source ?? "engine",
        gameTime: this.state?.campaign.gameTime ?? 0,
        createdAt: "2026-10-29T00:00:00.000Z",
        schemaVersion: 1,
      } as EventEnvelope;
      this.state = reduce(this.state, e);
      this.events.push(e);
    }
    return this;
  }
}
