import { loadHandler } from './sourceHandler.mjs';

/**
 * Настоящий разбор эффектов «на цель» клиента без приложения: функции берутся
 * из исходника, правила — из движка, мир и наложение — портами теста.
 */

const resolutionPath = 'src/client/composables/useTargetEffectResolution.ts';

/**
 * Загружает разбор эффектов цели.
 *
 * @param {object} engine - собранный движок системы
 * @param {object} ports - порты окружения поверх умолчаний: мир, подстановка
 *   чисел наложившего, штамп наложения, предупреждение
 * @returns {Promise<object>} функции разбора
 */
export async function loadTargetEffectResolution(engine, ports = {}) {
  const base = {
    // Мир без сущностей: наложившего и его типа нет
    useWorldEntities: () => ({
      findCurrentDndEntity: () => undefined,
      findEntityCreatureType: () => undefined,
    }),
    buildLandingContext: () => ({}),
    // Числа наложившего в фикстуре уже подставлены
    bindTargetEffectsToCaster: (effects) => [...effects],
    // У фикстур нет урона при наложении — бросать нечего
    rollEffectDamage: () => ({ damage: 0, outcome: 'normal', lines: [] }),
    stampEffectOnApply: (effect) => effect,
    resolveSpellCastId: () => undefined,
    resolveSpellCastLevel: () => 0,
    warnUnresolvedSaveDc: () => {},
    UNRESOLVED_SAVE_DC_LABELS: engine.UNRESOLVED_SAVE_DC_LABELS,
    findUnresolvedApplySaveDc: engine.findUnresolvedApplySaveDc,
    getTargetSpellEffects: engine.getTargetSpellEffects,
    isDndSceneEntity: engine.isDndSceneEntity,
    getEntityConditionImmunities: engine.getEntityConditionImmunities,
    resolveActorStats: engine.resolveActorStats,
    passesLandingCondition: engine.passesLandingCondition,
    resolveEffectApplication: engine.resolveEffectApplication,
    isMagicRoll: engine.isMagicRoll,
    isMagicalEffect: engine.isMagicalEffect,
    hasLastingEffectPayload: engine.hasLastingEffectPayload,
    isImmuneToCondition: engine.isImmuneToCondition,
    stampSourceTurnSaveDc: engine.stampSourceTurnSaveDc,
    ...ports,
  };

  /**
   * Функция разбора с теми же портами.
   *
   * @param {string} name - имя функции
   * @param {object} extra - уже загруженные функции разбора
   * @returns {Promise<Function>} функция
   */
  const load = (name, extra = {}) =>
    loadHandler(resolutionPath, name, { ...base, ...extra });

  const listEffectsWithOwnSave = await load('listEffectsWithOwnSave');
  const listLandingTargetEffects = await load('listLandingTargetEffects');

  const resolveTargetConditionImmunities = await load(
    'resolveTargetConditionImmunities',
  );

  const shared = {
    listEffectsWithOwnSave,
    listLandingTargetEffects,
    resolveTargetConditionImmunities,
  };

  return {
    listLandingEffectsWithOwnSave: await load(
      'listLandingEffectsWithOwnSave',
      shared,
    ),
    targetEffectsCanLand: await load('targetEffectsCanLand', shared),
    collectTargetEffects: await load('collectTargetEffects', shared),
  };
}
