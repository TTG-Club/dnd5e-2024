/**
 * Авто-описание активного эффекта.
 *
 * Чистая функция `describeActiveEffect` собирает человекочитаемое описание
 * эффекта из его настроек (модификаторы, флаги, спасбросок, урон, длительность
 * и т.д.), переиспользуя единые локализованные подписи системы. Используется
 * в редакторе эффекта (предпросмотр + кнопка «Сгенерировать») и пригодна для
 * любого read-only отображения.
 *
 * `buildActiveEffectDetails` собирает то же самое разделами — для карточки
 * просмотра эффекта, где одной строкой уже не обойтись.
 *
 * Сознательно не трогает поле `name` и не зависит от рантайма актора —
 * описывает только то, «как настроен эффект».
 */

import type { DamagePart } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectChange,
  EffectDuration,
} from './activeEffectTypes.js';

import {
  AREA_TRIGGER_LABELS,
  EFFECT_ATTACK_TRIGGER_LABELS,
  EFFECT_CHANGE_MODE_LABELS,
  EFFECT_CONDITION_SUGGESTIONS,
  EFFECT_DURATION_LABELS,
  EFFECT_FLAG_LABELS,
  EFFECT_TARGET_SUGGESTIONS,
} from './activeEffectTypes.js';
import { getConditionEntry } from './conditionTemplates.js';
import { ABILITY_LABELS } from './consts.js';
import { getShortDamageTypeLabel } from './damageConstants.js';

/** Подпись ключа модификатора (`armorClass` → «Класс доспеха (AC)»). */
const TARGET_LABELS = new Map(
  EFFECT_TARGET_SUGGESTIONS.map((entry) => [entry.value, entry.label]),
);

/** Подпись кода-условия (`roll.isCritical === true` → «… Крит»). */
const CONDITION_LABELS = new Map(
  EFFECT_CONDITION_SUGGESTIONS.map((entry) => [entry.value, entry.label]),
);

/**
 * Подпись флага (`attack.disadvantage` → «Помеха на все атаки»). Через `Map`,
 * чтобы безопасно искать по произвольной строке (флаги бывают кастомные) без
 * `as`-каста по ключу Record.
 */
const FLAG_LABELS = new Map<string, string>(Object.entries(EFFECT_FLAG_LABELS));

/** Подписи цели ауры (кого она задевает). */
const AURA_TARGET_LABELS: Record<'allies' | 'enemies' | 'all', string> = {
  allies: 'союзники',
  enemies: 'враги',
  all: 'все существа',
};

/** Короткие подписи @-токенов в формулах значений модификаторов. */
const VALUE_TOKEN_LABELS: Record<string, string> = {
  '@mod.spell': 'мод. закл. характеристики',
  '@mod.str': 'мод. Силы',
  '@mod.dex': 'мод. Ловкости',
  '@mod.con': 'мод. Телосложения',
  '@mod.int': 'мод. Интеллекта',
  '@mod.wis': 'мод. Мудрости',
  '@mod.cha': 'мод. Харизмы',
  '@prof': 'бонус мастерства',
  '@level': 'уровень',
  '@speed.walk': 'скорость ходьбы',
  '@speed.fly': 'скорость полёта',
  '@speed.swim': 'скорость плавания',
  '@speed.climb': 'скорость лазания',
  '@speed.burrow': 'скорость копания',
};

/** Русское название состояния по ключу (неизвестный ключ отдаётся как есть). */
function conditionLabel(conditionKey: string): string {
  return getConditionEntry(conditionKey)?.nameRu ?? conditionKey;
}

/** Русская плюрализация: pluralize(2, ['раунд', 'раунда', 'раундов']). */
function pluralize(count: number, forms: [string, string, string]): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;

  if (abs > 10 && abs < 20) {
    return forms[2];
  }

  if (last > 1 && last < 5) {
    return forms[1];
  }

  if (last === 1) {
    return forms[0];
  }

  return forms[2];
}

/** Заглавная первая буква — строки собираются из разных источников. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Проверка, что строка — «голое» число (с опциональным знаком). */
function isNumeric(value: string): boolean {
  return /^[+-]?\d+(?:\.\d+)?$/.test(value.trim());
}

/** Подпись Сл спасброска: `0` у спелловых эффектов = «Сл заклинателя». */
function formatSaveDc(dc: number): string {
  return dc === 0 ? 'Сл заклинателя' : `Сл ${dc}`;
}

/** Заменяет @-токены формулы на короткие русские подписи. */
function prettifyFormula(value: string): string {
  return value.replace(
    /@[a-z.]+/gi,
    (token) => VALUE_TOKEN_LABELS[token] ?? token,
  );
}

/** Форматирует значение одного модификатора в духе «+5 фт» / «×2». */
function describeChangeValue(change: EffectChange): string {
  const unit = change.key.startsWith('movement.') ? ' фт' : '';

  if (change.mode === 'add') {
    if (isNumeric(change.value)) {
      const numeric = Number(change.value);
      const sign = numeric < 0 ? '−' : '+';

      return `${sign}${Math.abs(numeric)}${unit}`;
    }

    return `+${prettifyFormula(change.value)}${unit}`;
  }

  if (change.mode === 'multiply') {
    return `×${change.value}`;
  }

  const modeLabel = EFFECT_CHANGE_MODE_LABELS[change.mode].toLowerCase();

  return `${modeLabel} ${prettifyFormula(change.value)}${unit}`;
}

/** Описывает один модификатор: «Класс доспеха (AC) +5 (только: …)». */
function describeChange(change: EffectChange): string {
  const keyLabel = TARGET_LABELS.get(change.key) ?? change.key;
  const base = `${keyLabel} ${describeChangeValue(change)}`;

  const condition = change.condition?.trim();

  if (!condition) {
    return base;
  }

  const conditionText = CONDITION_LABELS.get(condition) ?? condition;

  return `${base} (только: ${conditionText})`;
}

/** Подписи условия по цели в формуле урона (токен `@target.<cond>`). */
const DAMAGE_TARGET_LABELS: Record<string, string> = {
  full: 'по цели с полным HP',
  notFull: 'по раненой цели',
};

/**
 * Описывает части урона: «2к8 ядом + 1к6 огненный». Разбирает токены формулы
 * `@dmg.<тип>` (тип урона) и `@target.<условие>` (условие по цели), очищая их из
 * отображаемой формулы, чтобы в описании не торчали сырые токены.
 */
function describeDamageParts(parts: DamagePart[]): string {
  return parts
    .filter((part) => part.formula?.trim())
    .map((part) => {
      const formula = part.formula.trim();

      // Тип урона: из поля type либо из токена @dmg.<type> в формуле
      const damageToken = formula.match(/@dmg\.([a-z]+)/i);
      const typeKey = part.type ?? damageToken?.[1];
      const typeLabel = typeKey ? ` ${getShortDamageTypeLabel(typeKey)}` : '';

      // Условие по цели: токен @target.<cond>
      const targetToken = formula.match(/@target\.(\w+)/);

      const targetLabel = targetToken
        ? ` (${DAMAGE_TARGET_LABELS[targetToken[1]] ?? targetToken[1]})`
        : '';

      // Чистим формулу от токенов и подставляем подписи @mod.* / @prof / @level
      const cleanFormula = prettifyFormula(
        formula
          .replace(/@dmg\.[a-z]+/gi, '')
          .replace(/@target\.\w+/gi, '')
          .trim(),
      );

      return `${cleanFormula}${typeLabel}${targetLabel}`;
    })
    .join(' + ');
}

/** Описывает длительность: «на 1 раунд», «постоянно». */
function describeDuration(duration: EffectDuration): string | null {
  switch (duration.type) {
    case 'permanent':
      return 'постоянно';
    case 'rounds':
    case 'minutes':
    case 'hours':
    case 'days': {
      const value = duration.value ?? 0;

      if (value <= 0) {
        return null;
      }

      const forms: Record<typeof duration.type, [string, string, string]> = {
        rounds: ['раунд', 'раунда', 'раундов'],
        minutes: ['минуту', 'минуты', 'минут'],
        hours: ['час', 'часа', 'часов'],
        days: ['день', 'дня', 'дней'],
      };

      return `на ${value} ${pluralize(value, forms[duration.type])}`;
    }
    case 'turn': {
      const when =
        (duration.turnTiming ?? 'end') === 'end' ? 'конца' : 'начала';

      const whose =
        (duration.turnAnchor ?? 'carrier') === 'source'
          ? 'источника'
          : 'носителя';

      return `до ${when} следующего хода ${whose}`;
    }
    case 'special':
    default:
      return null;
  }
}

/**
 * Собирает человекочитаемое описание эффекта из его настроек.
 *
 * Возвращает пустую строку, если описывать нечего (нет модификаторов, флагов,
 * урона и т.п.) — вызывающий код сам решает, что показать вместо неё.
 */
export function describeActiveEffect(effect: ActiveEffect): string {
  const clauses: string[] = [];

  // 1. Числовые модификаторы
  for (const change of effect.changes) {
    if (change.value?.trim()) {
      clauses.push(describeChange(change));
    }
  }

  // 2. Булевы флаги
  for (const flag of effect.flags) {
    clauses.push(FLAG_LABELS.get(flag) ?? flag);
  }

  // 3. Состояние — канонное или заведённое в мире
  if (effect.conditionKey) {
    const condition = getConditionEntry(effect.conditionKey);

    if (condition) {
      clauses.push(`Состояние: ${condition.nameRu}`);
    }
  }

  // 4. Спасбросок при наложении
  if (effect.applySave) {
    const ability = ABILITY_LABELS[effect.applySave.ability];

    const onSuccess =
      effect.applySave.onSuccess === 'half'
        ? 'при успехе урон вдвое'
        : 'при успехе эффект отменяется';

    clauses.push(
      `спасбросок (${ability}, ${formatSaveDc(effect.applySave.dc)}), ${onSuccess}`,
    );
  }

  // 5. Урон при наложении
  if (effect.damageParts && effect.damageParts.length > 0) {
    const damage = describeDamageParts(effect.damageParts);

    if (damage) {
      clauses.push(`урон при наложении: ${damage}`);
    }
  }

  // 6. Периодический урон (DoT)
  if (effect.recurringDamage && effect.recurringDamage.damageParts.length > 0) {
    const damage = describeDamageParts(effect.recurringDamage.damageParts);

    const timing =
      effect.recurringDamage.timing === 'startOfTurn'
        ? 'в начале хода'
        : 'в конце хода';

    if (damage) {
      clauses.push(`урон каждый ход (${timing}): ${damage}`);
    }
  }

  // 7. Периодический спасбросок снимает эффект
  if (effect.recurringSave) {
    const ability = ABILITY_LABELS[effect.recurringSave.ability];

    const timing =
      effect.recurringSave.timing === 'startOfTurn'
        ? 'в начале хода'
        : 'в конце хода';

    clauses.push(
      `повторный спасбросок (${ability}, ${formatSaveDc(effect.recurringSave.dc)}) ${timing} снимает эффект`,
    );
  }

  // 8. Аура
  if (effect.aura) {
    const auraTarget = AURA_TARGET_LABELS[effect.aura.target];

    clauses.push(`аура ${effect.aura.radius} фт (${auraTarget})`);
  }

  // 9. Триггер области/ауры (кроме поведения по умолчанию «пока внутри»)
  if (effect.areaTrigger && effect.areaTrigger !== 'stay') {
    clauses.push(AREA_TRIGGER_LABELS[effect.areaTrigger].toLowerCase());
  }

  // 10. Иммунитет к состояниям
  if (effect.conditionImmunities && effect.conditionImmunities.length > 0) {
    const names = effect.conditionImmunities.map(conditionLabel).join(', ');

    clauses.push(`иммунитет к состояниям: ${names}`);
  }

  // 11. Только при успешном спасброске уровня действия
  if (effect.applyOnSuccessOnly) {
    clauses.push('только при успешном спасброске');
  }

  // 12. Одноразовость на броске атаки
  if (effect.consumeOn) {
    clauses.push(EFFECT_ATTACK_TRIGGER_LABELS[effect.consumeOn].toLowerCase());
  }

  // 13. Длительность (добавляем в конце, если есть что описывать)
  const duration = describeDuration(effect.duration);

  if (duration && clauses.length > 0) {
    clauses.push(duration);
  }

  if (clauses.length === 0) {
    return '';
  }

  // Капитализируем первую букву и завершаем точкой.
  const text = clauses.join('; ');
  const capitalized = capitalize(text);

  return capitalized.endsWith('.') ? capitalized : `${capitalized}.`;
}

// ── Разбор эффекта разделами (карточка просмотра) ─────────────

/**
 * Раздел разбора эффекта. Ключ нужен показу: по нему подбирается значок
 * раздела — сами значки живут в UI, движок о них не знает.
 */
export type ActiveEffectDetailSectionKey =
  | 'changes'
  | 'flags'
  | 'condition'
  | 'conditionImmunities'
  | 'applySave'
  | 'damage'
  | 'recurringDamage'
  | 'recurringSave'
  | 'aura'
  | 'areaTrigger'
  | 'application'
  | 'duration';

/** Раздел разбора эффекта: заголовок и готовые к показу строки */
export interface ActiveEffectDetailSection {
  /** Ключ раздела */
  key: ActiveEffectDetailSectionKey;
  /** Заголовок раздела */
  title: string;
  /** Строки раздела — уже человекочитаемые, показывать как есть */
  lines: string[];
}

/**
 * Заголовки разделов разбора. Живут рядом с самим разбором: заголовок и
 * строки под ним пишутся одной формулировкой, и разносить их по файлам значило
 * бы править перевод в двух местах.
 */
const DETAIL_SECTION_TITLES: Record<ActiveEffectDetailSectionKey, string> = {
  changes: 'Модификаторы',
  flags: 'Флаги',
  condition: 'Состояние',
  conditionImmunities: 'Иммунитет к состояниям',
  applySave: 'Спасбросок при наложении',
  damage: 'Урон при наложении',
  recurringDamage: 'Периодический урон',
  recurringSave: 'Периодический спасбросок',
  aura: 'Аура',
  areaTrigger: 'Триггер области',
  application: 'Применение',
  duration: 'Длительность',
};

/**
 * Подписи цели эффекта. Только `target`: `self` — поведение по умолчанию, и в
 * разборе оно не упоминается (см. `applicationLines`).
 */
const EFFECT_TARGET_DETAIL_LABELS = {
  target: 'Накладывается на цель при попадании атакой',
} as const;

/**
 * Строки длительности для карточки: в отличие от однострочного описания,
 * здесь длительность есть всегда — «постоянно» тоже ответ. Остаток раундов
 * показывается отдельно: он живёт на конкретном наложении эффекта, а не в его
 * настройке.
 */
function durationLines(duration: EffectDuration): string[] {
  const lines = [
    describeDuration(duration) ?? EFFECT_DURATION_LABELS[duration.type],
  ];

  if (duration.type === 'rounds' && duration.remaining !== undefined) {
    lines.push(
      `осталось ${duration.remaining} ${pluralize(duration.remaining, [
        'раунд',
        'раунда',
        'раундов',
      ])}`,
    );
  }

  return lines;
}

/** Строки раздела «Спасбросок при наложении» вместе с оговорками об исходе. */
function applySaveLines(effect: ActiveEffect): string[] {
  const lines: string[] = [];

  if (effect.applySave) {
    const ability = ABILITY_LABELS[effect.applySave.ability];

    const onSuccess =
      effect.applySave.onSuccess === 'half'
        ? 'при успехе урон вдвое'
        : 'при успехе эффект отменяется';

    lines.push(
      `${ability}, ${formatSaveDc(effect.applySave.dc)} — ${onSuccess}`,
    );
  }

  if (effect.applyOnSuccess) {
    lines.push('накладывается даже при успешном спасброске');
  }

  if (effect.applyOnSuccessOnly) {
    lines.push('накладывается только при успешном спасброске');
  }

  return lines;
}

/** Строки раздела «Аура»: радиус, кого задевает и что с источником. */
function auraLines(effect: ActiveEffect): string[] {
  if (!effect.aura) {
    return [];
  }

  const lines = [
    `радиус ${effect.aura.radius} фт`,
    `задевает: ${AURA_TARGET_LABELS[effect.aura.target]}`,
  ];

  if (effect.aura.applyToSelf) {
    lines.push('действует и на источник ауры');
  }

  if (effect.aura.visible) {
    lines.push('круг ауры виден на сцене');
  }

  return lines;
}

/**
 * Строки раздела «Применение»: на кого ложится, переносится ли, когда спадает.
 *
 * Цель `self` не упоминается намеренно: это поведение по умолчанию, и строкой
 * «применяется к владельцу» раздел появлялся бы у каждого эффекта, ничего при
 * этом не сообщая.
 */
function applicationLines(effect: ActiveEffect): string[] {
  const lines: string[] = [];

  if (effect.effectTarget === 'target') {
    lines.push(EFFECT_TARGET_DETAIL_LABELS.target);
  }

  if (effect.transfer) {
    lines.push('переносится с предмета на владельца при экипировке');
  }

  if (effect.consumeOn) {
    lines.push(EFFECT_ATTACK_TRIGGER_LABELS[effect.consumeOn]);
  }

  return lines;
}

/**
 * Разбирает эффект на разделы для карточки просмотра: что он меняет, чем
 * гейтится, как долго держится. Пустые разделы не возвращаются — показывать
 * нечего, значит и заголовка быть не должно.
 *
 * От `describeActiveEffect` отличается только формой: та собирает ту же
 * механику одной строкой (описание эффекта, тултип), эта — списком по темам.
 *
 * @param effect - активный эффект
 * @returns разделы разбора в порядке показа
 */
export function buildActiveEffectDetails(
  effect: ActiveEffect,
): ActiveEffectDetailSection[] {
  const exhaustionSuffix =
    effect.exhaustionLevel && effect.exhaustionLevel > 0
      ? ` (степень ${effect.exhaustionLevel})`
      : '';

  const sections: Array<{
    key: ActiveEffectDetailSectionKey;
    lines: string[];
  }> = [
    {
      key: 'changes',
      lines: effect.changes
        .filter((change) => change.value?.trim())
        .map(describeChange),
    },
    {
      key: 'flags',
      lines: effect.flags.map((flag) => FLAG_LABELS.get(flag) ?? flag),
    },
    {
      key: 'condition',
      lines: effect.conditionKey
        ? [`${conditionLabel(effect.conditionKey)}${exhaustionSuffix}`]
        : [],
    },
    {
      key: 'conditionImmunities',
      lines: (effect.conditionImmunities ?? []).map(conditionLabel),
    },
    { key: 'applySave', lines: applySaveLines(effect) },
    {
      key: 'damage',
      lines: effect.damageParts?.length
        ? [describeDamageParts(effect.damageParts)].filter(Boolean)
        : [],
    },
    {
      key: 'recurringDamage',
      lines: effect.recurringDamage?.damageParts.length
        ? [
            `${describeDamageParts(effect.recurringDamage.damageParts)} — ${
              effect.recurringDamage.timing === 'startOfTurn'
                ? 'в начале хода'
                : 'в конце хода'
            }`,
          ]
        : [],
    },
    {
      key: 'recurringSave',
      lines: effect.recurringSave
        ? [
            `${ABILITY_LABELS[effect.recurringSave.ability]}, ${formatSaveDc(
              effect.recurringSave.dc,
            )} ${
              effect.recurringSave.timing === 'startOfTurn'
                ? 'в начале хода'
                : 'в конце хода'
            } — успех снимает эффект`,
          ]
        : [],
    },
    { key: 'aura', lines: auraLines(effect) },
    {
      key: 'areaTrigger',
      lines: effect.areaTrigger
        ? [AREA_TRIGGER_LABELS[effect.areaTrigger]]
        : [],
    },
    { key: 'application', lines: applicationLines(effect) },
    { key: 'duration', lines: durationLines(effect.duration) },
  ];

  return sections
    .filter((section) => section.lines.length > 0)
    .map((section) => ({
      key: section.key,
      title: DETAIL_SECTION_TITLES[section.key],
      lines: section.lines.map(capitalize),
    }));
}
