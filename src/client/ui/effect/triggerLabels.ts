/**
 * Подписи списка «Срабатывания» окна эффекта.
 */

import type { DamageType } from '@vtt/shared';
import type {
  CreatureCategory,
  EffectTriggerActionGate,
  EffectTriggerActionType,
  EffectTriggerAttackRole,
  EffectTriggerEvent,
  EffectTriggerLimitPeriod,
  EffectTriggerPreset,
  EffectTriggerTurnOwner,
  TriggerConditionKind,
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
  turnOf: 'Чей ход',
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
  tag: 'Ключ отметки',
  tagLabel: 'Имя в списке',
  tagLabelPlaceholder: 'Как ключ',
  tagRoundsPlaceholder: 'До начала следующего хода',
  tagInvalid:
    'Ключ — буквы, цифры, «_», «.» и «-»; без годного ключа отметка не сохранится.',
  limitToggle: 'Не чаще',
  limitTimes: 'раз за',
} as const;

/** События срабатывания в списке */
export const EFFECT_TRIGGER_EVENT_LABELS: Partial<
  Record<EffectTriggerEvent, string>
> = {
  turnStart: 'В начале хода',
  turnEnd: 'В конце хода',
  enter: 'При входе в зону или ауру',
  exit: 'При выходе из зоны или ауры',
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

/** Чей ход у срабатывания начала и конца хода */
export const EFFECT_TRIGGER_TURN_OWNER_LABELS: Record<
  EffectTriggerTurnOwner,
  string
> = {
  subject: 'Носителя эффекта',
  source: 'Наложившего эффект',
};

/** Виды действий */
export const EFFECT_TRIGGER_ACTION_LABELS: Record<
  EffectTriggerActionType,
  string
> = {
  damage: 'Урон или лечение',
  applySelf: 'Наложить сам эффект',
  applyCondition: 'Наложить состояние',
  applyTag: 'Поставить отметку',
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
  applyTag: 'tabler:bookmark',
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

/** Подписи условия срабатывания */
export const EFFECT_TRIGGER_CONDITION_LABELS = {
  title: 'Условие',
  always: 'Без условия — срабатывает всегда.',
  and: 'и',
  add: 'Условие',
  remove: 'Убрать условие',
  unknown: 'Условие из данных, окно его не знает: срабатывание не сработает',
  knownTags: 'Отметки этого эффекта',
} as const;

/** Виды частей условия срабатывания */
export const EFFECT_TRIGGER_CONDITION_KIND_LABELS: Record<
  TriggerConditionKind,
  string
> = {
  damageType: 'Урон этого типа',
  damageTypeNot: 'Урон без этого типа',
  damageCritical: 'Критическое попадание',
  damageNotCritical: 'Не критическое попадание',
  selfBloodied: 'Носитель окровавлен (хитов не больше половины)',
  selfWounded: 'Носитель ранен',
  selfCreatureType: 'Носитель — существо типа',
  selfTag: 'На носителе отметка',
  selfTagNot: 'На носителе нет отметки',
  rollAdvantage: 'Атака с преимуществом',
  rollDisadvantage: 'Атака с помехой',
  otherCreatureType: 'Другая сторона — существо типа',
  otherMarkedBySelf: 'Другая сторона помечена носителем',
};

/** Ключ новой отметки, пока автор не назвал свою */
export const EFFECT_TRIGGER_DEFAULT_TAG = 'отметка';

/** Значение новой части условия с выбором */
export const EFFECT_TRIGGER_CONDITION_DEFAULT_VALUES: {
  damageType: DamageType;
  creatureType: CreatureCategory;
  tag: string;
} = {
  damageType: 'fire',
  creatureType: 'humanoid',
  tag: EFFECT_TRIGGER_DEFAULT_TAG,
};
