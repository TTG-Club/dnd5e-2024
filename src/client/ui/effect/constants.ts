/**
 * Подписи и размеры окна активного эффекта и его библиотек подсказок.
 *
 * Общие с другими формами подписи (название, характеристика, сложность,
 * кнопки окна) живут в `ui/actor/constants.ts` и берутся оттуда.
 */

import type { SkillType } from '@vtt/shared';
import type {
  AreaEffectTrigger,
  ConditionKey,
  EffectActionCost,
  EffectActivationMode,
  EffectChangeModeChoice,
  EffectChangeStepPeriod,
  EffectDelivery,
  EffectFormContext,
  EffectFormStep,
  EffectSaveUnavailableReason,
  EffectSuccessOutcome,
  EffectTriggerEvent,
  EffectVariantPick,
  InertEffectField,
} from '@vtt/shared/system/dnd.js';

import { SUBTRACT_MODE_CHOICE } from '@vtt/shared/system/dnd.js';

import {
  ACTIVE_EFFECT_DEFAULTS,
  MODAL_BUTTON_LABELS,
} from '../actor/constants';

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
  summaryHint: 'Так эффект сработает с текущими настройками',
} as const;

/** Иконка шаблона состояния: у кнопки шага и у раздела в меню правил */
export const CONDITION_PRESET_ICON = 'tabler:template';

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
  aura: 'tabler:circle-dashed',
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

/** Подписи доставок эффекта, который накладывается применением */
export const EFFECT_USE_DELIVERY_LABELS = {
  carrier: 'На применившем',
  target: 'На цели при применении',
} as const;

/** Пояснения доставок эффекта, который накладывается применением */
export const EFFECT_USE_DELIVERY_HINTS = {
  carrier: 'Копия ложится на того, кто применил, и живёт своей длительностью.',
  target:
    'Копия ложится на того, кого выберут щелчком по фишке, — на себя или на '
    + 'другого (зелье выпивают или вливают). Спасбросок и урон ниже относятся '
    + 'к цели.',
} as const;

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

/** Шаг новой растущей строки: правило, ради которого его заводят, — убывающее */
export const DEFAULT_CHANGE_STEP_BY = -1;

/** Период шага новой растущей строки: каждый ход носителя */
export const DEFAULT_CHANGE_STEP_PER: EffectChangeStepPeriod = 'turn';

/** Подписи периода шага строки модификатора */
export const EFFECT_CHANGE_STEP_PER_LABELS: Record<
  EffectChangeStepPeriod,
  string
> = {
  turn: 'Каждый ход носителя',
  round: 'Каждый раунд боя',
};

/** Подписи шага строки модификатора */
export const EFFECT_CHANGE_STEP_LABELS = {
  toggle: 'Меняется со временем',
  by: 'На сколько',
  per: 'Как часто',
  until: 'До',
  untilPlaceholder: 'Без предела',
  hint:
    'Значение строки двигается само: «−1 за каждый следующий ход, до −5». '
    + 'Работает только у обычного числа — формулу двигать нечем, её считают '
    + 'заново при каждом броске. Вне боя ни ход, ни раунд не наступают.',
  numberHint:
    'Шаг работает только у числа: у этой строки значение пустое или формула.',
} as const;

/** Приставка ключей модификаторов урона: у них значение может быть костями */
export const DAMAGE_CHANGE_KEY_PREFIX = 'damage.';

/** Шаг радиуса ауры, фт */
export const EFFECT_AURA_RADIUS_STEP = 5;

/** Шаг футов цены «Перемещение»: клетка сетки */
export const EFFECT_MOVE_COST_FEET_STEP = 5;

/** Подписи цены действия — у срабатывания и у «вырваться» одни */
export const EFFECT_ACTION_COST_FIELD_LABELS = {
  cost: 'Цена',
  moveCost: 'Футов',
} as const;

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
  /** Согласная цель не бросает спасбросок */
  allowWilling: 'Согласная цель не бросает',
  /** Подсказка галочки: кто решает и что увидит */
  allowWillingHint:
    'В окне броска появится «Не сопротивляюсь»: решает владелец цели',
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
  conditionPresetTitle: 'Готовое состояние',
  conditionPresetHint:
    'Отравленный, Ослеплённый и другие состояния: модификаторы и правила '
    + 'заполнятся сами. Спасбросок, урон и длительность останутся как есть.',
  conditionPresetPick: 'Выбрать состояние',
  conditionPresetChange: 'Сменить',
  conditionPresetChangeHint:
    'Заменить модификаторы и особые правила другим состоянием',
  /** Раздел состояний в меню «Готовые» у особых правил */
  flagMenuConditions: 'Состояния (Отравленный и др.)',
  flagMenuConditionsNote: 'Заменит модификаторы и правила эффекта',
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
  savedRollTitle: 'Сохранённый бросок',
  savedRollPlaceholder: 'Например, 2к6',
  savedRollHint:
    'Кость бросается ОДИН раз — когда эффект ложится. Результат подставляется '
    + 'вместо @roll во все формулы эффекта и дальше не меняется: урон каждый '
    + 'ход будет одним и тем же числом, а не новой костью при каждом тике.',
  adjacentAllyTitle: 'Какой союзник',
  adjacentAllyHint:
    'По правилам 2024 «Тактика стаи» не считает недееспособного союзника: '
    + 'спящего, парализованного, оглушённого. «В любом состоянии» — хватит '
    + 'просто стоять рядом.',
  immunitiesTitle: 'Иммунитет к состояниям',
  immunitiesHint:
    'Пока эффект действует, носитель не подхватывает эти состояния.',
  suppressTitle: 'Подавляет состояния',
  suppressHint:
    'Состояние остаётся на носителе, но не действует, пока эффект жив: «Свобода перемещения» гасит Опутанного.',
  suppressPlaceholder: 'Выберите состояния',
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
  noOpHint:
    'Прибавка 0 и множитель 1 ничего не меняют. Преимущество и помеха — '
    + 'в «Особых правилах» ниже.',
  damageFormulaHint:
    'Кроме числа (+2) можно указать кости — они бросаются отдельной частью '
    + 'урона: «2к6», тип — «2к6@dmg.fire», только по цели с полным HP — '
    + '«2к6@dmg.fire@target.full», только по раненой — «@target.notFull».',
  rollDiceHint: 'Кость бросается заново при каждом броске.',
  diceNotRolledError:
    'Здесь кость никто не бросит: она работает только у атак, спасбросков, '
    + 'проверок, навыков и урона. Укажите число.',
  diceModeError:
    'Кость работает только в режимах «Добавить (+)» и «Вычесть (−)».',
} as const;

/** Подписи режимов модификатора */
export const EFFECT_CHANGE_MODE_OPTIONS: ReadonlyArray<{
  value: EffectChangeModeChoice;
  label: string;
}> = [
  { value: 'add', label: 'Добавить (+)' },
  // Только в форме: в данных это «Добавить» со знаком минус
  { value: SUBTRACT_MODE_CHOICE, label: 'Вычесть (−)' },
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
  formulaToggle: 'Формулой',
  formulaToggleHint:
    'Срок бросается один раз, при наложении: «1к4» раунда у «Замешательства», '
    + '«1 + @mod.con» у умения.',
  formulaPlaceholder: 'Например, 1к4',
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
  title: 'Не работает в этом месте',
  titleHint:
    'Настройки остались от прежнего редактора или от другого места эффекта. '
    + 'При срабатывании они пропускаются. «Убрать» стирает только их — '
    + 'остальное в эффекте не меняется.',
  clear: 'Убрать',
  clearAll: 'Убрать всё',
  triggerName: 'Срабатывание',
  /** Между названием настройки и тем, что именно задано */
  detailSeparator: ': ',
  actionsUnavailablePrefix: 'Здесь нет действий: ',
  actionsJoiner: ', ',
  /** Перед переключателями, которые включают момент срабатывания */
  switchesPrefix: ` Выберите в шаге «${EFFECT_FORM_STEP_TITLES.trigger}»: `,
  switchesJoiner: ' или ',
  switchQuoteOpen: '«',
  switchQuoteClose: '»',
} as const;

/** Названия неработающих настроек — заголовки строк плашки */
export const EFFECT_INERT_FIELD_NAMES: Record<InertEffectField, string> = {
  charges: 'Заряды',
  activation: 'Применение или включение',
  landingCondition: 'Условие наложения',
  variant: 'Вариант',
  effectTarget: 'На кого накладывается',
  aura: 'Аура',
  areaTrigger: 'Момент входа или выхода',
  applySave: 'Спасбросок',
  successOutcome: 'Исход при успехе',
  damageParts: 'Урон при срабатывании',
  recurringDamage: 'Урон каждый ход',
  recurringSave: 'Повторный спасбросок',
  consumeOn: 'Снятие после атаки',
  duration: 'Длительность',
  conditionImmunities: 'Иммунитет к состояниям',
  triggers: 'Срабатывания',
};

/**
 * Почему настройка не работает. Причины сверены с раскладкой окна
 * (`resolveEffectFormLayout`): поле работает там же, где окно его показывает.
 */
export const EFFECT_INERT_FIELD_REASONS: Record<InertEffectField, string> = {
  charges: 'Заряды тратят срабатывания, а здесь эффект их не выполняет.',
  activation: 'Такого способа включения здесь нет.',
  landingCondition:
    'Условие проверяется, когда эффект накладывают, а отсюда его не '
    + 'накладывают.',
  variant: 'Выбор варианта здесь не предлагается.',
  effectTarget:
    'Отсюда эффект так не накладывается: на цель — только ударом или '
    + 'заклинанием, в зону — только заклинанием с областью.',
  aura: 'Аурой эффект отсюда не работает.',
  areaTrigger: 'Вход и выход бывают только у зоны и ауры.',
  applySave:
    'Спасбросок кидает тот, на кого эффект ложится, а здесь эффект просто '
    + 'лежит на носителе.',
  successOutcome: 'Исход при успехе бывает только у спасброска.',
  damageParts:
    'Урон получает тот, на кого эффект ложится, а здесь эффект ни на кого не '
    + 'ложится.',
  recurringDamage:
    'Каждый ход тикает только эффект, который лежит на существе сам.',
  recurringSave:
    'Повторный спасбросок бывает только у эффекта, который лежит на существе '
    + 'сам.',
  consumeOn:
    'Снимается после атаки только эффект, который лежит на существе сам.',
  duration:
    'Здесь эффект действует, пока есть источник: срок не отсчитывается.',
  conditionImmunities: 'Иммунитет отсюда не действует.',
  triggers: 'Такой момент здесь не наступает.',
};

/**
 * Почему момент срабатывания не наступает. Что переключить, дописывает
 * плашка — только то, что в этом месте есть. Нет в списке — общая причина.
 */
export const EFFECT_TRIGGER_EVENT_UNAVAILABLE_REASONS: Partial<
  Record<EffectTriggerEvent, string>
> = {
  applied: '«При наложении» бывает, только когда эффект накладывают.',
  activate:
    '«При действии или включении» бывает, только когда эффект включают.',
};

/** Значение выбора «Действует» для эффекта без применения */
export const EFFECT_PERMANENT_ACTIVATION = 'permanent';

/** Условию по отметке в «Ложится, если» подсказывать нечего */
export const EFFECT_NO_KNOWN_TAGS: readonly string[] = [];

/** Значение выбора «Действует» у модификаторов без условия броска */
export const EFFECT_ROLL_CONDITION_ALWAYS = 'always';

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

/**
 * До скольких вариантов группа выбирается переключателем: больше в ширину
 * плашки не помещается — тогда выпадающий список
 */
export const EFFECT_VARIANT_SWITCH_MAX = 3;

/** Приставка ключа плашки выбора варианта */
export const EFFECT_VARIANT_MODAL_KEY_PREFIX = 'effect-variant';

/** Подписи плашки выбора варианта и строки чата */
export const EFFECT_VARIANT_PROMPT_LABELS = {
  titlePrefix: '«',
  titleSuffix: '»: какой вариант?',
  confirm: MODAL_BUTTON_LABELS.apply,
  cancel: MODAL_BUTTON_LABELS.cancel,
  chatSeparator: ': ',
  chatJoiner: ', ',
} as const;

/** Приставка ключа плашки выбора цели */
export const EFFECT_TARGET_MODAL_KEY_PREFIX = 'effect-target';

/** С какого числа кандидатов плашка выбора цели показывает поиск */
export const CHOICE_SEARCH_THRESHOLD = 8;

/** Вид кнопки кандидата в плашке выбора: отмеченный и нет */
export const TARGET_CANDIDATE_BUTTON = {
  chosen: { color: 'primary', variant: 'solid', icon: 'tabler:check' },
  idle: { color: 'neutral', variant: 'ghost', icon: 'tabler:point' },
} as const;

/** Подписи плашки выбора цели */
export const EFFECT_TARGET_PROMPT_LABELS = {
  titleFallback: 'Выберите цель',
  titleSeparator: ': ',
  countPrefix: 'Выбрано ',
  countJoiner: ' из ',
  confirm: MODAL_BUTTON_LABELS.apply,
  decline: 'Отказаться',
  cancel: MODAL_BUTTON_LABELS.cancel,
  hpPrefix: ' (',
  hpJoiner: '/',
  hpSuffix: ')',
  search: 'Поиск',
  searchEmpty: 'Никто не подходит',
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
  noUsesTitle: 'Нечего применить',
  noUsesText: 'Заряды или количество кончились.',
  noCounterTitle: 'Не хватает ресурса',
  noCounterPrefix: 'Ресурс «',
  noCounterSuffix: '» исчерпан.',
  blockedPrefix: '⛔ ',
  noAmmunitionSuffix: ': нет боеприпасов',
  depletedSuffix: ': закончились',
  /** Подпись кнопки применения на панели быстрого доступа */
  hotbarPrefix: 'Использовать: ',
} as const;

/** Приставка ключа плашки «На кого применить» */
export const EFFECT_USE_TARGET_MODAL_KEY_PREFIX = 'effect-use-target';

/** Иконки плашки «На кого применить»: шапка и предупреждение «далеко» */
export const EFFECT_USE_TARGET_ICONS = {
  header: 'tabler:hand-finger',
  far: 'tabler:alert-triangle',
} as const;

/** Подписи выбора получателя при применении предмета или эффекта */
export const EFFECT_USE_TARGET_LABELS = {
  prompt: 'На кого применить?',
  titleSeparator: EFFECT_TARGET_PROMPT_LABELS.titleSeparator,
  mapHint: 'Щёлкните по фишке на карте. Правая кнопка снимает выбор.',
  pickHint: 'Никто не выбран',
  distancePrefix: ' — ',
  farTitle: 'Далеко',
  farText: 'Дальше касания применить можно только с разрешения ведущего.',
  apply: MODAL_BUTTON_LABELS.apply,
  askGm: 'Спросить ведущего',
  cancel: MODAL_BUTTON_LABELS.cancel,
  noTargetTitle: 'Нет цели',
  noTargetText: 'Эффект ложится на цель — сначала выберите её.',
  movedAwayTitle: 'Цель пропала',
  movedAwayText: 'Выбранной фишки больше нет на сцене.',
} as const;

/**
 * Вопрос ведущему о применении дальше касания:
 * «Эльф хочет применить «Зелье лечения» к Гоблину: до цели 15 фт, касанием —
 * 5 фт.»
 */
export const EFFECT_USE_GM_QUESTION_PARTS = {
  wantsToApply: ' хочет применить «',
  toTarget: '» к ',
  distancePrefix: ': до цели ',
  reachPrefix: ', касанием — ',
  end: '.',
  unitSeparator: ' ',
} as const;

/** Что видит просящий, когда ведущий не разрешил */
export const EFFECT_USE_GM_VERDICT_TOASTS = {
  denied: {
    title: 'Ведущий не разрешил',
    description: 'Предмет не потрачен.',
  },
  noGameMaster: {
    title: 'Ведущего нет в сети',
    description: 'Спросить некого — подойдите ближе.',
  },
  unanswered: {
    title: 'Ведущий не ответил',
    description: 'Предмет не потрачен — попробуйте ещё раз.',
  },
} as const;

/** Сколько получателей у применения предмета или эффекта: один */
export const EFFECT_USE_TARGET_COUNT = 1;

/** Цена нового действия «вырваться»: правила обычно просят действие */
export const NEW_ESCAPE_COST: EffectActionCost = 'action';

/** Навык проверки нового действия «вырваться» */
export const NEW_ESCAPE_CHECK_SKILL: SkillType = 'athletics';

/** Приставка ключа окна броска «вырваться»: дальше идёт идентификатор эффекта */
export const EFFECT_ESCAPE_MODAL_KEY_PREFIX = 'effect-escape:';

/** Подписи действия «вырваться» на вкладке «Эффекты» */
export const EFFECT_ESCAPE_LABELS = {
  /** Разделитель подписи и имени носителя */
  titleSeparator: ' — ',
  /** Подпись кнопки броска в окне костей */
  rollButton: 'Бросить проверку',
  /** Подсказка кнопки на строке эффекта */
  hint: 'Действие, снимающее эффект',
  /** Приставка причины, по которой кнопка не действует */
  unavailablePrefix: 'Нельзя вырваться: ',
} as const;

/** Подписи ступеней эффекта на вкладке «Эффекты» */
export const EFFECT_STAGE_LABELS = {
  /** Подсказка кнопки перевода на следующую ступень */
  advanceHint: 'Перевести эффект на следующую ступень',
} as const;

/** Подписи зарядов эффекта в списке эффектов листа */
export const EFFECT_CHARGES_LABELS = {
  /** Приставка перед «осталось/всего» */
  title: 'Заряды:',
  /** Разделитель «осталось» и «всего» */
  separator: '/',
} as const;

/** Подписи действия при действующем заклинании */
export const EFFECT_ACTIVE_ACTION_LABELS = {
  /** Подпись кнопки */
  run: 'Действие',
  /** Подсказка кнопки */
  hint: 'Выполнить действие действующего заклинания',
  /** Разделитель подписи и цены: «Действие · Бонусное действие» */
  costSeparator: ' · ',
} as const;

/** Подписи плашки вопроса человеку */
export const EFFECT_QUESTION_PROMPT_LABELS = {
  /** Заголовок без названия источника */
  titleFallback: 'Вопрос',
  /** Разделитель источника и заголовка */
  titleSeparator: ' — ',
  /** Приставка строки «что случится по согласию» */
  summaryPrefix: 'По согласию: ',
  /** Подсказка кнопки закрытия */
  cancel: 'Закрыть без ответа',
} as const;

/** Подписи раздела «Ступени» окна эффекта */
export const EFFECT_STAGES_SECTION_LABELS = {
  title: 'Ступени',
  hint:
    'Каждая ступень несёт свои модификаторы и флаги. Переводит на следующую '
    + 'человек — кнопкой на листе или действием срабатывания.',
  /** Приставка номера ступени — и в заголовке, и в подписи новой ступени */
  stagePrefix: 'Ступень ',
  add: 'Ступень',
  remove: 'Убрать ступень',
} as const;

/** Подписи раздела «Действие, снимающее эффект» */
export const EFFECT_ESCAPE_SECTION_LABELS = {
  toggle: 'Из эффекта можно вырваться',
  hint: 'На листе у эффекта появится кнопка действия',
  actor: 'Кто действует',
  outcome: 'Успех',
  checkToggle: 'С проверкой',
  skill: 'Навык',
  dc: 'Сл',
} as const;
