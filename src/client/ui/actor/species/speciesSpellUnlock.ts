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

import { resolveSpellGrantsForActor } from '../../../composables/grantedSpellPacks';

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

  // Своим паком заклинания без названного пака считается пак вида листа
  const speciesPackId = actor.system.species?.packId;

  const resolved = await resolveSpellGrantsForActor(socket, actor, {
    sources: sources.map((source) => ({
      ...source,
      packId: source.packId ?? speciesPackId,
    })),
    isLevelUnlock: true,
  });

  // Прежняя форма выдачи вида: имя умения и отметка подготовки
  return resolved.map((granted) => ({
    spell: granted.spell,
    featureName: granted.featureName,
    alwaysPrepared: granted.alwaysPrepared,
  }));
}
