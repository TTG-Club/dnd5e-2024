/**
 * Числа наложившего в эффектах «на цель»: урон и лечение эффекта считаются
 * по тому, кто его накладывает, а не по цели.
 *
 * Без подстановки сервер пропускает часть урона с `@`: «Божественная искра»
 * `1к8 + @mod.wis` не лечила бы вовсе, «Героизм» не давал бы временных хитов.
 * Подставлять приходится на клиенте и в момент наложения — наложивший может
 * потом уйти со сцены, а модификатор заклинания зависит от самого заклинания.
 */

import type {
  ActiveEffect,
  DnDSceneEntity,
  Spell,
} from '@vtt/shared/system/dnd.js';

import {
  bindTargetEffectsToSource,
  buildFormulaContext,
  resolveActorStats,
  resolveSpellcastingAbility,
} from '@vtt/shared/system/dnd.js';

import { listAmbientEffects } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/**
 * Модификатор заклинательной характеристики наложившего для этого
 * заклинания — токен `@mod.spell`.
 *
 * @param caster - наложивший
 * @param spell - заклинание или псевдо-заклинание применения
 * @returns модификатор характеристики
 */
function resolveCasterSpellMod(caster: DnDSceneEntity, spell: Spell): number {
  return resolveActorStats(caster, listAmbientEffects(caster.id)).abilityMods[
    resolveSpellcastingAbility(caster, spell)
  ];
}

/**
 * Подставляет числа наложившего в урон и лечение эффектов «на цель».
 * Наложившего нет в мире — эффекты возвращаются как есть.
 *
 * @param effects - эффекты «на цель»
 * @param spell - заклинание или псевдо-заклинание, которое их несёт
 * @param casterId - кто накладывает
 * @returns эффекты с числами наложившего
 */
export function bindTargetEffectsToCaster(
  effects: readonly ActiveEffect[],
  spell: Spell,
  casterId: string | undefined,
): ActiveEffect[] {
  const caster = useWorldEntities().findCurrentDndEntity(casterId);

  if (!caster) {
    return [...effects];
  }

  return bindTargetEffectsToSource(effects, caster, {
    ...buildFormulaContext(caster),
    spellMod: resolveCasterSpellMod(caster, spell),
  });
}
