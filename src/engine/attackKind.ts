/**
 * Вид атаки «рукопашная или дальнобойная».
 *
 * В D&D 2024 одной записью бывают обе атаки сразу: у существа «Бросок
 * рукопашной или дальнобойной атаки: +5, досягаемость 5 фт. или дистанция
 * 30/120 фт.», у персонажа — метательное рукопашное оружие (кинжал,
 * метательное копьё), которым можно ударить или бросить его. Какая из двух
 * атак идёт, решает бросающий перед броском; дальше бросок идёт выбранным
 * видом целиком: проверка расстояния, помеха на дальней дистанции, флаги и
 * бонусы `attack.melee` / `attack.ranged`, `damage.melee` / `damage.ranged`.
 *
 * Выбор не пишется в запись: из неё делается копия с конкретной дальностью
 * (`melee` либо `ranged`), и весь остальной код броска работает с ней так же,
 * как с обычной рукопашной или дальнобойной атакой.
 *
 * @module system/dnd/attackKind
 */

import type { CreatureAction } from './creatureTypes.js';
import type { DnDGameItem } from './dndEntities.js';

import { checkCreatureActionRange, checkRange } from './attackUtils.js';
import { getDefaultWeaponAbility } from './calculations.js';

/** Вид атаки, которым идёт бросок */
export type AttackKind = 'melee' | 'ranged';

/** Свойство оружия «Метательное» */
const THROWN_PROPERTY = 'thrown';

/** Все виды атаки в порядке вопроса: сначала рукопашная */
const BOTH_ATTACK_KINDS: readonly AttackKind[] = ['melee', 'ranged'];

/**
 * Можно ли бросить оружие дальнобойной атакой, оставаясь рукопашным:
 * рукопашное оружие со свойством «Метательное» и дистанцией броска.
 * Дальнобойное метательное (дротик) и так дальнобойное — выбора у него нет.
 *
 * @param weapon - оружие
 * @returns `true`, если оружием можно и ударить, и бросить его
 */
export function isThrowableMeleeWeapon(weapon: DnDGameItem): boolean {
  return (
    weapon.rangeType !== 'ranged'
    && !!weapon.weaponProperties?.includes(THROWN_PROPERTY)
    && (weapon.range?.normal ?? 0) > 0
  );
}

/**
 * Какими видами можно атаковать действием существа. Область таргетится
 * шаблоном — вид у неё не спрашивается.
 *
 * @param action - действие существа
 * @returns один вид либо оба (`meleeOrRanged`)
 */
export function listCreatureActionAttackKinds(
  action: CreatureAction,
): readonly AttackKind[] {
  if (action.rangeType === 'meleeOrRanged' && !action.areaOfEffect) {
    return BOTH_ATTACK_KINDS;
  }

  return action.rangeType === 'ranged' ? ['ranged'] : ['melee'];
}

/**
 * Какими видами можно атаковать оружием: метательным рукопашным — ударом и
 * броском, остальным — своим видом.
 *
 * @param weapon - оружие
 * @returns один вид либо оба
 */
export function listWeaponAttackKinds(
  weapon: DnDGameItem,
): readonly AttackKind[] {
  if (isThrowableMeleeWeapon(weapon)) {
    return BOTH_ATTACK_KINDS;
  }

  return weapon.rangeType === 'ranged' ? ['ranged'] : ['melee'];
}

/**
 * Действие существа, атакующее выбранным видом: копия с конкретной
 * дальностью. Досягаемость и дистанция остаются — проверка расстояния берёт
 * нужное по виду.
 *
 * @param action - действие существа
 * @param kind - выбранный вид атаки
 * @returns копия действия с дальностью `melee` либо `ranged`
 */
export function withCreatureActionAttackKind(
  action: CreatureAction,
  kind: AttackKind,
): CreatureAction {
  return { ...action, rangeType: kind };
}

/**
 * Оружие, атакующее выбранным видом. Брошенное метательное оружие — это
 * дальнобойная атака, но характеристика у неё та же, что у удара: по
 * правилам метательное рукопашное оружие бросают Силой («Фехтовальное» —
 * лучшей из Силы и Ловкости). Поэтому у копии характеристика закрепляется
 * рукопашной, если своей у оружия нет.
 *
 * @param weapon - оружие
 * @param kind - выбранный вид атаки
 * @returns копия оружия с дальностью `melee` либо `ranged`
 */
export function withWeaponAttackKind(
  weapon: DnDGameItem,
  kind: AttackKind,
): DnDGameItem {
  if (kind === 'melee' || weapon.rangeType === 'ranged') {
    return { ...weapon, rangeType: kind };
  }

  return {
    ...weapon,
    rangeType: 'ranged',
    attackAbility:
      weapon.attackAbility ?? getDefaultWeaponAbility(weapon.rangeType),
  };
}

/**
 * Виды атаки действием существа, которыми цель достаётся с этого расстояния:
 * за пределами досягаемости остаётся только дальнобойная, и спрашивать не
 * нужно; в досягаемости возможны обе. Пустой список — цель не достаётся ни
 * одним видом, об этом скажет обычная проверка расстояния.
 *
 * @param action - действие существа
 * @param distance - расстояние до цели в единицах сцены
 * @returns виды, из которых выбирать
 */
export function listReachableCreatureActionAttackKinds(
  action: CreatureAction,
  distance: number,
): readonly AttackKind[] {
  return listCreatureActionAttackKinds(action).filter(
    (kind) =>
      checkCreatureActionRange(
        withCreatureActionAttackKind(action, kind),
        distance,
      ).allowed,
  );
}

/**
 * Виды атаки оружием, которыми цель достаётся с этого расстояния — как у
 * {@link listReachableCreatureActionAttackKinds}.
 *
 * @param weapon - оружие
 * @param distance - расстояние до цели в единицах сцены
 * @returns виды, из которых выбирать
 */
export function listReachableWeaponAttackKinds(
  weapon: DnDGameItem,
  distance: number,
): readonly AttackKind[] {
  return listWeaponAttackKinds(weapon).filter(
    (kind) => checkRange(withWeaponAttackKind(weapon, kind), distance).allowed,
  );
}
