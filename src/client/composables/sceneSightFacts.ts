import type { DnDSceneEntity, SceneSight } from '@vtt/shared/system/dnd.js';

import { useWorldStore } from '@/stores/worldStore';
import { getSightBetween } from '@/system-runtime/sceneSight';
import { createSceneSight } from '@vtt/shared/system/dnd.js';

/**
 * Видимость и свет открытой сцены для правил на клиенте.
 *
 * Факты даёт приложение (модуль хоста `@/system-runtime/sceneSight`, VTTG
 * 0.9.701+) — тем же расчётом, которым сервер отвечает правилам и которым
 * сцена решает, что показать игроку. Правило «видит» поверх фактов — общее с
 * сервером (`sceneSight.ts` движка).
 *
 * Фишки сущности ищутся на открытой сцене: копий у существа может быть
 * несколько, и какая из них действует, лист не знает — правило берёт лучшую
 * пару.
 *
 * @returns видимость и свет сцены; `undefined` — сцена не открыта
 */
export function resolveClientSceneSight(): SceneSight | undefined {
  const scene = useWorldStore().currentScene;

  if (!scene) {
    return undefined;
  }

  return createSceneSight({
    getSightBetween,
    listTokenIds: (entity: DnDSceneEntity) =>
      scene.tokens
        .filter((token) => token.actorId === entity.id)
        .map((token) => token.id),
  });
}
