import type { DamagePart } from '@vtt/shared';
import type {
  CreatureAction,
  CreatureDamageAlternative,
  CreatureDamageChoice,
  CreatureDamageCondition,
  CreatureDamageContext,
  CreatureDamageOption,
  DnDCreature,
  EffectVariantChoices,
  EffectVariantGroup,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { generateId } from '@vtt/shared';
import {
  applyCreatureDamageOption,
  chooseCreatureActionDamage,
  describeCreatureDamageCondition,
  describeDamagePart,
  entityHasDamageStatus,
  getDamagePartsPrimaryType,
  getDamageTemplateColor,
  isDndSceneEntity,
  readAlternativeShownParts,
} from '@vtt/shared/system/dnd.js';

import { useSystemDataStore } from '../stores/systemDataStore';
import {
  CREATURE_DAMAGE_CHOICE_LABELS,
  CREATURE_DAMAGE_MODAL_KEY_PREFIX,
} from '../ui/creature/constants';
import { EFFECT_VARIANT_PROMPT_MODAL } from '../ui/effect/constants';
import { formatDamageTypeChoiceLabel } from './damageTypeChoice';

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
export interface DamagePartsText {
  formula: string;
  typeLabel: string;
}

/**
 * Сводка набора урона для строки листа и подписей выбора: «2к4 + 1» и «Яд».
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
    formula: infos.map((info) => info.formula).join(' + '),
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
 * Подпись набора в вопросе и в чате. Своя подпись варианта идёт впереди
 * формулы: по одной подписи не видно, сколько урона будет.
 *
 * @param option - набор урона
 * @param getTypeLabel - название типа урона по ключу
 * @returns подпись набора
 */
function formatOptionLabel(
  option: CreatureDamageOption,
  getTypeLabel: (typeKey: string) => string,
): string {
  const text = formatDamagePartsText(
    option.alternative
      ? readAlternativeShownParts(option.alternative)
      : option.damageParts,
    getTypeLabel,
  );

  const ownLabel = option.alternative?.label;

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

/**
 * Выполняет атаку действием с выбранным уроном «или». Сработало состояние —
 * атака идёт вариантом, и чат говорит почему; «на выбор» — плашка спрашивает
 * бросающего; «случайно» — набор выпадает сам, и чат называет, какой; без
 * вариантов действие идёт как есть и сразу. Закрытая без выбора плашка
 * отменяет атаку — так же, как у вариантов эффектов.
 *
 * @param action - действие существа (после выбора вариантов эффектов)
 * @param creature - атакующее существо
 * @param proceed - продолжение атаки с выбранным уроном
 */
export function runWithCreatureDamageChoice(
  action: CreatureAction,
  creature: DnDCreature,
  proceed: (chosen: CreatureAction) => void,
): void {
  if (!action.damageAlternatives?.length) {
    proceed(action);

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

  const chatPrefix = `${action.name}${CREATURE_DAMAGE_CHOICE_LABELS.chatSeparator}`;

  if (choice.kind === 'resolved') {
    // Сработавшее состояние и выпавший набор называются в чате: иначе урон,
    // непохожий на прошлый бросок, выглядел бы ошибкой
    const reason = readChoiceReason(choice);

    if (reason) {
      useChatStore().sendMessage(
        `${chatPrefix}${formatOptionLabel(choice.option, getTypeLabel)}${CREATURE_DAMAGE_CHOICE_LABELS.reasonOpen}${describeCreatureDamageCondition(reason)}${CREATURE_DAMAGE_CHOICE_LABELS.reasonClose}`,
        'text',
      );
    }

    proceed(applyCreatureDamageOption(action, choice.option));

    return;
  }

  const labels = makeLabelsUnique(
    choice.options.map((option) => formatOptionLabel(option, getTypeLabel)),
  );

  const group: EffectVariantGroup = {
    group: CREATURE_DAMAGE_CHOICE_LABELS.groupName,
    pick: 'choose',
    labels,
  };

  const finish = (choices: EffectVariantChoices): void => {
    const pickedIndex = labels.indexOf(choices[group.group] ?? '');
    const picked = choice.options[pickedIndex];

    if (!picked) {
      return;
    }

    useChatStore().sendMessage(`${chatPrefix}${labels[pickedIndex]}`, 'text');
    proceed(applyCreatureDamageOption(action, picked));
  };

  // Плашка та же, что у вариантов эффектов: один вопрос «какой вариант?»
  useModalManager().openModal(EFFECT_VARIANT_PROMPT_MODAL, {
    _modalKey: generateId(CREATURE_DAMAGE_MODAL_KEY_PREFIX),
    sourceName: action.name,
    groups: [group],
    onConfirm: finish,
  });
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
