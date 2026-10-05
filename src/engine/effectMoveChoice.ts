/**
 * Выбор перемещения цели тем, кто применяет: «переместить цель на расстояние
 * до 10 футов к себе или от себя».
 *
 * Действие «Переместить» выполняет сервер и вопросов не задаёт, поэтому выбор
 * делается раньше — на столе у применившего, вместе с выбором варианта
 * эффекта: расстояние «до N» (`upTo`) и направление «к опоре или от неё»
 * (`kind: 'choose'`). Выбранное записывается в действие числом и видом, и
 * дальше оно обычное. Там, где спросить некого (срабатывание ауры, ход), выбор
 * не делается: «на выбор» толкает от опоры, «до N» — на все N.
 *
 * @module system/dnd/effectMoveChoice
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type {
  EffectTrigger,
  EffectTriggerMoveAction,
  EffectTriggerMoveKind,
} from './effectTriggerTypes.js';

/** Шаг выбора расстояния, фт: клетка сетки */
const MOVE_CHOICE_STEP_FEET = 5;

/** Больше вариантов одна плашка вопроса не вмещает (как у вопросов движка) */
const MAX_MOVE_CHOICE_OPTIONS = 12;

/** Ключ варианта «не двигать» */
export const MOVE_CHOICE_STAY_ID = 'stay';

/** Виды, из которых выбирают при `kind: 'choose'`: от опоры или к ней */
const CHOOSE_MOVE_KINDS: readonly EffectTriggerMoveKind[] = ['push', 'pull'];

/** Вид перемещения, когда спросить некого: «на выбор» толкает от опоры */
export const UNASKED_MOVE_KIND: EffectTriggerMoveKind = 'push';

/** Подписи вариантов выбора перемещения */
const MOVE_CHOICE_LABELS: Record<EffectTriggerMoveKind, string> = {
  push: 'От себя на ',
  pull: 'К себе на ',
  teleport: 'Перенести на ',
  bring: 'Перенести вплотную',
  choose: '',
};

/** Слова плашки выбора перемещения */
export const MOVE_CHOICE_PROMPT_LABELS = {
  question: 'Куда переместить цель?',
  stay: 'Не двигать',
  feet: ' фт',
} as const;

/** Вариант выбора: вид и расстояние */
export interface MoveChoiceOption {
  /** Ключ варианта */
  id: string;
  /** Подпись варианта */
  label: string;
  /** Вид перемещения; у «не двигать» его нет */
  kind?: EffectTriggerMoveKind;
  /** Расстояние, фт */
  distance?: number;
}

/** Действие «Переместить», о котором надо спросить применившего */
export interface MoveChoiceRequest {
  /** Эффект с действием */
  effectId: string;
  /** Срабатывание эффекта */
  triggerId: string;
  /** Номер действия в срабатывании */
  actionIndex: number;
  /** Имя эффекта — в заголовок плашки */
  effectName: string;
  /** Варианты, первый — «не двигать» */
  options: MoveChoiceOption[];
}

/**
 * Спрашивают ли о действии применившего: расстояние «до N» или направление «на
 * выбор».
 *
 * @param action - действие «Переместить»
 * @returns `true`, если у действия есть выбор
 */
export function moveActionNeedsChoice(
  action: EffectTriggerMoveAction,
): boolean {
  return action.kind === 'choose' || action.upTo === true;
}

/**
 * Расстояния на выбор: от клетки до N с шагом в клетку. Вариантов не больше,
 * чем вмещает плашка, — у дальних перемещений шаг крупнее.
 *
 * @param action - действие «Переместить»
 * @param kinds - сколько видов перемещения в выборе
 * @returns расстояния по возрастанию
 */
function listMoveDistances(
  action: EffectTriggerMoveAction,
  kinds: number,
): number[] {
  if (action.upTo !== true) {
    return [action.distance];
  }

  // Место под «не двигать» и под каждый вид перемещения
  const room = Math.max(
    1,
    Math.floor((MAX_MOVE_CHOICE_OPTIONS - 1) / Math.max(1, kinds)),
  );

  const steps = Math.ceil(action.distance / MOVE_CHOICE_STEP_FEET);
  const stride = Math.ceil(steps / room) * MOVE_CHOICE_STEP_FEET;
  const distances: number[] = [];

  for (let feet = stride; feet < action.distance; feet += stride) {
    distances.push(feet);
  }

  // Полное расстояние — всегда в выборе, даже если оно не кратно шагу
  return [...distances, action.distance];
}

/**
 * Варианты выбора для действия «Переместить».
 *
 * @param action - действие с выбором
 * @returns варианты: «не двигать» и по одному на вид и расстояние
 */
function listMoveOptions(action: EffectTriggerMoveAction): MoveChoiceOption[] {
  const kinds = action.kind === 'choose' ? CHOOSE_MOVE_KINDS : [action.kind];

  const moves = kinds.flatMap((kind) =>
    listMoveDistances(action, kinds.length).map(
      (distance): MoveChoiceOption => ({
        id: `${kind}:${distance}`,
        label: `${MOVE_CHOICE_LABELS[kind]}${distance}${MOVE_CHOICE_PROMPT_LABELS.feet}`,
        kind,
        distance,
      }),
    ),
  );

  return [
    { id: MOVE_CHOICE_STAY_ID, label: MOVE_CHOICE_PROMPT_LABELS.stay },
    ...moves,
  ];
}

/**
 * Действия «Переместить» эффектов, о которых надо спросить применившего.
 *
 * @param effects - эффекты заклинания, действия или применения
 * @returns вопросы по порядку эффектов
 */
export function listMoveChoices(
  effects: readonly ActiveEffect[],
): MoveChoiceRequest[] {
  return effects.flatMap((effect) =>
    effect.disabled
      ? []
      : (effect.triggers ?? []).flatMap((trigger) =>
          trigger.actions.flatMap((action, actionIndex) =>
            action.type === 'move' && moveActionNeedsChoice(action)
              ? [
                  {
                    effectId: effect.id,
                    triggerId: trigger.id,
                    actionIndex,
                    effectName: effect.name,
                    options: listMoveOptions(action),
                  },
                ]
              : [],
          ),
        ),
  );
}

/**
 * Срабатывание с выбранным перемещением: действие становится обычным, а при
 * «не двигать» — убирается.
 *
 * @param trigger - срабатывание
 * @param request - о каком действии спрашивали
 * @param option - что выбрали
 * @returns срабатывание с записанным выбором
 */
function stampTriggerMoveChoice(
  trigger: EffectTrigger,
  request: MoveChoiceRequest,
  option: MoveChoiceOption,
): EffectTrigger {
  if (trigger.id !== request.triggerId) {
    return trigger;
  }

  return {
    ...trigger,
    actions: trigger.actions.flatMap((action, actionIndex) => {
      if (actionIndex !== request.actionIndex || action.type !== 'move') {
        return [action];
      }

      if (option.kind === undefined || option.distance === undefined) {
        return [];
      }

      const { upTo: _upTo, ...rest } = action;

      return [{ ...rest, kind: option.kind, distance: option.distance }];
    }),
  };
}

/**
 * Эффекты с записанным выбором перемещения.
 *
 * @param effects - эффекты заклинания, действия или применения
 * @param request - о каком действии спрашивали
 * @param option - что выбрали
 * @returns эффекты, где действие стало обычным
 */
export function stampMoveChoice(
  effects: readonly ActiveEffect[],
  request: MoveChoiceRequest,
  option: MoveChoiceOption,
): ActiveEffect[] {
  return effects.map((effect) =>
    effect.id === request.effectId && effect.triggers
      ? {
          ...effect,
          triggers: effect.triggers.map((trigger) =>
            stampTriggerMoveChoice(trigger, request, option),
          ),
        }
      : effect,
  );
}
