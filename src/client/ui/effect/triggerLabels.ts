/**
 * Подписи списка «Срабатывания» окна эффекта.
 */

import type { DamageType } from '@vtt/shared';
import type {
  ConditionRef,
  CreatureCategory,
  CreatureSize,
  EffectCastOwner,
  EffectNotifyTarget,
  EffectRestoreKind,
  EffectSaveTiming,
  EffectTempHpMode,
  EffectTriggerActionGate,
  EffectTriggerActionType,
  EffectTriggerAreaShiftKind,
  EffectTriggerAttackRole,
  EffectTriggerEvent,
  EffectTriggerLimitPeriod,
  EffectTriggerMaxHpRestEnd,
  EffectTriggerMoveKind,
  EffectTriggerMoveOrigin,
  EffectTriggerPreset,
  EffectTriggerRecipient,
  EffectTriggerRestType,
  EffectTriggerSaveMode,
  EffectTriggerTurnOwner,
  TriggerConditionKind,
  TriggerConditionParameter,
} from '@vtt/shared/system/dnd.js';

import {
  DEFAULT_EFFECT_TAG,
  EVENT_DAMAGE_VARIABLE,
  MAX_HP_REDUCTION_NEVER_ENDS,
} from '@vtt/shared/system/dnd.js';

/** «На сколько» нового действия «Уменьшить максимум хитов» */
export const DEFAULT_MAX_HP_REDUCTION = `@${EVENT_DAMAGE_VARIABLE}`;

/** Обычный спасбросок в выборе режима: поля `mode` нет */
export const EFFECT_TRIGGER_NORMAL_SAVE_MODE = 'normal';

/** Момент повторного спасброска наложенного состояния по умолчанию */
export const DEFAULT_RECURRING_SAVE_TIMING: EffectSaveTiming = 'endOfTurn';

/** Подписи шага «Срабатывания» */
export const EFFECT_TRIGGERS_STEP_LABELS = {
  hint:
    'Что эффект делает сам по ходу боя: урон каждый ход, повторный спасбросок, '
    + 'снятие после атаки или своё — «когда → спасбросок → что сделать → сколько '
    + 'раз».',
  empty: 'Срабатываний нет.',
  addTitle: 'Добавить',
  chargesToggle: 'Заряды',
  chargesToggleHint:
    'Сколько раз срабатывания эффекта сработают всего. Каждое сработавшее '
    + 'тратит заряд; зарядов не осталось — эффект молчит. Считаются только у '
    + 'эффекта, который лежит на существе: у ауры и зоны своего экземпляра нет.',
  chargesEndsWhenEmpty: 'Последний заряд снимает эффект',
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
  chanceToggle: 'С броском на шанс',
  chancePercent: '% срабатывания',
  chanceHint:
    'Бросок идёт ПЕРЕД лимитом «не чаще N раз»: неудавшийся шанс — это '
    + 'несостоявшееся срабатывание, и «раз в ход» на него не тратится.',
  conditionKey: 'Какое состояние',
  conditionKeyAny: 'Любое',
  conditionKeyHint: 'Срабатывание слушает только это снятое состояние.',
  advantageIf: 'Преимущество, если',
  disadvantageIf: 'Помеха, если',
  saveModeIfEmpty: 'Без условия — режим не меняется.',
  autoSuccessIf: 'Автоматический успех, если',
  autoFailIf: 'Автоматический провал, если',
  autoOutcomeEmpty: 'Без условия — спасбросок бросается как обычно.',
  moveKind: 'Как двигать',
  moveDistance: 'Футов',
  moveFrom: 'От кого',
  moveHint: 'Ядро ставит фишку; препятствия не учитываются',
  areaShiftKind: 'Куда',
  areaShiftHint: 'Сдвигается зона того же каста; форма не меняется',
  removeConditionAll: 'Все состояния',
  tempHpAmount: 'Сколько',
  tempHpMode: 'Как',
  reviveHp: 'Хитов',
  reviveFull: 'Полный запас',
  setHpToMax: 'Полный запас',
  restoreWhat: 'Что вернуть',
  restoreLevel: 'Круг',
  restoreCounter: 'Ключ ресурса',
  restoreAmount: 'Сколько',
  dispelMaxLevel: 'До какого круга',
  dispelWithoutLevel: 'И то, у чего круг неизвестен',
  endCastWhose: 'Чей каст',
  conditionEndsOnExit: 'Спадает при выходе из зоны',
  conditionEndsOnExitHint:
    'Состояние уходит, как только существо покинет зону, которая его наложила '
    + '(«Опутанность» от «Паутины»). Вне зоны выходить не из чего — там '
    + 'настройка ничего не делает.',
  conditionLocked: 'Снимает только источник',
  conditionLockedHint:
    'Плитка состояния на листе и действие «снять состояние» его не трогают',
  costHint: 'Ходом распоряжается человек — цена это пометка',
  askToggle: 'Спрашивать разрешения',
  asker: 'У кого спрашивать',
  notifyText: 'Текст сообщения',
  notifyTextPlaceholder: 'Что напомнить человеку',
  notifyTo: 'Кому',
  notifyRoll: 'Бросок к сообщению',
  notifyRollPlaceholder: '1к8',
  notifyRollHint: 'Номер строки таблицы поведения; пусто — без броска',
  restType: 'Какой отдых',
  everyFeet: 'За каждые, фт',
  everyFeetOnce: 'раз за путь',
  saveMode: 'Бросок',
  recurringSaveToggle: 'Повторный спасбросок снимает состояние',
  recurringSaveTiming: 'Когда',
  tagStack: 'Счётчик',
  tagStackHint: 'Повторная отметка прибавляет ступень, а не заменяет прежнюю',
  maxHpAmount: 'На сколько',
  maxHpAmountPlaceholder: DEFAULT_MAX_HP_REDUCTION,
  maxHpAmountHint: '@damage — урон события; можно число или кости',
  maxHpRest: 'Максимум вернётся после',
  nestedTriggerToggle: 'Своё срабатывание состояния',
  nestedTriggerEvent: 'Когда у состояния',
  nestedTriggerAction: 'Что делает',
} as const;

/** События срабатывания в списке */
export const EFFECT_TRIGGER_EVENT_LABELS: Partial<
  Record<EffectTriggerEvent, string>
> = {
  applied: 'При наложении',
  activate: 'При действии или включении',
  turnStart: 'В начале хода',
  turnEnd: 'В конце хода',
  enter: 'При входе в зону или ауру',
  exit: 'При выходе из зоны или ауры',
  attackRoll: 'При броске атаки',
  damageTaken: 'Когда носитель получает урон',
  healed: 'Когда носителя лечат',
  hpZero: 'Когда хиты носителя падают до 0',
  downedOther: 'Когда носитель сваливает цель',
  conditionLost: 'Когда с носителя снимается состояние',
  castEnd: 'Когда заклинание заканчивается',
  moved: 'Когда носитель проходит путь',
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
  EffectTriggerMaxHpRestEnd,
  string
> = {
  ...EFFECT_TRIGGER_REST_LABELS,
  [MAX_HP_REDUCTION_NEVER_ENDS]: 'Не вернётся сам',
};

/** Момент повторного спасброска */
export const EFFECT_SAVE_TIMING_LABELS: Record<EffectSaveTiming, string> = {
  startOfTurn: 'В начале хода',
  endOfTurn: 'В конце хода',
};

/** Режим спасброска срабатывания; обычный в данных не пишется */
export const EFFECT_TRIGGER_SAVE_MODE_LABELS: Record<
  EffectTriggerSaveMode | typeof EFFECT_TRIGGER_NORMAL_SAVE_MODE,
  string
> = {
  [EFFECT_TRIGGER_NORMAL_SAVE_MODE]: 'Обычный',
  advantage: 'С преимуществом',
  disadvantage: 'С помехой',
};

/** Подпись носителя эффекта как получателя или адресата */
const SUBJECT_ADDRESS_LABEL = 'Носителю эффекта';

/** Подпись наложившего эффект как получателя или адресата */
const SOURCE_ADDRESS_LABEL = 'Наложившему эффект';

/** Кому достаются действия срабатывания; «другая сторона» — у урона */
export const EFFECT_TRIGGER_RECIPIENT_LABELS: Record<
  EffectTriggerRecipient,
  string
> = {
  subject: SUBJECT_ADDRESS_LABEL,
  other: 'Тому, кто нанёс урон',
  source: SOURCE_ADDRESS_LABEL,
  area: 'Всем в радиусе',
  choice: 'Выбранным',
};

/** Подписи полей «всем в радиусе» */
export const EFFECT_TRIGGER_AREA_LABELS = {
  radius: 'Радиус, фт',
  target: 'Кого',
  alliesWithSelf: 'Союзников и носителя',
  allWithSelf: 'Всех и носителя',
} as const;

/** Подписи полей «по выбору» */
export const EFFECT_TRIGGER_CHOICE_LABELS = {
  radius: 'Радиус, фт',
  target: 'Из кого выбирать',
  count: 'Сколько целей',
  condition: 'Условие цели',
  optional: 'Можно отказаться',
  chooser: 'Кто выбирает',
} as const;

/** Кто выбирает получателей */
export const EFFECT_TRIGGER_CHOOSER_LABELS = {
  subject: 'Носитель эффекта',
  source: 'Наложивший эффект',
} as const;

/** «Другая сторона» при наложении — кто наложил эффект */
export const EFFECT_TRIGGER_APPLIED_OTHER_PARTY_LABEL = SOURCE_ADDRESS_LABEL;

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
  move: 'Переместить',
  moveArea: 'Сдвинуть зону',
  removeCondition: 'Снять состояние',
  tempHp: 'Временные хиты',
  kill: 'Убить',
  revive: 'Вернуть к жизни',
  dropHeld: 'Уронить из рук',
  restore: 'Вернуть ресурс',
  dispel: 'Рассеять заклинания',
  grantInspiration: 'Дать вдохновение',
  notify: 'Сообщить человеку',
  nextStage: 'Следующая ступень',
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
  move: 'tabler:arrow-big-right-lines',
  moveArea: 'tabler:arrows-move',
  removeCondition: 'tabler:mood-check',
  tempHp: 'tabler:shield-half',
  kill: 'tabler:skull',
  revive: 'tabler:heartbeat',
  dropHeld: 'tabler:hand-off',
  restore: 'tabler:battery-charging',
  dispel: 'tabler:wand-off',
  grantInspiration: 'tabler:star',
  notify: 'tabler:message-2',
  nextStage: 'tabler:stairs-up',
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
  selfTempHpZero: 'У носителя нет временных хитов',
  selfGrounded: 'Носитель не летит',
  selfSpecies: 'Вид носителя',
  selfAbilityAtMost: 'У носителя характеристика не больше',
  selfAbilityAtLeast: 'У носителя характеристика не меньше',
  otherIsSource: 'Другая сторона — тот, кто наложил эффект',
  otherBloodied: 'Другая сторона окровавлена (хитов не больше половины)',
  otherHpAtMost: 'У другой стороны хитов не больше',
  damageAtLeast: 'Урон не меньше',
  sourceWithin: 'Наложивший в пределах (фт)',
  attackKind: 'Вид атаки',
  attackAbility: 'Атака считается характеристикой',
  attackLanded: 'Атака попала',
  attackMissed: 'Атака промахнулась',
  combatRoundIs: 'Идёт раунд боя',
  combatRoundAtLeast: 'Раунд боя не раньше',
  movementOwn: 'Носитель шёл сам',
  movementForced: 'Носителя переставили (толчок, перенос)',
};

/**
 * Значение новой части условия, когда общее по виду выбора не годится: «на
 * раунде 50» бессмысленно, расписание почти всегда — со второго раунда.
 */
export const EFFECT_TRIGGER_CONDITION_KIND_DEFAULT_VALUES: Partial<
  Record<TriggerConditionKind, string>
> = {
  combatRoundIs: '2',
  combatRoundAtLeast: '2',
};

/** Значение новой части условия с выбором */
export const EFFECT_TRIGGER_CONDITION_DEFAULT_VALUES: Record<
  TriggerConditionParameter,
  string
> & {
  damageType: DamageType;
  creatureType: CreatureCategory;
  size: CreatureSize;
  condition: ConditionRef;
} = {
  damageType: 'fire',
  creatureType: 'humanoid',
  tag: DEFAULT_EFFECT_TAG,
  number: '50',
  size: 'large',
  condition: 'incapacitated',
  ability: 'strength',
  attackKind: 'melee',
  text: '',
};

/** Подписи того, кому адресовано сообщение срабатывания */
export const EFFECT_NOTIFY_TARGET_LABELS: Record<EffectNotifyTarget, string> = {
  subject: SUBJECT_ADDRESS_LABEL,
  source: SOURCE_ADDRESS_LABEL,
};

/** Подписи того, что делает действие с временными хитами */
export const EFFECT_TEMP_HP_MODE_LABELS: Record<EffectTempHpMode, string> = {
  set: 'Поставить',
  add: 'Прибавить',
  spend: 'Потратить',
};

/** Подписи того, какой ресурс возвращает действие */
export const EFFECT_RESTORE_KIND_LABELS: Record<EffectRestoreKind, string> = {
  spellSlot: 'Ячейку заклинания',
  counter: 'Ресурс листа',
};

/** Подписи того, чей каст заканчивает действие */
export const EFFECT_CAST_OWNER_LABELS: Record<EffectCastOwner, string> = {
  self: 'Свой',
  recipient: 'Получателя',
};

/** Подписи того, как двигает действие «Переместить» */
export const EFFECT_TRIGGER_MOVE_KIND_LABELS: Record<
  EffectTriggerMoveKind,
  string
> = {
  push: 'Оттолкнуть',
  pull: 'Притянуть',
  teleport: 'Перенести',
};

/** Подписи того, как сдвигается зона действием «Сдвинуть зону» */
export const EFFECT_TRIGGER_AREA_SHIFT_KIND_LABELS: Record<
  EffectTriggerAreaShiftKind,
  string
> = {
  away: 'От получателя',
  toward: 'К получателю',
  follow: 'За носителем',
};

/** Подписи опоры направления перемещения */
export const EFFECT_TRIGGER_MOVE_ORIGIN_LABELS: Record<
  EffectTriggerMoveOrigin,
  string
> = {
  source: 'От наложившего',
  subject: 'От носителя',
};
