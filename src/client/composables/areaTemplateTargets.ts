/**
 * Шаблон области на карте ради выбора получателей: применение с областью
 * («выдох в конусе 30 футов») и кнопка «При действии» с шаблоном («Дыхание
 * дракона»). Шаблон ставит тот, кто нажал, а после выбора он снимается —
 * остаются накрытые им сущности и его форма (по ней ложится зона).
 *
 * @module system/dnd/client/areaTemplateTargets
 */

import type { MeasurementTemplate, SpellAreaOfEffect } from '@vtt/shared';

import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useWorldStore } from '@/stores/worldStore';
import { resolveGridCellSize } from '@vtt/shared';
import { findTokensInTemplate } from '@vtt/shared/system/dnd.js';

/** Цвет шаблона выбора получателей: нейтральный, типа урона у него нет */
const AREA_TEMPLATE_COLOR = 0x8b5cf6;

/**
 * Ставит на карту шаблон области и отдаёт тех, кого он накрыл. Шаблон после
 * этого снимается: он нужен только для выбора получателей и места зоны.
 *
 * @param area - форма и размер шаблона
 * @param originEntityId - от чьей фишки ставится шаблон
 * @param maxDistance - предел расстояния до точки шаблона; `null` — без предела
 * @param proceed - продолжение: накрытые сущности без повторов и сам шаблон
 */
export function placeAreaTemplate(
  area: SpellAreaOfEffect,
  originEntityId: string,
  maxDistance: number | null,
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

      const targetIds = findTokensInTemplate(
        template,
        scene.tokens ?? [],
        resolveGridCellSize(scene.gridSettings),
      ).flatMap((token) => (token.actorId ? [token.actorId] : []));

      proceed([...new Set(targetIds)], template);
    },
    maxDistance,
  );
}
