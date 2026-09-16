/**
 * Подписи и размеры окна активного эффекта и его библиотек подсказок.
 *
 * Общие с другими формами подписи (название, характеристика, сложность,
 * кнопки окна) живут в `ui/actor/constants.ts` и берутся оттуда.
 */

import type {
  AreaEffectTrigger,
  ConditionKey,
  EffectActivationMode,
  EffectChangeMode,
  EffectDelivery,
  EffectFormContext,
  EffectFormStep,
  EffectSaveUnavailableReason,
  EffectSuccessOutcome,
  EffectVariantPick,
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
  duration: 'Длительность',
  triggers: 'Срабатывания',
};

/** Иконки шагов окна */
export const EFFECT_FORM_STEP_ICONS: Record<EffectFormStep, string> = {
  trigger: 'tabler:bolt',
  save: 'tabler:shield-half',
  damage: 'tabler:flame',
  modifiers: 'tabler:adjustments',
  duration: 'tabler:hourglass',
  triggers: 'tabler:repeat',
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
  /** Зона, которую заклинание оставляет на месте своего шаблона */
  spellZone: 'Зоной на месте области',
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

/**
 * Пояснение к зоне заклинания: где она появляется и когда пропадает. Урон и
 * эффекты при касте накладывает само заклинание, зона — то, что остаётся.
 */
export const EFFECT_SPELL_ZONE_DELIVERY_HINT =
  'После применения на месте шаблона остаётся зона: в бою она держится, пока '
  + 'длится заклинание, новая концентрация её снимает. Нужна область у '
  + 'заклинания.';

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
  radiusFormula: 'Радиус формулой',
  radiusFormulaPlaceholder: '10 + 20 * floor(@classLevel / 18)',
  radiusFormulaHint: 'Считается от носителя и заменяет число радиуса',
  whileCapable: 'Гаснет, пока носитель недееспособен',
} as const;

/** Приставка ключей модификаторов урона: у них значение может быть костями */
export const DAMAGE_CHANGE_KEY_PREFIX = 'damage.';

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

/** Чья Сл подставляется в режиме «Авто», по месту окна */
export const EFFECT_SOURCE_DC_LABELS: Partial<
  Record<EffectFormContext, string>
> = {
  spell: 'Сл заклинателя',
  creatureAction: 'Сл действия',
  weapon: 'Сл оружия (8 + бонус атаки)',
  generic: 'Сл источника',
};

/** Режим поля Сл: подставить Сл источника или задать своё число */
export type SaveDcFieldMode = 'auto' | 'manual';

/** Подписи режимов поля Сл */
export const SAVE_DC_FIELD_MODE_LABELS: Record<SaveDcFieldMode, string> = {
  auto: 'Авто',
  manual: 'Вручную',
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
  addDamage: 'Добавить урон',
} as const;

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
  rollConditionTitle: 'Действует',
  rollConditionAlways: 'Всегда — в числах листа',
  rollConditionHint:
    'С условием эффект не входит в числа листа и работает только в бросках, '
    + 'где условие выполнено: в своей атаке («Тактика стаи» — союзник рядом с '
    + 'целью) или в атаке по носителю («Защита от добра и зла» — атакующий '
    + 'исчадие).',
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

/** Подписи шага «Длительность» */
export const EFFECT_DURATION_STEP_LABELS = {
  durationTitle: 'Сколько держится',
  valuePlaceholder: 'Сколько',
  permanentHint: 'Пока не снимут вручную.',
  roundsHint: 'Отсчитывается в бою каждый раунд.',
  turnHint:
    'Спадает точно на ходу носителя или источника — «до конца следующего '
    + 'хода». Работает в бою.',
  specialHint: 'Особое условие: снимает мастер.',
  timeHint:
    'В бою минуты и часы отсчитываются раундами (минута — 10); вне боя время '
    + 'не идёт.',
} as const;

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
  activation: 'применение или включение',
  landingCondition: 'условие наложения',
  variant: 'вариант',
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
  triggers: 'срабатывания не для этого места',
};

/** Значение выбора «Действует» для эффекта без применения */
export const EFFECT_PERMANENT_ACTIVATION = 'permanent';

/** Выбор «Действует»: постоянно, при применении или переключателем */
export type EffectActivationChoice =
  EffectActivationMode | typeof EFFECT_PERMANENT_ACTIVATION;

/** Подписи выбора «Действует» */
export const EFFECT_ACTIVATION_CHOICE_LABELS: Record<
  EffectActivationChoice,
  string
> = {
  permanent: 'Постоянно',
  use: 'При применении',
  toggle: 'Переключателем',
};

/** Пояснения под выбором «Действует» */
export const EFFECT_ACTIVATION_CHOICE_HINTS: Record<
  EffectActivationChoice,
  string
> = {
  permanent: 'Действует всё время, пока есть источник.',
  use:
    'Сам не действует: копия ложится, когда источник применяют — пунктом '
    + '«Использовать» у предмета, выстрелом боеприпасом, кнопкой «Применить» '
    + 'на листе. Расходуемый предмет теряет единицу, предмет с зарядами — '
    + 'заряд.',
  toggle:
    'Лежит на листе выключенным и включается переключателем. Включение '
    + 'запускает срабатывания «При включении»; по истечении длительности '
    + 'эффект выключается.',
};

/** Подписи ресурса применения */
export const EFFECT_ACTIVATION_COUNTER_LABELS = {
  counter: 'Тратит ресурс',
  counterPlaceholder: 'Ключ ресурса, например rage',
  amount: 'Сколько',
  hint: 'Ресурс листа (вкладка «Ресурсы»); пусто — ничего не тратит.',
} as const;

/** Подписи условия наложения */
export const EFFECT_LANDING_CONDITION_LABELS = {
  title: 'Ложится, если',
  always: 'Без условия — ложится всегда.',
  hint:
    'Условие считается до урона этого удара. Нужны хиты после урона — '
    + 'срабатывание «При наложении».',
} as const;

/** Подписи варианта эффекта */
export const EFFECT_VARIANT_LABELS = {
  toggle: 'Один из вариантов',
  toggleHint:
    'Из эффектов одной группы ложится один: его выбирают при броске или '
    + 'бросают случайно.',
  group: 'Группа',
  label: 'Вариант',
  pick: 'Выбор',
  defaultGroup: 'вариант',
} as const;

/** Приставка ключа плашки выбора варианта */
export const EFFECT_VARIANT_MODAL_KEY_PREFIX = 'effect-variant';

/** Подписи плашки выбора варианта и строки чата */
export const EFFECT_VARIANT_PROMPT_LABELS = {
  titlePrefix: '«',
  titleSuffix: '»: какой вариант?',
  confirm: 'Выбрать',
  cancel: 'Отменить',
  chatSeparator: ': ',
  chatJoiner: ', ',
} as const;

/** Как выбирается вариант группы */
export const EFFECT_VARIANT_PICK_LABELS: Record<EffectVariantPick, string> = {
  choose: 'Выбирает бросающий',
  random: 'Случайно',
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
  priorityField: 'Приоритет у модификаторов',
  priorityFieldHint:
    'Порядок, в котором применяются модификаторы. Строки, где приоритет уже '
    + 'задан, показывают его всегда.',
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

/** Подписи применения эффектов, предметов и боеприпасов */
export const EFFECT_USE_LABELS = {
  use: 'Использовать',
  apply: 'Применить',
  applyHint: 'Наложить эффект: на себя или на выбранную цель',
  chatUses: ' применяет ',
  noTargetTitle: 'Нет цели',
  noTargetText: 'Эффект ложится на цель — сначала выберите её.',
  noUsesTitle: 'Нечего применить',
  noUsesText: 'Заряды или количество кончились.',
  noCounterTitle: 'Не хватает ресурса',
  noCounterPrefix: 'Ресурс «',
  noCounterSuffix: '» исчерпан.',
  noAmmunitionPrefix: '⛔ ',
  noAmmunitionSuffix: ': нет боеприпасов',
} as const;
