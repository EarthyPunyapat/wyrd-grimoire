/**
 * Event payloads for the M7 subsystem breadth (inventory, economy, survival, weather, lighting,
 * language, ammo, durability, crafting, disease). Kept in its own module so parallel work does not
 * edit the central registry. `events.ts` spreads this object.
 */
export const subsystemEventSchemas = {} as const;
