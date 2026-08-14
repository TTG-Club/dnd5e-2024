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
import type { ConditionKey } from './conditionKeys.js';

import { generateId } from '@vtt/shared';

import { DEFAULT_EFFECT_CHANGE_PRIORITY } from './activeEffectTypes.js';
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
  conditionImmunities?: ConditionKey[];
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
): ConditionKey | undefined {
  if (effect.conditionKey) {
    return effect.conditionKey;
  }

  const entry = CONDITIONS.find(
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
  conditionKey: ConditionKey,
  options: BuildConditionEffectOptions = {},
): ActiveEffect | null {
  const condition = CONDITIONS.find((entry) => entry.key === conditionKey);

  if (!condition) {
    return null;
  }

  const template = CONDITION_EFFECT_TEMPLATES[conditionKey];
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
