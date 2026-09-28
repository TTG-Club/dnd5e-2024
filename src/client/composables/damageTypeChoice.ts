/**
 * Тип урона на выбор (`@dmg.choice(…)`, `@dmg.random(…)`) на стороне клиента:
 * вопрос бросающему перед броском и подписи вариантов в листах.
 *
 * Сам разбор и подстановка — в движке (`damageTypeChoice.ts`); здесь только
 * то, что требует окна и справочника типов мира.
 */

import type {
  DamageTypeChoice,
  DamageTypeChoiceSource,
  EffectVariantChoices,
  EffectVariantGroup,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { generateId } from '@vtt/shared';
import {
  applySourceDamageTypeChoices,
  damageTypeChoiceKey,
  listSourceDamageTypeChoices,
  rollRandomDamageTypeChoices,
} from '@vtt/shared/system/dnd.js';

import { useSystemDataStore } from '../stores/systemDataStore';
import { DAMAGE_PART_LABELS } from '../ui/actor/constants';
import {
  DAMAGE_TYPE_CHOICE_MODAL_KEY_PREFIX,
  DAMAGE_TYPE_CHOICE_PROMPT_LABELS,
  EFFECT_VARIANT_PROMPT_MODAL,
} from '../ui/effect/constants';

/**
 * Подпись типа урона на выбор для листов и итога формулы: «На выбор:
 * Кислота/Холод/Огненный» или «Случайно: Излучение/Некротический».
 *
 * @param choice - тип на выбор из формулы
 * @param getTypeLabel - название типа урона по ключу
 * @returns подпись вариантов
 */
export function formatDamageTypeChoiceLabel(
  choice: DamageTypeChoice,
  getTypeLabel: (typeKey: string) => string,
): string {
  const prefix =
    choice.mode === 'random'
      ? DAMAGE_PART_LABELS.typeRandomPrefix
      : DAMAGE_PART_LABELS.typeChoicePrefix;

  return `${prefix}${choice.options
    .map((typeKey) => getTypeLabel(typeKey))
    .join(DAMAGE_PART_LABELS.typeChoiceSeparator)}`;
}

/**
 * Название типа урона по справочнику мира; незнакомый ключ — как есть.
 *
 * @returns функция «ключ → название»
 */
export function useDamageTypeLabel(): (typeKey: string) => string {
  const systemDataStore = useSystemDataStore();

  return (typeKey) =>
    systemDataStore.damageTypes.find((entry) => entry.key === typeKey)?.name
    ?? typeKey;
}

/** Источник броска: у него есть имя для вопроса и строки чата */
export interface DamageTypeChoiceRunSource extends DamageTypeChoiceSource {
  name: string;
}

/**
 * Выполняет бросок с решённым типом урона «на выбор»: у всех формул
 * источника (урон, ступени заговора, урон «или», эффекты на цель и зоны)
 * `@dmg.choice(…)` становится выбранным `@dmg.<тип>`. Случайные типы
 * выпадают сразу, остальные выбирает бросающий плашкой — одним вопросом на
 * одинаковый список, сколько бы целей ни было. Без токенов бросок идёт сразу;
 * закрытая без выбора плашка отменяет бросок.
 *
 * В чат уходит итог: какой тип выбран или выпал, — иначе урон «огнём» у
 * заклинания «на выбор» непонятно откуда.
 *
 * @param source - заклинание, действие, оружие или предмет
 * @param proceed - продолжение с выбранными типами
 */
export function runWithDamageTypeChoices<
  Source extends DamageTypeChoiceRunSource,
>(source: Source, proceed: (chosen: Source) => void): void {
  const choices = listSourceDamageTypeChoices(source);

  if (choices.length === 0) {
    proceed(source);

    return;
  }

  const getTypeLabel = useDamageTypeLabel();
  const rolled = rollRandomDamageTypeChoices(choices);
  const chooseChoices = choices.filter((choice) => choice.mode === 'choose');

  const finish = (picked: ReadonlyMap<string, string>): void => {
    const picks = new Map([...rolled, ...picked]);

    const chatLabels = choices.flatMap((choice) => {
      const type = picks.get(damageTypeChoiceKey(choice));

      if (!type) {
        return [];
      }

      return [
        `${getTypeLabel(type)}${choice.mode === 'random' ? DAMAGE_TYPE_CHOICE_PROMPT_LABELS.randomSuffix : ''}`,
      ];
    });

    if (chatLabels.length > 0) {
      useChatStore().sendMessage(
        `${source.name}${DAMAGE_TYPE_CHOICE_PROMPT_LABELS.chatSeparator}${chatLabels.join(DAMAGE_TYPE_CHOICE_PROMPT_LABELS.chatJoiner)}`,
        'text',
      );
    }

    proceed(applySourceDamageTypeChoices(source, picks));
  };

  if (chooseChoices.length === 0) {
    finish(new Map());

    return;
  }

  // Группа — список вариантов; подписи — названия типов мира (они различны,
  // поэтому по подписи тип находится однозначно)
  const groups = chooseChoices.map((choice, index) => ({
    choice,
    group: {
      group:
        chooseChoices.length > 1
          ? `${DAMAGE_TYPE_CHOICE_PROMPT_LABELS.group}${DAMAGE_TYPE_CHOICE_PROMPT_LABELS.groupNumberSeparator}${index + 1}`
          : DAMAGE_TYPE_CHOICE_PROMPT_LABELS.group,
      pick: 'choose',
      labels: choice.options.map((typeKey) => getTypeLabel(typeKey)),
    } satisfies EffectVariantGroup,
  }));

  const handleConfirm = (answers: EffectVariantChoices): void => {
    const picked = new Map<string, string>();

    for (const { choice, group } of groups) {
      const index = group.labels.indexOf(answers[group.group] ?? '');
      const type = choice.options[index];

      if (type) {
        picked.set(damageTypeChoiceKey(choice), type);
      }
    }

    finish(picked);
  };

  // Плашка та же, что у вариантов эффектов: вопрос «какой вариант?»
  useModalManager().openModal(EFFECT_VARIANT_PROMPT_MODAL, {
    _modalKey: generateId(DAMAGE_TYPE_CHOICE_MODAL_KEY_PREFIX),
    sourceName: source.name,
    groups: groups.map(({ group }) => group),
    onConfirm: handleConfirm,
  });
}
