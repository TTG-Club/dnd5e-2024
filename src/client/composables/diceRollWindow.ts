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
 */

import type { ModalInstance } from '@/shared_ui/composables/useModalManager';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { generateId } from '@vtt/shared';

import { DICE_ROLL_MODAL_KEY_PREFIX } from '../ui/actor/constants';

/** Имя окна броска в менеджере окон ядра */
const DICE_ROLL_MODAL = 'DiceRollModal';

/**
 * Обработчик закрытия окна в его свойствах. Менеджер окон, закрывая окно сам
 * (`closeModal`), события окна не шлёт — обработчик зовёт помощник
 */
const CLOSE_LISTENER_PROP = 'onUpdate:open';

/** Разделитель частей ключа источника */
const SOURCE_KEY_SEPARATOR = ':';

/** Чем действует сущность: от этого зависит, чьё окно заменяется */
export type RollSourceKind = 'weapon' | 'spell' | 'action';

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
}

/** Окна действий по источнику: id окна в менеджере окон */
const sourceWindowIds = new Map<string, string>();

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
 * Обработчик закрытия окна: функция от «открыто ли».
 *
 * @param value - свойство окна
 * @returns `true`, если это обработчик
 */
function isCloseListener(value: unknown): value is (isOpen: boolean) => void {
  return typeof value === 'function';
}

/**
 * Открытое окно источника, в котором ещё не бросили. Окно, которое бросило
 * или закрыто, из учёта выбывает: оно уже закрывается само.
 *
 * @param sourceKey - источник действия
 * @returns окно менеджера либо `undefined`
 */
function findOpenSourceWindow(sourceKey: string): ModalInstance | undefined {
  const modalId = sourceWindowIds.get(sourceKey);
  const modal = modalId ? useModalManager().getModal(modalId) : undefined;

  if (modal?.props.open === true) {
    return modal;
  }

  sourceWindowIds.delete(sourceKey);

  return undefined;
}

/**
 * Закрывает открытое окно источника как отменённое: окно сворачивает своё
 * действие само (`onCancel` — шаблон области), обработчик закрытия — то, что
 * вёл вызывающий (шаблон и выбор снарядов заклинания персонажа). Потраченное
 * прежним окном при открытии (ход, заряд) не возвращается — заменяющее окно
 * это второй раз не тратит: вызывающий узнаёт о замене по ответу.
 *
 * Зовётся перед тем, как действие начнёт собирать новое окно: выбор снарядов
 * у заклинаний один на приложение, и прежнее окно обязано отпустить его
 * раньше, чем его займёт новое.
 *
 * @param sourceKey - источник действия
 * @returns `true`, если окно было и закрыто: новое встаёт на его место
 */
export function closeRollWindow(sourceKey: string): boolean {
  const modal = findOpenSourceWindow(sourceKey);

  if (!modal) {
    return false;
  }

  const closeListener = modal.props[CLOSE_LISTENER_PROP];

  sourceWindowIds.delete(sourceKey);
  useModalManager().closeModal(modal.id);

  if (isCloseListener(closeListener)) {
    closeListener(false);
  }

  return true;
}

/**
 * Открывает окно броска со своим ключом.
 *
 * Всё, чего нельзя отменить (трата хода, списание, строка в чат), вызывающий
 * делает только после того, как окно открылось; размещённый до окна шаблон
 * при неудаче убирает.
 *
 * @param props - свойства окна
 * @param options - ключ окна и источник действия
 * @returns id окна; `null` — окно не открылось (окно с этим ключом уже есть,
 *   и менеджер поднял его)
 */
export function openDiceRollWindow(
  props: Record<string, unknown>,
  options: DiceRollWindowOptions = {},
): string | null {
  const { sourceKey } = options;

  if (sourceKey !== undefined) {
    closeRollWindow(sourceKey);
  }

  const modalId = useModalManager().openModal(DICE_ROLL_MODAL, {
    ...props,
    _modalKey: options.modalKey ?? generateId(DICE_ROLL_MODAL_KEY_PREFIX),
  });

  if (modalId !== null && sourceKey !== undefined) {
    sourceWindowIds.set(sourceKey, modalId);
  }

  return modalId;
}
