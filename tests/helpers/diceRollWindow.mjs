import { loadHandler } from './sourceHandler.mjs';

/** Единственное место, откуда система открывает окно броска */
const DICE_ROLL_WINDOW_PATH = 'src/client/composables/diceRollWindow.ts';

/** Счётчик ключей окон в тестах: у каждого открытия свой */
let keyCounter = 0;

/** Менеджер окон того теста, который сейчас открывает окно */
let activeModalManager = () => ({ openModal: () => null });

// Настоящий помощник собирается один раз на модуль; менеджер окон
// подставляется на каждый вызов
// eslint-disable-next-line antfu/no-top-level-await
const openDiceRollWindow = await loadHandler(
  DICE_ROLL_WINDOW_PATH,
  'openDiceRollWindow',
  {
    useModalManager: () => activeModalManager(),
    DICE_ROLL_MODAL: 'DiceRollModal',
    DICE_ROLL_MODAL_KEY_PREFIX: 'dice-roll',
    generateId: (prefix) => `${prefix}-${(keyCounter += 1)}`,
    // Окна источников тесты входов не ведут: заменять нечего
    closeRollWindow: () => false,
    CLOSE_LISTENER_PROP: 'onUpdate:open',
    sourceWindows: new Map(),
  },
);

/**
 * Настоящий `openDiceRollWindow` поверх подменённого менеджера окон теста.
 * Заглушка `openModal`, которая ничего не возвращает, считается открывшимся
 * окном: так тесты, написанные до помощника, видят окно открытым.
 *
 * @param {() => { openModal: Function }} useModalManager - менеджер окон теста
 * @returns {(props: object, options?: object) => string | null} помощник
 */
export function bindOpenDiceRollWindow(useModalManager) {
  return (props, options) => {
    activeModalManager = () => ({
      openModal: (name, modalProps) => {
        const modalId = useModalManager().openModal(name, modalProps);

        return modalId === undefined ? modalProps._modalKey : modalId;
      },
    });

    return openDiceRollWindow(props, options);
  };
}
