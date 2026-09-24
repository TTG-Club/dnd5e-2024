import type { TokenSettings } from '@vtt/shared';

import {
  TOKEN_DARKVISION_DEFAULT,
  TOKEN_VISION_RANGE_DEFAULT,
} from '@/core/tokenConsts';
import { isTokenVisionEnabled } from '@vtt/shared/system/dnd.js';

import { TOKEN_VISION_ANGLE_DEFAULT } from './constants';

/** Настройки зрения фишки без пропусков */
export interface TokenVisionSettings {
  /** Зрение включено */
  enabled: boolean;
  /** Дальность обычного зрения, фт */
  range: number;
  /** Дальность тёмного зрения, фт; 0 — тёмного зрения нет */
  darkvision: number;
  /** Ширина сектора обзора, градусы */
  angle: number;
}

/**
 * Настройки зрения фишки для полей формы — так же, как их читает сцена
 * приложения: нет блока `vision` — это обычное зрение с умолчаниями (правило
 * движка `isTokenVisionEnabled`). Лист и окна настроек раньше читали пустой
 * блок как «зрение выключено»: шапка теряла обычное зрение, а сохранение
 * настроек записывало `enabled: false` и ослепляло фишку, которая до того
 * видела.
 *
 * @param token - настройки фишки сущности
 * @returns настройки зрения без пропусков
 */
export function readTokenVision(
  token: TokenSettings | undefined,
): TokenVisionSettings {
  const vision = token?.vision;

  return {
    enabled: isTokenVisionEnabled(token),
    range: vision?.range ?? TOKEN_VISION_RANGE_DEFAULT,
    darkvision: vision?.darkvision ?? TOKEN_DARKVISION_DEFAULT,
    angle: vision?.angle ?? TOKEN_VISION_ANGLE_DEFAULT,
  };
}
