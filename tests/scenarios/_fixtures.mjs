import assert from 'node:assert/strict';

import { loadEngineBundle } from '../helpers/engineBundle.mjs';

/**
 * Общие заготовки каталога сценариев эффектов (`docs/EFFECT_SCENARIOS.md`).
 *
 * Сценарий проверяет эффект так, как его соберёт автор в окне: в нужном месте
 * окна не должно остаться неработающих полей, сводка читается, а движок делает
 * то, что написано в правилах. Движок — настоящий, вместе с ядром хоста.
 */

// Как в самих тестах: движок собирается один раз на файл, до сценариев
// eslint-disable-next-line antfu/no-top-level-await
export const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
  export { isPointInPolygon } from '@vtt/shared';
`);

/** Управляющий персонажем игрок */
export const PLAYER_ID = 'player';

/** Размер клетки сцены в пикселях */
export const CELL_SIZE = 100;

/** Футов в клетке */
export const FEET_PER_CELL = 5;

/** Настройки сетки сцены */
export const GRID = {
  type: 'fixed',
  cellSize: CELL_SIZE,
  scale: FEET_PER_CELL,
  color: '',
  visible: true,
};

/** Приоритет модификатора по умолчанию */
export const DEFAULT_PRIORITY = 20;

/**
 * Эффект в форме редактора.
 *
 * @param {string} id - идентификатор эффекта
 * @param {object} overrides - поля, отличные от умолчания
 * @returns {object} эффект
 */
export function createEffect(id, overrides = {}) {
  return {
    id,
    name: id,
    description: '',
    disabled: false,
    origin: 'manual',
    transfer: false,
    duration: { type: 'permanent' },
    changes: [],
    flags: [],
    ...overrides,
  };
}

/**
 * Строка модификатора.
 *
 * @param {string} key - что меняется
 * @param {string} value - значение
 * @param {object} overrides - режим, условие
 * @returns {object} строка
 */
export function change(key, value, overrides = {}) {
  return { key, mode: 'add', value, priority: DEFAULT_PRIORITY, ...overrides };
}

/**
 * Персонаж игрока.
 *
 * @param {object} overrides - поля, отличные от умолчания
 * @returns {object} персонаж
 */
export function createActor(overrides = {}) {
  return {
    ...structuredClone(engine.DEFAULT_ACTOR),
    id: 'actor_hero',
    name: 'Гримли',
    ownerIds: [PLAYER_ID],
    activeEffects: [],
    ...overrides,
  };
}

/**
 * Существо мастера.
 *
 * @param {object} overrides - поля, отличные от умолчания
 * @returns {object} существо
 */
export function createCreature(overrides = {}) {
  return {
    ...structuredClone(engine.DEFAULT_CREATURE),
    id: 'creature_wolf',
    name: 'Волк',
    activeEffects: [],
    ...overrides,
  };
}

/**
 * Токен сущности.
 *
 * @param {string} actorId - сущность
 * @param {number} column - колонка клетки
 * @param {number} row - ряд клетки
 * @param {object} overrides - диспозиция, масштаб
 * @returns {object} токен
 */
export function createToken(actorId, column, row, overrides = {}) {
  return {
    id: `token_${actorId}`,
    actorId,
    x: column * CELL_SIZE,
    y: row * CELL_SIZE,
    scale: 1,
    rotation: 0,
    ...overrides,
  };
}

/**
 * Зона сцены.
 *
 * @param {string} id - идентификатор
 * @param {object[]} effects - эффекты зоны
 * @param {object} overrides - точки, источник
 * @returns {object} зона
 */
export function createZone(id, effects, overrides = {}) {
  return {
    id,
    name: id,
    shape: 'polygon',
    points: [],
    color: '#000000',
    opacity: 0.3,
    aboveTokens: false,
    blocksVision: false,
    blocksLight: false,
    createdBy: 'gm',
    effects,
    ...overrides,
  };
}

/**
 * Запрос броска ядра, который тест завершает руками.
 *
 * @returns {{ requestRoll: Function, requests: object[], answer: Function }} двойник
 */
export function createRequestRoll() {
  const requests = [];
  const resolvers = [];

  return {
    requests,
    requestRoll: (options) => {
      requests.push(options);

      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    },
    answer: (outcome) => {
      const resolve = resolvers.shift();

      assert.ok(resolve, 'Нет висящего запроса');
      resolve(outcome);
    },
  };
}

/**
 * Выполняет функцию с подменённым генератором: броски кубов идут по списку.
 * Значение — доля [0, 1): 0.99 даёт максимум кости, 0 — единицу.
 *
 * @param {number[]} values - значения `Math.random` по порядку (последнее повторяется)
 * @param {Function} action - что выполнить
 * @returns {*} результат действия
 */
export function withRandom(values, action) {
  const originalRandom = Math.random;

  let index = 0;

  Math.random = () => {
    const value = values[Math.min(index, values.length - 1)];

    index += 1;

    return value;
  };

  try {
    return action();
  } finally {
    Math.random = originalRandom;
  }
}

/**
 * Уже известный исход спасброска эффекта.
 *
 * @param {boolean} passed - прошла ли цель
 * @param {object} overrides - характеристика, Сл
 * @returns {object} исход
 */
export function saveOutcome(passed, overrides = {}) {
  return {
    effectName: 'effect',
    ability: 'constitution',
    dc: 10,
    roll: passed ? 20 : 1,
    total: passed ? 20 : 1,
    passed,
    ...overrides,
  };
}

/**
 * Черта существа с эффектами.
 *
 * @param {string} name - название черты
 * @param {object[]} effects - эффекты черты
 * @returns {object} черта
 */
export function createTrait(name, effects) {
  return { name, description: [], activeEffects: effects };
}

/** Бросок кости на максимум */
export const MAX_ROLL = 0.999;

/** Бросок кости на единицу */
export const MIN_ROLL = 0;

/**
 * Эффект, собранный автором в месте окна: неработающих полей нет, сводка
 * читается. Возвращает сводку — тест сверяет её строкой.
 *
 * @param {object} effect - эффект
 * @param {string} context - место окна
 * @param {object} options - доступность зоны
 * @returns {string} сводка эффекта
 */
export function authoredScenario(effect, context, options = {}) {
  const layout = engine.resolveEffectFormLayout(context, effect, options);

  assert.deepEqual(
    engine.listInertEffectFields(effect, layout),
    [],
    `в месте «${context}» не должно быть неработающих полей`,
  );

  return engine.describeEffectScenario(effect, context);
}
