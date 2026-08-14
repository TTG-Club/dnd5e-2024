/**
 * Геометрия аур D&D 5e: кто кого достаёт и какие эффекты аура транслирует.
 *
 * Круг ауры считается от центра токена-источника: половина его размера плюс
 * радиус ауры; цель засчитывается по своему хитбоксу. Один и тот же тест
 * используют и клиентские ambient-ауры, и серверные разовые триггеры входа и
 * выхода — иначе клиент показывал бы ауру действующей там, где сервер её не
 * срабатывает.
 *
 * @module system/dnd/auraMath
 */

import type { GridSettings, Token } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isCreatureEntity } from '@vtt/shared';

import { itemEffectsActive } from './effectPipeline.js';

/** Размер клетки сетки в пикселях, когда сцена его не задала */
const DEFAULT_CELL_SIZE_PX = 50;

/** Сколько футов в клетке, когда сцена не задала масштаб */
const DEFAULT_FEET_PER_CELL = 5;

/**
 * Доля половины токена, которую занимает его хитбокс (TOKEN_HITBOX_SIZE ядра).
 * Квадратный хитбокс аппроксимируется кругом этого радиуса.
 */
const TOKEN_HITBOX_RATIO = 0.2;

/**
 * Отношение между токенами для вычисления аур.
 * В будущем можно усложнить логику (проверять disposition или user ownership).
 */
export type TokenDisposition = 'ally' | 'enemy' | 'neutral';

export interface AuraSourceToken {
  token: Token;
  effects: ActiveEffect[];
}

/**
 * Определяет относительное отношение между двумя токенами.
 *
 * @param source - токен-источник ауры
 * @param target - целевой токен
 * @returns союзник, враг или нейтральный
 */
export function getRelativeDisposition(
  source: Token,
  target: Token,
): TokenDisposition {
  const sourceDisposition = source.disposition ?? 'neutral';
  const targetDisposition = target.disposition ?? 'neutral';

  if (
    sourceDisposition === targetDisposition
    && sourceDisposition !== 'neutral'
  ) {
    return 'ally';
  }

  if (
    (sourceDisposition === 'friendly' && targetDisposition === 'hostile')
    || (sourceDisposition === 'hostile' && targetDisposition === 'friendly')
  ) {
    return 'enemy';
  }

  return 'neutral';
}

/**
 * Фильтрует активные эффекты, возвращая только те, которые имеют активную ауру.
 *
 * @param effects - список эффектов носителя (может отсутствовать)
 * @returns эффекты с ненулевым радиусом ауры, кроме отключённых
 */
export function getAuraEffects(effects?: ActiveEffect[]): ActiveEffect[] {
  if (!effects) {
    return [];
  }

  return effects.filter(
    (effect) => effect.aura && effect.aura.radius > 0 && !effect.disabled,
  );
}

/**
 * Собирает все аура-эффекты сущности из всех источников:
 * 1. Эффекты напрямую на сущности (`activeEffects`)
 * 2. Эффекты с работающих предметов (`itemEffectsActive`)
 * 3. Эффекты черт существа — там живут его постоянные ауры («Аура страха»)
 *
 * Набор источников тот же, что и у `collectActiveEffects`: иначе существо
 * применяло бы ауру черты к себе, но не транслировало бы её на других.
 *
 * @param entity - объект сущности (DnDSceneEntity)
 * @returns массив активных аура-эффектов
 */
export function collectAllAuraEffects(entity: DnDSceneEntity): ActiveEffect[] {
  const allEffects: ActiveEffect[] = [...getAuraEffects(entity.activeEffects)];

  if ('equipment' in entity && entity.equipment) {
    for (const item of entity.equipment) {
      if (!itemEffectsActive(item) || !item.activeEffects) {
        continue;
      }

      const itemAuras = getAuraEffects(item.activeEffects).filter(
        (auraEffect) => auraEffect.effectTarget !== 'target',
      );

      allEffects.push(...itemAuras);
    }
  }

  if (isCreatureEntity(entity)) {
    for (const trait of entity.system.traits ?? []) {
      allEffects.push(...getAuraEffects(trait.activeEffects));
    }
  }

  return allEffects;
}

/**
 * Вычисляет все внешние (Ambient) эффекты от аур, которые должны быть
 * наложены на указанный целевой токен в данный момент времени.
 *
 * Проверка попадания: аура действует на цель, когда центр цели
 * находится внутри круга ауры (евклидова дистанция).
 * Круг ауры: центр источника + радиус ауры + половина размера источника.
 *
 * @param targetToken - токен, для которого запрашиваем внешние ауры
 * @param sources - массив токенов-источников с их аура-эффектами
 * @param gridSettings - настройки координатной сетки сцены
 * @returns массив ActiveEffect (аур), которые достают до targetToken
 */
export function calculateAmbientAuras(
  targetToken: Token,
  sources: AuraSourceToken[],
  gridSettings: GridSettings,
): ActiveEffect[] {
  const ambientEffects: ActiveEffect[] = [];

  for (const source of sources) {
    if (source.effects.length === 0) {
      continue;
    }

    // Собственные ауры обрабатываются нативно в effectPipeline
    if (source.token.actorId === targetToken.actorId) {
      continue;
    }

    const disposition = getRelativeDisposition(source.token, targetToken);

    for (const effect of source.effects) {
      const aura = effect.aura;

      if (!aura || effect.disabled) {
        continue;
      }

      // enter/exit-ауры — разовые (обрабатываются авторитетно на сервере),
      // не транслируются как постоянные ambient-эффекты
      if (effect.areaTrigger === 'enter' || effect.areaTrigger === 'exit') {
        continue;
      }

      if (aura.target === 'allies' && disposition !== 'ally') {
        continue;
      }

      if (aura.target === 'enemies' && disposition !== 'enemy') {
        continue;
      }

      if (
        !isAuraReachingTarget(
          source.token,
          targetToken,
          aura.radius,
          gridSettings,
        )
      ) {
        continue;
      }

      ambientEffects.push({
        ...effect,
        id: `${effect.id}_aura_${source.token.id}`,
      });
    }
  }

  return ambientEffects;
}

/**
 * Достаёт ли круг ауры источника до целевого токена.
 *
 * Единственный тест попадания ауры в системе: радиус ауры + половина
 * токена-источника + хитбокс цели против евклидова расстояния между центрами.
 * Им пользуются и постоянные ambient-ауры, и разовые триггеры входа и выхода.
 *
 * @param sourceToken - токен-источник ауры
 * @param targetToken - целевой токен
 * @param auraRadiusFeet - радиус ауры в футах
 * @param gridSettings - настройки сетки сцены
 * @returns true, если цель в пределах ауры
 */
export function isAuraReachingTarget(
  sourceToken: Token,
  targetToken: Token,
  auraRadiusFeet: number,
  gridSettings: GridSettings,
): boolean {
  const cellSize = gridSettings.cellSize ?? DEFAULT_CELL_SIZE_PX;
  const distancePerCell = gridSettings.scale ?? DEFAULT_FEET_PER_CELL;

  const targetTokenSizePx = (targetToken.scale ?? 1) * cellSize;
  const targetCenterX = targetToken.x + targetTokenSizePx / 2;
  const targetCenterY = targetToken.y + targetTokenSizePx / 2;
  const targetHitboxRadiusPx = (targetTokenSizePx / 2) * TOKEN_HITBOX_RATIO;

  const sourceTokenSizePx = (sourceToken.scale ?? 1) * cellSize;
  const sourceCenterX = sourceToken.x + sourceTokenSizePx / 2;
  const sourceCenterY = sourceToken.y + sourceTokenSizePx / 2;

  const deltaXPx = targetCenterX - sourceCenterX;
  const deltaYPx = targetCenterY - sourceCenterY;

  const centerDistancePx = Math.sqrt(deltaXPx * deltaXPx + deltaYPx * deltaYPx);

  const auraRadiusPx = (auraRadiusFeet / distancePerCell) * cellSize;

  const totalReachPx =
    sourceTokenSizePx / 2 + auraRadiusPx + targetHitboxRadiusPx;

  return centerDistancePx <= totalReachPx;
}

/** Попадание триггер-ауры (enter/exit) источника на целевой токен */
export interface TriggerAuraHit {
  /** ID токена-источника ауры (для ключа членства) */
  sourceTokenId: string;
  /** Аура-эффект с триггером enter/exit */
  effect: ActiveEffect;
}

/**
 * Собирает enter/exit-ауры источников, достающие до целевого токена сейчас.
 * Применяет те же фильтры, что и ambient: пропуск собственных аур цели и фильтр
 * по отношению (`allies`/`enemies`/`all`). Используется сервером для определения
 * входа/выхода токена в радиус ауры (разовые триггеры).
 *
 * @param targetToken - целевой токен
 * @param sources - токены-источники с их аура-эффектами
 * @param gridSettings - настройки сетки сцены
 * @returns список попаданий триггер-аур на цель
 */
export function collectTriggerAurasForTarget(
  targetToken: Token,
  sources: AuraSourceToken[],
  gridSettings: GridSettings,
): TriggerAuraHit[] {
  const hits: TriggerAuraHit[] = [];

  for (const source of sources) {
    if (source.token.actorId === targetToken.actorId) {
      continue; // собственные ауры не триггерим
    }

    const disposition = getRelativeDisposition(source.token, targetToken);

    for (const effect of source.effects) {
      const aura = effect.aura;

      if (
        !aura
        || effect.disabled
        || (effect.areaTrigger !== 'enter' && effect.areaTrigger !== 'exit')
      ) {
        continue;
      }

      if (aura.target === 'allies' && disposition !== 'ally') {
        continue;
      }

      if (aura.target === 'enemies' && disposition !== 'enemy') {
        continue;
      }

      if (
        isAuraReachingTarget(
          source.token,
          targetToken,
          aura.radius,
          gridSettings,
        )
      ) {
        hits.push({ sourceTokenId: source.token.id, effect });
      }
    }
  }

  return hits;
}
