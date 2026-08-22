/**
 * Шаблоны Active Effects для D&D 5e Conditions (PHB 2024)
 *
 * Каждый шаблон содержит предзаготовленные changes (числовые) и flags (булевые),
 * которые применяются автоматически при активации условия на акторе.
 *
 * Exhaustion — особый случай с уровнями (1-6, PHB 2024):
 * - Каждый уровень: -2 ко всем d20 тестам (атаки, спасброски, проверки/навыки,
 *   инициатива)
 * - Каждый уровень: -5 фт ко всем видам скорости
 * - Смерть на уровне 6
 */

import type { SkillType } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectChange,
  EffectDuration,
  EffectFlagKey,
  EffectOrigin,
} from './activeEffectTypes.js';
import type { ConditionKey, ConditionRef } from './conditionKeys.js';
import type { WorldConditionDefinition } from './conditionRegistry.js';
import type { ConditionEntry } from './consts.js';

import { generateId } from '@vtt/shared';

import { DEFAULT_EFFECT_CHANGE_PRIORITY } from './activeEffectTypes.js';
import { DEATH_CONDITION_KEY, isCanonConditionKey } from './conditionKeys.js';
import { readWorldConditions } from './conditionRegistry.js';
import {
  ABILITY_KEYS,
  CONDITIONS,
  MOVEMENT_KEYS,
  SKILLS_LIST,
} from './consts.js';

// ── Общие наборы флагов ───────────────────────────────────────

/**
 * Следствия Недееспособности (PHB 2024): само состояние плюс помеха на
 * инициативу. Флаг `incapacitated` инертен — механику «нет действий и реакций»
 * движок не считает, — поэтому помеха на инициативу проставляется явно.
 *
 * Вынесено в константу: состояния, включающие Недееспособность (Парализован,
 * Окаменевший, Ошеломлён, Без сознания), обязаны наследовать её следствия
 * целиком, а не повторять список по памяти.
 */
const INCAPACITATED_FLAGS: readonly EffectFlagKey[] = [
  'incapacitated',
  'initiative.disadvantage',
];

/**
 * Следствия беспомощности (PHB 2024): автопровал спасбросков Силы и Ловкости и
 * преимущество атак по существу. Общие у Парализованного, Окаменевшего,
 * Ошеломлённого и Находящегося без сознания.
 */
const HELPLESS_FLAGS: readonly EffectFlagKey[] = [
  'save.autoFail.strength',
  'save.autoFail.dexterity',
  'attacksAgainst.advantage',
];

// ── Типы ──────────────────────────────────────────────────────

/** Шаблон эффекта для состояния D&D 5e */
export interface ConditionEffectTemplate {
  /** Числовые модификаторы */
  changes: EffectChange[];
  /** Булевые флаги */
  flags: EffectFlagKey[];
  /**
   * Состояния, к которым это состояние даёт иммунитет (напр. Окаменевший →
   * иммунитет к Отравлению). Прокидывается в `ActiveEffect.conditionImmunities`
   * и блокирует наложение состояния через `getEntityConditionImmunities`.
   */
  conditionImmunities?: ConditionRef[];
  /** Есть ли уровни (для Exhaustion) */
  hasLevels?: boolean;
  /** Максимальный уровень (для Exhaustion) */
  maxLevel?: number;
}

// ── Шаблоны Conditions ────────────────────────────────────────

/**
 * Шаблоны Active Effects для всех D&D 5e Conditions.
 *
 * Используются при клике на иконку состояния в ActorEffectsTab:
 * 1. Находим шаблон по ConditionKey
 * 2. Создаём ActiveEffect с changes и flags из шаблона
 * 3. Добавляем в actor.activeEffects
 */
export const CONDITION_EFFECT_TEMPLATES: Record<
  ConditionKey,
  ConditionEffectTemplate
> = {
  blinded: {
    changes: [],
    flags: [
      'attack.disadvantage',
      'attacksAgainst.advantage',
      'vision.blinded',
    ],
  },

  charmed: {
    changes: [],
    flags: [],
    // Механика «нельзя атаковать» — специфичная, не через числа/флаги
  },

  deafened: {
    changes: [],
    flags: [],
    // Автопровал проверок слуха — специфичная механика
  },

  exhaustion: {
    changes: [],
    flags: [],
    hasLevels: true,
    maxLevel: 6,
    // Changes генерируются динамически через buildExhaustionChanges()
  },

  frightened: {
    changes: [],
    flags: ['attack.disadvantage', 'abilityCheck.disadvantage'],
  },

  grappled: {
    changes: [],
    flags: ['speed.zero'],
  },

  incapacitated: {
    changes: [],
    flags: [...INCAPACITATED_FLAGS],
  },

  invisible: {
    changes: [],
    flags: [
      'attack.advantage',
      'attacksAgainst.disadvantage',
      'initiative.advantage',
      'vision.invisible',
    ],
  },

  paralyzed: {
    changes: [],
    flags: [...INCAPACITATED_FLAGS, 'speed.zero', ...HELPLESS_FLAGS],
    // Крит в пределах 5 фт автоматизировать нечем (нет флага «крит по мне»).
  },

  petrified: {
    changes: [],
    flags: [
      ...INCAPACITATED_FLAGS,
      'speed.zero',
      ...HELPLESS_FLAGS,
      // Сопротивление всему урону (PHB 2024) — по типу на каждый вид урона.
      'resistance.slashing',
      'resistance.piercing',
      'resistance.bludgeoning',
      'resistance.fire',
      'resistance.cold',
      'resistance.lightning',
      'resistance.thunder',
      'resistance.poison',
      'resistance.acid',
      'resistance.necrotic',
      'resistance.radiant',
      'resistance.force',
      'resistance.psychic',
    ],
    // Иммунитет к Отравлению (само состояние; урон ядом — лишь сопротивление).
    conditionImmunities: ['poisoned'],
  },

  poisoned: {
    changes: [],
    flags: ['attack.disadvantage', 'abilityCheck.disadvantage'],
  },

  prone: {
    changes: [],
    flags: [
      'attack.disadvantage',
      // PHB 2024: атака по лежащему в пределах 5 футов — с преимуществом,
      // дальше — с помехой. Дистанцию движок в этом месте не знает, поэтому
      // правило приближено по виду атаки: рукопашная бьёт вплотную,
      // дальнобойная — издали. Это ближе к правилу, чем прежнее «ничего».
      'attacksAgainst.melee.advantage',
      'attacksAgainst.ranged.disadvantage',
    ],
  },

  restrained: {
    changes: [],
    flags: [
      'speed.zero',
      'attack.disadvantage',
      'attacksAgainst.advantage',
      // PHB 2024: помеха на спасброски Ловкости.
      'save.disadvantage.dexterity',
    ],
  },

  stunned: {
    changes: [],
    // Скорость НЕ обнуляется: у Ошеломлённого 2024 нет пункта «не может
    // двигаться» (в отличие от Парализованного и Находящегося без сознания).
    flags: [...INCAPACITATED_FLAGS, ...HELPLESS_FLAGS],
  },

  unconscious: {
    changes: [],
    flags: [
      ...INCAPACITATED_FLAGS,
      'speed.zero',
      ...HELPLESS_FLAGS,
      // Без сознания включает Лежащего ничком: помеха на свои броски атаки и
      // те же поправки атак по нему
      'attack.disadvantage',
      'attacksAgainst.melee.advantage',
      'attacksAgainst.ranged.disadvantage',
    ],
    // Крит в пределах 5 фт автоматизировать нечем (нет флага «крит по мне»).
  },

  dead: {
    changes: [],
    // Чистая метка: механики нет намеренно. `speed.zero` запретил бы мастеру
    // перетаскивать токен трупа (ядро глушит перетаскивание при нулевой
    // скорости), а помехи и автопровалы мёртвому ничего не решают — по нему
    // не бьют и он ничего не кидает.
    flags: [],
  },
};

// ── Канон + состояния мира ────────────────────────────────────

/**
 * Значок состояния мира, для которого не выбрали ни иконку, ни картинку.
 *
 * Пустой значок в сетке статусов неотличим от «состояния нет», поэтому
 * умолчание обязано быть видимым.
 */
export const DEFAULT_CONDITION_ICON = 'tabler:activity-heartbeat';

/**
 * Состояния, у которых шаблон эффекта правке из мира НЕ подлежит.
 *
 * У Истощения `changes` собираются по текущей степени (`buildExhaustionChanges`),
 * и записанный в мире набор всё равно был бы затёрт при смене степени — правка
 * такого шаблона обещала бы то, чего не будет. Оформление (название, значок,
 * описание) правится и у него.
 */
const TEMPLATE_LOCKED_KEYS: readonly ConditionRef[] = ['exhaustion'];

/**
 * Шаблон эффекта этого состояния правке из мира не подлежит.
 *
 * Читает форма состояния: у такого состояния она правит только оформление и
 * прямо об этом говорит, вместо того чтобы принять правку и потерять её.
 *
 * @param conditionKey - ключ состояния
 * @returns `true`, если эффект состояния считается кодом
 */
export function isConditionTemplateLocked(conditionKey: ConditionRef): boolean {
  return TEMPLATE_LOCKED_KEYS.includes(conditionKey);
}

/** Состояние в собранном виде: справка, шаблон эффекта и происхождение. */
export interface RuntimeCondition {
  /** Справочная часть: название, значок, описание */
  entry: ConditionEntry;
  /** Шаблон эффекта, который состояние накладывает */
  template: ConditionEffectTemplate;
  /** Канонное состояние системы — удалить его из мира нельзя */
  isCanon: boolean;
  /** Канон, перекрытый записью мира */
  isOverridden: boolean;
}

/** Пустой шаблон — состоянию мира без эффекта. */
const EMPTY_TEMPLATE: ConditionEffectTemplate = { changes: [], flags: [] };

/** Список мира, по которому собран текущий кэш слияния. */
let cachedWorldConditions: readonly WorldConditionDefinition[] | null = null;

/** Последнее собранное слияние канона с состояниями мира. */
let cachedRuntimeConditions: RuntimeCondition[] = [];

/**
 * Собирает справочную запись состояния из определения мира.
 *
 * @param definition - состояние, заведённое в мире
 * @returns справочная часть состояния
 */
function toConditionEntry(
  definition: WorldConditionDefinition,
): ConditionEntry {
  return {
    key: definition.key,
    nameRu: definition.nameRu,
    nameEn: definition.nameEn ?? definition.nameRu,
    icon: definition.icon ?? DEFAULT_CONDITION_ICON,
    customImage: definition.customImage,
    description: definition.description,
    overlay: definition.overlay,
  };
}

/**
 * Все состояния рантайма: канон PHB, где записи мира заменяют одноимённые
 * канонные, плюс свои состояния стола в конце.
 *
 * Порядок канона сохраняется: правка «Отравленного» остаётся на месте
 * «Отравленного», иначе сетка состояний на листе перетасовывалась бы от одной
 * правки описания.
 *
 * @returns состояния со шаблонами и признаком происхождения
 */
export function listRuntimeConditions(): RuntimeCondition[] {
  const worldConditions = readWorldConditions();

  // Слияние КЭШИРУЕТСЯ по самому списку мира: справочник дёргают в горячих
  // местах (опознание состояния у каждого эффекта, подписи иммунитетов), а
  // список мира — стабильная ссылка, пока записи не менялись.
  if (cachedWorldConditions === worldConditions) {
    return cachedRuntimeConditions;
  }

  const overrides = new Map<ConditionRef, WorldConditionDefinition>();
  const own: WorldConditionDefinition[] = [];

  for (const definition of worldConditions) {
    if (isCanonConditionKey(definition.key)) {
      overrides.set(definition.key, definition);
    } else {
      own.push(definition);
    }
  }

  const canon = CONDITIONS.map((entry) => {
    const canonTemplate = isCanonConditionKey(entry.key)
      ? CONDITION_EFFECT_TEMPLATES[entry.key]
      : EMPTY_TEMPLATE;

    const override = overrides.get(entry.key);

    if (!override) {
      return {
        entry,
        template: canonTemplate,
        isCanon: true,
        isOverridden: false,
      };
    }

    return {
      entry: toConditionEntry(override),
      template: TEMPLATE_LOCKED_KEYS.includes(entry.key)
        ? canonTemplate
        : {
            ...override.template,
            // Степени — свойство самого состояния, а не его шаблона: их знает
            // только код (шкала Истощения на листе), и правка из мира их не
            // заводит и не отменяет.
            hasLevels: canonTemplate.hasLevels,
            maxLevel: canonTemplate.maxLevel,
          },
      isCanon: true,
      isOverridden: true,
    };
  });

  cachedWorldConditions = worldConditions;

  cachedRuntimeConditions = [
    ...canon,
    ...own.map((definition) => ({
      entry: toConditionEntry(definition),
      template: definition.template,
      isCanon: false,
      isOverridden: false,
    })),
  ];

  return cachedRuntimeConditions;
}

/**
 * Справочник состояний рантайма — замена канонному `CONDITIONS` для всего, что
 * показывает состояния пользователю.
 *
 * @returns справочные записи всех состояний
 */
export function listConditions(): ConditionEntry[] {
  return listRuntimeConditions().map((condition) => condition.entry);
}

/**
 * Состояния, доступные для выбора руками: всё, кроме метки смерти (её ставит и
 * снимает запас хитов).
 *
 * @returns справочные записи выбираемых состояний
 */
export function listSelectableConditions(): ConditionEntry[] {
  return listConditions().filter((entry) => entry.key !== DEATH_CONDITION_KEY);
}

/**
 * Находит состояние по ключу среди канона и состояний мира.
 *
 * @param conditionKey - ключ состояния
 * @returns состояние со шаблоном или `undefined`, если ключ неизвестен
 */
export function getRuntimeCondition(
  conditionKey: ConditionRef,
): RuntimeCondition | undefined {
  return listRuntimeConditions().find(
    (condition) => condition.entry.key === conditionKey,
  );
}

/**
 * Справочная запись состояния по ключу.
 *
 * @param conditionKey - ключ состояния
 * @returns запись или `undefined`, если ключ неизвестен
 */
export function getConditionEntry(
  conditionKey: ConditionRef,
): ConditionEntry | undefined {
  return getRuntimeCondition(conditionKey)?.entry;
}

/**
 * Шаблон эффекта состояния по ключу.
 *
 * @param conditionKey - ключ состояния
 * @returns шаблон или `undefined`, если ключ неизвестен
 */
export function getConditionTemplate(
  conditionKey: ConditionRef,
): ConditionEffectTemplate | undefined {
  return getRuntimeCondition(conditionKey)?.template;
}

// ── Exhaustion ────────────────────────────────────────────────

/** Штраф к тестам d20 за каждый уровень истощения (PHB 2024) */
const EXHAUSTION_D20_PENALTY_PER_LEVEL = -2;

/** Штраф к скорости (в футах) за каждый уровень истощения (PHB 2024) */
const EXHAUSTION_SPEED_PENALTY_PER_LEVEL = -5;

/** Степень, на которой истощения нет */
export const EXHAUSTION_LEVEL_MIN = 0;

/** Смертельная степень истощения (PHB 2024: 6 = смерть) */
export const EXHAUSTION_LEVEL_MAX = 6;

/** Сколько степеней истощения снимает продолжительный отдых (PHB 2024) */
export const EXHAUSTION_LONG_REST_RECOVERY = 1;

/** Деления шкалы истощения: степени от первой до смертельной */
export const EXHAUSTION_LEVELS: readonly number[] = Array.from(
  { length: EXHAUSTION_LEVEL_MAX },
  (_unused, index) => index + 1,
);

/** Что даёт текущая степень истощения */
export interface ExhaustionEffects {
  /** Степень после приведения к границам шкалы */
  level: number;
  /** Штраф ко всем тестам к20 (положительное число — величина штрафа) */
  d20Penalty: number;
  /** Снижение всех скоростей в футах (положительное число) */
  speedPenalty: number;
  /** Смертельная ли степень */
  isLethal: boolean;
}

/**
 * Приводит степень истощения к границам шкалы.
 *
 * @param level - произвольная степень
 * @returns степень в пределах 0…6
 */
export function clampExhaustionLevel(level: number): number {
  return Math.max(
    EXHAUSTION_LEVEL_MIN,
    Math.min(Math.trunc(level), EXHAUSTION_LEVEL_MAX),
  );
}

/**
 * Что даёт степень истощения по правилам 2024: каждая степень снижает все тесты
 * к20 на 2 и все скорости на 5 футов, шестая — смертельна.
 *
 * Числа отдаются положительными: панель листа подписывает их со знаком минус
 * сама, а расчёт штрафа живёт в `buildExhaustionChanges`.
 *
 * @param level - степень истощения
 * @returns штрафы и признак смертельной степени
 */
export function getExhaustionEffects(level: number): ExhaustionEffects {
  const currentLevel = clampExhaustionLevel(level);

  return {
    level: currentLevel,
    d20Penalty: currentLevel * Math.abs(EXHAUSTION_D20_PENALTY_PER_LEVEL),
    speedPenalty: currentLevel * Math.abs(EXHAUSTION_SPEED_PENALTY_PER_LEVEL),
    isLethal: currentLevel === EXHAUSTION_LEVEL_MAX,
  };
}

/**
 * Текущая степень истощения сущности: её несёт эффект-состояние.
 *
 * @param effects - активные эффекты сущности
 * @returns степень истощения (0, если состояния нет)
 */
export function getEntityExhaustionLevel(
  effects: readonly ActiveEffect[] | undefined,
): number {
  for (const effect of effects ?? []) {
    if (resolveEffectConditionKey(effect) === 'exhaustion') {
      return clampExhaustionLevel(effect.exhaustionLevel ?? 1);
    }
  }

  return EXHAUSTION_LEVEL_MIN;
}

/**
 * Заменяет эффект истощения в списке на эффект нужной степени.
 *
 * Единая точка смены степени: панель листа, продолжительный отдых и любые
 * будущие источники обязаны идти через неё, иначе `changes` разойдутся со
 * степенью. Нулевая степень снимает состояние.
 *
 * @param effects - активные эффекты сущности
 * @param level - новая степень истощения
 * @returns новый список эффектов
 */
export function withExhaustionLevel(
  effects: readonly ActiveEffect[],
  level: number,
): ActiveEffect[] {
  const withoutExhaustion = effects.filter(
    (effect) => resolveEffectConditionKey(effect) !== 'exhaustion',
  );

  const nextLevel = clampExhaustionLevel(level);

  if (nextLevel === EXHAUSTION_LEVEL_MIN) {
    return withoutExhaustion;
  }

  const exhaustionEffect = buildConditionActiveEffect('exhaustion', {
    exhaustionLevel: nextLevel,
  });

  return exhaustionEffect
    ? [...withoutExhaustion, exhaustionEffect]
    : withoutExhaustion;
}

/**
 * Навыки для штрафа к проверкам (часть «всех d20 тестов»). Движок не имеет
 * единого ключа «проверка характеристики», поэтому штраф разворачивается по
 * навыкам — это покрывает подавляющее большинство проверок (чистые проверки
 * характеристики без навыка штраф не получают — ограничение модели).
 *
 * Список берётся из общего справочника: новый навык обязан получать штраф сам,
 * без правки этого файла.
 */
const EXHAUSTION_SKILL_KEYS: readonly SkillType[] = SKILLS_LIST.map(
  (skill) => skill.key,
);

/**
 * Генерирует числовые изменения для заданного уровня Exhaustion (PHB 2024).
 *
 * PHB 2024 правила:
 * - Каждый уровень: -2 ко ВСЕМ d20 тестам — атаки (рукопашные/дальнобойные/
 *   заклинаниями), спасброски (все 6 характеристик), проверки (все навыки) и
 *   инициатива (она же проверка Ловкости);
 * - Каждый уровень: -5 фт ко ВСЕМ видам скорости;
 * - Уровень 6 = смерть (обрабатывается UI).
 *
 * Количество changes (до 33 на эффект) укладывается в `MAX_CHANGES_PER_EFFECT`.
 *
 * @param exhaustionLevel - текущий уровень истощения (1-6)
 * @returns массив EffectChange для этого уровня
 */
export function buildExhaustionChanges(
  exhaustionLevel: number,
): EffectChange[] {
  const clampedLevel = clampExhaustionLevel(exhaustionLevel);

  if (clampedLevel === EXHAUSTION_LEVEL_MIN) {
    return [];
  }

  const d20Penalty = String(EXHAUSTION_D20_PENALTY_PER_LEVEL * clampedLevel);

  const speedPenalty = String(
    EXHAUSTION_SPEED_PENALTY_PER_LEVEL * clampedLevel,
  );

  const changes: EffectChange[] = [];

  // Штраф к атакам (все три вида)
  for (const attackKey of [
    'attack.melee',
    'attack.ranged',
    'attack.spell',
  ] as const) {
    changes.push({
      key: attackKey,
      mode: 'add',
      value: d20Penalty,
      priority: DEFAULT_EFFECT_CHANGE_PRIORITY,
    });
  }

  // Инициатива — тоже тест к20 (проверка Ловкости), и штраф идёт на неё
  changes.push({
    key: 'initiative',
    mode: 'add',
    value: d20Penalty,
    priority: DEFAULT_EFFECT_CHANGE_PRIORITY,
  });

  // Штраф ко всем спасброскам
  for (const ability of ABILITY_KEYS) {
    changes.push({
      key: `save.${ability}`,
      mode: 'add',
      value: d20Penalty,
      priority: DEFAULT_EFFECT_CHANGE_PRIORITY,
    });
  }

  // Штраф ко всем навыкам (приближение «проверок характеристик»)
  for (const skill of EXHAUSTION_SKILL_KEYS) {
    changes.push({
      key: `skill.${skill}`,
      mode: 'add',
      value: d20Penalty,
      priority: DEFAULT_EFFECT_CHANGE_PRIORITY,
    });
  }

  // Штраф ко всем видам скорости
  for (const movement of MOVEMENT_KEYS) {
    changes.push({
      key: `movement.${movement}`,
      mode: 'add',
      value: speedPenalty,
      priority: DEFAULT_EFFECT_CHANGE_PRIORITY,
    });
  }

  return changes;
}

// ── Опознание состояния ───────────────────────────────────────

/**
 * Опознаёт ключ состояния эффекта: по явному `conditionKey` либо по совпадению
 * `id`/имени с записью состояния (легаси-данные без `conditionKey`).
 *
 * Единственный способ понять «какое это состояние»: сравнение по имени
 * ненадёжно — переименованный эффект перестал бы опознаваться, — поэтому имя
 * остаётся лишь откатом для старых записей.
 *
 * @param effect - эффект
 * @returns ключ состояния или `undefined`, если эффект не является состоянием
 */
export function resolveEffectConditionKey(
  effect: ActiveEffect,
): ConditionRef | undefined {
  if (effect.conditionKey) {
    return effect.conditionKey;
  }

  const entry = listConditions().find(
    (conditionEntry) =>
      conditionEntry.key === effect.id
      || conditionEntry.nameRu === effect.name
      || conditionEntry.nameEn === effect.name,
  );

  return entry?.key;
}

// ── Сборка эффекта состояния ──────────────────────────────────

/** Опции сборки ActiveEffect для состояния */
export interface BuildConditionEffectOptions {
  /** Источник эффекта (по умолчанию `condition`) */
  origin?: EffectOrigin;
  /** Длительность (по умолчанию постоянная) */
  duration?: EffectDuration;
  /** Цель применения: на себя или на цель атаки (для райдеров — `target`) */
  effectTarget?: 'self' | 'target';
  /** Уровень истощения (учитывается только для `exhaustion`) */
  exhaustionLevel?: number;
}

/**
 * Собирает ActiveEffect для состояния D&D 5e из шаблона.
 *
 * Единый источник правды для наложения состояний (тоггл на листе актора,
 * применение по цели атаки, райдеры). Проставляет `conditionKey` — он нужен
 * для проверки иммунитета цели и устойчивого опознания состояния.
 *
 * @param conditionKey - ключ состояния
 * @param options - источник, длительность, цель применения, уровень истощения
 * @returns готовый ActiveEffect или `null`, если состояние неизвестно
 */
export function buildConditionActiveEffect(
  conditionKey: ConditionRef,
  options: BuildConditionEffectOptions = {},
): ActiveEffect | null {
  const runtimeCondition = getRuntimeCondition(conditionKey);

  if (!runtimeCondition) {
    return null;
  }

  const condition = runtimeCondition.entry;
  const template = runtimeCondition.template;
  const isExhaustion = conditionKey === 'exhaustion';

  const exhaustionLevel = isExhaustion
    ? clampExhaustionLevel(options.exhaustionLevel ?? 1)
    : EXHAUSTION_LEVEL_MIN;

  const changes = isExhaustion
    ? buildExhaustionChanges(exhaustionLevel)
    : [...template.changes];

  const effect: ActiveEffect = {
    id: generateId('effect'),
    name: condition.nameRu,
    description: condition.description,
    icon: condition.icon,
    disabled: false,
    origin: options.origin ?? 'condition',
    transfer: false,
    duration: options.duration ?? { type: 'permanent' },
    changes,
    flags: [...template.flags],
    conditionKey,
  };

  // Степень нужна панели истощения: по набору `changes` её уже не восстановить
  if (isExhaustion) {
    effect.exhaustionLevel = exhaustionLevel;
  }

  if (options.effectTarget) {
    effect.effectTarget = options.effectTarget;
  }

  if (template.conditionImmunities && template.conditionImmunities.length > 0) {
    effect.conditionImmunities = [...template.conditionImmunities];
  }

  return effect;
}
