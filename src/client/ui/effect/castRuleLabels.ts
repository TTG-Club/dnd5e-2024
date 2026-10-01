/**
 * Подписи раздела «Правило каста» формы эффекта (`EffectCastRuleSection.vue`).
 */

import type { AbilityType } from '@vtt/shared';
import type { CastRuleComponent } from '@vtt/shared/system/dnd.js';

/** Подписи раздела */
export const EFFECT_CAST_RULE_LABELS = {
  toggle: 'Мешает носителю колдовать',
  toggleHint:
    'Лимит круга ячейки и провал каста. Полный запрет, запрет школы и действия «Магия» — флаги',
  maxSlotLevel: 'Ячейки не выше круга',
  maxSlotLevelHint:
    '«Не может использовать ячейки 7-го круга и выше» — 6. Пусто — без лимита',
  minSlotLevel: 'Ячейки не ниже круга',
  minSlotLevelHint: 'Пусто — без лимита',
  failChance: 'Шанс провала, %',
  failChanceHint:
    '«Вероятность 25 %, что заклинание не удастся» — 25. Пусто — без шанса',
  failSaveToggle: 'Спасбросок при попытке каста',
  failSaveToggleHint: 'Провал — заклинание не удалось, действие потрачено',
  failSaveAbility: 'Характеристика',
  failSaveDc: 'Сл',
  failComponent: 'Только заклинания с компонентом',
  failLosesSlot: 'При провале тратится и ячейка',
  failLosesSlotHint:
    'Выключено — потрачено только действие («Слово силы: Боль»)',
} as const;

/** Значение «любое заклинание» в выборе компонента */
export const CAST_RULE_ANY_COMPONENT = 'any';

/** Компонент в выборе: настоящий либо «любое заклинание» */
export type CastRuleComponentChoice =
  CastRuleComponent | typeof CAST_RULE_ANY_COMPONENT;

/** Варианты выбора компонента */
export const CAST_RULE_COMPONENT_OPTIONS: ReadonlyArray<{
  value: CastRuleComponentChoice;
  label: string;
}> = [
  { value: CAST_RULE_ANY_COMPONENT, label: 'Любое заклинание' },
  { value: 'verbal', label: 'Вербальный' },
  { value: 'somatic', label: 'Соматический' },
  { value: 'material', label: 'Материальный' },
];

/** Характеристика спасброска нового правила: Телосложение — самая частая */
export const NEW_CAST_RULE_SAVE_ABILITY: AbilityType = 'constitution';
