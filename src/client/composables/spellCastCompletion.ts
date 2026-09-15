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

import type { MeasurementTemplate } from '@vtt/shared';
import type {
  ActiveEffect,
  DnDSceneEntity,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { resolveGridCellSize } from '@vtt/shared';
import {
  bindSourceEffectFormulas,
  buildFormulaContext,
  buildSpellZoneDraft,
  getCasterSpellEffects,
  mergeAppliedEffects,
  stampSourceSaveDcs,
} from '@vtt/shared/system/dnd.js';

import {
  formatSpellEffectsMessage,
  instantiateSpellEffects,
  stampEffectOnApply,
} from './spellResolutionShared';

/** Заклинатель как источник чисел эффекта */
export interface SpellCasterSource {
  /** Сл спасброска заклинателя для этого заклинания */
  saveDc: number;
  /** Модификатор заклинательной характеристики (`@mod.spell`) */
  spellMod?: number;
}

/** Приставка ключа каста (см. {@link SpellCastCompletionInput.castKey}) */
export const SPELL_CAST_KEY_PREFIX = 'cast';

/** Сл заклинаний существа, у которого не задано заклинательство */
export const DEFAULT_CREATURE_SPELL_SAVE_DC = 10;

/** Сколько применённых кастов помнить, чтобы не применить один дважды */
const COMPLETED_CAST_MEMORY = 200;

/** Ключи уже доведённых кастов (окно броска может позвать применение дважды) */
const completedCastKeys = new Set<string>();

/**
 * Эффекты заклинания на самого заклинателя, готовые лечь в `activeEffects`:
 * свои копии, числа и Сл заклинателя подставлены, точная длительность хода
 * привязана к нему. Аура на заклинателе живёт отдельно от каста, и Сл 0 в ней
 * иначе бросалась бы против нуля.
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
  const casterEffects = getCasterSpellEffects(spell);

  if (casterEffects.length === 0) {
    return [];
  }

  const formulaContext = {
    ...buildFormulaContext(caster),
    spellMod: source.spellMod,
  };

  return instantiateSpellEffects(casterEffects).map((effect) =>
    stampEffectOnApply(
      stampSourceSaveDcs(
        bindSourceEffectFormulas(effect, formulaContext),
        source.saveDc,
      ),
      { carrierId: caster.id, sourceId: caster.id },
    ),
  );
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
  const chatStore = useChatStore();
  const socket = chatStore.getSocket();

  if (prepared.length === 0 || !socket) {
    return;
  }

  // Клон: живую запись стора меняет только ответ сервера
  const updatedCaster: DnDSceneEntity = JSON.parse(JSON.stringify(caster));

  updatedCaster.activeEffects = mergeAppliedEffects(
    updatedCaster.activeEffects ?? [],
    prepared,
  );

  emitEntityCombatState(socket, updatedCaster);

  chatStore.sendMessage(
    formatSpellEffectsMessage(spell.name, [caster.name], prepared),
    'text',
  );
}

/**
 * Снимает зоны заклинателя, которые держатся его концентрацией: новая
 * концентрация заканчивает прежнюю.
 *
 * @param casterId - заклинатель
 */
export function releaseConcentrationZones(casterId: string): void {
  const scene = useWorldStore().currentScene;
  const socket = useChatStore().getSocket();

  if (!scene || !socket) {
    return;
  }

  for (const area of scene.customAreas ?? []) {
    if (area.source?.entityId === casterId && area.source.concentration) {
      socket.emit('custom-area:delete', scene.id, area.id);
    }
  }
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
    saveDc: source.saveDc,
    formulaContext: {
      ...buildFormulaContext(caster),
      spellMod: source.spellMod,
    },
    gridSize: resolveGridCellSize(scene.gridSettings),
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
   * Накладывать ли эффекты на заклинателя. Лист персонажа и каст без броска
   * пишут их вместе со своим обновлением сущности и передают `false`.
   */
  applyCasterEffects: boolean;
  /**
   * Ключ каста: окно броска может позвать применение и по попаданию, и по
   * частям урона — каст доводится один раз. Без ключа повтор не отсекается.
   */
  castKey?: string;
}

/**
 * Доводит применённое заклинание: конец прежней концентрации, эффекты на
 * заклинателе, зона на месте шаблона.
 *
 * @param input - заклинание, заклинатель и шаблон
 */
export function completeSpellCast(input: SpellCastCompletionInput): void {
  const { spell, caster, source, template, castKey } = input;

  if (castKey !== undefined) {
    if (completedCastKeys.has(castKey)) {
      return;
    }

    if (completedCastKeys.size >= COMPLETED_CAST_MEMORY) {
      completedCastKeys.clear();
    }

    completedCastKeys.add(castKey);
  }

  // Концентрация кончается до новой зоны: иначе снялась бы и она сама
  if (spell.concentration) {
    releaseConcentrationZones(caster.id);
  }

  if (input.applyCasterEffects) {
    applyCasterSpellEffectsToEntity(spell, caster, source);
  }

  requestSpellZone(spell, caster, source, template);
}
