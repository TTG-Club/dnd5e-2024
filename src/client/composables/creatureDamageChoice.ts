import type { DamagePart } from '@vtt/shared';
import type {
  CreatureAction,
  CreatureDamageAlternative,
  CreatureDamageChoice,
  CreatureDamageCondition,
  CreatureDamageContext,
  CreatureDamageOption,
  DamageSetDisplay,
  DnDCreature,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { RollDamageVariant } from '../ui/actor/diceRollTypes';
import type { CreatureRollSetup } from './useBonusDamageParts';
import type { RolledSpellDamagePart } from './useSpellResolution';

import { useChatStore } from '@/stores/chatStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import {
  applyCreatureDamageOption,
  applySourceDamageTypeChoices,
  chooseCreatureActionDamage,
  combineDamagePartDisplays,
  creatureActionHasSave,
  describeCreatureDamageCondition,
  describeDamagePart,
  entityHasDamageStatus,
  getDamagePartsPrimaryType,
  getDamageTemplateColor,
  isDndSceneEntity,
  listCreatureDamageAlternatives,
  readAlternativeShownParts,
} from '@vtt/shared/system/dnd.js';

import { useSystemDataStore } from '../stores/systemDataStore';
import { CREATURE_DAMAGE_CHOICE_LABELS } from '../ui/creature/constants';
import {
  formatDamageTypeChoiceLabel,
  requestDamageTypeChoice,
  runWithDamageTypeChoices,
} from './damageTypeChoice';

/** Способ «случайно» — для пометки выпавшего основного урона в чате */
const RANDOM_CONDITION: CreatureDamageCondition = 'random';

/**
 * Почему атака идёт этим набором — для строки чата: сработавшее состояние или
 * случай. Выбор человека и основной урон без вариантов объяснять незачем.
 *
 * @param choice - итог выбора
 * @returns способ для фразы либо `undefined`, если объяснять нечего
 */
function readChoiceReason(
  choice: Extract<CreatureDamageChoice, { kind: 'resolved' }>,
):
  | (Pick<CreatureDamageAlternative, 'condition'>
      & Partial<Pick<CreatureDamageAlternative, 'damageParts'>>)
  | undefined {
  if (choice.matched) {
    return choice.option.alternative;
  }

  return choice.rolled ? { condition: RANDOM_CONDITION } : undefined;
}

/** Сводка набора урона: формула без токенов и подпись типов */
export interface DamagePartsText extends DamageSetDisplay {
  typeLabel: string;
}

/**
 * Сводка набора урона для строки листа и подписей выбора: «2к4 + 1» и «Ядовитый».
 *
 * @param parts - части урона
 * @param getTypeLabel - название типа урона по ключу
 * @returns сводка либо `null`, если частей нет
 */
export function summarizeDamageParts(
  parts: readonly DamagePart[],
  getTypeLabel: (typeKey: string) => string,
): DamagePartsText | null {
  if (parts.length === 0) {
    return null;
  }

  const infos = parts.map((part) => describeDamagePart(part));
  const typeKeys = [...new Set(infos.flatMap((info) => info.types))];

  const choiceLabels = [
    ...new Set(
      infos.flatMap((info) =>
        info.typeChoices.map((choice) =>
          formatDamageTypeChoiceLabel(choice, getTypeLabel),
        ),
      ),
    ),
  ];

  return {
    ...combineDamagePartDisplays(infos),
    typeLabel: [
      ...typeKeys.map((key) => getTypeLabel(key)),
      ...choiceLabels,
    ].join(', '),
  };
}

/**
 * Одной строкой: «2к4 + 1 яд». Тип пишется строчными — он идёт в середине
 * фразы, а не заголовком.
 *
 * @param parts - части урона
 * @param getTypeLabel - название типа урона по ключу
 * @returns строка набора; без частей — подпись «без урона»
 */
export function formatDamagePartsText(
  parts: readonly DamagePart[],
  getTypeLabel: (typeKey: string) => string,
): string {
  const summary = summarizeDamageParts(parts, getTypeLabel);

  if (!summary) {
    return CREATURE_DAMAGE_CHOICE_LABELS.noDamage;
  }

  return summary.typeLabel
    ? `${summary.formula} ${summary.typeLabel.toLocaleLowerCase('ru')}`
    : summary.formula;
}

/**
 * Сводка набора, у которого типы урона постоянные: тип на выбор
 * (`@dmg.choice(…)`) — не одно название, подписью набора он не станет.
 *
 * @param parts - части урона
 * @param getTypeLabel - название типа урона по ключу
 * @returns сводка либо `null`, если частей нет или тип не постоянный
 */
function summarizeFixedTypeParts(
  parts: readonly DamagePart[],
  getTypeLabel: (typeKey: string) => string,
): DamagePartsText | null {
  const summary = summarizeDamageParts(parts, getTypeLabel);

  const isFixed =
    summary !== null
    && summary.typeLabel.length > 0
    && parts.every((part) => describeDamagePart(part).typeChoices.length === 0);

  return isFixed ? summary : null;
}

/**
 * Отличаются ли варианты от основного урона только типом. Так компендиум
 * пишет «один тип на выбор»: основной урон — первым типом, варианты — теми же
 * костями другого типа. Подписи таких вариантов пишут люди, и они расходятся
 * со справочником («Огонь» при типе «Огненный»), поэтому набор называется
 * типом из справочника, а не своей подписью.
 *
 * @param action - действие существа с вариантами
 * @param getTypeLabel - название типа урона по ключу
 * @returns `true`, если все наборы — те же кости другого типа
 */
function isTypeOnlyChoice(
  action: Pick<CreatureAction, 'damageParts' | 'damageAlternatives'>,
  getTypeLabel: (typeKey: string) => string,
): boolean {
  const base = summarizeFixedTypeParts(action.damageParts ?? [], getTypeLabel);

  if (!base) {
    return false;
  }

  return listCreatureDamageAlternatives(action).every(
    (alternative) =>
      summarizeFixedTypeParts(
        readAlternativeShownParts(alternative),
        getTypeLabel,
      )?.formula === base.formula,
  );
}

/**
 * Подпись набора в вопросе и в чате: «подпись: формула», у основного урона
 * тоже — иначе первая строка списка не читается таким же выбором. Если
 * наборы отличаются только типом ({@link isTypeOnlyChoice}), подпись — тип
 * из справочника, а формула идёт без типа: «Кислотный: 1к6+3». Иначе своя
 * подпись варианта («С преимуществом») или «Основной урон» идёт впереди
 * формулы с типом: по одной подписи не видно, сколько урона будет.
 *
 * @param option - набор урона
 * @param getTypeLabel - название типа урона по ключу
 * @param typeOnly - наборы отличаются только типом урона
 * @returns подпись набора
 */
function formatOptionLabel(
  option: CreatureDamageOption,
  getTypeLabel: (typeKey: string) => string,
  typeOnly: boolean,
): string {
  const parts = option.alternative
    ? readAlternativeShownParts(option.alternative)
    : option.damageParts;

  const typeSummary = typeOnly
    ? summarizeFixedTypeParts(parts, getTypeLabel)
    : null;

  if (typeSummary) {
    return `${typeSummary.typeLabel}${CREATURE_DAMAGE_CHOICE_LABELS.labelSeparator}${typeSummary.formula}`;
  }

  const text = formatDamagePartsText(parts, getTypeLabel);

  const ownLabel = option.alternative
    ? option.alternative.label
    : CREATURE_DAMAGE_CHOICE_LABELS.base;

  return ownLabel
    ? `${ownLabel}${CREATURE_DAMAGE_CHOICE_LABELS.labelSeparator}${text}`
    : text;
}

/**
 * Подписи наборов без повторов: плашка выбирает по подписи, и два одинаковых
 * пункта отдали бы всегда первый.
 *
 * @param labels - подписи по порядку наборов
 * @returns подписи, где повторы помечены номером
 */
function makeLabelsUnique(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();

  return labels.map((label) => {
    const count = (seen.get(label) ?? 0) + 1;

    seen.set(label, count);

    return count === 1
      ? label
      : `${label}${CREATURE_DAMAGE_CHOICE_LABELS.duplicateOpen}${count}${CREATURE_DAMAGE_CHOICE_LABELS.duplicateClose}`;
  });
}

/**
 * Проверки состояний сторон атаки на этот момент. Цель — только у одиночной
 * атаки: у области её нет, и вариант «если у цели» не выбирается.
 *
 * @param action - действие существа
 * @param creature - атакующее существо
 * @returns проверки состояний атакующего и цели
 */
function buildDamageContext(
  action: CreatureAction,
  creature: DnDCreature,
): CreatureDamageContext {
  const target = action.areaOfEffect ? null : useTargetStore().getTargetActor();

  const targetEntity = target && isDndSceneEntity(target) ? target : null;

  return {
    selfHasStatus: (status) => entityHasDamageStatus(creature, status),
    targetHasStatus: targetEntity
      ? (status) => entityHasDamageStatus(targetEntity, status)
      : undefined,
  };
}

/** Вариант урона «или», который выбирают в окне броска */
export interface CreatureDamageVariant {
  /** Подпись в окне и в строке чата: «С преимуществом: 4к6 + 4 колющий» */
  label: string;
  /** Действие с уроном этого варианта */
  action: CreatureAction;
}

/**
 * Выполняет атаку действием с уроном «или». Сработало состояние — атака идёт
 * вариантом, и чат говорит почему; «случайно» — набор выпадает сам, и чат
 * называет, какой; без вариантов действие идёт как есть. «На выбор» решается
 * в окне броска: атака идёт с первым набором (основной урон), а все наборы
 * уходят в `variants` — окно показывает поле «Урон» и в начале броска
 * называет выбранный в чате ({@link announceCreatureDamageVariant}).
 *
 * @param action - действие существа (после выбора вариантов эффектов)
 * @param creature - атакующее существо
 * Строку чата о решённом наборе продолжение отправляет само
 * (`announceChoice`) — когда окно броска открылось: действие, которое не
 * состоялось, в чат не пишется.
 *
 * @param proceed - продолжение атаки: действие, наборы для окна (пусто —
 *   выбирать в окне нечего) и отправка строки чата о выбранном наборе
 */
export function runWithCreatureDamageChoice(
  action: CreatureAction,
  creature: DnDCreature,
  proceed: (
    chosen: CreatureAction,
    variants: CreatureDamageVariant[],
    announceChoice: () => void,
  ) => void,
): void {
  /** Решённого набора нет — сказать в чате нечего */
  const silent = (): void => {};

  if (!action.damageAlternatives?.length) {
    proceed(action, [], silent);

    return;
  }

  const choice = chooseCreatureActionDamage(
    action,
    buildDamageContext(action, creature),
  );

  const systemDataStore = useSystemDataStore();

  const getTypeLabel = (typeKey: string): string =>
    systemDataStore.damageTypes.find((entry) => entry.key === typeKey)?.name
    ?? typeKey;

  const typeOnly = isTypeOnlyChoice(action, getTypeLabel);

  if (choice.kind === 'resolved') {
    // Сработавшее состояние и выпавший набор называются в чате: иначе урон,
    // непохожий на прошлый бросок, выглядел бы ошибкой
    const reason = readChoiceReason(choice);

    const announceChoice = reason
      ? () =>
          useChatStore().sendMessage(
            `${action.name}${CREATURE_DAMAGE_CHOICE_LABELS.chatSeparator}${formatOptionLabel(choice.option, getTypeLabel, typeOnly)}${CREATURE_DAMAGE_CHOICE_LABELS.reasonOpen}${describeCreatureDamageCondition(reason)}${CREATURE_DAMAGE_CHOICE_LABELS.reasonClose}`,
            'text',
          )
      : silent;

    proceed(
      applyCreatureDamageOption(action, choice.option),
      [],
      announceChoice,
    );

    return;
  }

  const labels = makeLabelsUnique(
    choice.options.map((option) =>
      formatOptionLabel(option, getTypeLabel, typeOnly),
    ),
  );

  const variants = choice.options.map((option, index) => ({
    label: labels[index] ?? '',
    action: applyCreatureDamageOption(action, option),
  }));

  const [firstVariant] = variants;

  if (!firstVariant) {
    return;
  }

  proceed(firstVariant.action, variants, silent);
}

/**
 * Пишет в чат выбранный в окне набор урона «или»: «Укус: С преимуществом».
 *
 * @param actionName - имя действия
 * @param variant - выбранный набор
 */
export function announceCreatureDamageVariant(
  actionName: string,
  variant: CreatureDamageVariant,
): void {
  useChatStore().sendMessage(
    `${actionName}${CREATURE_DAMAGE_CHOICE_LABELS.chatSeparator}${variant.label}`,
    'text',
  );
}

/**
 * Запускает атаку действием с уже выбранным уроном: у действия с областью
 * сначала ставится шаблон у фишки существа (цвет — по типу первой части
 * урона), остальное сразу открывает окно броска. Общий путь листа существа и
 * хотбара.
 *
 * @param action - действие существа с выбранным уроном
 * @param creatureId - фишка существа, у которой ставится шаблон; нет — шаблон
 *   ставится без привязки к фишке
 * @param openRoll - открывает окно броска; у области получает id шаблона
 */
export function launchCreatureAction(
  action: CreatureAction,
  creatureId: string | undefined,
  openRoll: (templateId: string | undefined) => void,
): void {
  if (!action.areaOfEffect) {
    openRoll(undefined);

    return;
  }

  const color = getDamageTemplateColor(
    getDamagePartsPrimaryType(action.damageParts),
  );

  useSpellTemplateStore().requestPlacement(
    action.areaOfEffect,
    color,
    creatureId,
    (templateId) => openRoll(templateId),
    null,
  );
}

/**
 * Наборы урона для окна броска действия существа. Без урона «или» набор один —
 * само действие; с ним — по набору на вариант, и окно показывает поле «Урон».
 *
 * У каждого набора всё своё: части урона, бонус-части, вопрос о типе урона на
 * выбор и применение. Выбранный в окне тип подставляется и в действие (его
 * эффекты на себя), и в псевдо-заклинание (эффекты на цель).
 *
 * @param action - действие с уроном первого набора
 * @param variants - наборы урона «или»; пусто — выбирать нечего
 * @param buildSetup - части и псевдо-заклинание броска по действию
 * @param apply - применение брошенных частей: действие, псевдо-заклинание, части
 * @returns наборы для окна; первый — тот, что выбран при открытии
 */
export function buildCreatureRollVariants(
  action: CreatureAction,
  variants: readonly CreatureDamageVariant[],
  buildSetup: (variantAction: CreatureAction) => CreatureRollSetup,
  apply: (
    chosenAction: CreatureAction,
    actionSpell: Spell,
    parts: RolledSpellDamagePart[],
  ) => void,
): RollDamageVariant[] {
  const damageSets =
    variants.length > 0 ? variants : [{ label: action.name, action }];

  return damageSets.map((variant) => {
    const setup = buildSetup(variant.action);

    let chosenAction = variant.action;
    let actionSpell = setup.pseudoSpell;

    const damageTypeChoice = requestDamageTypeChoice(
      variant.action,
      (picks) => {
        chosenAction = applySourceDamageTypeChoices(variant.action, picks);
        actionSpell = applySourceDamageTypeChoices(setup.pseudoSpell, picks);
      },
    );

    return {
      label: variant.label,
      formula: setup.baseParts[0]?.formula ?? '',
      damageType: getDamagePartsPrimaryType(variant.action.damageParts),
      damageParts: setup.baseParts,
      evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
      damageTypeChoice,
      onRollParts: (parts) => {
        apply(chosenAction, actionSpell, parts);
      },
      // Выбор человека называется в чате; без вариантов называть нечего
      onSelect: () => {
        if (variants.length > 0) {
          announceCreatureDamageVariant(action.name, variant);
        }
      },
    };
  });
}

/**
 * Применяет действие со спасброском или областью, у которого нет урона
 * («Пленяющий стручок», «Господство над разумом», «Ужасающий облик» с уроном
 * в эффекте): бросать существу нечего, поэтому окна броска нет — цели
 * спасаются сами, эффекты ложатся по исходу. Раньше такое действие открывало
 * окно без частей урона: в чат уходил голый к20, а применение не звалось.
 *
 * Тип урона «на выбор» у эффектов спрашивает плашка — окна, которое задало бы
 * вопрос, здесь нет.
 *
 * @param action - действие существа с выбранным уроном
 * @param rollVariants - наборы урона, собранные для окна броска
 * @param buildSpell - псевдо-заклинание действия для разбора целей
 * @param apply - применение: действие, псевдо-заклинание и брошенные части
 * @returns `true`, если действие без урона и ушло на применение
 */
export function runDamagelessCreatureAction(
  action: CreatureAction,
  rollVariants: readonly RollDamageVariant[],
  buildSpell: (chosenAction: CreatureAction) => Spell,
  apply: (
    chosenAction: CreatureAction,
    actionSpell: Spell,
    parts: RolledSpellDamagePart[],
  ) => void,
): boolean {
  const hasDamage = rollVariants.some(
    (variant) => (variant.damageParts ?? []).length > 0,
  );

  if (hasDamage || !(creatureActionHasSave(action) || action.areaOfEffect)) {
    return false;
  }

  runWithDamageTypeChoices(action, (chosenAction) => {
    apply(chosenAction, buildSpell(chosenAction), []);
  });

  return true;
}
