/**
 * Что можно забрать у персонажа вместе с классом, видом или предысторией, и
 * применение выбора игрока.
 *
 * Особенности, владения и эффекты источника снимаются всегда — без них запись
 * на листе не имеет смысла. А заклинания и стартовые предметы игрок мог успеть
 * сделать своими, поэтому про них окно удаления спрашивает отдельно.
 *
 * Список выданных заклинаний здесь не разбирается заново: он берётся разницей
 * листа до и после отката источника, которым владеет сам источник. Второй
 * разбор его даров разошёлся бы с первым.
 *
 * @module ui/actor/removal/grantRemovalPlan
 */

import type { DnDActor, DnDGameItem, Spell } from '@vtt/shared/system/dnd.js';

import type { MissingSheetSectionKey } from '../constants';

/**
 * Раздел окна удаления: заклинания, выданные источником; заклинания из списка
 * класса, набранные игроком; стартовые предметы.
 */
export type GrantRemovalGroup = 'grantedSpell' | 'classSpell' | 'item';

/** Порядок разделов в окне удаления */
export const GRANT_REMOVAL_GROUPS: ReadonlyArray<GrantRemovalGroup> = [
  'grantedSpell',
  'classSpell',
  'item',
];

/** Строка окна удаления: одно заклинание или один предмет */
export interface GrantRemovalOption {
  /** Ключ строки — раздел вместе с id записи: id заклинаний и предметов свои */
  id: string;
  group: GrantRemovalGroup;
  /** Id заклинания или предмета на листе */
  entityId: string;
  name: string;
}

/** Что снимается с листа */
export interface GrantRemovalSubject {
  kind: MissingSheetSectionKey;
  /** Ключ снимаемой записи: класса, вида или предыстории */
  key: string;
}

/**
 * Собирает строку окна удаления.
 *
 * @param group - раздел окна
 * @param entity - заклинание или предмет листа
 * @param entity.id - id записи на листе
 * @param entity.name - название записи
 */
function toOption(
  group: GrantRemovalGroup,
  entity: { id: string; name: string },
): GrantRemovalOption {
  return {
    id: `${group}:${entity.id}`,
    group,
    entityId: entity.id,
    name: entity.name,
  };
}

/**
 * Собирает то, что окно удаления предложит забрать вместе с источником.
 *
 * Заклинания из списка класса узнаются по спискам классов самой записи: это
 * заклинание снимаемого класса, недоступное ни одному из оставшихся. Пометки
 * «кто набрал» у них нет — поэтому это предложение, а не откат.
 *
 * @param actor - актёр до удаления
 * @param subject - что снимается
 * @param spellsAfterRollback - заклинания листа после отката источника
 * @param remainingClassKeys - ключи классов, остающихся у персонажа
 * @returns строки окна; пусто — спрашивать не о чем
 */
export function collectGrantRemovalOptions(
  actor: DnDActor,
  subject: GrantRemovalSubject,
  spellsAfterRollback: ReadonlyArray<Spell>,
  remainingClassKeys: ReadonlyArray<string>,
): GrantRemovalOption[] {
  const survivingSpellIds = new Set(
    spellsAfterRollback.map((spell) => spell.id),
  );

  const grantedSpells = actor.spells.filter(
    (spell) => !survivingSpellIds.has(spell.id),
  );

  const classSpells =
    subject.kind === 'class'
      ? spellsAfterRollback.filter((spell) => {
          const classKeys: ReadonlyArray<string> = spell.classKeys ?? [];

          return (
            !spell.grantedByFeature
            && classKeys.includes(subject.key)
            && !classKeys.some((classKey) =>
              remainingClassKeys.includes(classKey),
            )
          );
        })
      : [];

  const items = actor.equipment.filter(
    (item) =>
      item.grantedBy?.kind === subject.kind
      && item.grantedBy.key === subject.key,
  );

  return [
    ...grantedSpells.map((spell) => toOption('grantedSpell', spell)),
    ...classSpells.map((spell) => toOption('classSpell', spell)),
    ...items.map((item) => toOption('item', item)),
  ];
}

/**
 * Применяет выбор игрока к листу после отката источника.
 *
 * Выданное заклинание откат уже снял — неотмеченное возвращается на лист как
 * было. Заклинания из списка класса и предметы откат не трогает — отмеченные
 * снимаются здесь.
 *
 * Возвращает НОВЫЕ списки — исходные не меняются.
 *
 * @param spellsBefore - заклинания листа до отката
 * @param after - заклинания и снаряжение листа после отката
 * @param after.spells - заклинания после отката
 * @param after.equipment - снаряжение после отката
 * @param options - строки, которые показывало окно
 * @param selectedIds - ключи строк, отмеченных к удалению
 */
export function applyGrantRemovalSelection(
  spellsBefore: ReadonlyArray<Spell>,
  after: {
    spells: ReadonlyArray<Spell>;
    equipment: ReadonlyArray<DnDGameItem>;
  },
  options: ReadonlyArray<GrantRemovalOption>,
  selectedIds: ReadonlySet<string>,
): { spells: Spell[]; equipment: DnDGameItem[] } {
  /**
   * Id записей раздела с нужной отметкой.
   *
   * @param group - раздел окна
   * @param isSelected - отмеченные к удалению или оставленные
   */
  const entityIdsOf = (
    group: GrantRemovalGroup,
    isSelected: boolean,
  ): Set<string> =>
    new Set(
      options
        .filter(
          (option) =>
            option.group === group && selectedIds.has(option.id) === isSelected,
        )
        .map((option) => option.entityId),
    );

  const keptGrantedSpellIds = entityIdsOf('grantedSpell', false);
  const removedClassSpellIds = entityIdsOf('classSpell', true);
  const removedItemIds = entityIdsOf('item', true);

  return {
    spells: [
      ...after.spells.filter((spell) => !removedClassSpellIds.has(spell.id)),
      ...spellsBefore.filter((spell) => keptGrantedSpellIds.has(spell.id)),
    ],
    equipment: after.equipment.filter((item) => !removedItemIds.has(item.id)),
  };
}
