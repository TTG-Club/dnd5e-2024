/**
 * Подписи списка «Срабатывания» окна эффекта.
 */

import type { DamageType } from '@vtt/shared';
import type {
  ConditionRef,
  CreatureCategory,
  CreatureSize,
  EffectTriggerActionGate,
  EffectTriggerActionType,
  EffectTriggerAttackRole,
  EffectTriggerEvent,
  EffectTriggerLimitPeriod,
  EffectTriggerPreset,
  EffectTriggerRecipient,
  EffectTriggerRestType,
  EffectTriggerSaveMode,
  EffectTriggerTurnOwner,
  TriggerConditionKind,
} from '@vtt/shared/system/dnd.js';

import { DEFAULT_EFFECT_TAG } from '@vtt/shared/system/dnd.js';

/** «На сколько» нового действия «Уменьшить максимум хитов» */
export const DEFAULT_MAX_HP_REDUCTION = '@damage';

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
  recipient: 'Кому',
  setHpValue: 'Хитов',
  dcFormula: 'Сл формулой',
  dcFormulaPlaceholder: 'max(10, floor(@damage / 2))',
  dcFormulaHint: '@damage — урон события. Пусто — число Сл.',
  limitToggle: 'Не чаще',
  limitTimes: 'раз за',
  restType: 'Какой отдых',
  saveMode: 'Бросок',
  recurringSaveToggle: 'Повторный спасбросок снимает состояние',
  recurringSaveTiming: 'Когда',
  tagStack: 'Счётчик',
  tagStackHint: 'Повторная отметка прибавляет ступень, а не заменяет прежнюю',
  maxHpAmount: 'На сколько',
  maxHpAmountPlaceholder: '@damage',
  maxHpAmountHint: '@damage — урон события; можно число или кости',
  maxHpRest: 'Максимум вернётся после',
} as const;

/** События срабатывания в списке */
export const EFFECT_TRIGGER_EVENT_LABELS: Partial<
  Record<EffectTriggerEvent, string>
> = {
  applied: 'При наложении на цель',
  turnStart: 'В начале хода',
  turnEnd: 'В конце хода',
  enter: 'При входе в зону или ауру',
  exit: 'При выходе из зоны или ауры',
  attackRoll: 'При броске атаки',
  damageTaken: 'Когда носитель получает урон',
  hpZero: 'Когда хиты носителя падают до 0',
  castEnd: 'Когда заклинание заканчивается',
  rest: 'После отдыха',
};

/** Какой отдых запускает срабатывание */
export const EFFECT_TRIGGER_REST_LABELS: Record<EffectTriggerRestType, string> =
  {
    long: 'Долгий отдых',
    short: 'Короткий отдых',
    any: 'Любой отдых',
  };

/** После какого отдыха возвращается максимум хитов */
export const EFFECT_TRIGGER_MAX_HP_REST_LABELS: Record<
  EffectTriggerRestType | 'never',
  string
> = {
  ...EFFECT_TRIGGER_REST_LABELS,
  never: 'Не вернётся сам',
};

/** Режим спасброска срабатывания; обычный в данных не пишется */
export const EFFECT_TRIGGER_SAVE_MODE_LABELS: Record<
  EffectTriggerSaveMode | typeof EFFECT_TRIGGER_NORMAL_SAVE_MODE,
  string
> = {
  normal: 'Обычный',
  advantage: 'С преимуществом',
  disadvantage: 'С помехой',
};

/** Обычный спасбросок в выборе режима: поля `mode` нет */
export const EFFECT_TRIGGER_NORMAL_SAVE_MODE = 'normal';

/** Кому достаются действия срабатывания; «другая сторона» — у урона */
export const EFFECT_TRIGGER_RECIPIENT_LABELS: Record<
  EffectTriggerRecipient,
  string
> = {
  subject: 'Носителю эффекта',
  other: 'Тому, кто нанёс урон',
};

/** «Другая сторона» при наложении — кто наложил эффект */
export const EFFECT_TRIGGER_APPLIED_OTHER_PARTY_LABEL = 'Наложившему эффект';

/** «Другая сторона» броска атаки по роли носителя */
export const EFFECT_TRIGGER_ATTACK_OTHER_PARTY_LABELS: Record<
  EffectTriggerAttackRole,
  string
> = {
  attacker: 'Цели атаки',
  target: 'Атакующему',
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
  reduceMaxHp: 'Уменьшить максимум хитов',
  setHp: 'Хиты становятся',
  endCast: 'Закончить каст',
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
  reduceMaxHp: 'tabler:heart-minus',
  setHp: 'tabler:heart-plus',
  endCast: 'tabler:player-stop',
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
    hpZeroToOne: 'Вместо 0 хитов — 1 хит',
    tagOnDamage: 'Отметка от урона',
    custom: 'Своё…',
  };

/** Иконки готовых срабатываний */
export const EFFECT_TRIGGER_PRESET_ICONS: Record<EffectTriggerPreset, string> =
  {
    recurringDamage: 'tabler:flame',
    recurringSave: 'tabler:shield-half',
    consumeOn: 'tabler:sword',
    hpZeroToOne: 'tabler:heart-broken',
    tagOnDamage: 'tabler:bookmark',
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
  amount: 'не меньше',
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
  selfHpAtMost: 'У носителя хитов не больше',
  selfHpAtLeast: 'У носителя хитов не меньше',
  selfSizeAtMost: 'Носитель размером не больше',
  selfSizeAtLeast: 'Носитель размером не меньше',
  selfCondition: 'Носитель в состоянии',
  selfConditionNot: 'Носитель не в состоянии',
  selfTagCountAtLeast: 'Отметок на носителе (счётчик)',
  selfTagFromSource: 'На носителе отметка от наложившего',
  selfTagFromSourceNot: 'На носителе нет отметки от наложившего',
  sourceWeaponMastery: 'Атакующий владеет приёмом этого оружия',
};

/** Значение новой части условия с выбором */
export const EFFECT_TRIGGER_CONDITION_DEFAULT_VALUES: {
  damageType: DamageType;
  creatureType: CreatureCategory;
  tag: string;
  number: string;
  size: CreatureSize;
  condition: ConditionRef;
} = {
  damageType: 'fire',
  creatureType: 'humanoid',
  tag: DEFAULT_EFFECT_TAG,
  number: '50',
  size: 'large',
  condition: 'incapacitated',
};
