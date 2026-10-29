import {
  defaultTuning,
  draft,
  type EventDraft,
  GearDef,
  type ItemCatalog,
  QuestState,
  type StateChange,
  type StateChangeInput,
  StateChange as StateChangeSchema,
  slugify,
  type Tuning,
} from "@wyrd/core";
import { catalogWith } from "./catalog.ts";
import { addItem, equipItem, inventoryOf, removeItem } from "./inventory.ts";
import { xpLevelEvents } from "./levels.ts";
import type { GameState } from "./state.ts";
import { Working } from "./working.ts";

/** What happened to one requested change; a failure rejects only that change. */
export type ChangeOutcome = {
  index: number;
  ok: boolean;
  reason?: string;
  ids?: string[];
  /** The change has no exact inverse (quest objectives, XP): a retcon leaves it in place. */
  irreversible?: boolean;
};

type Applied = { drafts: EventDraft[]; inverse: EventDraft[]; ids?: string[]; irreversible?: boolean };

const ITEM_TABLES = ["weapons", "armor", "gear"] as const;

function itemExists(items: ItemCatalog, itemId: string): boolean {
  for (const table of ITEM_TABLES) if (Object.hasOwn(items[table], itemId)) return true;
  return false;
}

function actorOf(state: GameState, actorId: string) {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`unknown actor ${actorId}`);
  return actor;
}

export function knownEntities(state: GameState): Set<string> {
  const known = new Set<string>(Object.keys(state.knowledge?.entities ?? {}));
  for (const id of Object.keys(state.actors)) known.add(id);
  if (state.scene) {
    known.add(state.scene.locationId);
    for (const id of Object.keys(state.scene.positions)) known.add(id);
  }
  return known;
}

/**
 * Applies GM-proposed state changes to a working copy of the state (D144). Each change is validated
 * against the state with earlier accepted changes folded in, so a define-then-give call works and a
 * bad id rejects only its own change. Returns the events and the inverse events for Undo.
 */
export function applyChanges(
  state: GameState,
  changes: StateChangeInput[],
  ctx: { items: ItemCatalog; newId: () => string; tuning?: Tuning },
): { drafts: EventDraft[]; outcomes: ChangeOutcome[]; inverse: EventDraft[] } {
  const working = new Working(state);
  const known = knownEntities(state);
  const drafts: EventDraft[] = [];
  const inverse: EventDraft[] = [];
  const outcomes: ChangeOutcome[] = [];

  changes.forEach((change, index) => {
    try {
      const parsed = StateChangeSchema.parse(change);
      const applied = applyOne(working.state, parsed, ctx, known);
      working.apply(applied.drafts);
      drafts.push(...applied.drafts);
      if (applied.drafts.some((d) => d.type === "XpAwarded")) {
        const levels = xpLevelEvents(working.state, ctx.tuning ?? defaultTuning);
        working.apply(levels);
        drafts.push(...levels);
      }
      inverse.push(...applied.inverse);
      for (const id of applied.ids ?? []) known.add(id);
      outcomes.push({
        index,
        ok: true,
        ...(applied.ids ? { ids: applied.ids } : {}),
        ...(applied.irreversible ? { irreversible: true } : {}),
      });
    } catch (e) {
      outcomes.push({ index, ok: false, reason: (e as Error).message });
    }
  });

  return { drafts, outcomes, inverse };
}

function applyOne(
  state: GameState,
  change: StateChange,
  ctx: { items: ItemCatalog; newId: () => string; tuning?: Tuning },
  known: Set<string>,
): Applied {
  const items = catalogWith(state, ctx.items);

  switch (change.kind) {
    case "item.give": {
      actorOf(state, change.actorId);
      if (!itemExists(items, change.itemId)) throw new Error(`unknown item ${change.itemId}`);
      return {
        drafts: addItem(change.actorId, change.itemId, change.qty, { kind: "carried" }, "gm"),
        inverse: removeItem(change.actorId, change.itemId, change.qty, "undo gm"),
        ids: [change.itemId],
      };
    }

    case "item.take": {
      actorOf(state, change.actorId);
      const held = inventoryOf(state, change.actorId)
        .stacks.filter((s) => s.itemId === change.itemId)
        .reduce((sum, s) => sum + s.qty, 0);
      if (held < change.qty)
        throw new Error(`cannot take ${change.qty} ${change.itemId}: only ${held} carried`);
      return {
        drafts: removeItem(change.actorId, change.itemId, change.qty, "gm"),
        inverse: addItem(change.actorId, change.itemId, change.qty, { kind: "carried" }, "undo gm"),
        ids: [change.itemId],
      };
    }

    case "item.equip": {
      actorOf(state, change.actorId);
      const held = inventoryOf(state, change.actorId).stacks.some(
        (s) => s.itemId === change.itemId && s.qty > 0,
      );
      if (!held) throw new Error(`cannot equip ${change.itemId}: not carried`);
      const place =
        change.slot === "worn"
          ? ({ kind: "worn", slot: "body" } as const)
          : ({ kind: "held", hand: change.slot } as const);
      return {
        // Remove then add, so moving an item never changes how many are carried.
        drafts: [
          ...removeItem(change.actorId, change.itemId, 1, `equip ${change.itemId}`),
          ...equipItem(change.actorId, change.itemId, place),
        ],
        inverse: [
          ...removeItem(change.actorId, change.itemId, 1, "undo gm"),
          ...addItem(change.actorId, change.itemId, 1, { kind: "carried" }, "undo gm"),
        ],
        ids: [change.itemId],
      };
    }

    case "item.define": {
      const base = slugify(change.name, "item");
      let local = base;
      for (let n = 2; itemExists(items, `campaign:${local}`); n++) local = `${base}-${n}`;
      const itemId = `campaign:${local}`;
      const def = GearDef.parse({
        id: local,
        name: change.name,
        description: change.description,
        weightKg: change.weightKg,
        price: change.price,
        tags: ["gm"],
      });
      return { drafts: [draft("ItemDefined", { itemId, def }, "model")], inverse: [], ids: [itemId] };
    }

    case "coins": {
      actorOf(state, change.actorId);
      const current = state.economy?.wallets[change.actorId]?.coins ?? 0;
      if (current + change.delta < 0)
        throw new Error(`not enough coins: ${current} available, ${change.delta} requested`);
      return {
        drafts: [
          draft(
            "CoinsChanged",
            {
              actorId: change.actorId,
              delta: change.delta,
              reason: "gm",
            },
            "model",
          ),
        ],
        inverse: [
          draft(
            "CoinsChanged",
            {
              actorId: change.actorId,
              delta: -change.delta,
              reason: "undo gm",
            },
            "engine",
          ),
        ],
        ids: [change.actorId],
      };
    }

    case "hp": {
      const actor = actorOf(state, change.actorId);
      const before = actor.sheet.status.hp;
      const after = Math.max(0, Math.min(actor.sheet.derived.hpMax, before + change.delta));
      const gained = change.delta > 0;
      return {
        drafts: [
          draft(
            "HpChanged",
            {
              actorId: change.actorId,
              hp: after,
              delta: change.delta,
              cause: gained ? "healing" : "damage",
            },
            "model",
          ),
        ],
        inverse: [
          draft(
            "HpChanged",
            {
              actorId: change.actorId,
              hp: before,
              delta: -change.delta,
              cause: gained ? "damage" : "healing",
            },
            "engine",
          ),
        ],
        ids: [change.actorId],
      };
    }

    case "entity.create": {
      const id = ctx.newId();
      const entity = {
        id,
        kind: change.entity.kind,
        name: change.entity.name,
        aliases: [],
        detail: "stub" as const,
        summary: change.entity.summary,
        data: {},
        status: "active" as const,
        importance: 2,
      };
      return {
        drafts: [draft("EntityCreated", { entity }, "model")],
        inverse: [draft("EntityUpdated", { entityId: id, patch: { status: "retconned" } }, "engine")],
        ids: [id],
      };
    }

    case "fact": {
      if (!known.has(change.entityId)) throw new Error(`unknown entity ${change.entityId}`);
      const factId = ctx.newId();
      return {
        drafts: [
          draft(
            "FactAsserted",
            {
              fact: {
                id: factId,
                entityId: change.entityId,
                predicate: change.predicate,
                value: change.value,
                source: "model",
                visibility: "public",
                importance: 2,
              },
            },
            "model",
          ),
        ],
        inverse: [draft("FactRetracted", { factId, reason: "undo gm" }, "engine")],
        ids: [factId],
      };
    }

    case "quest.start": {
      const questId = ctx.newId();
      const stageId = ctx.newId();
      const quest = QuestState.parse({
        id: questId,
        title: change.title,
        kind: "side",
        stages: [
          {
            id: stageId,
            summary: change.title,
            objectives: change.objectives.map((description) => ({ kind: "narrative", description })),
            met: [],
          },
        ],
        stage: 0,
        status: "active",
      });
      return {
        drafts: [draft("QuestStarted", { quest }, "model")],
        inverse: [draft("QuestEnded", { questId, status: "retconned", reason: "undo gm" }, "engine")],
        ids: [questId],
      };
    }

    case "quest.objective": {
      const quest = state.quests[change.questId];
      if (!quest) throw new Error(`unknown quest ${change.questId}`);
      if (quest.status !== "active") throw new Error(`quest ${change.questId} is not active`);
      const stage = quest.stages[quest.stage];
      if (!stage) throw new Error(`quest ${change.questId} has no current stage`);
      if (change.objectiveIndex >= stage.objectives.length)
        throw new Error(`quest ${change.questId} has no objective ${change.objectiveIndex}`);
      return {
        drafts: [
          draft(
            "QuestObjectiveMet",
            {
              questId: change.questId,
              stage: quest.stage,
              objective: change.objectiveIndex,
              evidence: "gm",
            },
            "model",
          ),
        ],
        inverse: [],
        ids: [change.questId],
        irreversible: true,
      };
    }

    case "clock.advance": {
      const clock = state.clocks[change.clockId];
      if (!clock) throw new Error(`unknown clock ${change.clockId}`);
      const left = clock.segments - clock.filled;
      if (change.by > left) throw new Error(`clock ${change.clockId} has only ${left} segments left`);
      return {
        drafts: [draft("ClockAdvanced", { clockId: change.clockId, by: change.by, reason: "gm" }, "model")],
        inverse: [
          draft("ClockAdvanced", { clockId: change.clockId, by: -change.by, reason: "undo gm" }, "engine"),
        ],
        ids: [change.clockId],
      };
    }

    case "xp": {
      actorOf(state, change.actorId);
      return {
        drafts: [draft("XpAwarded", { amount: change.amount, source: "quest", reason: "gm" }, "model")],
        inverse: [],
        ids: [change.actorId],
        irreversible: true,
      };
    }
  }
}
