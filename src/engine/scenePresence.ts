/**
 * Присутствие фишки на сцене: «Изгнание», уход на другой план, «исчезает до
 * конца хода».
 *
 * Правило записано флагом эффекта ({@link OFF_SCENE_FLAG}), а не парой действий
 * «убрать» и «вернуть»: пока на существе действует эффект с флагом, его фишки
 * на сцене нет; флаг пропал — фишка возвращается. Так возврат не зависит от
 * того, чем кончился эффект: вышел срок, прервалась концентрация, эффект
 * развеяли или сняли — сверке всё равно, она смотрит на итог.
 *
 * Убирает и возвращает фишку ядро (`SystemTriggerContext.takeTokenOffScene` /
 * `returnTokenToScene`, VTTG 0.9.664+): оно помнит место, прячет фишку от
 * игроков и держит существо в бою. Система только говорит, какой фишке где
 * быть. Без этих возможностей (старое ядро, клиент) сверка молчит — прятать
 * фишку сама система не вправе.
 *
 * @module system/dnd/scenePresence
 */

import type { SystemTriggerContext } from '@vtt/shared';

import type { ActiveEffect, EffectFlagKey } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { resolveActorStats } from './effectPipeline.js';

/** Флаг «убран со сцены»: пока действует, фишки носителя на сцене нет */
export const OFF_SCENE_FLAG: EffectFlagKey = 'scene.offScene';

/** Хвост строки в чат: фишка вернулась, но встать ей было некуда */
export const RETURN_OVERLAPPED_NOTE =
  'вернулся на сцену — свободного места рядом не нашлось, фишка стоит поверх другой';

/** Начало строки в чат: мастер вернул фишку, эффекты изгнания сняты */
export const RELEASED_BY_MASTER_NOTE = 'возвращён на сцену мастером, снято: ';

/** Возможности ядра, которыми сверка убирает и возвращает фишку */
export type ScenePresenceControls = Pick<
  SystemTriggerContext,
  | 'getSceneSurroundings'
  | 'takeTokenOffScene'
  | 'returnTokenToScene'
  | 'getOffSceneTokens'
>;

/**
 * Приводит фишку сущности в согласие с её эффектами: с флагом «убран со
 * сцены» — убирает, без флага — возвращает убранную.
 *
 * Вызывается после каждого срабатывания правил, которое могло наложить или
 * снять эффект. Повторный вызов безвреден: убранную фишку второй раз не
 * убирают, стоящую — не возвращают.
 *
 * @param entity - сущность, чьи эффекты только что могли измениться
 * @param controls - возможности ядра; без них сверка молчит
 * @returns строка в чат, если фишка вернулась поверх другой, иначе `null`
 */
export function reconcileScenePresence(
  entity: DnDSceneEntity,
  controls: ScenePresenceControls | undefined,
): string | null {
  if (!controls?.takeTokenOffScene || !controls.returnTokenToScene) {
    return null;
  }

  if (resolveActorStats(entity).activeFlags.has(OFF_SCENE_FLAG)) {
    const token = controls.getSceneSurroundings?.(entity)?.token;

    if (token) {
      controls.takeTokenOffScene(token.id);
    }

    return null;
  }

  const { returnTokenToScene } = controls;

  const overlapped = (controls.getOffSceneTokens?.(entity) ?? [])
    .map((token) => returnTokenToScene(token.id))
    .some((place) => place?.overlapped === true);

  return overlapped ? `${entity.name}: ${RETURN_OVERLAPPED_NOTE}` : null;
}

/**
 * Держит ли эффект фишку вне сцены: включён и несёт флаг «убран со сцены».
 *
 * @param effect - эффект сущности
 * @returns `true`, если из-за него фишки нет на сцене
 */
function keepsOffScene(effect: ActiveEffect): boolean {
  return !effect.disabled && effect.flags.includes(OFF_SCENE_FLAG);
}

/**
 * Снимает с сущности эффекты, которые держат её фишку вне сцены: мастер
 * возвращает фишку сам, и причина не должна убрать её снова.
 *
 * Снимаются только собственные эффекты сущности. Флаг, который даёт надетый
 * предмет или чужая аура, так не снять — он исчезнет вместе с источником.
 *
 * @param entity - сущность убранной фишки (мутируется)
 * @returns строка в чат со снятыми эффектами либо `null`, если снимать нечего
 */
export function releaseOffSceneEffects(entity: DnDSceneEntity): string | null {
  const effects = entity.activeEffects ?? [];
  const released = effects.filter(keepsOffScene);

  if (released.length === 0) {
    return null;
  }

  entity.activeEffects = effects.filter((effect) => !keepsOffScene(effect));

  const names = released.map((effect) => effect.name).join(', ');

  return `${entity.name}: ${RELEASED_BY_MASTER_NOTE}${names}`;
}
