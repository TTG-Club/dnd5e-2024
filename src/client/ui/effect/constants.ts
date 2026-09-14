/**
 * Подписи и размеры окна активного эффекта и его библиотек подсказок.
 *
 * Общие с другими формами подписи (название, характеристика, сложность,
 * кнопки окна) живут в `ui/actor/constants.ts` и берутся оттуда.
 */

import type {
  AreaEffectTrigger,
  ConditionKey,
  EffectAttackTrigger,
  EffectChangeMode,
  EffectDelivery,
  EffectFormContext,
  EffectFormStep,
  EffectSaveTiming,
  EffectSaveUnavailableReason,
  EffectSuccessOutcome,
  InertEffectField,
} from '@vtt/shared/system/dnd.js';

import { ACTIVE_EFFECT_DEFAULTS } from '../actor/constants';

/** Размеры окна эффекта */
export const ACTIVE_EFFECT_FORM_MODAL_SIZE = {
  width: 820,
  minWidth: 560,
  minHeight: 420,
} as const;

/** Подписи шапки, подвала и общих частей окна эффекта */
export const ACTIVE_EFFECT_FORM_LABELS = {
  /** Заголовок окна правки: дальше дописывается название эффекта */
  editTitlePrefix: 'Редактирование: ',
  /**
   * Заголовок окна создания. Это же слово стоит в названии нового эффекта:
   * форма открывается уже заполненной, и заголовок повторяет её поле.
   */
  createTitle: ACTIVE_EFFECT_DEFAULTS.name,
  icon: 'Иконка',
  iconPlaceholder: `Напр: ${ACTIVE_EFFECT_DEFAULTS.icon}`,
  statusActive: 'Работает',
  statusDisabled: 'Отключён',
  conditionPreset: 'Шаблон состояния',
  conditionPresetHint:
    'Заполнить тем, что делает стандартное состояние. Когда эффект '
    + 'срабатывает, спасбросок, урон и длительность останутся как есть.',
  summaryHint: 'Так эффект сработает с текущими настройками',
} as const;

/** Состояние, которого нет в меню шаблонов: степень Истощения задаёт своя панель */
export const CONDITION_PRESET_EXCLUDED_KEY: ConditionKey = 'exhaustion';

/** Заголовки шагов окна */
export const EFFECT_FORM_STEP_TITLES: Record<EffectFormStep, string> = {
  trigger: 'Когда срабатывает',
  save: 'Спасбросок',
  damage: 'Урон',
  modifiers: 'Что меняет',
  duration: 'Длительность и снятие',
};

/** Иконки шагов окна */
export const EFFECT_FORM_STEP_ICONS: Record<EffectFormStep, string> = {
  trigger: 'tabler:bolt',
  save: 'tabler:shield-half',
  damage: 'tabler:flame',
  modifiers: 'tabler:adjustments',
  duration: 'tabler:hourglass',
};

/** Заголовок шага «Что меняет» — по тому, на кого эффект ложится */
export const EFFECT_MODIFIERS_STEP_TITLES: Record<EffectDelivery, string> = {
  carrier: 'Что меняет',
  target: 'Что получает цель',
  aura: 'Что получают существа в ауре',
  zone: 'Что получает существо в зоне',
};

/** Иконки вариантов доставки */
export const EFFECT_DELIVERY_ICONS: Record<EffectDelivery, string> = {
  carrier: 'tabler:user-shield',
  target: 'tabler:crosshair',
  aura: 'tabler:circle-dotted',
  zone: 'tabler:hexagon',
};

/** Подпись варианта «на носителе» — по месту окна */
export const EFFECT_CARRIER_DELIVERY_LABELS: Record<EffectFormContext, string> =
  {
    ownEffects: 'На себе',
    feature: 'На персонаже',
    item: 'На владельце',
    weapon: 'На владельце',
    spell: 'На заклинателе',
    creatureAction: 'На существе',
    creatureTrait: 'На существе',
    zone: 'В зоне',
    condition: 'На носителе',
    generic: 'На носителе',
  };

/** Подпись варианта «на цели» — по месту окна */
export const EFFECT_TARGET_DELIVERY_LABELS: Record<EffectFormContext, string> =
  {
    ownEffects: 'На цели при попадании',
    feature: 'На цели при попадании',
    item: 'На цели при попадании',
    weapon: 'На цели при попадании',
    spell: 'На цели заклинания',
    creatureAction: 'На цели действия',
    creatureTrait: 'На цели при попадании',
    zone: 'На цели при попадании',
    condition: 'На цели при попадании',
    generic: 'На цели при попадании',
  };

/** Подписи вариантов доставки, не зависящие от места окна */
export const EFFECT_DELIVERY_LABELS = {
  aura: 'Аурой вокруг',
  zone: 'В зоне',
} as const;

/** Пояснения под выбором доставки */
export const EFFECT_DELIVERY_HINTS: Record<EffectDelivery, string> = {
  carrier:
    'Действует на того, у кого эффект: пока надет предмет, есть черта или '
    + 'висит сам эффект.',
  target:
    'Ложится на цель, когда атака попала или заклинание её задело. '
    + 'Спасбросок и урон ниже относятся к цели.',
  aura: 'Носитель излучает эффект на существ вокруг себя.',
  zone: 'Действует на существ в зоне.',
};

/** Подписи момента срабатывания зоны */
export const ZONE_TRIGGER_LABELS: Record<AreaEffectTrigger, string> = {
  stay: 'Пока в зоне',
  enter: 'При входе',
  exit: 'При выходе',
};

/** Подписи момента срабатывания ауры */
export const AURA_TRIGGER_LABELS: Record<AreaEffectTrigger, string> = {
  stay: 'Пока в ауре',
  enter: 'При входе в ауру',
  exit: 'При выходе из ауры',
};

/** Пояснения под выбором момента срабатывания */
export const EFFECT_TRIGGER_HINTS: Record<AreaEffectTrigger, string> = {
  stay:
    'Держится, пока существо внутри, и снимается на выходе. Спасброска и урона '
    + 'сразу у такого эффекта нет — только урон каждый ход.',
  enter:
    'Срабатывает один раз при каждом входе: спасбросок, урон и то, что '
    + 'останется на существе.',
  exit:
    'Срабатывает один раз при каждом выходе: спасбросок, урон и то, что '
    + 'останется на существе.',
};

/** Подписи настроек ауры */
export const EFFECT_AURA_LABELS = {
  radius: 'Радиус, фт',
  target: 'Кого задевает',
  targetAllies: 'Только союзников',
  targetEnemies: 'Только врагов',
  targetAll: 'Всех существ',
  applyToSelf: 'Действует и на носителя',
  visible: 'Круг на сцене',
} as const;

/** Приставка ключей модификаторов урона: у них значение может быть костями */
export const DAMAGE_CHANGE_KEY_PREFIX = 'damage.';

/** Момент урона каждого хода у нового эффекта: «Горение» жжёт в начале хода */
export const DEFAULT_RECURRING_DAMAGE_TIMING: EffectSaveTiming = 'startOfTurn';

/** Шаг радиуса ауры, фт */
export const EFFECT_AURA_RADIUS_STEP = 5;

/** Подписи шага «Спасбросок» */
export const EFFECT_SAVE_STEP_LABELS = {
  toggle: 'Цель делает спасбросок',
  areaToggle: 'Существо делает спасбросок',
  toggleHint: 'Провал — эффект срабатывает полностью. Что даёт успех — ниже.',
  ownToggle: 'Отдельный спасбросок эффекта',
  ownToggleHint:
    'Обычно хватает спасброска самого заклинания или действия. Включите, если '
    + 'эффект требует свой — например, другой характеристики.',
  successTitle: 'Если спасбросок успешен',
} as const;

/** Подсказка «0 — Сл источника» у поля Сл, по месту окна */
export const EFFECT_SOURCE_DC_HINTS: Partial<
  Record<EffectFormContext, string>
> = {
  spell: '0 — Сл заклинателя',
  creatureAction: '0 — Сл действия',
  generic: '0 — Сл источника (заклинателя или действия)',
};

/** Заголовок выбора «при успехе» спасброска самого заклинания или действия */
export const EFFECT_ACTION_SAVE_SUCCESS_TITLES: Partial<
  Record<EffectFormContext, string>
> = {
  spell: 'Если цель прошла спасбросок заклинания',
  creatureAction: 'Если цель прошла спасбросок действия',
};

/** Почему спасброска нет — пояснение вместо полей */
export const EFFECT_SAVE_UNAVAILABLE_HINTS: Record<
  EffectSaveUnavailableReason,
  string
> = {
  stayTrigger:
    'У эффекта «пока внутри» спасброска нет. Чтобы существо бросало '
    + 'спасбросок, выберите в шаге «Когда срабатывает» вход или выход.',
  onCarrier:
    'Спасбросок бросает цель. Чтобы при попадании цель бросала спасбросок, '
    + 'выберите в шаге «Когда срабатывает» вариант «на цели».',
};

/** Вариант выбора «при успехе»: подпись и пояснение */
export interface EffectSuccessOutcomeOption {
  /** Подпись варианта */
  label: string;
  /** Пояснение под подписью */
  description: string;
}

/** Варианты «при успехе» спасброска самого эффекта */
export const EFFECT_SUCCESS_OUTCOME_OPTIONS: Record<
  EffectSuccessOutcome,
  EffectSuccessOutcomeOption
> = {
  nothing: {
    label: 'Ничего',
    description: 'Ни урона, ни эффекта.',
  },
  halfDamage: {
    label: 'Половина урона',
    description: 'Эффект не накладывается.',
  },
  halfDamageWithEffect: {
    label: 'Половина урона и эффект',
    description: 'Эффект накладывается и на прошедшего спасбросок.',
  },
  effectWithoutDamage: {
    label: 'Эффект без урона',
    description: 'Урона нет, эффект накладывается.',
  },
  onlyOnSuccess: {
    label: 'Эффект только при успехе',
    description:
      'При провале — ничего. Для исходов «успех/провал» разными эффектами, '
      + 'как у «Луча слабости».',
  },
};

/** Варианты «при успехе» спасброска заклинания или действия */
export const EFFECT_ACTION_SAVE_OUTCOME_OPTIONS: Record<
  EffectSuccessOutcome,
  EffectSuccessOutcomeOption
> = {
  ...EFFECT_SUCCESS_OUTCOME_OPTIONS,
  nothing: {
    label: 'Эффект не накладывается',
    description: 'Прошедшая спасбросок цель эффект не получает.',
  },
  effectWithoutDamage: {
    label: 'Эффект всё равно',
    description: 'Эффект ложится и на прошедшую спасбросок цель.',
  },
};

/** Подписи шага «Урон» */
export const EFFECT_DAMAGE_STEP_LABELS = {
  triggerTitle: 'Урон при срабатывании',
  triggerHint:
    'Наносится сразу. Со спасброском: провал — полный, успех — по выбору в '
    + 'шаге «Спасбросок».',
  recurringToggle: 'Урон каждый ход',
  recurringHint:
    'Пока эффект на существе, урон наносится в бою на каждом его ходу '
    + '(«Горение»).',
  recurringWhen: 'Когда',
  addDamage: 'Добавить урон',
} as const;

/** Моменты хода для урона и повторного спасброска */
export const EFFECT_TURN_MOMENT_LABELS: Record<EffectSaveTiming, string> = {
  startOfTurn: 'В начале хода',
  endOfTurn: 'В конце хода',
};

/** Подписи шага «Что меняет» */
export const EFFECT_MODIFIERS_STEP_LABELS = {
  conditionPrefix: 'Состояние: ',
  conditionRemove: 'Не считать состоянием',
  conditionRemoveHint:
    'Эффект перестанет считаться состоянием: иммунитет к нему не сработает. '
    + 'Модификаторы и особые правила останутся.',
  changesTitle: 'Модификаторы',
  changesEmpty: 'Модификаторов нет. Добавьте из списка «Готовые».',
  flagsTitle: 'Особые правила',
  flagsEmpty: 'Особых правил нет: помеха, преимущество, сопротивления…',
  presets: 'Готовые',
  changePresetHint:
    'Ключ, режим и значение подставятся сами — останется поправить число.',
  flagPresetHint: 'Выбрать правило из разделов',
  flagSearch: 'Поиск',
  add: 'Добавить',
  immunitiesTitle: 'Иммунитет к состояниям',
  immunitiesHint:
    'Пока эффект действует, носитель не подхватывает эти состояния.',
  immunitiesPlaceholder: 'Состояния...',
} as const;

/** Подписи строки модификатора */
export const EFFECT_CHANGE_ROW_LABELS = {
  keyPlaceholder: 'Что меняется',
  keyLibrary: 'Выбрать, что меняется',
  value: 'Значение',
  valuePlaceholder: '+2, 1к4',
  valueLibrary: 'Библиотека значений',
  mode: 'Режим',
  condition: 'Условие',
  conditionPlaceholder: 'roll.hasAdvantage',
  conditionLibrary: 'Шаблоны условий',
  conditionOnlyPrefix: 'Только: ',
  priority: 'Приоритет',
  priorityHint: `Меньше — раньше (по умолчанию ${ACTIVE_EFFECT_DEFAULTS.changePriority})`,
  remove: 'Удалить модификатор',
  damageFormulaHint:
    'Кроме числа (+2) можно указать кости — они бросаются отдельной частью '
    + 'урона: «2к6», тип — «2к6@dmg.fire», только по цели с полным HP — '
    + '«2к6@dmg.fire@target.full», только по раненой — «@target.notFull».',
} as const;

/** Подписи режимов модификатора */
export const EFFECT_CHANGE_MODE_OPTIONS: ReadonlyArray<{
  value: EffectChangeMode;
  label: string;
}> = [
  { value: 'add', label: 'Добавить (+)' },
  { value: 'multiply', label: 'Умножить (×)' },
  { value: 'override', label: 'Заменить (=)' },
  { value: 'upgrade', label: 'Не меньше (max)' },
  { value: 'downgrade', label: 'Не больше (min)' },
  { value: 'custom', label: 'Особый' },
];

/** Подписи строки флага */
export const EFFECT_FLAG_ROW_LABELS = {
  remove: 'Убрать правило',
} as const;

/** Подписи шага «Длительность и снятие» */
export const EFFECT_DURATION_STEP_LABELS = {
  durationTitle: 'Сколько держится',
  valuePlaceholder: 'Сколько',
  permanentHint: 'Пока не снимут вручную.',
  roundsHint: 'Отсчитывается в бою каждый раунд.',
  turnHint:
    'Спадает точно на ходу носителя или источника — «до конца следующего '
    + 'хода». Работает в бою.',
  specialHint: 'Особое условие: снимает мастер.',
  timeHint: 'Для справки: вне боя время не отсчитывается.',
  recurringSaveToggle: 'Повторный спасбросок снимает эффект',
  recurringSaveHint:
    'Пока эффект действует, существо повторяет спасбросок и при успехе '
    + 'сбрасывает его.',
  recurringSaveWhen: 'Когда',
  consumeOnTitle: 'Снять после атаки',
  consumeOnHint:
    'Эффект сгорает после первого же броска атаки — «помеха на следующую '
    + 'атаку», не дожидаясь конца длительности.',
} as const;

/** Значение переключателя «снять после атаки», когда снимать не нужно */
export const EFFECT_CONSUME_ON_NONE = 'none';

/** Варианты «Снять после атаки» */
export const EFFECT_CONSUME_ON_OPTIONS: ReadonlyArray<{
  value: EffectAttackTrigger | typeof EFFECT_CONSUME_ON_NONE;
  label: string;
  icon: string;
}> = [
  { value: EFFECT_CONSUME_ON_NONE, label: 'Нет', icon: 'tabler:hourglass' },
  { value: 'carrierAttack', label: 'После своей атаки', icon: 'tabler:sword' },
  {
    value: 'attackOnCarrier',
    label: 'После атаки по носителю',
    icon: 'tabler:target-arrow',
  },
];

/** Подписи плашки неработающих настроек */
export const EFFECT_INERT_FIELDS_LABELS = {
  title: 'Эти настройки здесь не работают',
  description:
    'Они остались от прежнего редактора или от другого места эффекта и при '
    + 'срабатывании будут пропущены: ',
  clear: 'Убрать',
} as const;

/** Названия неработающих настроек */
export const EFFECT_INERT_FIELD_NAMES: Record<InertEffectField, string> = {
  effectTarget: 'на кого накладывается',
  aura: 'аура',
  areaTrigger: 'момент срабатывания',
  applySave: 'спасбросок',
  successOutcome: 'исход при успехе',
  damageParts: 'урон при срабатывании',
  recurringDamage: 'урон каждый ход',
  recurringSave: 'повторный спасбросок',
  consumeOn: 'снятие после атаки',
  duration: 'длительность',
  conditionImmunities: 'иммунитет к состояниям',
};

/** Подписи сворачиваемого раздела «Описание» */
export const EFFECT_DESCRIPTION_LABELS = {
  title: 'Описание',
  placeholder: 'Коротко для подсказки и списка эффектов',
  fillFromSummary: 'Взять из сводки',
  fillFromSummaryHint: 'Заменить описание фразой из сводки сверху',
} as const;

/** Подписи сворачиваемого раздела «Для опытных» */
export const EFFECT_ADVANCED_LABELS = {
  title: 'Для опытных',
  advancedFields: 'Режим, условие и приоритет у модификаторов',
  advancedFieldsHint:
    'Строки, где эти поля уже заданы, показывают их всегда. Остальным хватает '
    + '«что меняется» и значения.',
} as const;

/** Размеры окна библиотеки подсказок эффекта */
export const EFFECT_TEMPLATES_MODAL_SIZE = {
  width: 400,
  height: 500,
  minWidth: 300,
  minHeight: 400,
} as const;

/** Ключи окон библиотек подсказок в менеджере окон хоста */
export const EFFECT_TEMPLATES_MODAL_IDS = {
  key: 'effect-key-templates-modal',
  value: 'effect-value-templates-modal',
  flag: 'effect-flag-templates-modal',
  condition: 'effect-condition-templates-modal',
} as const;

/**
 * Подписи библиотек шаблонов активного эффекта. Окно у всех четырёх одно:
 * поиск сверху, список подсказок под ним — расходиться должны только слова,
 * которыми оно называет своё содержимое.
 *
 * Заголовки берутся у кнопок формы, которые эти окна открывают: одна и та же
 * библиотека не может называться по-разному в кнопке и в шапке.
 */
export const ACTIVE_EFFECT_TEMPLATES_LABELS = {
  keyTitle: EFFECT_CHANGE_ROW_LABELS.keyLibrary,
  keySearchPlaceholder: 'Поиск по атрибутам...',
  keyEmpty: 'Атрибуты не найдены',
  valueTitle: EFFECT_CHANGE_ROW_LABELS.valueLibrary,
  valueSearchPlaceholder: 'Поиск по значениям...',
  valueEmpty: 'Значения не найдены',
  flagTitle: 'Поиск особых правил',
  flagSearchPlaceholder: 'Поиск по правилам...',
  flagEmpty: 'Правила не найдены',
  conditionTitle: EFFECT_CHANGE_ROW_LABELS.conditionLibrary,
  conditionSearchPlaceholder: 'Поиск по шаблонам...',
  conditionEmpty: 'Шаблоны не найдены',
} as const;
