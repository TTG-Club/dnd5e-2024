import type { MissingSheetSectionKey } from '../constants';
import type { GrantRemovalGroup } from './grantRemovalPlan';

/** Заголовок окна удаления — свой у класса, вида и предыстории */
export const GRANT_REMOVAL_TITLES: Record<MissingSheetSectionKey, string> = {
  class: 'Что убрать вместе с классом',
  species: 'Что убрать вместе с видом',
  background: 'Что убрать вместе с предысторией',
};

/** Подписи окна удаления */
export const GRANT_REMOVAL_LABELS = {
  /** Что уходит в любом случае: выбора по этим дарам окно не даёт */
  alwaysRemovedHint:
    'Особенности, владения и эффекты будут сняты в любом случае. '
    + 'Отметьте, что ещё убрать с листа, — неотмеченное останется у персонажа.',
  selectAll: 'Отметить всё',
  selectNone: 'Снять всё',
} as const;

/** Названия разделов окна удаления */
export const GRANT_REMOVAL_GROUP_LABELS: Record<GrantRemovalGroup, string> = {
  grantedSpell: 'Выданные заклинания',
  classSpell: 'Заклинания из списка класса',
  item: 'Стартовое снаряжение',
};
