/**
 * Шаблон области на карте ради выбора получателей: применение с областью
 * («выдох в конусе 30 футов») и кнопка «При действии» с шаблоном («Дыхание
 * дракона»). Шаблон ставит тот, кто нажал, а после выбора он снимается —
 * остаются накрытые им сущности и его форма (по ней ложится зона).
 *
 * @module system/dnd/client/areaTemplateTargets
 */

import type { MeasurementTemplate, SpellAreaOfEffect } from '@vtt/shared';

import type { AreaTargetsInput } from './areaTargetChoice';

import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useWorldStore } from '@/stores/worldStore';
import { resolveGridCellSize } from '@vtt/shared';

import { resolveAreaTargets } from './areaTargetChoice';
import { useWorldEntities } from './useWorldEntities';

/** Цвет шаблона выбора получателей: нейтральный, типа урона у него нет */
const AREA_TEMPLATE_COLOR = 0x8b5cf6;

/**
 * Ставит на карту шаблон области и отдаёт тех, кого он задел. Шаблон после
 * этого снимается: он нужен только для выбора получателей и места зоны.
 *
 * Кого задел шаблон, решает общее правило области (`resolveAreaTargets`):
 * мёртвых он не задевает, а правило `areaChoice` среди эффектов источника
 * отсеивает накрытых и просит применившего отметить получателей.
 *
 * @param area - форма и размер шаблона
 * @param originEntityId - от чьей фишки ставится шаблон
 * @param maxDistance - предел расстояния до точки шаблона; `null` — без предела
 * @param source - что применяют: название и эффекты с правилом выбора
 * @param proceed - продолжение: задетые сущности без повторов и сам шаблон
 */
export function placeAreaTemplate(
  area: SpellAreaOfEffect,
  originEntityId: string,
  maxDistance: number | null,
  source: AreaTargetsInput['source'],
  proceed: (targetIds: string[], template: MeasurementTemplate) => void,
): void {
  const templateStore = useSpellTemplateStore();

  templateStore.requestPlacement(
    area,
    AREA_TEMPLATE_COLOR,
    originEntityId,
    (templateId) => {
      // Данные шаблона забираются до его снятия: по ним считаются получатели
      const template = templateStore.getPlacedTemplate(templateId);

      templateStore.removePlacedTemplate(templateId);
      templateStore.deleteTemplate(templateId);

      const scene = useWorldStore().currentScene;

      if (!template || !scene) {
        return;
      }

      resolveAreaTargets(
        {
          source,
          casterId: originEntityId,
          template,
          tokens: scene.tokens ?? [],
          gridSize: resolveGridCellSize(scene.gridSettings),
          entities: useWorldEntities().getCurrentWorldEntities(),
        },
        (targets) => {
          proceed(
            targets.map((target) => target.id),
            template,
          );
        },
      );
    },
    maxDistance,
  );
}
