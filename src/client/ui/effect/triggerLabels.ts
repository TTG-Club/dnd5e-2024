/**
 * Подписи списка «Срабатывания» окна эффекта.
 */

import type {
  EffectTriggerActionGate,
  EffectTriggerActionType,
  EffectTriggerAttackRole,
  EffectTriggerEvent,
  EffectTriggerLimitPeriod,
  EffectTriggerPreset,
} from '@vtt/shared/system/dnd.js';

/** Подписи шага «Срабатывания» */
export const EFFECT_TRIGGERS_STEP_LABELS = {
  hint:
    'Что эффект делает сам по ходу боя: урон каждый ход, повторный спасбросок, '
    + 'снятие после атаки или своё — «когда → спасбросок → что сделать → сколько '
    + 'раз».',
  empty: 'Срабатываний нет.',
  addTitle: 'Добавить',
} as const;

/** Подписи строки срабатывания */
export const EFFECT_TRIGGER_ROW_LABELS = {
  event: 'Когда',
  role: 'Чья атака',
  saveToggle: 'Спасбросок',
  saveAbility: 'Характеристика',
  saveDc: 'Сл',
  actionsTitle: 'Что сделать',
  actionsEmpty:
    'Добавьте хотя бы одно действие — без него срабатывание не сохранится.',
  addAction: 'Действие',
  removeAction: 'Убрать действие',
  remove: 'Убрать срабатывание',
  gate: 'Исход',
  condition: 'Состояние',
  conditionRounds: 'Раундов',
  conditionRoundsPlaceholder: 'Пока не снимут',
  limitToggle: 'Не чаще',
  limitTimes: 'раз за',
} as const;

/** События срабатывания в списке */
export const EFFECT_TRIGGER_EVENT_LABELS: Partial<
  Record<EffectTriggerEvent, string>
> = {
  turnStart: 'В начале хода',
  turnEnd: 'В конце хода',
  enter: 'При входе в зону',
  exit: 'При выходе из зоны',
  attackRoll: 'При броске атаки',
};

/** Роль в броске атаки */
export const EFFECT_TRIGGER_ROLE_LABELS: Record<
  EffectTriggerAttackRole,
  string
> = {
  attacker: 'Своя атака',
  target: 'Атака по носителю',
};

/** Виды действий */
export const EFFECT_TRIGGER_ACTION_LABELS: Record<
  EffectTriggerActionType,
  string
> = {
  damage: 'Урон или лечение',
  applySelf: 'Наложить сам эффект',
  applyCondition: 'Наложить состояние',
  removeSelf: 'Снять эффект',
};

/** Иконки видов действий */
export const EFFECT_TRIGGER_ACTION_ICONS: Record<
  EffectTriggerActionType,
  string
> = {
  damage: 'tabler:flame',
  applySelf: 'tabler:copy',
  applyCondition: 'tabler:mood-sick',
  removeSelf: 'tabler:circle-x',
};

/** Исход спасброска, при котором выполняется действие */
export const EFFECT_TRIGGER_GATE_LABELS: Record<
  EffectTriggerActionGate,
  string
> = {
  failed: 'При провале',
  saved: 'При успехе',
  always: 'Всегда',
};

/** Исход урона: «половина при успехе» — отдельный вариант */
export const EFFECT_TRIGGER_DAMAGE_HALF_GATE = 'half';

/** Подпись варианта «провал — полный, успех — половина» */
export const EFFECT_TRIGGER_DAMAGE_HALF_LABEL =
  'Провал — полный, успех — половина';

/** Периоды лимита */
export const EFFECT_TRIGGER_PERIOD_LABELS: Record<
  EffectTriggerLimitPeriod,
  string
> = {
  turn: 'ход',
  round: 'раунд',
  shortRest: 'короткий отдых',
  longRest: 'долгий отдых',
};

/** Готовые срабатывания */
export const EFFECT_TRIGGER_PRESET_LABELS: Record<EffectTriggerPreset, string> =
  {
    recurringDamage: 'Урон каждый ход',
    recurringSave: 'Повторный спасбросок',
    consumeOn: 'Снять после атаки',
    custom: 'Своё…',
  };

/** Иконки готовых срабатываний */
export const EFFECT_TRIGGER_PRESET_ICONS: Record<EffectTriggerPreset, string> =
  {
    recurringDamage: 'tabler:flame',
    recurringSave: 'tabler:shield-half',
    consumeOn: 'tabler:sword',
    custom: 'tabler:plus',
  };
