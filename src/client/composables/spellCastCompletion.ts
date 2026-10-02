/**
 * Что происходит после применения заклинания, помимо урона и эффектов на цели:
 * эффекты на самом заклинателе (в том числе его аура), зона на месте шаблона и
 * конец прежней концентрации.
 *
 * Путей каста несколько (лист персонажа, горячая панель, заклинания существа),
 * и раньше каждый делал эту часть по-своему: у многочастного броска и у
 * существа эффекты на заклинателе не накладывались вовсе, а Сл 0 у ауры
 * бросалась против нуля. Здесь один способ на все пути.
 */

import type { AbilityType, MeasurementTemplate } from '@vtt/shared';
import type {
  ActiveEffect,
  DnDSceneEntity,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { resolveGridCellSize } from '@vtt/shared';
import {
  bindOwnerTokens,
  bindSourceEffectFormulas,
  bindWeaponSpellAbility,
  buildConcentrationEffect,
  buildFormulaContext,
  buildSpellZoneDraft,
  getCasterSpellEffects,
  listConcentrationCastIds,
  mergeAppliedEffects,
  passesLandingCondition,
  resolveEntityCreatureType,
  resolveSpellcastingAbility,
  stampSourceSaveDcs,
} from '@vtt/shared/system/dnd.js';

import { resolveCombatRound } from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import {
  requestEndCasts,
  resolveSpellCastId,
  resolveSpellCastLevel,
  waitForCastsEnded,
} from './spellCasts';
import {
  instantiateSpellEffects,
  postSpellEffectsMessage,
  stampEffectOnApply,
} from './spellResolutionShared';

/** Заклинатель как источник чисел эффекта */
export interface SpellCasterSource {
  /** Сл спасброска заклинателя для этого заклинания */
  saveDc: number;
  /** Модификатор заклинательной характеристики (`@mod.spell`) */
  spellMod?: number;
  /**
   * Заклинательная характеристика — для замены характеристики оружия
   * («Дубинка»). Нет — берётся по заклинанию и листу; блок заклинаний
   * существа называет свою, и её передают явно.
   */
  spellAbility?: AbilityType;
}

/** Приставка ключа каста (см. {@link SpellCastCompletionInput.castKey}) */
export const SPELL_CAST_KEY_PREFIX = 'cast';

/** Сколько применённых кастов помнить, чтобы не применить один дважды */
const COMPLETED_CAST_MEMORY = 200;

/** Ключи уже доведённых кастов (окно броска может позвать применение дважды) */
const completedCastKeys = new Set<string>();

/**
 * Эффекты заклинания на самого заклинателя, готовые лечь в `activeEffects`:
 * свои копии, числа и Сл заклинателя подставлены, точная длительность хода
 * привязана к нему. Аура на заклинателе живёт отдельно от каста, и Сл 0 в ней
 * иначе бросалась бы против нуля. У заклинания с концентрацией к ним
 * добавляется метка концентрации идущего каста.
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param source - Сл и модификатор заклинателя
 * @returns эффекты на заклинателя (может быть пусто)
 */
export function prepareCasterSpellEffects(
  spell: Spell,
  caster: DnDSceneEntity,
  source: SpellCasterSource,
): ActiveEffect[] {
  // Условие наложения на заклинателе: сам себе он и наложивший
  const casterEffects = getCasterSpellEffects(spell).filter((effect) =>
    passesLandingCondition(effect, caster, {
      source: caster,
      combatRound: resolveCombatRound(),
    }),
  );

  const castId = resolveSpellCastId(caster.id, spell);

  const concentration = castId
    ? [buildConcentrationEffect({ spell, casterId: caster.id, castId })]
    : [];

  if (casterEffects.length === 0) {
    return concentration;
  }

  const formulaContext = {
    ...buildFormulaContext(caster),
    spellMod: source.spellMod,
    spellSaveDc: source.saveDc,
    castLevel: resolveSpellCastLevel(caster.id, spell),
  };

  // Уровень класса — по id умения, пока новые id наложения его не стёрли
  const classBound = bindOwnerTokens(casterEffects, caster);

  const spellAbility =
    source.spellAbility ?? resolveSpellcastingAbility(caster, spell);

  const prepared = instantiateSpellEffects([...classBound]).map((effect) =>
    stampEffectOnApply(
      stampSourceSaveDcs(
        bindWeaponSpellAbility(
          bindSourceEffectFormulas(effect, formulaContext),
          spellAbility,
        ),
        source.saveDc,
      ),
      {
        carrierId: caster.id,
        sourceId: caster.id,
        castId,
        castLevel: resolveSpellCastLevel(caster.id, spell),
      },
    ),
  );

  return [...prepared, ...concentration];
}

/**
 * Накладывает эффекты заклинания на заклинателя боевым каналом и пишет об этом
 * в чат. Одноимённый эффект не стакается, а обновляется (правило PHB 2024).
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param source - Сл и модификатор заклинателя
 */
export function applyCasterSpellEffectsToEntity(
  spell: Spell,
  caster: DnDSceneEntity,
  source: SpellCasterSource,
): void {
  const prepared = prepareCasterSpellEffects(spell, caster, source);

  if (prepared.length === 0 || !landCasterEventEffects(caster, prepared)) {
    return;
  }

  postSpellEffectsMessage(spell.name, [caster.name], prepared);
}

/**
 * Кладёт готовые эффекты на заклинателя боевым снимком — единственный путь
 * эффектов заклинателя: событие наложения сервер видит только в снимке
 * («Связь с иным планом»: спасбросок, урон и состояние срабатывания), а
 * снимок несёт разницу и не возвращает эффекты прежнего каста, снятые
 * сервером. Сохранение листа после конца концентрации этого не умело: оно
 * писало сущность целиком.
 *
 * @param caster - заклинатель с текущими эффектами
 * @param effects - готовые эффекты «на себя»
 * @returns `true`, если снимок ушёл; нет эффектов или соединения — `false`
 */
export function landCasterEventEffects(
  caster: DnDSceneEntity,
  effects: readonly ActiveEffect[],
): boolean {
  if (effects.length === 0) {
    return false;
  }

  // Заклинатель перечитывается в момент записи; копия — живую запись стора
  // меняет только ответ сервера. Снимок несёт разницу: прежние эффекты,
  // снятые сервером концом прежнего каста, не возвращаются
  return (
    changeEntityCombatState(caster.id, (current) => ({
      ...current,
      activeEffects: mergeAppliedEffects(current.activeEffects ?? [], effects),
    })) !== null
  );
}

/**
 * Заканчивает прежнюю концентрацию заклинателя: новая концентрация
 * заканчивает старую. Касты с меткой заканчивает сервер — со всеми их
 * эффектами и зонами; зоны без каста (созданные до меток) снимаются здесь.
 *
 * @param caster - заклинатель
 * @param castId - идущий каст: его не трогать
 * @returns закончившиеся касты — их эффекты снимет ответ сервера
 */
export function releaseConcentration(
  caster: DnDSceneEntity,
  castId: string | undefined,
): string[] {
  const endedCastIds = listConcentrationCastIds(caster.activeEffects).filter(
    (previous) => previous !== castId,
  );

  requestEndCasts(caster.id, endedCastIds);

  const scene = useWorldStore().currentScene;
  const socket = useChatStore().getSocket();

  if (!scene || !socket) {
    return endedCastIds;
  }

  for (const area of scene.customAreas ?? []) {
    const areaSource = area.source;

    if (
      areaSource?.entityId === caster.id
      && areaSource.concentration
      && areaSource.castId === undefined
    ) {
      socket.emit('custom-area:delete', scene.id, area.id);
    }
  }

  return endedCastIds;
}

/**
 * Просит ядро оставить зону заклинания на месте шаблона. Без эффектов «в зону»,
 * мгновенного заклинания или шаблона — ничего.
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param source - Сл и модификатор заклинателя
 * @param template - размещённый шаблон
 * @returns `true`, если запрос ушёл
 */
export function requestSpellZone(
  spell: Spell,
  caster: DnDSceneEntity,
  source: SpellCasterSource,
  template: MeasurementTemplate | null | undefined,
): boolean {
  const scene = useWorldStore().currentScene;
  const socket = useChatStore().getSocket();

  if (!template || !scene || !socket) {
    return false;
  }

  const draft = buildSpellZoneDraft({
    spell,
    template,
    casterId: caster.id,
    casterCreatureType: resolveEntityCreatureType(caster),
    saveDc: source.saveDc,
    formulaContext: {
      ...buildFormulaContext(caster),
      spellMod: source.spellMod,
      castLevel: resolveSpellCastLevel(caster.id, spell),
    },
    gridSize: resolveGridCellSize(scene.gridSettings),
    castId: resolveSpellCastId(caster.id, spell),
  });

  if (!draft) {
    return false;
  }

  socket.emit('custom-area:create-for-entity', scene.id, caster.id, draft);

  return true;
}

/** Что нужно, чтобы довести каст до конца */
export interface SpellCastCompletionInput {
  /** Заклинание */
  spell: Spell;
  /** Заклинатель */
  caster: DnDSceneEntity;
  /** Сл и модификатор заклинателя */
  source: SpellCasterSource;
  /** Шаблон, если заклинание с областью */
  template?: MeasurementTemplate | null;
  /**
   * Ключ каста: окно броска может позвать применение и по попаданию, и по
   * частям урона — каст доводится один раз. Без ключа повтор не отсекается.
   */
  castKey?: string;
}

/**
 * Доводит применённое заклинание — строго в этом порядке: конец прежней
 * концентрации, эффекты на заклинателе (боевым снимком), зона на месте
 * шаблона. Эффекты на заклинателя готовятся и пишутся только здесь: путь
 * каста, записавший их сам сохранением листа, затирал метку концентрации
 * или возвращал эффекты прежнего каста.
 *
 * Ресурсы каста (ячейка, заряд) вызывающий пишет ДО этого вызова, а цели
 * разбирает ПОСЛЕ его промиса ({@link afterSpellCast}).
 *
 * @param input - заклинание, заклинатель и шаблон
 * @returns выполняется, когда сервер снял эффекты закончившихся кастов (или
 *   вышло время): окно спасброска цели не должно видеть эффект прежнего
 */
export function completeSpellCast(
  input: SpellCastCompletionInput,
): Promise<void> {
  const { spell, caster, source, template, castKey } = input;

  if (castKey !== undefined) {
    if (completedCastKeys.has(castKey)) {
      return Promise.resolve();
    }

    if (completedCastKeys.size >= COMPLETED_CAST_MEMORY) {
      completedCastKeys.clear();
    }

    completedCastKeys.add(castKey);
  }

  // Концентрация кончается до новой зоны (иначе снялась бы и она сама) и до
  // эффектов на заклинателе: среди них новая метка концентрации, а прежний
  // каст ищется по старой
  const endedCastIds = spell.concentration
    ? releaseConcentration(caster, resolveSpellCastId(caster.id, spell))
    : [];

  applyCasterSpellEffectsToEntity(spell, caster, source);
  requestSpellZone(spell, caster, source, template);

  return waitForCastsEnded(caster.id, endedCastIds);
}

/**
 * Продолжает каст после его доведения: разбор целей ждёт, пока сервер снимет
 * эффекты прежнего каста. Обработчики окна броска синхронные — ожидание
 * уходит сюда, а сбой продолжения пишется в консоль, а не теряется молча.
 *
 * @param completion - промис {@link completeSpellCast}
 * @param proceed - разбор целей каста
 */
export function afterSpellCast(
  completion: Promise<void>,
  proceed: () => void,
): void {
  completion.then(proceed).catch((error: unknown) => {
    console.error('[spellCast] разбор целей после каста не удался:', error);
  });
}
