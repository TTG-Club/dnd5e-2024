/**
 * Скрытая атака — общий механизм эффекта, а не «код плута».
 *
 * Любой источник (класс, подкласс, существо, черта, предмет) задаёт её строкой
 * `sneakAttack.damage`: кости и условие. Атака оружием собирает такие строки в
 * момент броска, и если условие выполнено, окно атаки показывает переключатель
 * «Скрытая атака +Nк6». Включён — кости идут отдельной частью урона с подписью
 * «Скрытая атака» (тип — как у оружия, крит их удваивает), и тратится лимит
 * «раз в ход».
 *
 * Правило 2024 одинаково для всех источников, поэтому живёт здесь, а не в
 * данных:
 * - из нескольких источников, сработавших в одной атаке, берётся наибольший —
 *   кости не складываются;
 * - строки `sneakAttack.dice` («+1к6 к Скрытой атаке») прибавляют кости к
 *   выбранному источнику, а не идут отдельным уроном;
 * - лимит — одна копилка на все источники ({@link SNEAK_ATTACK_USAGE_KEY}):
 *   два источника не дадут её дважды за ход. Сбрасывает его конец любого хода
 *   боя (период `turn`), поэтому атака реакцией в чужой ход тоже возможна. Вне
 *   боя лимит не пишется вовсе: сбросить его некому, и расход провисел бы до
 *   первого хода в бою.
 *
 * @module system/dnd/sneakAttack
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { AttackDamageRecord } from './attackDamageRecord.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { RollContext } from './effectPipeline.js';
import type { EffectTriggerLimit } from './effectTriggerTypes.js';
import type {
  EffectTriggerUsageLedger,
  TriggerUsageChanges,
} from './effectTriggerUsage.js';
import type { FormulaContext } from './formulaParser.js';

import {
  isSneakAttackKey,
  SNEAK_ATTACK_APPLIED_CONDITION,
  SNEAK_ATTACK_CUNNING_STRIKE_COUNT_KEY,
  SNEAK_ATTACK_CUNNING_STRIKE_KEY,
  SNEAK_ATTACK_DAMAGE_KEY,
  SNEAK_ATTACK_DICE_KEY,
  SNEAK_ATTACK_MIN_DIE_KEY,
  SNEAK_ATTACK_RIDER_KEY,
} from './activeEffectTypes.js';
import {
  buildClassEffectId,
  readClassEffectClassKey,
} from './classEffectScope.js';
import { resolveDiceCountExpressions } from './diceCountExpressions.js';
import {
  collectRollTimeChanges,
  resolveChangeValue,
} from './effectPipeline.js';
import {
  buildTriggerUsageScope,
  readTriggerUsage,
} from './effectTriggerUsage.js';
import { substituteFormulaVariables } from './formulaParser.js';

/** Подпись Скрытой атаки в окне атаки и в чате */
export const SNEAK_ATTACK_LABEL = 'Скрытая атака';

/** Метка Скрытой атаки — имя общей копилки лимита */
export const SNEAK_ATTACK_TAG = 'sneakAttack';

/** Лимит Скрытой атаки по правилам: раз в ход */
export const SNEAK_ATTACK_LIMIT: EffectTriggerLimit = {
  max: 1,
  per: 'turn',
  key: SNEAK_ATTACK_TAG,
};

/**
 * Ключ счётчика Скрытой атаки в журнале `system.effectUsage`. Источник —
 * метка, а не эффект: у мультиклассера и у предмета с той же Скрытой атакой
 * счётчик один.
 */
export const SNEAK_ATTACK_USAGE_KEY = `${buildTriggerUsageScope('tag', SNEAK_ATTACK_TAG)}|${SNEAK_ATTACK_LIMIT.key}`;

/** Скрытая атака, которая пойдёт в этой атаке, если её не выключить */
export interface SneakAttackPlan {
  /** Формула костей для роллера: числа уже подставлены, прибавки учтены */
  formula: string;
  /** Чья это Скрытая атака — эффект-источник наибольших костей */
  sourceName: string;
}

/** Кость в формуле: число (может не быть), буква, грань */
const DICE_TERM_PATTERN = /(\d*)\s*([кдd])\s*(\d+)/gi;

/** Первая кость формулы — к ней прибавляются кости Скрытой атаки */
const FIRST_DICE_TERM_PATTERN = /(\d*)\s*([кдd])\s*(\d+)/i;

/**
 * Средний итог костей формулы — по нему сравниваются источники. Числа без
 * костей не считаются: «наибольшая» Скрытая атака — по костям.
 *
 * @param formula - формула с подставленными числами
 * @returns среднее костей
 */
export function estimateDiceAverage(formula: string): number {
  let average = 0;

  for (const match of formula.matchAll(DICE_TERM_PATTERN)) {
    const count = match[1] ? Number(match[1]) : 1;
    const faces = Number(match[3]);

    average += (count * (faces + 1)) / 2;
  }

  return average;
}

/**
 * Прибавляет кости к первой кости формулы: «3к6» и 2 — «5к6». Отрицательная
 * прибавка убирает кости (Хитрый удар платит ими), но не ниже нуля.
 *
 * @param formula - формула с подставленными числами
 * @param extra - сколько костей прибавить
 * @returns формула с новым числом костей; без костей — как есть
 */
export function addDiceToFormula(formula: string, extra: number): string {
  if (extra === 0) {
    return formula;
  }

  return formula.replace(
    FIRST_DICE_TERM_PATTERN,
    (_term, count: string, letter: string, faces: string) => {
      const total = Math.max(0, (count ? Number(count) : 1) + extra);

      return `${total}${letter}${faces}`;
    },
  );
}

/**
 * Формула строки с числами носителя: `@classLevel` уже подставлен сборкой
 * эффектов, остальное (`@prof`, `@mod.dex`) — здесь, число костей
 * выражением считается тут же.
 *
 * Тип урона у Скрытой атаки — как у оружия, токенов `@dmg.*` в ней нет:
 * нечитаемая формула источником не считается, бросок не ломается.
 *
 * @param value - значение строки
 * @param formulaContext - числа носителя
 * @returns формула для роллера; нечитаемая — пустая строка
 */
function resolveSneakAttackFormula(
  value: string,
  formulaContext: FormulaContext,
): string {
  try {
    return resolveDiceCountExpressions(
      substituteFormulaVariables(value, formulaContext),
    );
  } catch {
    return '';
  }
}

/**
 * Решает, какая Скрытая атака доступна в этом броске: из строк
 * `sneakAttack.damage` с выполненным условием — наибольшая по костям, с
 * прибавками `sneakAttack.dice`. Переключатель окна и лимит здесь не
 * учитываются: их решает окно.
 *
 * Прибавки проверяются в контексте «Скрытая атака идёт», так что их условие
 * может ссылаться на неё же (`attack.sneakAttack === true`). Цикла нет:
 * прибавки на выбор источника не влияют.
 *
 * @param effects - эффекты бросающего (с аурами)
 * @param rollContext - контекст броска: режим, оружие, цель
 * @param formulaContext - числа бросающего
 * @returns Скрытая атака либо `undefined`, если её условия не выполнены
 */
export function resolveSneakAttack(
  effects: readonly ActiveEffect[],
  rollContext: RollContext,
  formulaContext: FormulaContext,
): SneakAttackPlan | undefined {
  const sources = collectRollTimeChanges(
    effects,
    SNEAK_ATTACK_DAMAGE_KEY,
    rollContext,
  ).map(({ change, effect }) => ({
    formula: resolveSneakAttackFormula(change.value, formulaContext),
    sourceName: effect.name,
  }));

  const best = sources.reduce<(typeof sources)[number] | undefined>(
    (largest, source) =>
      !largest
      || estimateDiceAverage(source.formula)
        > estimateDiceAverage(largest.formula)
        ? source
        : largest,
    undefined,
  );

  if (!best || estimateDiceAverage(best.formula) <= 0) {
    return undefined;
  }

  const extraDice = collectRollTimeChanges(effects, SNEAK_ATTACK_DICE_KEY, {
    ...rollContext,
    sneakAttack: true,
  }).reduce(
    (sum, { change }) =>
      sum + Math.trunc(resolveChangeValue(change.value, formulaContext) ?? 0),
    0,
  );

  return {
    formula: addDiceToFormula(best.formula, extraDice),
    sourceName: best.sourceName,
  };
}

/** Выбор приёма в окне атаки: чем он ограничен */
export interface SneakAttackOptionChoice {
  /** Id эффекта-кнопки приёма — ключ выбора */
  id: string;
  /** Сколько костей Скрытой атаки стоит */
  cost: number;
  /** Приём Хитрого удара: входит в число приёмов за удар */
  cunningStrike: boolean;
}

/** Приём Хитрого удара или эффект по выбору при уроне Скрытой атаки */
export interface SneakAttackOption extends SneakAttackOptionChoice {
  /** Эффект-кнопка на листе */
  effect: ActiveEffect;
}

/** Приёмов Хитрого удара за удар по правилу 5-го уровня */
const BASE_CUNNING_STRIKE_LIMIT = 1;

/**
 * Приёмы Хитрого удара и эффекты по выбору при уроне Скрытой атаки, которые
 * доступны в этом броске: строки `sneakAttack.cunningStrike` и
 * `sneakAttack.rider` на эффектах-кнопках с выполненным условием. Условие
 * проверяется в контексте «Скрытая атака идёт»: без неё приёмов не бывает.
 * Ресурс кнопки (`activation.counter`) здесь не проверяется — его знает лист.
 *
 * @param effects - эффекты бросающего (с аурами)
 * @param rollContext - контекст броска
 * @param formulaContext - числа бросающего для цены
 * @returns приёмы по порядку эффектов; у эффекта — один приём
 */
export function listSneakAttackOptions(
  effects: readonly ActiveEffect[],
  rollContext: RollContext,
  formulaContext: FormulaContext,
): SneakAttackOption[] {
  const context = { ...rollContext, sneakAttack: true };

  const rows = [
    ...collectRollTimeChanges(
      effects,
      SNEAK_ATTACK_CUNNING_STRIKE_KEY,
      context,
      true,
    ).map((match) => ({ ...match, cunningStrike: true })),
    ...collectRollTimeChanges(
      effects,
      SNEAK_ATTACK_RIDER_KEY,
      context,
      true,
    ).map((match) => ({ ...match, cunningStrike: false })),
  ];

  const seen = new Set<string>();

  return effects.flatMap((effect) => {
    const row = rows.find((entry) => entry.effect === effect);

    if (!row || seen.has(effect.id)) {
      return [];
    }

    seen.add(effect.id);

    const cost = Math.max(
      0,
      Math.trunc(resolveChangeValue(row.change.value, formulaContext) ?? 0),
    );

    return [{ id: effect.id, effect, cost, cunningStrike: row.cunningStrike }];
  });
}

/**
 * Сколько приёмов Хитрого удара можно добавить к одному удару: один по
 * правилу и прибавки `sneakAttack.cunningStrikeCount` («Улучшенный хитрый
 * удар» — ещё один).
 *
 * @param effects - эффекты бросающего (с аурами)
 * @param rollContext - контекст броска
 * @param formulaContext - числа бросающего
 * @returns наибольшее число приёмов за удар
 */
export function resolveCunningStrikeLimit(
  effects: readonly ActiveEffect[],
  rollContext: RollContext,
  formulaContext: FormulaContext,
): number {
  return collectRollTimeChanges(
    effects,
    SNEAK_ATTACK_CUNNING_STRIKE_COUNT_KEY,
    { ...rollContext, sneakAttack: true },
  ).reduce(
    (sum, { change }) =>
      sum + Math.trunc(resolveChangeValue(change.value, formulaContext) ?? 0),
    BASE_CUNNING_STRIKE_LIMIT,
  );
}

/**
 * Число костей формулы Скрытой атаки — у первой кости: «3к6» — 3.
 *
 * @param formula - формула с подставленными числами
 * @returns число костей; без костей — 0
 */
export function countFormulaDice(formula: string): number {
  const match = FIRST_DICE_TERM_PATTERN.exec(formula);

  if (!match) {
    return 0;
  }

  return match[1] ? Number(match[1]) : 1;
}

/**
 * Кости той же грани, что у Скрытой атаки, числом: цена приёма «1к6» при
 * формуле «3к6».
 *
 * @param formula - формула Скрытой атаки
 * @param count - число костей
 * @returns кости строкой; формула без костей — просто число
 */
export function formatSneakAttackDice(formula: string, count: number): string {
  const match = FIRST_DICE_TERM_PATTERN.exec(formula);

  return match ? `${count}${match[2]}${match[3]}` : String(count);
}

/**
 * Сколько костей Скрытой атаки стоят выбранные приёмы.
 *
 * @param picked - выбранные приёмы
 * @returns число костей
 */
export function sumSneakAttackOptionCost(
  picked: readonly SneakAttackOptionChoice[],
): number {
  return picked.reduce((sum, option) => sum + option.cost, 0);
}

/**
 * Можно ли добавить приём к уже выбранным: его цена не больше оставшихся
 * костей, а приём Хитрого удара — ещё и в пределах числа приёмов за удар.
 * Один и тот же приём дважды не берётся.
 *
 * @param picked - уже выбранные приёмы
 * @param option - добавляемый
 * @param diceCount - сколько костей у Скрытой атаки
 * @param limit - сколько приёмов Хитрого удара за удар
 * @returns `true`, если приём можно выбрать
 */
export function canAddSneakAttackOption(
  picked: readonly SneakAttackOptionChoice[],
  option: SneakAttackOptionChoice,
  diceCount: number,
  limit: number,
): boolean {
  if (picked.some((entry) => entry.id === option.id)) {
    return false;
  }

  if (sumSneakAttackOptionCost(picked) + option.cost > diceCount) {
    return false;
  }

  return (
    !option.cunningStrike
    || picked.filter((entry) => entry.cunningStrike).length < limit
  );
}

/**
 * Выбор приёмов, который можно оставить: по порядку выбора, пока хватает
 * костей и приёмов за удар. Окно зовёт это и при смене режима: костей стало
 * меньше — лишнее снимается.
 *
 * @param options - доступные приёмы
 * @param selectedIds - выбранные игроком id эффектов, по порядку выбора
 * @param diceCount - сколько костей у Скрытой атаки
 * @param limit - сколько приёмов Хитрого удара за удар
 * @returns выбранные приёмы, которые проходят
 */
export function pickSneakAttackOptions<T extends SneakAttackOptionChoice>(
  options: readonly T[],
  selectedIds: readonly string[],
  diceCount: number,
  limit: number,
): T[] {
  return [...new Set(selectedIds)].reduce<T[]>((picked, id) => {
    const option = options.find((entry) => entry.id === id);

    return option && canAddSneakAttackOption(picked, option, diceCount, limit)
      ? [...picked, option]
      : picked;
  }, []);
}

/**
 * Эффект приёма для цели: кнопка становится действующим эффектом — без
 * применения и без строк Скрытой атаки (их читает только бросающий).
 * Спасбросок, состояние, флаги и срок — как в данных приёма; Сл по
 * `dcFormula` считается числами бросающего, как у эффектов оружия.
 *
 * @param effect - эффект-кнопка приёма
 * @returns эффект «на цель» для оркестратора удара
 */
export function buildSneakAttackOptionTargetEffect(
  effect: ActiveEffect,
): ActiveEffect {
  const { activation: _activation, ...rest } = effect;

  return {
    ...rest,
    disabled: false,
    effectTarget: 'target',
    changes: effect.changes.filter((change) => !isSneakAttackKey(change.key)),
  };
}

/**
 * Наименьшее значение кости Скрытой атаки: из строк `sneakAttack.minDie` —
 * наибольшее («1 или 2 считайте за 3»).
 *
 * @param effects - эффекты бросающего (с аурами)
 * @param rollContext - контекст броска
 * @param formulaContext - числа бросающего
 * @returns наименьшее значение либо `undefined`, если строк нет
 */
export function resolveSneakAttackMinDie(
  effects: readonly ActiveEffect[],
  rollContext: RollContext,
  formulaContext: FormulaContext,
): number | undefined {
  const values = collectRollTimeChanges(effects, SNEAK_ATTACK_MIN_DIE_KEY, {
    ...rollContext,
    sneakAttack: true,
  })
    .map(({ change }) =>
      Math.trunc(resolveChangeValue(change.value, formulaContext) ?? 0),
    )
    .filter((value) => value > 1);

  return values.length > 0 ? Math.max(...values) : undefined;
}

/** Брошенные кости после поднятия до наименьшего значения */
export interface RaisedDiceRoll {
  /** Итог части */
  amount: number;
  /** Значения костей */
  values: number[];
}

/**
 * Поднимает брошенные кости до наименьшего значения: «1 или 2 считайте за 3».
 * Роллер такой записи не знает, поэтому значения правятся после броска;
 * итог растёт на ту же разницу.
 *
 * @param amount - итог части
 * @param values - значения костей
 * @param minDie - наименьшее значение кости
 * @returns итог и значения после поднятия
 */
export function raiseDiceToMinimum(
  amount: number,
  values: readonly number[],
  minDie: number,
): RaisedDiceRoll {
  const raised = values.map((value) => Math.max(value, minDie));

  const gain = raised.reduce(
    (sum, value, index) => sum + value - (values[index] ?? value),
    0,
  );

  return { amount: amount + gain, values: raised };
}

/**
 * Есть ли у бросающего источник Скрытой атаки — строка `sneakAttack.damage`
 * в каком-либо эффекте. Без неё окну атаки нечего показывать.
 *
 * @param effects - эффекты бросающего (с аурами)
 * @returns `true`, если источник есть
 */
export function hasSneakAttackSource(
  effects: readonly ActiveEffect[],
): boolean {
  return effects.some((effect) =>
    effect.changes.some((change) => change.key === SNEAK_ATTACK_DAMAGE_KEY),
  );
}

/**
 * Добавляется ли Скрытая атака в окне атаки сама: настройка листа, по
 * умолчанию — да.
 *
 * @param entity - персонаж или существо
 * @returns `true`, если переключатель включён при открытии окна
 */
export function readSneakAttackAutoAdd(entity: DnDSceneEntity): boolean {
  return entity.system.sneakAttackAutoAdd !== false;
}

/**
 * Потрачена ли Скрытая атака в этом ходу.
 *
 * @param ledger - журнал срабатываний бросающего
 * @returns `true`, если лимит хода исчерпан
 */
export function isSneakAttackSpent(ledger: EffectTriggerUsageLedger): boolean {
  return (ledger[SNEAK_ATTACK_USAGE_KEY]?.used ?? 0) >= SNEAK_ATTACK_LIMIT.max;
}

/**
 * Разница журнала «Скрытая атака потрачена» — приращением, как и весь журнал
 * боевого канала: расход с другого клиента складывается, а не затирается.
 *
 * @returns разница журнала
 */
export function buildSneakAttackSpend(): TriggerUsageChanges {
  return {
    spend: {
      [SNEAK_ATTACK_USAGE_KEY]: { used: 1, per: SNEAK_ATTACK_LIMIT.per },
    },
    removeKeys: [],
  };
}

/**
 * Журнал, в котором расход Скрытой атаки возвращён: промах, отмена урона из
 * чата. На один расход меньше; пусто — ключ снимается.
 *
 * @param entity - бросающий, каким он есть сейчас
 * @returns журнал без одного расхода
 */
export function releaseSneakAttackUsage(
  entity: DnDSceneEntity,
): EffectTriggerUsageLedger {
  const ledger = readTriggerUsage(entity);
  const entry = ledger[SNEAK_ATTACK_USAGE_KEY];

  if (!entry) {
    return ledger;
  }

  const rest = Object.fromEntries(
    Object.entries(ledger).filter(([key]) => key !== SNEAK_ATTACK_USAGE_KEY),
  );

  return entry.used > 1
    ? { ...rest, [SNEAK_ATTACK_USAGE_KEY]: { ...entry, used: entry.used - 1 } }
    : rest;
}

/**
 * Id эффекта старой Скрытой атаки плута в компендиуме: кнопка «Применить»
 * (`activation: use`) с костями на один удар. Новая — постоянная строка
 * `sneakAttack.damage`; старая кнопка вместе с ней дала бы урон дважды.
 */
export const LEGACY_SNEAK_ATTACK_EFFECT_ID = 'effect-rogue-phb-sneak-attack';

/**
 * Старая ли это Скрытая атака: кнопка «Применить» (`activation: use`) с id
 * ровно `class-effect:<класс>:effect-rogue-phb-sneak-attack` — так её кладёт
 * мастер класса. Сравнение точное: кнопки Хитрого удара
 * (`effect-rogue-phb-sneak-attack-minus-1…9`) начинаются так же, а снимает
 * их только миграция этапа 3.
 *
 * @param effect - эффект на листе
 * @returns `true`, если эффект надо заменить
 */
function isLegacySneakAttackEffect(effect: ActiveEffect): boolean {
  const classKey = readClassEffectClassKey(effect.id);

  return (
    classKey !== undefined
    && effect.id === buildClassEffectId(classKey, LEGACY_SNEAK_ATTACK_EFFECT_ID)
    && effect.activation?.mode === 'use'
    && !hasSneakAttackSource([effect])
  );
}

/**
 * Эффекты листа со старой Скрытой атакой, заменённой новой из определения
 * класса. Повторный запуск ничего не меняет: старых эффектов уже нет, а
 * новые добавляются, только если их id на листе нет.
 *
 * Новой Скрытой атаки в определении нет (данные компендиума ещё старые) —
 * ничего не меняется: снять кнопку, не поставив строку, значило бы отнять
 * Скрытую атаку вовсе.
 *
 * @param effects - эффекты листа
 * @param replacements - эффекты класса со строкой `sneakAttack.damage`, уже с
 *   меткой класса в id
 * @returns новые эффекты листа либо `undefined`, если менять нечего
 */
export function migrateLegacySneakAttackEffects(
  effects: readonly ActiveEffect[],
  replacements: readonly ActiveEffect[],
): ActiveEffect[] | undefined {
  const fresh = replacements.filter((effect) => hasSneakAttackSource([effect]));

  if (fresh.length === 0 || !effects.some(isLegacySneakAttackEffect)) {
    return undefined;
  }

  const kept = effects.filter((effect) => !isLegacySneakAttackEffect(effect));
  const keptIds = new Set(kept.map((effect) => effect.id));

  return [...kept, ...fresh.filter((effect) => !keptIds.has(effect.id))];
}

/**
 * Кнопки старых данных, которые делает автоматика этапа 3: «Скрытая атака:
 * −Nк6» Хитрого удара (теперь цену платит выбор приёма в окне атаки),
 * «Неожиданные удары: урон» Убийцы и «Жажда крови: урон по окровавленному»
 * Наследника Троих (теперь — строки урона с условием «идёт Скрытая атака»).
 * В новых данных их нет; с новой строкой Скрытой атаки они дали бы её урон
 * дважды.
 */
export const LEGACY_SNEAK_ATTACK_BUTTON_IDS: readonly string[] = [
  ...Array.from(
    { length: 9 },
    (_unused, index) => `${LEGACY_SNEAK_ATTACK_EFFECT_ID}-minus-${index + 1}`,
  ),
  'effect-rogue-assassin-phb-surprising-strikes',
  'effect-rogue-scion-of-the-three-uafrs-bloodthirst-damage',
];

/** Ключи строк, по которым видно, что эффект — из данных этапа 3 */
const STAGE3_SNEAK_ATTACK_KEYS: ReadonlySet<string> = new Set([
  SNEAK_ATTACK_CUNNING_STRIKE_KEY,
  SNEAK_ATTACK_CUNNING_STRIKE_COUNT_KEY,
  SNEAK_ATTACK_RIDER_KEY,
  SNEAK_ATTACK_MIN_DIE_KEY,
]);

/**
 * Эффект из данных этапа 3: у него строка Хитрого удара, приёма по выбору,
 * числа приёмов или наименьшей кости, либо строка с условием «идёт Скрытая
 * атака».
 *
 * @param effect - эффект
 * @returns `true`, если эффект уже новый
 */
function isStage3SneakAttackEffect(effect: ActiveEffect): boolean {
  return effect.changes.some(
    (change) =>
      STAGE3_SNEAK_ATTACK_KEYS.has(change.key)
      || change.condition?.includes(SNEAK_ATTACK_APPLIED_CONDITION) === true,
  );
}

/**
 * Старая ли это кнопка из списка {@link LEGACY_SNEAK_ATTACK_BUTTON_IDS}:
 * id ровно `class-effect:<класс>:<id из списка>` и «Применить».
 *
 * @param effect - эффект на листе
 * @returns `true`, если кнопку снимают, когда её нет в новых данных
 */
function isLegacySneakAttackButton(effect: ActiveEffect): boolean {
  const classKey = readClassEffectClassKey(effect.id);

  return (
    classKey !== undefined
    && effect.activation?.mode === 'use'
    && LEGACY_SNEAK_ATTACK_BUTTON_IDS.some(
      (legacyId) => effect.id === buildClassEffectId(classKey, legacyId),
    )
  );
}

/**
 * Обновление листа после этапа 3. Трогает только кнопки «Применить» умений
 * класса и только когда определение класса уже новое (в нём есть строка
 * Скрытой атаки — данные компендиума переписаны):
 * - кнопка из {@link LEGACY_SNEAK_ATTACK_BUTTON_IDS}, которой в определении
 *   нет, снимается;
 * - кнопка, у которой в определении тот же id, но уже не кнопка или эффект
 *   этапа 3 («Хитрый удар: Отравить» со строкой цены), заменяется копией из
 *   определения;
 * - заодно добавляются эффекты этапа 3 из определения, которых на листе нет
 *   («Улучшенный хитрый удар»).
 *
 * Сравнение id точное. Повторный запуск ничего не меняет: старых кнопок уже
 * нет, заменённые — уже новые, добавленные — уже на листе.
 *
 * @param effects - эффекты листа
 * @param definitionEffects - эффекты умений класса, положенные персонажу по
 *   уровню и подклассу, с меткой класса в id
 * @returns новые эффекты листа либо `undefined`, если менять нечего
 */
export function migrateStage3SneakAttackEffects(
  effects: readonly ActiveEffect[],
  definitionEffects: readonly ActiveEffect[],
): ActiveEffect[] | undefined {
  if (!hasSneakAttackSource(definitionEffects)) {
    return undefined;
  }

  const definitionById = new Map(
    definitionEffects.map((effect) => [effect.id, effect]),
  );

  let changed = false;

  const kept = effects.flatMap((effect) => {
    if (effect.activation?.mode !== 'use') {
      return [effect];
    }

    const fresh = definitionById.get(effect.id);

    if (!fresh) {
      if (isLegacySneakAttackButton(effect)) {
        changed = true;

        return [];
      }

      return [effect];
    }

    const outdated =
      fresh.activation?.mode !== 'use'
      || (isStage3SneakAttackEffect(fresh)
        && !isStage3SneakAttackEffect(effect));

    if (!outdated) {
      return [effect];
    }

    changed = true;

    return [fresh];
  });

  if (!changed) {
    return undefined;
  }

  const keptIds = new Set(kept.map((effect) => effect.id));

  return [
    ...kept,
    ...definitionEffects.filter(
      (effect) => isStage3SneakAttackEffect(effect) && !keptIds.has(effect.id),
    ),
  ];
}

/** Как повторить урон удара, в котором была Скрытая атака */
export interface SneakAttackReapplyPlan {
  /** Запись для повтора: без костей Скрытой атаки, если лимит уже занят */
  record: AttackDamageRecord;
  /** Тратить ли лимит хода повтором */
  spend: boolean;
}

/**
 * «Нанести урон» после «Отменить урон»: идёт ли в повтор Скрытая атака.
 *
 * Отмена вернула лимит хода; если за это время его потратил другой удар
 * того же хода, повтор идёт БЕЗ костей Скрытой атаки — иначе она легла бы
 * дважды за ход. В другом ходу лимит уже новый и тратить его старым ударом
 * нельзя: кости остаются (удар был тогда), расход не пишется.
 *
 * @param record - запись отменённого урона
 * @param turnStamp - метка идущего хода
 * @param spentNow - потрачена ли Скрытая атака бившего в этом ходу сейчас
 * @returns запись для повтора и нужен ли расход
 */
export function planSneakAttackReapply(
  record: AttackDamageRecord,
  turnStamp: string,
  spentNow: boolean,
): SneakAttackReapplyPlan {
  if (!record.sneakAttackTurn || record.sneakAttackTurn !== turnStamp) {
    return { record, spend: false };
  }

  if (!spentNow) {
    return { record, spend: true };
  }

  return { record: withoutSneakAttackParts(record), spend: false };
}

/**
 * Запись урона без частей Скрытой атаки: вклады целей переписаны на новые
 * номера частей, метка хода снята.
 *
 * @param record - запись урона
 * @returns запись без костей Скрытой атаки
 */
function withoutSneakAttackParts(
  record: AttackDamageRecord,
): AttackDamageRecord {
  const newIndex = new Map<number, number>();

  const parts = record.parts.filter((part, index) => {
    if (part.sneakAttack) {
      return false;
    }

    newIndex.set(index, newIndex.size);

    return true;
  });

  return {
    ...record,
    sneakAttackTurn: undefined,
    parts,
    targets: record.targets.map((target) => ({
      ...target,
      contributions: target.contributions.flatMap((contribution) => {
        const part = newIndex.get(contribution.part);

        return part === undefined ? [] : [{ ...contribution, part }];
      }),
    })),
  };
}
