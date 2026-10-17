/**
 * Выдача заклинаний вида, открывшихся с ростом уровня.
 *
 * Вид применяют один раз, при выборе, и выдаёт он только открытое на тот момент:
 * «Псевдожизнь» чтонического тифлинга приходит на 3 уровне, «Луч слабости» — на
 * 5-м. Без этого прохода при повышении они не появились бы никогда.
 *
 * @module ui/actor/species/speciesSpellUnlock
 */

import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  DnDActor,
  ResolvedGrantedSpell,
  SpeciesDefinition,
} from '@vtt/shared/system/dnd.js';

import {
  collectSpeciesGrantedSpellSources,
  getTotalLevel,
} from '@vtt/shared/system/dnd.js';

import {
  findSpellInPacks,
  loadSpellPacks,
} from '../../../composables/spellCompendium';

/**
 * Пере-собирает заклинания вида листа на текущем уровне персонажа.
 *
 * Только особенности выбранного варианта вида: невыбранные варианты ничего не
 * выдают и при применении. Уже выданное повторно не добавляется —
 * `appendGrantedSpells` отсеивает совпадения по названию.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param actor - лист персонажа с уже обновлённым уровнем
 * @param definition - определение вида листа
 * @param subspecies - определение записи-подвида; пусто — не выбрана
 * @returns заклинания вида, доступные на текущем уровне
 */
export async function resolveActorSpeciesSpells(
  socket: TypedWebSocketClient | null | undefined,
  actor: DnDActor,
  definition: SpeciesDefinition,
  subspecies: SpeciesDefinition | null,
): Promise<ResolvedGrantedSpell[]> {
  const sources = collectSpeciesGrantedSpellSources(definition, subspecies, {
    characterLevel: getTotalLevel(actor.system.classes),
    featureChoices: actor.system.species?.featureChoices ?? {},
  });

  if (sources.length === 0 || !socket) {
    return [];
  }

  const { packs } = await loadSpellPacks(socket);

  return sources.flatMap((source): ResolvedGrantedSpell[] => {
    const spell = findSpellInPacks(packs, source.spellId, source.packId);

    return spell
      ? [
          {
            spell,
            featureName: source.featureName,
            alwaysPrepared: source.alwaysPrepared,
          },
        ]
      : [];
  });
}
