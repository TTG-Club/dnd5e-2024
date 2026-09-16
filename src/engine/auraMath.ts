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

import type { GridSettings, SystemSceneSurroundings, Token } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { EffectTriggerArea } from './effectTriggerTypes.js';

import { isCreatureEntity } from '@vtt/shared';

import { isCarrierEffect, isEffectDormant } from './activeEffectTypes.js';
import { bindClassLevels } from './classEffectScope.js';
import {
  itemEffectsActive,
  resolveActorStats,
  resolveChangeValue,
} from './effectPipeline.js';
import { hasPresenceTriggers } from './effectTriggers.js';
import { DEFAULT_TRIGGER_AREA_TARGET } from './effectTriggerTypes.js';
import { isDndSceneEntity } from './entityGuards.js';
import { buildFormulaContext } from './formulaParser.js';
import {
  bindSourceEffectFormulas,
  effectUsesSourceFormulas,
} from './sourceFormulaBinding.js';

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

/**
 * Отношение фишки без настройки — «враждебный»: так ядро рисует её рамку, и так
 * по умолчанию стоит переключатель в настройках фишки листа.
 */
export const DEFAULT_TOKEN_DISPOSITION = 'hostile';

/**
 * Фишка с действующим отношением: у настроек фишки сущности
 * (`entity.token.disposition`) приоритет, затем поле фишки сцены, затем
 * «враждебный». У фишки сцены своё поле обычно пустое, а отношения аур,
 * «всем в радиусе» и «союзника рядом» сравнивают именно его. Правило то же, что
 * у ядра (`withTokenDisposition`), — своей копией, чтобы не требовать новое
 * ядро: старое отдаёт фишки как есть.
 *
 * @param token - фишка сцены
 * @param entity - сущность фишки, если известна
 * @returns та же фишка, если отношение совпало, иначе копия
 */
export function withResolvedDisposition(
  token: Token,
  entity: Pick<DnDSceneEntity, 'token'> | undefined,
): Token {
  const disposition =
    entity?.token?.disposition
    ?? token.disposition
    ?? DEFAULT_TOKEN_DISPOSITION;

  return disposition === token.disposition ? token : { ...token, disposition };
}

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
    (effect) =>
      effect.aura && effect.aura.radius > 0 && !isEffectDormant(effect),
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
        isCarrierEffect,
      );

      allEffects.push(...itemAuras);
    }
  }

  if (isCreatureEntity(entity)) {
    for (const trait of entity.system.traits ?? []) {
      allEffects.push(...getAuraEffects(trait.activeEffects));
    }
  }

  // Уровень класса подставляется по ИСТОЧНИКУ ауры: аура умения класса несёт
  // уровень того, кто её излучает, а не того, кто в неё попал
  const classBound = bindClassLevels(allEffects, entity);

  const shaped = shapeEntityAuras(classBound, entity);

  if (!shaped.some(effectUsesSourceFormulas)) {
    return shaped;
  }

  // Так же и прочие числа источника: «Аура защиты» даёт союзникам модификатор
  // Харизмы паладина, а пайплайн получателя прочёл бы в `@mod.cha` свою
  const sourceContext = buildFormulaContext(entity);

  return shaped.map((effect) =>
    bindSourceEffectFormulas(effect, sourceContext),
  );
}

/** Флаг недееспособности носителя */
const INCAPACITATED_FLAG = 'incapacitated';

/**
 * Ауры носителя в той форме, в какой они действуют сейчас: радиус формулой
 * посчитан от носителя (уровень класса уже подставлен), аура «пока
 * дееспособен» у недееспособного погашена.
 *
 * @param auras - ауры носителя
 * @param entity - носитель
 * @returns действующие ауры
 */
function shapeEntityAuras(
  auras: readonly ActiveEffect[],
  entity: DnDSceneEntity,
): ActiveEffect[] {
  const needsStats = auras.some((effect) => effect.aura?.whileCapable);

  const incapacitated =
    needsStats && resolveActorStats(entity).activeFlags.has(INCAPACITATED_FLAG);

  const needsFormulas = auras.some((effect) => effect.aura?.radiusFormula);
  const formulaContext = needsFormulas ? buildFormulaContext(entity) : null;

  return auras.flatMap((effect) => {
    const { aura } = effect;

    if (!aura) {
      return [effect];
    }

    if (aura.whileCapable && incapacitated) {
      return [];
    }

    if (!aura.radiusFormula || !formulaContext) {
      return [effect];
    }

    const radius = resolveChangeValue(aura.radiusFormula, formulaContext);

    return [
      {
        ...effect,
        aura: {
          ...aura,
          radius: radius === undefined ? aura.radius : Math.max(0, radius),
        },
      },
    ];
  });
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

      if (!aura || isEffectDormant(effect)) {
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

      // Наложивший копии — носитель ауры: по нему идут «ход наложившего» и
      // «до конца хода источника»
      ambientEffects.push({
        ...effect,
        id: buildAmbientAuraEffectId(effect, source.token.id),
        sourceActorId: source.token.actorId,
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

/**
 * Сущности в радиусе от фишки субъекта — получатели «всем в радиусе». Та же
 * геометрия и те же отношения, что у ауры: радиус от края фишки субъекта,
 * союзник — фишка того же действующего отношения.
 *
 * @param surroundings - сцена вокруг субъекта от ядра
 * @param area - радиус и отбор
 * @param subject - субъект: его настройки фишки задают отношение
 * @returns сущности без повторов (у сущности бывает несколько фишек)
 */
export function findEntitiesInArea(
  surroundings: SystemSceneSurroundings | null | undefined,
  area: EffectTriggerArea,
  subject?: DnDSceneEntity,
): DnDSceneEntity[] {
  if (!surroundings) {
    return [];
  }

  const target = area.target ?? DEFAULT_TRIGGER_AREA_TARGET;
  const found = new Map<string, DnDSceneEntity>();
  const subjectToken = withResolvedDisposition(surroundings.token, subject);

  for (const neighbor of surroundings.neighbors) {
    const { entity, token } = neighbor;

    if (found.has(entity.id) || !isDndSceneEntity(entity)) {
      continue;
    }

    const disposition = getRelativeDisposition(
      subjectToken,
      withResolvedDisposition(token, entity),
    );

    if (
      (target === 'allies' && disposition !== 'ally')
      || (target === 'enemies' && disposition !== 'enemy')
      || !isAuraReachingTarget(
        surroundings.token,
        token,
        area.radius,
        surroundings.gridSettings,
      )
    ) {
      continue;
    }

    found.set(entity.id, entity);
  }

  return [...found.values()];
}

/**
 * Id копии ауры на накрытом: у одной ауры с разных токенов копии разные, и
 * счётчики лимита у них свои.
 *
 * @param effect - аура источника
 * @param sourceTokenId - токен-источник
 * @returns id копии
 */
export function buildAmbientAuraEffectId(
  effect: Pick<ActiveEffect, 'id'>,
  sourceTokenId: string,
): string {
  return `${effect.id}_aura_${sourceTokenId}`;
}

/**
 * Будит ли аура вход и выход: разовый эффект старых полей (`areaTrigger`) или
 * явные срабатывания входа и выхода — у ауры «пока внутри» тоже («Духовные
 * стражи»: вход и начало хода).
 *
 * @param effect - аура
 * @returns `true`, если у ауры есть что делать на входе или выходе
 */
export function isTriggerAura(effect: ActiveEffect): boolean {
  return (
    effect.areaTrigger === 'enter'
    || effect.areaTrigger === 'exit'
    || hasPresenceTriggers(effect)
  );
}

/** Попадание триггер-ауры (enter/exit) источника на целевой токен */
export interface TriggerAuraHit {
  /** ID токена-источника ауры (для ключа членства) */
  sourceTokenId: string;
  /** Аура-эффект со входом или выходом; наложивший — носитель ауры */
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

      if (!aura || isEffectDormant(effect) || !isTriggerAura(effect)) {
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
        hits.push({
          sourceTokenId: source.token.id,
          effect: { ...effect, sourceActorId: source.token.actorId },
        });
      }
    }
  }

  return hits;
}
