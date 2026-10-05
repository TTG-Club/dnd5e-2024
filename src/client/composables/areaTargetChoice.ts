/**
 * Цели области для разбора — одно место на всё, что ставит шаблон на карту:
 * заклинание с областью (персонажа и существа), действие существа с областью,
 * применение умения и предмета с областью, кнопка «При действии» с шаблоном.
 *
 * Кого накрыл шаблон и кого из них задеть, решает движок (`areaChoice.ts`):
 * мёртвых область не задевает, а правило эффекта `areaChoice` отсеивает и
 * просит применившего отметить цели («Замедление»: до шести существ на выбор
 * в кубе), а область, исходящая от применившего, его самого не задевает.
 * Здесь — только вопрос: плашка выбора цели, та же, что у срабатываний «по
 * выбору».
 */

import type { MeasurementTemplate, SceneEntity, Token } from '@vtt/shared';
import type {
  AreaSource,
  DnDSceneEntity,
  EffectAreaChoice,
  FormulaContext,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  areaOriginatesFromCaster,
  findAreaChoice,
  isDndSceneEntity,
  listAreaCandidates,
  planAreaTargets,
  resolveAreaCaster,
  settleAreaChoice,
  toChoiceCandidatePayload,
} from '@vtt/shared/system/dnd.js';

import { EFFECT_TARGET_PROMPT_MODAL } from '../ui/effect/constants';
import { resolveSpellCastLevel } from './spellCasts';
import { buildEntityFormulaContext } from './useResolvedStats';

/** Что нужно, чтобы решить, кого задела область */
export interface AreaTargetsInput {
  /**
   * Что применяют: название — в заголовок плашки, эффекты несут правило, а
   * по дальности видно, исходит ли область от применившего
   */
  source: AreaSource;
  /** Кто применяет */
  casterId: string | undefined;
  /** Размещённый шаблон */
  template: MeasurementTemplate;
  /** Фишки сцены */
  tokens: readonly Token[];
  /** Размер клетки, пикс. */
  gridSize: number;
  /** Сущности разбора */
  entities: readonly SceneEntity[];
}

/**
 * Числа применившего для предела формулой (`@castLevel`, `@mod.cha`). Считаются
 * только когда предел записан формулой.
 *
 * @param choice - правило выбора
 * @param caster - применивший
 * @param source - что применяют: по нему читается круг каста
 * @returns контекст формулы либо `undefined`
 */
function buildChoiceContext(
  choice: EffectAreaChoice | undefined,
  caster: SceneEntity | undefined,
  source: AreaTargetsInput['source'],
): FormulaContext | undefined {
  if (
    typeof choice?.count !== 'string'
    || !caster
    || !isDndSceneEntity(caster)
  ) {
    return undefined;
  }

  return {
    ...buildEntityFormulaContext(caster),
    castLevel: resolveSpellCastLevel(caster.id, source),
  };
}

/**
 * Решает, кого задела область, и отдаёт цели продолжению. Без правила выбора
 * и у правила «все» продолжение зовётся сразу; иначе — после ответа
 * применившего. Закрытая плашка — умолчание правила (`fallback`): никого либо
 * всех допущенных.
 *
 * @param input - источник, применивший, шаблон и сцена
 * @param proceed - разбор задетых целей
 */
export function resolveAreaTargets(
  input: AreaTargetsInput,
  proceed: (targets: DnDSceneEntity[]) => void,
): void {
  const candidates = listAreaCandidates(
    input.template,
    input.tokens,
    input.gridSize,
    input.entities,
  );

  const choice = findAreaChoice(input.source.activeEffects);

  const caster = input.casterId
    ? input.entities.find((entity) => entity.id === input.casterId)
    : undefined;

  const plan = planAreaTargets(
    candidates,
    choice,
    resolveAreaCaster(caster, input.tokens),
    {
      context: buildChoiceContext(choice, caster, input.source),
      originatesFromCaster: areaOriginatesFromCaster(input.source),
    },
  );

  if (plan.kind === 'settled') {
    proceed(plan.targets);

    return;
  }

  const { request } = plan;

  const modalId = useModalManager().openModal(EFFECT_TARGET_PROMPT_MODAL, {
    allowMultiple: true,
    candidates: toChoiceCandidatePayload(
      request.candidates.map((candidate) => candidate.entity),
    ),
    count: request.max,
    minCount: request.min,
    optional: request.min === 0,
    sourceName: input.source.name,
    onConfirm: (chosenIds: string[]) => {
      proceed(settleAreaChoice(request, chosenIds));
    },
    onCancel: () => {
      proceed(plan.fallbackTargets);
    },
  });

  // Плашка не открылась — спросить некого: действует умолчание правила
  if (modalId === null) {
    proceed(plan.fallbackTargets);
  }
}

/**
 * То же промисом — для разбора, который ждёт цели.
 *
 * @param input - источник, применивший, шаблон и сцена
 * @returns задетые цели
 */
export function chooseAreaTargets(
  input: AreaTargetsInput,
): Promise<DnDSceneEntity[]> {
  return new Promise((resolve) => {
    resolveAreaTargets(input, resolve);
  });
}
