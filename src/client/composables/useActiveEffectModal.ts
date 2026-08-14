import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';

/**
 * Открытие карточки просмотра активного эффекта.
 *
 * Живёт композаблом, а не строкой `openModal` на месте: строка эффекта есть в
 * карточке записи, на вкладке эффектов листа, в блоке существа и в карточке
 * действия — и ведёт она везде в одно и то же окно.
 */
export function useActiveEffectModal() {
  const { openModal } = useModalManager();

  /**
   * Открывает карточку эффекта (только просмотр).
   *
   * @param effect - активный эффект
   * @param ownerName - название записи-носителя: предмета, черты, действия.
   *   Показывается подзаголовком — по одному названию эффекта не видно, откуда
   *   он на листе взялся.
   */
  function openActiveEffectDetail(
    effect: ActiveEffect,
    ownerName?: string,
  ): void {
    openModal('ActiveEffectDetailModal', {
      // Ключ окна собирается вместе с носителем: один и тот же эффект живёт
      // копиями на разных записях (предмет скопировали вместе с эффектом), и по
      // одному id окно второй записи не открылось бы.
      _modalKey: ownerName ? `${ownerName}:${effect.id}` : effect.id,
      effect,
      ownerName,
    });
  }

  return { openActiveEffectDetail };
}
