/**
 * «Видит ли одно существо другое» и «на свету ли оно» — правило D&D поверх
 * фактов ядра.
 *
 * Ядро отдаёт только нейтральные факты о паре фишек (`SceneSightFacts`, VTTG
 * 0.9.700+): есть ли линия взгляда сквозь стены, попадает ли цель в сектор
 * обзора, сколько между фишками и насколько освещено место каждой. Правило
 * собирает система — здесь:
 *
 * - слепой (флаг `vision.blinded` либо выключенное зрение фишки) не видит
 *   никого;
 * - невидимого (флаг `vision.invisible`) не видит никто;
 * - стена или закрытая дверь на линии взгляда, цель вне сектора обзора или
 *   дальше дальности зрения фишки — не видит;
 * - видимая часть цели в темноте — видит, только если до цели дотягивается
 *   тёмное зрение (своё, от эффекта, предмета или умения).
 *
 * Чувства, которых у ядра нет (слепое и истинное зрение, чувство вибраций), в
 * правило не входят — п. 1 § «Чего не хватает для полноценного SDK».
 *
 * Фактов может не быть: старое ядро, сущность без фишки на сцене, фишки на
 * разных сценах. Тогда ответ — «неизвестно» (`undefined`), и правило, которое
 * его спросило, молчит: ни «вижу», ни «не вижу» не выполняются.
 *
 * @module system/dnd/sceneSight
 */

import type {
  SceneLightLevel,
  SceneSightFacts,
  SystemTriggerContext,
} from '@vtt/shared';

import type { EffectFlagKey } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { brighterLightLevel, TOKEN_VISION_RANGE_DEFAULT } from '@vtt/shared';

import { resolveActorStats } from './effectPipeline.js';
import { computeEntityVision } from './entityVision.js';
import { isTokenVisionEnabled, resolveTokenDarkvision } from './visionUtils.js';

/** Флаг «ослеплён»: носитель не видит никого */
const BLINDED_FLAG: EffectFlagKey = 'vision.blinded';

/**
 * Флаг преимущества атаки, которым записывается «цель не видит атакующего».
 * Отдельного флага у правила нет: это то же общее преимущество атаки, и с
 * помехой оно гасится так же.
 */
export const UNSEEN_ATTACKER_ADVANTAGE_FLAG: EffectFlagKey = 'attack.advantage';

/** Флаг «невидим»: носителя не видит никто */
const INVISIBLE_FLAG: EffectFlagKey = 'vision.invisible';

/** Чем существо смотрит: то, с чем сравниваются факты ядра */
export interface SightAbility {
  /** Зрение есть: не выключено настройкой фишки и существо не ослеплено */
  enabled: boolean;
  /** Дальность обычного зрения, фт; 0 — без ограничений */
  range: number;
  /** Дальность тёмного зрения, фт; 0 — тёмного зрения нет */
  darkvision: number;
}

/**
 * Чем существо смотрит: настройки зрения фишки и поправка правил (тёмное
 * зрение от эффекта, предмета, умения) — то же, что видит сцена.
 *
 * Считается без кэша по объекту сущности: сервер правит сущность на месте, и
 * кэш отдал бы зрение до правки.
 *
 * @param viewer - смотрящий
 * @returns зрение смотрящего
 */
export function resolveSightAbility(viewer: DnDSceneEntity): SightAbility {
  const byRules = computeEntityVision(viewer);

  const isEnabled = byRules?.enabled ?? isTokenVisionEnabled(viewer.token);

  return {
    enabled:
      isEnabled && !resolveActorStats(viewer).activeFlags.has(BLINDED_FLAG),
    // Не задана — та же дальность, с какой сцена рисует туман такой фишке
    range: viewer.token?.vision?.range ?? TOKEN_VISION_RANGE_DEFAULT,
    darkvision:
      byRules?.darkvisionUnits ?? resolveTokenDarkvision(viewer.token),
  };
}

/**
 * Видит ли смотрящий цель по фактам ядра — геометрия и свет, без состояний
 * цели.
 *
 * @param facts - факты ядра о паре фишек
 * @param ability - зрение смотрящего
 * @returns `true`, если цель видна
 */
export function canSeeByFacts(
  facts: SceneSightFacts,
  ability: SightAbility,
): boolean {
  if (!ability.enabled || !facts.lineOfSight || !facts.inVisionCone) {
    return false;
  }

  if (ability.range > 0 && facts.distance > ability.range) {
    return false;
  }

  return facts.seenLight !== 'dark' || facts.distance <= ability.darkvision;
}

/**
 * Невидимо ли существо: его не видит никто, как бы светло ни было.
 *
 * @param entity - существо
 * @returns `true` для невидимого
 */
export function isEntityInvisible(entity: DnDSceneEntity): boolean {
  return resolveActorStats(entity).activeFlags.has(INVISIBLE_FLAG);
}

/** Откуда правило берёт факты ядра и фишки сущностей */
export interface SceneSightSource {
  /** Факты ядра о паре фишек; `null` — фишки на сцене нет */
  getSightBetween: (
    viewerTokenId: string,
    targetTokenId: string,
  ) => SceneSightFacts | null;
  /** Фишки сущности на сцене; пусто — сущности на сцене нет */
  listTokenIds: (entity: DnDSceneEntity) => readonly string[];
}

/** Видимость и свет сцены для правил: ответы по сущностям, а не по фишкам */
export interface SceneSight {
  /**
   * Видит ли одно существо другое.
   *
   * @returns `undefined` — неизвестно: фактов нет
   */
  canSee: (
    viewer: DnDSceneEntity,
    target: DnDSceneEntity,
  ) => boolean | undefined;
  /**
   * Освещённость места существа.
   *
   * @returns `undefined` — неизвестно: фактов нет
   */
  lightOf: (entity: DnDSceneEntity) => SceneLightLevel | undefined;
}

/**
 * Факты ядра по всем парам фишек двух сущностей. Копий у существа на сцене
 * может быть несколько — у всех общий id.
 *
 * @param source - источник фактов
 * @param viewer - смотрящий
 * @param target - цель
 * @returns факты по каждой паре фишек, по которой ядро ответило
 */
function listSightFacts(
  source: SceneSightSource,
  viewer: DnDSceneEntity,
  target: DnDSceneEntity,
): SceneSightFacts[] {
  const targetTokenIds = source.listTokenIds(target);

  return source.listTokenIds(viewer).flatMap((viewerTokenId) =>
    targetTokenIds.flatMap((targetTokenId) => {
      const facts = source.getSightBetween(viewerTokenId, targetTokenId);

      return facts ? [facts] : [];
    }),
  );
}

/**
 * Собирает видимость и свет сцены для правил поверх источника фактов.
 *
 * У существа с несколькими копиями на сцене ответ — по лучшей паре: видит хоть
 * одна копия хоть одну копию цели — «видит»; освещённость — самой светлой
 * копии. Какая из копий действует, правила не знают.
 *
 * @param source - источник фактов; без него видимости нет
 * @returns видимость и свет либо `undefined`, если источника нет
 */
export function createSceneSight(
  source: SceneSightSource | undefined,
): SceneSight | undefined {
  if (!source) {
    return undefined;
  }

  return {
    canSee: (viewer, target) => {
      const facts = listSightFacts(source, viewer, target);

      if (facts.length === 0) {
        return undefined;
      }

      if (isEntityInvisible(target)) {
        return false;
      }

      const ability = resolveSightAbility(viewer);

      return facts.some((pairFacts) => canSeeByFacts(pairFacts, ability));
    },
    lightOf: (entity) => {
      const levels = listSightFacts(source, entity, entity).map(
        (facts) => facts.viewerLight,
      );

      return levels.length > 0 ? levels.reduce(brighterLightLevel) : undefined;
    },
  };
}

/**
 * Источник фактов на сервере: контекст срабатывания ядра. Фишку сущности
 * называет сцена вокруг неё (`getSceneSurroundings`).
 *
 * @param context - возможности ядра
 * @returns источник либо `undefined`: ядро старше 0.9.700 фактов не отдаёт
 */
export function createContextSightSource(
  context:
    | Pick<SystemTriggerContext, 'getSceneSurroundings' | 'getSightBetween'>
    | undefined,
): SceneSightSource | undefined {
  const getSightBetween = context?.getSightBetween;
  const getSceneSurroundings = context?.getSceneSurroundings;

  if (!getSightBetween || !getSceneSurroundings) {
    return undefined;
  }

  return {
    getSightBetween,
    listTokenIds: (entity) => {
      const token = getSceneSurroundings(entity)?.token;

      return token ? [token.id] : [];
    },
  };
}

/** Что видимость значит для броска атаки (D&D 2024, «Невидимые атакующие и цели») */
export interface AttackSight {
  /** Атакующий не видит цель — бросок с помехой */
  isTargetUnseen: boolean;
  /** Цель не видит атакующего — бросок с преимуществом */
  isAttackerUnseen: boolean;
}

/** Видимость ничего не меняет в броске: фактов нет либо обе стороны видят */
const NO_ATTACK_SIGHT: AttackSight = {
  isTargetUnseen: false,
  isAttackerUnseen: false,
};

/**
 * Что видимость значит для броска атаки по цели: атака по цели, которую не
 * видишь, — с помехой; атака по цели, которая не видит тебя, — с
 * преимуществом. Обе сразу гасят друг друга, как любые преимущество и помеха.
 *
 * Неизвестная видимость (нет сцены, нет фишки, старое ядро) броска не меняет.
 *
 * @param sight - видимость сцены; нет — фактов нет
 * @param attacker - атакующий
 * @param target - цель; нет — атака без цели
 * @returns что видимость добавляет броску
 */
export function resolveAttackSight(
  sight: SceneSight | undefined,
  attacker: DnDSceneEntity,
  target: DnDSceneEntity | undefined,
): AttackSight {
  if (!sight || !target || target.id === attacker.id) {
    return NO_ATTACK_SIGHT;
  }

  return {
    isTargetUnseen: sight.canSee(attacker, target) === false,
    isAttackerUnseen: sight.canSee(target, attacker) === false,
  };
}
