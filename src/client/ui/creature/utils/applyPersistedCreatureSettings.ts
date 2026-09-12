import type { DnDCreature } from '@vtt/shared/system/dnd.js';

import { resolveCreatureHitPointsByRules } from '@vtt/shared/system/dnd.js';

/** Применяет уже сохранённые настройки, не затирая остальные правки открытого листа. */
export function applyPersistedCreatureSettings(
  creature: DnDCreature,
  updates: Partial<DnDCreature>,
): DnDCreature {
  return {
    ...creature,
    ...updates,
    system: updates.system
      ? {
          ...creature.system,
          size: updates.system.size,
          hitPoints: updates.system.hitPoints,
        }
      : creature.system,
  };
}

/** Сохраняет несохранённые кости и Телосложение черновика при новом размере токена. */
export function mergeCreatureSettingsIntoDraft(
  creature: DnDCreature,
  updates: Partial<DnDCreature>,
): DnDCreature {
  const mergedCreature = applyPersistedCreatureSettings(creature, updates);

  if (!updates.system) {
    return mergedCreature;
  }

  const draftCreature: DnDCreature = {
    ...mergedCreature,
    system: { ...mergedCreature.system, hitPoints: creature.system.hitPoints },
  };

  const hitPoints = resolveCreatureHitPointsByRules(draftCreature);

  return hitPoints
    ? { ...draftCreature, system: { ...draftCreature.system, hitPoints } }
    : draftCreature;
}
