/**
 * Итог формулы части урона/лечения — для строки под полем ввода.
 *
 * Формула в редакторе бывает длинной: типы урона токенами, ветки по хитам
 * цели, слагаемые только против нежити. Итог раскладывает её так, как её
 * бросит движок, и называет всё словами: что бросается, какого типа и при
 * каком условии.
 *
 * Разбор не свой — это {@link expandDamageParts}, тот же, что у броска
 * заклинания, оружия и существа. Иначе подсказка и настоящий бросок
 * разошлись бы на первой же хитрой формуле.
 */

import type { DamagePart } from '@vtt/shared';

import type { CreatureCategory } from './creatureTypes.js';
import type {
  HealKind,
  ResolvedDamagePartInput,
  TargetHpGate,
} from './spellUtils.js';

import { FORMULA_VARIABLE_LABELS, isCreatureCategory } from './consts.js';
import { formatDiceFormula } from './diceFormula.js';
import { expandDamageParts } from './spellUtils.js';

/** @-переменная формулы (`@mod.spell`, `@prof`, …) */
const VARIABLE_TOKEN_REGEX = /@[a-z][\w.]*/gi;

/** Токен типа цели с захватом типа — для поиска опечаток в нём */
const TARGET_TYPE_TOKEN_REGEX = /@target\.type\.([a-z]+)\b/gi;

/** Подписи переменных для поиска по произвольной строке из формулы */
const VARIABLE_LABELS: ReadonlyMap<string, string> = new Map(
  Object.entries(FORMULA_VARIABLE_LABELS),
);

/** Одно слагаемое итога: что бросается и чем это станет у цели */
export interface DamagePreviewSegment {
  /** Формула словами: кости через «к», переменные подписями */
  formula: string;
  /** Типы урона слагаемого; пусто — урон без типа или лечение */
  types: string[];
  /** Вид лечения; не задан — это урон */
  healing?: HealKind;
}

/** Ветка итога: слагаемые, которые достаются цели при одном условии */
export interface DamagePreviewBranch {
  /** Условие по хитам цели; не задано — ветка для любой цели */
  hpGate?: TargetHpGate;
  /**
   * Тип существа, которому ветка достаётся сверху безусловной. Не
   * взаимоисключающая: безусловная ветка всё равно применяется.
   */
  typeGate?: CreatureCategory;
  /** Слагаемые ветки по порядку формулы */
  segments: DamagePreviewSegment[];
}

/** Итог формулы части урона/лечения */
export interface DamagePartPreview {
  /** Ветки итога; пусто — формула пустая */
  branches: DamagePreviewBranch[];
  /** Токены, которых движок не знает: при броске они уронят формулу или пропадут */
  unknownTokens: string[];
}

/**
 * Переписывает формулу слагаемого словами: кости и знаки — как в чате
 * ({@link formatDiceFormula}), переменные — подписями. Переменная без подписи
 * остаётся токеном: по нему итог и находит незнакомые движку токены.
 *
 * Подписи ставятся после костей: в них есть пробелы, а разбор костей пробелы
 * снимает.
 *
 * @param formula - формула слагаемого после снятия токенов типа и условий
 * @returns формула для чтения человеком
 */
function formatPreviewFormula(formula: string): string {
  return formatDiceFormula(formula).replace(
    VARIABLE_TOKEN_REGEX,
    (token) => VARIABLE_LABELS.get(token) ?? token,
  );
}

/**
 * Токены типа цели с неизвестным типом. Движок молча отбрасывает такое
 * слагаемое — цели этого типа не бывает, — и без подсказки опечатка в типе
 * выглядела бы как пропавший урон.
 *
 * @param formula - исходная формула части
 * @returns токены с опечаткой в типе
 */
function findUnknownTargetTypeTokens(formula: string): string[] {
  return [...formula.matchAll(TARGET_TYPE_TOKEN_REGEX)]
    .filter((match) => !isCreatureCategory(match[1].toLowerCase()))
    .map((match) => match[0]);
}

/**
 * Вид лечения развёрнутого слагаемого.
 *
 * @param entry - слагаемое после развёртки
 * @returns вид лечения; `undefined` — слагаемое наносит урон
 */
function readHealKind(entry: ResolvedDamagePartInput): HealKind | undefined {
  if (!entry.isHealing) {
    return undefined;
  }

  return entry.healTemp ? 'temp' : 'hp';
}

/**
 * Итог формулы части урона/лечения: что достанется цели при броске.
 *
 * Цель считается неизвестной, как у заклинания по площади: ветки по хитам
 * (`@target.full`/`@target.notFull`) и по типу существа (`@target.type.*`)
 * показываются все. Переменные не подставляются числами — у формы нет
 * владельца, — а называются словами. Бонусы, которые бросок добавляет сам
 * (модификатор оружия, усиление высших кругов), в формулу не входят и в итог
 * тоже.
 *
 * @param part - часть урона/лечения из редактора
 * @returns ветки итога и незнакомые движку токены
 */
export function previewDamagePart(part: DamagePart): DamagePartPreview {
  const branches = groupIntoBranches(
    expandDamageParts([part], undefined, formatPreviewFormula),
  );

  // Переменная без подписи осталась в формуле токеном — это и есть незнакомые
  const leftoverTokens = branches.flatMap((branch) =>
    branch.segments.flatMap(
      (segment) => segment.formula.match(VARIABLE_TOKEN_REGEX) ?? [],
    ),
  );

  return {
    branches: collapseHpIndependentBranches(branches),
    unknownTokens: [
      ...new Set([
        ...findUnknownTargetTypeTokens(part.formula),
        ...leftoverTokens,
      ]),
    ],
  };
}

/**
 * Слагаемое итога из развёрнутой части.
 *
 * @param entry - слагаемое после развёртки
 * @returns слагаемое итога
 */
function toPreviewSegment(
  entry: ResolvedDamagePartInput,
): DamagePreviewSegment {
  return {
    formula: entry.formula,
    types: entry.types ?? (entry.type ? [entry.type] : []),
    healing: readHealKind(entry),
  };
}

/**
 * Собирает развёрнутые слагаемые в ветки по условиям. Развёртка идёт ветка за
 * веткой, поэтому слагаемые одной ветки стоят подряд.
 *
 * @param resolved - слагаемые после развёртки
 * @returns ветки итога в порядке развёртки
 */
function groupIntoBranches(
  resolved: ResolvedDamagePartInput[],
): DamagePreviewBranch[] {
  return resolved.reduce<DamagePreviewBranch[]>((branches, entry) => {
    const segment = toPreviewSegment(entry);
    const current = branches.at(-1);

    if (
      current
      && current.hpGate === entry.targetGate
      && current.typeGate === entry.targetTypeGate
    ) {
      return [
        ...branches.slice(0, -1),
        { ...current, segments: [...current.segments, segment] },
      ];
    }

    return [
      ...branches,
      {
        hpGate: entry.targetGate,
        typeGate: entry.targetTypeGate,
        segments: [segment],
      },
    ];
  }, []);
}

/**
 * Ключ ветки без условия по хитам: по нему находятся одинаковые ветки.
 *
 * @param branch - ветка итога
 * @returns строка-ключ из типа цели и слагаемых
 */
function readBranchKey(branch: DamagePreviewBranch): string {
  return JSON.stringify([branch.typeGate ?? null, branch.segments]);
}

/**
 * Схлопывает ветки, которые от хитов цели не зависят.
 *
 * Развёртка кладёт слагаемое без условия по хитам в КАЖДУЮ ветку по хитам:
 * «2к6 против нежити» оказывается и в «полном HP», и в «неполном». Броску так
 * и надо, а читать одно и то же дважды незачем — ветка, одинаковая во всех
 * ветках по хитам, показывается один раз и без условия. Ветки для любой цели
 * идут первыми, добавки против типа существа — после них.
 *
 * @param branches - ветки итога в порядке развёртки
 * @returns ветки без повторов
 */
function collapseHpIndependentBranches(
  branches: DamagePreviewBranch[],
): DamagePreviewBranch[] {
  const hpGateCount = new Set(branches.map((branch) => branch.hpGate)).size;

  if (hpGateCount < 2) {
    return branches;
  }

  const keys = branches.map(readBranchKey);

  // Внутри одной ветки по хитам ветки по типу не повторяются, поэтому ключ,
  // встреченный столько раз, сколько веток по хитам, есть в каждой из них
  const sharedKeys = new Set(
    keys.filter(
      (key) => keys.filter((other) => other === key).length === hpGateCount,
    ),
  );

  // Общая ветка остаётся на месте первого появления, уже без условия по хитам
  const collapsed = branches.flatMap((branch, index) => {
    const key = keys[index];

    if (!sharedKeys.has(key)) {
      return [branch];
    }

    return keys.indexOf(key) === index
      ? [{ ...branch, hpGate: undefined }]
      : [];
  });

  return [
    ...collapsed.filter((branch) => !branch.typeGate),
    ...collapsed.filter((branch) => branch.typeGate),
  ];
}
