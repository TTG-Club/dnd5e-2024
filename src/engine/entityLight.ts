/**
 * Свет от эффекта: носитель излучает свет, пока эффект действует.
 *
 * «Корона света», «Священное оружие», «Сияющая душа» аасимара, светящиеся
 * предметы: «носитель испускает яркий свет в радиусе 20 фт и тусклый ещё на
 * 20 фт». У эффекта это поле `light` (`EffectLight`), а итог носителя — самый
 * сильный свет из его действующих эффектов (своих, надетых предметов, черт
 * существа): свет не складывается, берётся наибольший — по дальнему краю
 * тусклого света, при равенстве по яркому.
 *
 * Отдаёт итог сцене хук системы `resolveEntityLight` — по образцу
 * `resolveEntityVision` (`entityVision.ts`): настройки света фишки система не
 * переписывает (их ставит ведущий), а дополняет их поверх. Свет фишки,
 * который светит не слабее эффекта, остаётся её: тогда ответ пустой.
 *
 * Ядро такой хук пока не зовёт — сцена берёт свет только из настроек фишки
 * (README § «Чего не хватает», п. 33). Система отдаёт готовый ответ, и
 * включится он без правок в системе, когда ядро начнёт спрашивать.
 *
 * Считается редко: ответ кэшируется по объекту сущности, а стор приложения
 * заменяет сущность новым объектом только при изменении — свет меняется
 * вместе с набором действующих эффектов, без лишних перерисовок.
 *
 * @module system/dnd/entityLight
 */

import type { EffectLight } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { collectActiveEffects } from './effectPipeline.js';

/** Цвет света эффекта без своего цвета — белый, как у пресета «Заклинание» */
export const DEFAULT_EFFECT_LIGHT_COLOR = '#ffffff';

/** Яркость света эффекта — как у пресета «Заклинание» ядра */
const EFFECT_LIGHT_INTENSITY = 0.8;

/** Свет во все стороны: у эффекта конуса нет */
const FULL_CIRCLE_DEGREES = 360;

/** Скорость и сила анимации света эффекта — умеренные, как у пресетов ядра */
const EFFECT_LIGHT_ANIMATION = { speed: 1, intensity: 0.3 } as const;

/**
 * Свет носителя в форме излучателя фишки ядра (`LightEmitter`): радиусы в
 * футах от края фишки, тусклый — до дальнего края.
 */
export interface DndEntityLight {
  enabled: true;
  /** Радиус яркого света, фт */
  brightRadius: number;
  /** Радиус тусклого света до дальнего края, фт */
  dimRadius: number;
  intensity: number;
  color: string;
  angle: number;
  rotation: number;
  animation?: {
    type: NonNullable<EffectLight['animation']>;
    speed: number;
    intensity: number;
  };
}

/**
 * Дальний край света эффекта: яркий и тусклый «ещё на».
 *
 * @param light - свет эффекта
 * @returns радиус тусклого света до дальнего края, фт
 */
function outerRadiusOf(light: EffectLight): number {
  return light.bright + light.dim;
}

/**
 * Самый сильный свет среди эффектов: по дальнему краю, при равенстве — по
 * яркому. Свет не складывается: два факела светят не дальше одного.
 *
 * @param lights - свет действующих эффектов
 * @returns самый сильный свет либо `undefined`, если света нет
 */
export function pickStrongestEffectLight(
  lights: readonly EffectLight[],
): EffectLight | undefined {
  return lights.reduce<EffectLight | undefined>((strongest, light) => {
    if (!strongest) {
      return light;
    }

    const outer = outerRadiusOf(light);
    const strongestOuter = outerRadiusOf(strongest);

    if (outer !== strongestOuter) {
      return outer > strongestOuter ? light : strongest;
    }

    return light.bright > strongest.bright ? light : strongest;
  }, undefined);
}

/**
 * Свет эффекта в форме излучателя фишки.
 *
 * @param light - свет эффекта
 * @returns излучатель
 */
export function toEntityLight(light: EffectLight): DndEntityLight {
  return {
    enabled: true,
    brightRadius: light.bright,
    dimRadius: outerRadiusOf(light),
    intensity: EFFECT_LIGHT_INTENSITY,
    color: light.color ?? DEFAULT_EFFECT_LIGHT_COLOR,
    angle: FULL_CIRCLE_DEGREES,
    rotation: 0,
    ...(light.animation && light.animation !== 'none'
      ? { animation: { type: light.animation, ...EFFECT_LIGHT_ANIMATION } }
      : {}),
  };
}

/** Кэш ответов по объекту сущности — см. описание модуля */
const lightCache = new WeakMap<DnDSceneEntity, DndEntityLight | undefined>();

/**
 * Дальний край света, который фишка излучает сама, по настройкам ведущего.
 *
 * @param entity - сущность
 * @returns радиус тусклого света фишки; 0 — фишка не светит
 */
function readTokenLightRadius(entity: DnDSceneEntity): number {
  const light = entity.token?.light;

  return light?.enabled ? Math.max(light.dimRadius, light.brightRadius) : 0;
}

/**
 * Считает свет сущности без кэша.
 *
 * @param entity - сущность
 * @returns свет от эффектов либо `undefined`, если он не сильнее своего
 */
function computeEntityLight(
  entity: DnDSceneEntity,
): DndEntityLight | undefined {
  const strongest = pickStrongestEffectLight(
    collectActiveEffects(entity).flatMap((effect) =>
      effect.light ? [effect.light] : [],
    ),
  );

  if (!strongest || outerRadiusOf(strongest) <= readTokenLightRadius(entity)) {
    return undefined;
  }

  return toEntityLight(strongest);
}

/**
 * Свет сущности по правилам D&D: самый сильный свет действующих эффектов
 * поверх света фишки.
 *
 * @param entity - сущность
 * @returns свет от эффектов либо `undefined`, если светить нечем сверх фишки
 */
export function resolveEntityLight(
  entity: DnDSceneEntity,
): DndEntityLight | undefined {
  if (lightCache.has(entity)) {
    return lightCache.get(entity);
  }

  const resolved = computeEntityLight(entity);

  lightCache.set(entity, resolved);

  return resolved;
}
