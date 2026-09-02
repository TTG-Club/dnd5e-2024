/**
 * Труднопроходимая местность D&D 5e: во сколько раз дороже обходится клетка под
 * пользовательской зоной и кто на это не смотрит.
 *
 * Правило задаётся обычной строкой модификатора эффекта зоны с ключом
 * `terrain.movementCost` — отдельного поля у зоны нет намеренно: мастер лепит
 * болото тем же редактором эффектов, каким вешает урон и статусы.
 *
 * Логика системо-зависима (модель `ActiveEffect`), поэтому живёт здесь. Ядро
 * зовёт её через контракт `VttSystem` (`getAreaMovementCost` /
 * `entityIgnoresTerrainCost`) и знает только про число-множитель.
 */

import type { CustomArea } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isDnDEffect } from './activeEffectTypes.js';
import { collectActiveEffects } from './effectPipeline.js';

/** Ключ строки модификатора, задающей цену клетки внутри зоны. */
const TERRAIN_COST_KEY = 'terrain.movementCost';

/** Флаг сущности, для которой труднопроходимости не существует. */
const IGNORE_TERRAIN_FLAG = 'terrain.ignoreDifficult';

/** Цена обычной земли: зона без правил ничего не меняет. */
const NEUTRAL_COST = 1;

/**
 * Нижняя граница цены.
 *
 * Ноль и отрицательные значения означали бы «перемещение бесплатно» — с ними
 * маршрут любой длины укладывается в любой запас хода, а поиск пути перестаёт
 * сходиться. Дешевле этого «дорога» не бывает.
 */
const MIN_COST = 0.1;

/**
 * Применяет одну строку модификатора к накопленной цене.
 *
 * Режимы читаются буквально: «Заменить» задаёт цену, «Умножить» множит уже
 * накопленную, «Прибавить» прибавляет. Остальные режимы (`upgrade`/`downgrade`/
 * `custom`) для множителя смысла не имеют и пропускаются.
 *
 * @param cost - накопленная цена
 * @param change - строка модификатора
 * @returns новая цена
 */
function applyChange(cost: number, change: ActiveEffect['changes'][number]) {
  const value = Number.parseFloat(change.value);

  // Формула с @-переменными считается от актёра, а цена клетки принадлежит
  // зоне: считать её не от кого. Такая строка молча пропускается.
  if (!Number.isFinite(value)) {
    return cost;
  }

  switch (change.mode) {
    case 'override': {
      return value;
    }
    case 'multiply': {
      return cost * value;
    }
    case 'add': {
      return cost + value;
    }
    default: {
      return cost;
    }
  }
}

/**
 * Множитель цены клетки внутри зоны.
 *
 * @param area - пользовательская зона сцены
 * @returns множитель; `1` — зона на перемещение не влияет
 */
export function resolveAreaTerrainCost(area: CustomArea): number {
  const effects = area.effects;

  if (!effects || effects.length === 0) {
    return NEUTRAL_COST;
  }

  let cost = NEUTRAL_COST;
  let found = false;

  for (const effect of effects.filter(isDnDEffect)) {
    if (effect.disabled) {
      continue;
    }

    for (const change of effect.changes ?? []) {
      if (change.key !== TERRAIN_COST_KEY) {
        continue;
      }

      cost = applyChange(cost, change);
      found = true;
    }
  }

  return found ? Math.max(MIN_COST, cost) : NEUTRAL_COST;
}

/**
 * Игнорирует ли сущность труднопроходимую местность.
 *
 * @param entity - сущность токена
 * @returns `true`, если множители зон к её маршруту не применяются
 */
export function entityIgnoresTerrainCost(entity: DnDSceneEntity): boolean {
  return collectActiveEffects(entity).some((effect) =>
    effect.flags?.includes(IGNORE_TERRAIN_FLAG),
  );
}
