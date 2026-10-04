import { loadHandler } from './sourceHandler.mjs';

/** Единственное место, откуда система открывает окно броска */
const DICE_ROLL_WINDOW_PATH = 'src/client/composables/diceRollWindow.ts';

/** Окно броска */
const DICE_ROLL_MODAL_PATH = 'src/client/ui/actor/DiceRollModal.vue';

/** Счётчик ключей окон в тестах: у каждого открытия свой */
let keyCounter = 0;

/** Менеджер окон того теста, который сейчас открывает окно */
let activeModalManager = () => ({ openModal: () => null });

// Проверка и расход перед броском — настоящие: окно получает `beforeRoll`
// eslint-disable-next-line antfu/no-top-level-await
const buildBeforeRoll = await loadHandler(
  DICE_ROLL_WINDOW_PATH,
  'buildBeforeRoll',
  {},
);

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
    buildBeforeRoll,
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

/**
 * Настоящий `performRoll` окна броска вместе с настоящей защитой от повторного
 * броска (`claimRoll`, `isRollAllowed`). Порты — окружение окна; отметку
 * «бросок пошёл» (`hasRolled`) помощник заводит сам, если тест её не дал.
 *
 * @param {object} ports - окружение окна: свойства, состояние, заглушки
 * @returns {Promise<() => void>} бросок окна
 */
export async function loadPerformRoll(ports) {
  ports.hasRolled ??= { value: false };

  for (const name of ['claimRoll', 'isRollAllowed']) {
    ports[name] = await loadHandler(DICE_ROLL_MODAL_PATH, name, ports);
  }

  return loadHandler(DICE_ROLL_MODAL_PATH, 'performRoll', ports);
}
