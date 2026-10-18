/**
 * Откат владений класса с листа персонажа: снимается только то, что выдал сам
 * снимаемый класс, и только если этим не владеет другой источник.
 *
 * Владения на листе лежат плоскими списками без пометки «кто выдал». Поэтому
 * откат считается от источников: что держал снимаемый класс, что держат
 * оставшиеся классы и что держат вид, предыстория и черты. Раньше лист при
 * удалении класса пересобирал владения только из оставшихся классов — навыки
 * предыстории и вида пропадали вместе с последним классом.
 *
 * @module ui/actor/class/classRollback
 */

import type { AbilityType, SkillType } from '@vtt/shared';
import type { DnDProficiencies } from '@vtt/shared/system/dnd.js';

import { isSkillType } from '@vtt/shared/system/dnd.js';

/**
 * Владения, которые держит один источник (класс, вид, предыстория, черта).
 *
 * Языки и мастерство оружия сюда не входят: стартовыми владениями класса они
 * не выдаются, и откат класса их не трогает.
 */
export interface ProficiencyHoldings {
  armor: string[];
  weapons: string[];
  tools: string[];
  savingThrows: AbilityType[];
  skills: SkillType[];
}

/**
 * Владения источника как разница листа до и после его отката: что ушло бы с
 * источником, тем он и владеет.
 *
 * Так владения вида, предыстории и черты узнаются их же откатом, без второго
 * разбора их даров, который разошёлся бы с первым.
 *
 * @param before - владения листа
 * @param after - те же владения после отката источника
 * @returns владения, которые держит источник
 */
export function diffProficiencyHoldings(
  before: DnDProficiencies,
  after: DnDProficiencies,
): ProficiencyHoldings {
  return {
    armor: before.armor.filter((armor) => !after.armor.includes(armor)),
    weapons: before.weapons.filter((weapon) => !after.weapons.includes(weapon)),
    tools: before.tools.filter((tool) => !after.tools.includes(tool)),
    savingThrows: before.savingThrows.filter(
      (ability) => !after.savingThrows.includes(ability),
    ),
    skills: Object.keys(before.skills)
      .filter(isSkillType)
      .filter((skill) => !(skill in after.skills)),
  };
}

/**
 * Оставляет в списке всё, кроме снимаемого и ничем не удержанного, и
 * дописывает владения оставшихся классов.
 *
 * @param current - список владений листа
 * @param removed - что держал снимаемый класс
 * @param retained - что держат остальные источники
 * @param granted - что положено оставшимся классам
 * @returns новый список без повторов
 */
function rollbackList<Value extends string>(
  current: ReadonlyArray<Value>,
  removed: ReadonlyArray<Value>,
  retained: ReadonlySet<Value>,
  granted: ReadonlyArray<Value>,
): Value[] {
  const kept = current.filter(
    (value) => !removed.includes(value) || retained.has(value),
  );

  return [...new Set([...kept, ...granted])];
}

/**
 * Снимает с листа владения удалённого класса.
 *
 * Владение уходит, только если его держал снимаемый класс и не держит никто
 * другой. Владения оставшихся классов дописываются: первый из оставшихся
 * становится основным и получает полный стартовый набор вместо сокращённого
 * набора мультикласса.
 *
 * Навыки оставшихся классов не дописываются — они уже на листе, а запись
 * заново сбила бы компетентность до простого владения.
 *
 * Возвращает НОВЫЙ объект владений — исходный не меняется.
 *
 * @param proficiencies - текущие владения актёра
 * @param removed - что держал снимаемый класс
 * @param remainingClasses - что положено оставшимся классам
 * @param otherSources - что держат вид, предыстория и черты
 */
export function rollbackClassProficiencies(
  proficiencies: DnDProficiencies,
  removed: ProficiencyHoldings,
  remainingClasses: ReadonlyArray<ProficiencyHoldings>,
  otherSources: ReadonlyArray<ProficiencyHoldings>,
): DnDProficiencies {
  const holders = [...remainingClasses, ...otherSources];

  /**
   * Откатывает один список владений: один и тот же расчёт для доспехов,
   * оружия, инструментов и спасбросков.
   *
   * @param current - список владений листа
   * @param pick - какой список источника читать
   * @returns список без владений снятого класса
   */
  const rollbackHeld = <Value extends string>(
    current: ReadonlyArray<Value>,
    pick: (holdings: ProficiencyHoldings) => Value[],
  ): Value[] =>
    rollbackList(
      current,
      pick(removed),
      new Set(holders.flatMap(pick)),
      remainingClasses.flatMap(pick),
    );

  const retainedSkills = new Set(holders.flatMap((holder) => holder.skills));

  const skills = { ...proficiencies.skills };

  for (const skill of removed.skills) {
    if (!retainedSkills.has(skill)) {
      Reflect.deleteProperty(skills, skill);
    }
  }

  return {
    ...proficiencies,
    armor: rollbackHeld(proficiencies.armor, (holdings) => holdings.armor),
    weapons: rollbackHeld(
      proficiencies.weapons,
      (holdings) => holdings.weapons,
    ),
    tools: rollbackHeld(proficiencies.tools, (holdings) => holdings.tools),
    savingThrows: rollbackHeld(
      proficiencies.savingThrows,
      (holdings) => holdings.savingThrows,
    ),
    skills,
  };
}
