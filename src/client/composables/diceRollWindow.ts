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
   * Обработчик закрытия окна: помощник кладёт его в свойства окна и зовёт
   * сам, когда закрывает окно ради замены, — менеджер окон, закрывая окно
   * (`closeModal`), события окна не шлёт (README, § «Чего не хватает для
   * полноценного SDK», п. 36)
   */
  onClose?: (isOpen: boolean) => void;
}

/** Окно действия источника */
interface SourceWindow {
  /** id окна в менеджере окон */
  modalId: string;
  /** Обработчик закрытия, который ведёт вызывающий */
  onClose: ((isOpen: boolean) => void) | undefined;
}

/** Окна действий по источнику */
const sourceWindows = new Map<string, SourceWindow>();

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
 * @returns окно источника либо `undefined`
 */
function findOpenSourceWindow(sourceKey: string): SourceWindow | undefined {
  const sourceWindow = sourceWindows.get(sourceKey);

  const modal = sourceWindow
    ? useModalManager().getModal(sourceWindow.modalId)
    : undefined;

  if (sourceWindow && modal?.props.open === true) {
    return sourceWindow;
  }

  sourceWindows.delete(sourceKey);

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
  const sourceWindow = findOpenSourceWindow(sourceKey);

  if (!sourceWindow) {
    return false;
  }

  sourceWindows.delete(sourceKey);
  useModalManager().closeModal(sourceWindow.modalId);
  sourceWindow.onClose?.(false);

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
 * @param options - ключ окна, источник действия и обработчик закрытия
 * @returns id окна; `null` — окно не открылось (окно с этим ключом уже есть,
 *   и менеджер поднял его)
 */
export function openDiceRollWindow(
  props: Record<string, unknown>,
  options: DiceRollWindowOptions = {},
): string | null {
  const { sourceKey, onClose } = options;

  if (sourceKey !== undefined) {
    closeRollWindow(sourceKey);
  }

  const modalId = useModalManager().openModal(DICE_ROLL_MODAL, {
    ...props,
    ...(onClose ? { [CLOSE_LISTENER_PROP]: onClose } : {}),
    _modalKey: options.modalKey ?? generateId(DICE_ROLL_MODAL_KEY_PREFIX),
  });

  if (modalId !== null && sourceKey !== undefined) {
    sourceWindows.set(sourceKey, { modalId, onClose });
  }

  return modalId;
}
