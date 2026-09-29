/**
 * Тип урона на выбор (`@dmg.choice(…)`, `@dmg.random(…)`) на стороне клиента:
 * вопрос бросающему в окне броска (или плашкой, где окна нет) и подписи
 * вариантов в листах.
 *
 * Сам разбор и подстановка — в движке (`damageTypeChoice.ts`); здесь только
 * то, что требует окна и справочника типов мира.
 */

import type {
  DamageTypeChoice,
  DamageTypeChoicePicks,
  DamageTypeChoiceSource,
  EffectVariantChoices,
  EffectVariantGroup,
} from '@vtt/shared/system/dnd.js';

import type { SheetRowStat } from '../ui/actor/sheetRowTypes';

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
import {
  DAMAGE_PART_LABELS,
  DAMAGE_VARIANTS_STAT_ICON,
  SHEET_ROW_TOOLTIP_LINE_BREAK,
} from '../ui/actor/constants';
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
 * Подписи типов на выбор источника для подсказки: по строке на список —
 * «На выбор: Кислота/Холод/Огненный». Пусто — у урона источника тип один.
 *
 * @param source - заклинание, действие, оружие или предмет
 * @param getTypeLabel - название типа урона по ключу
 * @returns строки подсказки
 */
function describeSourceDamageTypeChoices(
  source: DamageTypeChoiceSource,
  getTypeLabel: (typeKey: string) => string,
): string[] {
  return listSourceDamageTypeChoices(source).map((choice) =>
    formatDamageTypeChoiceLabel(choice, getTypeLabel),
  );
}

/**
 * Подсказка и значок плитки урона источника с типом на выбор: в плитке
 * формула одна, есть ли выбор — говорит значок, а сами варианты — строки
 * подсказки после основной.
 *
 * @param source - заклинание, оружие или действие
 * @param baseTooltip - основная подсказка плитки
 * @param getTypeLabel - название типа урона по ключу
 * @returns подсказка и значок для плитки урона
 */
export function describeDamageVariantsStat(
  source: DamageTypeChoiceSource,
  baseTooltip: string,
  getTypeLabel: (typeKey: string) => string,
): Pick<SheetRowStat, 'tooltip' | 'icon'> {
  const typeChoiceLines = describeSourceDamageTypeChoices(source, getTypeLabel);

  return {
    tooltip: [baseTooltip, ...typeChoiceLines].join(
      SHEET_ROW_TOOLTIP_LINE_BREAK,
    ),
    icon: typeChoiceLines.length > 0 ? DAMAGE_VARIANTS_STAT_ICON : undefined,
  };
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
 * Пишет в чат итог выбора типов урона источника: «Цветной шарик: тип урона —
 * Огненный». Без строки урон «огнём» у заклинания «на выбор» непонятно откуда.
 *
 * @param sourceName - имя источника броска
 * @param choices - типы на выбор источника
 * @param picks - итог выбора
 */
export function announceDamageTypeChoices(
  sourceName: string,
  choices: readonly DamageTypeChoice[],
  picks: DamageTypeChoicePicks,
): void {
  const getTypeLabel = useDamageTypeLabel();

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
      `${sourceName}${DAMAGE_TYPE_CHOICE_PROMPT_LABELS.chatSeparator}${chatLabels.join(DAMAGE_TYPE_CHOICE_PROMPT_LABELS.chatJoiner)}`,
      'text',
    );
  }
}

/**
 * Вопрос о типе урона источника, отданный окну броска: окно показывает поле
 * «Тип урона» на каждый список, при броске решает случайные и отдаёт итог.
 */
export interface DamageTypeChoiceRequest {
  /** Имя источника — для строки чата */
  sourceName: string;
  /** Типы на выбор всех формул источника (урон, эффекты, зоны) */
  choices: DamageTypeChoice[];
  /** Итог выбора: зовётся в начале броска, до урона и эффектов */
  onChoose: (picks: DamageTypeChoicePicks) => void;
}

/**
 * Готовит вопрос о типе урона для окна броска. Итог выбора, сделанный в окне,
 * отдаётся в `onChoose` ДО урона: вызывающий подставляет его
 * (`applySourceDamageTypeChoices`) во всё, что ляжет после броска, — эффекты
 * на цель и зоны получают тот же тип, что и урон.
 *
 * @param source - заклинание, действие, оружие или предмет — все его формулы
 * @param onChoose - итог выбора: ключ списка → тип урона
 * @returns вопрос для окна; `undefined`, если выбирать нечего
 */
export function requestDamageTypeChoice(
  source: DamageTypeChoiceRunSource,
  onChoose: (picks: DamageTypeChoicePicks) => void,
): DamageTypeChoiceRequest | undefined {
  const choices = listSourceDamageTypeChoices(source);

  if (choices.length === 0) {
    return undefined;
  }

  return { sourceName: source.name, choices, onChoose };
}

/**
 * Вопрос о типе урона для окна броска, итог которого сразу подставляется в
 * то, что ляжет после броска: `question` задаёт списки (все формулы
 * источника), `target` получает выбранные типы и уходит в `onChosen`.
 * Вопрос и получатель различаются у оружия: урон в самом оружии, а эффекты на
 * цель — в его псевдо-заклинании.
 *
 * @param question - заклинание, действие, оружие или предмет — все его формулы
 * @param target - что после броска ложится с выбранным типом
 * @param onChosen - получатель с выбранными типами
 * @returns вопрос для окна; `undefined`, если выбирать нечего
 */
export function requestDamageTypeChoiceFor<
  Target extends DamageTypeChoiceSource,
>(
  question: DamageTypeChoiceRunSource,
  target: Target,
  onChosen: (chosen: Target) => void,
): DamageTypeChoiceRequest | undefined {
  return requestDamageTypeChoice(question, (picks) => {
    onChosen(applySourceDamageTypeChoices(target, picks));
  });
}

/**
 * Выполняет действие с решённым типом урона «на выбор» — плашкой ДО действия.
 * Нужна там, где окна броска нет (заговор без броска, эффект без урона): с
 * окном вопрос задаёт само окно ({@link requestDamageTypeChoice}).
 *
 * У всех формул источника (урон, ступени заговора, урон «или», эффекты на
 * цель и зоны) `@dmg.choice(…)` становится выбранным `@dmg.<тип>`. Случайные
 * типы выпадают сразу, остальные выбирает бросающий — одним вопросом на
 * одинаковый список. Без токенов действие идёт сразу; закрытая без выбора
 * плашка отменяет его. Итог уходит в чат.
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

    announceDamageTypeChoices(source.name, choices, picks);
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
