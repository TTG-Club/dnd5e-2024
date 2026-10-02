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
  DAMAGE_BONUS_LINE_PREFIX,
  DAMAGE_BONUS_STAT_ICON,
  DAMAGE_NO_CONSTANT_LABEL,
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
 * Кислотный/Холодный/Огненный» или «Случайно: Излучение/Некротический».
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
 * «На выбор: Кислотный/Холодный/Огненный». Пусто — у урона источника тип один.
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
 * Строки подсказки плитки урона о добавках по условию: «+ 1к8 (атакующий:
 * Окровавленный)». В самой плитке их нет — там урон, который бросается всегда.
 *
 * @param conditionalFormulas - добавки по условию с пометкой условия
 * @returns строки подсказки
 */
export function formatDamageBonusLines(
  conditionalFormulas: readonly string[],
): string[] {
  return conditionalFormulas.map(
    (formula) => `${DAMAGE_BONUS_LINE_PREFIX}${formula}`,
  );
}

/**
 * Текст плитки урона: урон, который бросается всегда, вместе со статической
 * прибавкой. У набора целиком под условием постоянных костей нет: тогда в
 * плитке одна прибавка («+3»), а без неё — короткая заглушка. Полный текст
 * добавок в плитку не идёт никогда: «2к10 (цель: Исчадие) + 2к10 (цель:
 * Нежить)» выдавливал название из строки — добавки читают в подсказке.
 *
 * @param baseFormula - постоянная часть урона; пусто — её нет
 * @param modifier - статическая прибавка (характеристика, магический бонус)
 * @returns текст плитки
 */
export function formatDamageTileFormula(
  baseFormula: string,
  modifier = 0,
): string {
  const signed = modifier > 0 ? `+${modifier}` : `${modifier}`;

  if (baseFormula.length === 0) {
    return modifier === 0 ? DAMAGE_NO_CONSTANT_LABEL : signed;
  }

  return modifier === 0 ? baseFormula : `${baseFormula}${signed}`;
}

/**
 * Значок плитки урона. Место под значок одно: выбор (урон «или», тип на выбор)
 * важнее добавки — без него бросок не начать, а добавка придёт сама.
 *
 * @param hasVariants - у урона есть выбор
 * @param hasBonus - у урона есть добавка по условию
 * @returns значок либо `undefined`, если в плитке сказано всё
 */
export function resolveDamageStatIcon(
  hasVariants: boolean,
  hasBonus: boolean,
): string | undefined {
  if (hasVariants) {
    return DAMAGE_VARIANTS_STAT_ICON;
  }

  return hasBonus ? DAMAGE_BONUS_STAT_ICON : undefined;
}

/**
 * Подсказка и значок плитки урона источника: в плитке формула одна — урон,
 * который бросается всегда. Есть ли добавки по условию и тип на выбор, говорит
 * значок, а сами они — строки подсказки после основной.
 *
 * @param source - заклинание, оружие или действие
 * @param baseTooltip - основная подсказка плитки
 * @param getTypeLabel - название типа урона по ключу
 * @param conditionalFormulas - добавки по условию; нет — пусто
 * @returns подсказка и значок для плитки урона
 */
export function describeDamageVariantsStat(
  source: DamageTypeChoiceSource,
  baseTooltip: string,
  getTypeLabel: (typeKey: string) => string,
  conditionalFormulas: readonly string[] = [],
): Pick<SheetRowStat, 'tooltip' | 'icon'> {
  const typeChoiceLines = describeSourceDamageTypeChoices(source, getTypeLabel);
  const bonusLines = formatDamageBonusLines(conditionalFormulas);

  return {
    tooltip: [baseTooltip, ...bonusLines, ...typeChoiceLines].join(
      SHEET_ROW_TOOLTIP_LINE_BREAK,
    ),
    icon: resolveDamageStatIcon(
      typeChoiceLines.length > 0,
      bonusLines.length > 0,
    ),
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
