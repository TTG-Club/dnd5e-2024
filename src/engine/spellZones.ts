/**
 * Зона заклинания на месте шаблона: срок по длительности заклинания и черновик
 * области для ядра (`custom-area:create-for-entity`).
 *
 * Ядро о заклинаниях не знает — ему уходит готовый полигон, эффекты и срок в
 * раундах. Всё, что зависит от заклинателя (Сл, модификаторы в формулах),
 * подставляется здесь: зона живёт на сцене без заклинателя под рукой.
 *
 * @module system/dnd/spellZones
 */

import type { EntityAreaDraft, MeasurementTemplate } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { Spell } from './dndEntities.js';
import type { FormulaContext } from './formulaParser.js';

import { ENTITY_AREA_MAX_ROUNDS, generateId } from '@vtt/shared';

import { stampSourceSaveDcs } from './effectAutomation.js';
import { upgradeStaySaveEffect } from './effectTriggers.js';
import { bindSourceEffectFormulas } from './sourceFormulaBinding.js';
import { getZoneSpellEffects } from './spellUtils.js';
import { templateToPolygon } from './templateGeometry.js';

/** Прозрачность заливки зоны заклинания */
export const SPELL_ZONE_OPACITY = 0.25;

/** Раундов в минуте */
const ROUNDS_PER_MINUTE = 10;

/** Раундов в часе */
const ROUNDS_PER_HOUR = 600;

/** Длина шестнадцатеричной записи цвета без решётки */
const HEX_COLOR_LENGTH = 6;

/**
 * Сколько живёт зона заклинания:
 * - `none` — зоны нет (мгновенное заклинание);
 * - `endless` — бессрочно, снимают вручную (сутки, особое, до рассеивания);
 * - `rounds` — столько раундов боя.
 */
export type SpellZoneLifetime =
  { kind: 'none' } | { kind: 'endless' } | { kind: 'rounds'; rounds: number };

/**
 * Срок зоны по длительности заклинания. Минута боя — 10 раундов, час — 600;
 * дольше потолка ядра — бессрочно.
 *
 * @param spell - заклинание
 * @returns срок зоны
 */
export function spellDurationToLifetime(
  spell: Pick<Spell, 'durationUnit' | 'durationValue'>,
): SpellZoneLifetime {
  const value = Math.max(1, Math.trunc(spell.durationValue || 1));

  const toRounds = (rounds: number): SpellZoneLifetime =>
    rounds > ENTITY_AREA_MAX_ROUNDS
      ? { kind: 'endless' }
      : { kind: 'rounds', rounds };

  switch (spell.durationUnit) {
    case 'instantaneous':
      return { kind: 'none' };
    case 'round':
      return toRounds(value);
    case 'minute':
      return toRounds(value * ROUNDS_PER_MINUTE);
    case 'hour':
      return toRounds(value * ROUNDS_PER_HOUR);
    default:
      return { kind: 'endless' };
  }
}

/**
 * Цвет шаблона (число) в цвет заливки зоны (`#rrggbb`).
 *
 * @param color - цвет шаблона
 * @returns hex-строка
 */
function templateColorToHex(color: number): string {
  const channel = Math.max(0, Math.trunc(color)) % 0x1000000;

  return `#${channel.toString(16).padStart(HEX_COLOR_LENGTH, '0')}`;
}

/**
 * Эффект зоны, готовый уйти на сцену: своя копия, Сл и формулы заклинателя
 * подставлены, помечен магическим. Эффект «пока в зоне» живёт, пока живёт
 * зона, — своя длительность у него обнулена.
 *
 * @param sourceEffect - эффект заклинания с доставкой «в зону»
 * @param options - заклинатель
 * @param options.casterId - заклинатель
 * @param options.saveDc - Сл заклинателя
 * @param options.formulaContext - формулы заклинателя (с `spellMod`)
 * @returns эффект зоны
 */
function buildZoneEffect(
  sourceEffect: ActiveEffect,
  options: { casterId: string; saveDc: number; formulaContext: FormulaContext },
): ActiveEffect {
  // Старый «пока в зоне» со спасброском уходит на сцену уже входом: так он
  // сохраняет свою длительность и не висит на стоящих в зоне без броска
  const effect = upgradeStaySaveEffect(sourceEffect);
  const isStay = (effect.areaTrigger ?? 'stay') === 'stay';

  const prepared: ActiveEffect = {
    ...effect,
    id: generateId('effect'),
    origin: 'spell',
    sourceActorId: options.casterId,
    magical: true,
    duration: isStay ? { type: 'permanent' } : { ...effect.duration },
  };

  return stampSourceSaveDcs(
    bindSourceEffectFormulas(prepared, options.formulaContext),
    options.saveDc,
  );
}

/** Что нужно, чтобы собрать зону заклинания */
export interface SpellZoneDraftInput {
  /** Заклинание */
  spell: Pick<
    Spell,
    | 'name'
    | 'activeEffects'
    | 'durationUnit'
    | 'durationValue'
    | 'concentration'
  >;
  /** Размещённый шаблон заклинания */
  template: MeasurementTemplate;
  /** Заклинатель */
  casterId: string;
  /** Сл спасброска заклинателя для этого заклинания */
  saveDc: number;
  /** Формулы заклинателя (`@mod.spell` уже в контексте) */
  formulaContext: FormulaContext;
  /** Размер клетки сцены в пикселях */
  gridSize: number;
  /** Каст с концентрацией: его конец снимет и зону */
  castId?: string;
}

/**
 * Черновик зоны заклинания для ядра. Зоны нет, если у заклинания нет эффектов
 * «в зону», оно мгновенное или шаблон вырожден.
 *
 * @param input - заклинание, шаблон и заклинатель
 * @returns черновик области либо `null`
 */
export function buildSpellZoneDraft(
  input: SpellZoneDraftInput,
): EntityAreaDraft | null {
  const zoneEffects = getZoneSpellEffects(input.spell);

  if (zoneEffects.length === 0) {
    return null;
  }

  const lifetime = spellDurationToLifetime(input.spell);

  if (lifetime.kind === 'none') {
    return null;
  }

  const points = templateToPolygon(input.template, input.gridSize);

  if (!points) {
    return null;
  }

  return {
    label: input.spell.name,
    name: input.spell.name,
    points,
    color: templateColorToHex(input.template.color),
    opacity: SPELL_ZONE_OPACITY,
    effects: zoneEffects.map((effect) =>
      buildZoneEffect(effect, {
        casterId: input.casterId,
        saveDc: input.saveDc,
        formulaContext: input.formulaContext,
      }),
    ),
    ...(input.spell.concentration ? { concentration: true } : {}),
    ...(input.castId ? { castId: input.castId } : {}),
    ...(lifetime.kind === 'rounds' ? { rounds: lifetime.rounds } : {}),
  };
}
