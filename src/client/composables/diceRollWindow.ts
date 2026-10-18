/**
 * Окно броска (`DiceRollModal`) — единственное место, откуда система его
 * открывает.
 *
 * Менеджер окон ядра узнаёт окно по ключу: `_modalKey`, иначе имя окна и `id`
 * из свойств. У окна броска без ключа ключ один на всё приложение — второй
 * вызов, пока первое окно открыто, свёрнуто или ещё закрывается, поднимал
 * ПРЕЖНЕЕ окно с прежними свойствами (оружие А под щелчком по оружию Б) и
 * возвращал `null`, а вызывающий тратил ход и ставил шаблон впустую. Здесь у
 * окна всегда свой ключ: случайный по умолчанию — каждое открытие получает
 * своё окно со своими свойствами; общий ключ передают только те, кому
 * повторное открытие должно поднимать уже открытое окно (инициатива
 * участника).
 *
 * Окна действий (оружие, заклинание, действие существа) открываются с ключом
 * источника: повторное действие того же источника той же сущности заменяет
 * своё прежнее окно новым, а не копит второе. Прежнее окно закрывается как
 * отменённое — его шаблон убирается, выбор снарядов сворачивается; окна
 * разных источников живут независимо.
 *
 * Ход и ресурсы действия (заряд, боеприпас) тратит бросок, а не открытие
 * окна: вызывающий отдаёт расход помощнику (`commit`), и тот зовёт его, когда
 * бросок подтверждён. Окно, закрытое без броска — крестиком или заменой, —
 * ничего не потратило, и возвращать нечего.
 */

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { generateId } from '@vtt/shared';

import { DICE_ROLL_MODAL_KEY_PREFIX } from '../ui/actor/constants';

/** Имя окна броска в менеджере окон ядра */
const DICE_ROLL_MODAL = 'DiceRollModal';

/** Свойство окна, в которое ложится обработчик закрытия */
const CLOSE_LISTENER_PROP = 'onUpdate:open';

/** Разделитель частей ключа источника */
const SOURCE_KEY_SEPARATOR = ':';

/** Чем действует сущность: от этого зависит, чьё окно заменяется */
export type RollSourceKind = 'weapon' | 'spell' | 'action';

/**
 * Проверка окна перед броском (`beforeRoll` окна): круг каста, тратится ли
 * ячейка и чья она. `false` — бросок не идёт, окно остаётся открытым
 */
export type RollValidator = (
  castLevel: number,
  consumeSlot: boolean,
  isPactSlot: boolean,
) => boolean;

/** Как открыть окно броска */
export interface DiceRollWindowOptions {
  /** Ключ окна; нет — новый на каждое открытие */
  modalKey?: string;
  /**
   * Источник действия ({@link buildRollSourceKey}): открытое окно того же
   * источника закрывается, новое встаёт на его место. Нет — окно ничьё не
   * заменяет
   */
  sourceKey?: string;
  /**
   * Обработчик закрытия окна: ложится в свойства окна. Его зовёт и само окно,
   * закрываясь, и менеджер окон, когда помощник закрывает окно ради замены
   * (`closeModal` с признаком `notify`, VTTG 0.9.642)
   */
  onClose?: (isOpen: boolean) => void;
  /** Проверка перед броском: выбор целей и снарядов ещё в силе */
  validateRoll?: RollValidator;
  /**
   * Бросок подтверждён — действие состоялось: вызывающий тратит ход и
   * ресурсы действия (заряд, боеприпас). Зовётся после проверки, один раз на
   * окно. `false` — тратить уже не из чего (заряд ушёл другим окном, ход
   * занят): вызывающий сам сказал почему, бросок не идёт, окно остаётся
   */
  commit?: () => boolean;
}

/** Окна действий по источнику: источник → id окна в менеджере окон */
const sourceWindows = new Map<string, string>();

/**
 * Ключ источника действия: то же оружие, заклинание или действие той же
 * сущности.
 *
 * @param entityId - кто действует
 * @param kind - чем действует
 * @param sourceId - id оружия или заклинания; у действия существа — раздел и
 *   название (своего id у действия нет)
 * @returns ключ источника
 */
export function buildRollSourceKey(
  entityId: string,
  kind: RollSourceKind,
  sourceId: string,
): string {
  return [entityId, kind, sourceId].join(SOURCE_KEY_SEPARATOR);
}

/**
 * Открытое окно источника, в котором ещё не бросили. Окно, которое бросило
 * или закрыто, из учёта выбывает: оно уже закрывается само.
 *
 * @param sourceKey - источник действия
 * @returns id окна источника либо `undefined`
 */
function findOpenSourceWindow(sourceKey: string): string | undefined {
  const modalId = sourceWindows.get(sourceKey);

  const modal =
    modalId === undefined ? undefined : useModalManager().getModal(modalId);

  if (modalId !== undefined && modal?.props.open === true) {
    return modalId;
  }

  sourceWindows.delete(sourceKey);

  return undefined;
}

/**
 * Закрывает открытое окно источника как отменённое: окно сворачивает своё
 * действие само (`onCancel` — шаблон области), а о закрытии открывшему
 * сообщает менеджер окон — зовёт обработчик `onUpdate:open` из свойств окна
 * (шаблон и выбор снарядов заклинания персонажа). Ход и заряд прежнее окно не
 * тратило — их тратит бросок, — поэтому заменяющее окно потратит их один раз,
 * когда бросят в нём.
 *
 * Зовётся перед тем, как действие начнёт собирать новое окно: выбор снарядов
 * у заклинаний один на приложение, и прежнее окно обязано отпустить его
 * раньше, чем его займёт новое.
 *
 * @param sourceKey - источник действия
 * @returns `true`, если окно было и закрыто: новое встаёт на его место
 */
export function closeRollWindow(sourceKey: string): boolean {
  const modalId = findOpenSourceWindow(sourceKey);

  if (modalId === undefined) {
    return false;
  }

  sourceWindows.delete(sourceKey);
  useModalManager().closeModal(modalId, { notify: true });

  return true;
}

/**
 * Свойство `beforeRoll` окна из проверки и расхода вызывающего: сперва
 * проверка, затем расход — один раз, даже если окно позовёт проверку снова.
 *
 * @param validateRoll - проверка перед броском
 * @param commit - расход хода и ресурсов действия
 * @returns проверка окна
 */
function buildBeforeRoll(
  validateRoll: RollValidator | undefined,
  commit: (() => boolean) | undefined,
): RollValidator {
  let committed = false;

  return (castLevel, consumeSlot, isPactSlot) => {
    if (validateRoll && !validateRoll(castLevel, consumeSlot, isPactSlot)) {
      return false;
    }

    if (commit && !committed) {
      committed = commit();

      return committed;
    }

    return true;
  };
}

/**
 * Открывает окно броска со своим ключом.
 *
 * Открытие окна ничего не тратит: ход, заряд и боеприпас вызывающий отдаёт в
 * `commit`, и они тратятся, когда бросок подтверждён. Размещённый до окна
 * шаблон при неудаче и отмене убирает вызывающий.
 *
 * @param props - свойства окна
 * @param options - ключ окна, источник действия и обработчик закрытия
 * @returns id окна; `null` — окно не открылось (окно с этим ключом уже есть,
 *   и менеджер поднял его)
 */
export function openDiceRollWindow(
  props: Record<string, unknown>,
  options: DiceRollWindowOptions = {},
): string | null {
  const { sourceKey, onClose, validateRoll, commit } = options;

  if (sourceKey !== undefined) {
    closeRollWindow(sourceKey);
  }

  const modalId = useModalManager().openModal(DICE_ROLL_MODAL, {
    ...props,
    ...(validateRoll || commit
      ? { beforeRoll: buildBeforeRoll(validateRoll, commit) }
      : {}),
    ...(onClose ? { [CLOSE_LISTENER_PROP]: onClose } : {}),
    _modalKey: options.modalKey ?? generateId(DICE_ROLL_MODAL_KEY_PREFIX),
  });

  if (modalId !== null && sourceKey !== undefined) {
    sourceWindows.set(sourceKey, modalId);
  }

  return modalId;
}
