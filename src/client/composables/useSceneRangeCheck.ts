import type { DistanceUnit, Token } from '@vtt/shared';
import type { Spell } from '@vtt/shared/system/dnd.js';

import { resolveTokenScale } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { DISTANCE_UNIT_SHORT, getTokenEdgeDistance } from '@vtt/shared';
import { checkSpellRange, getSpellMaxRange } from '@vtt/shared/system/dnd.js';

import { OUT_OF_RANGE_LABELS } from '../ui/actor/constants';

/** Результат измерения дистанции между токенами на сцене */
export interface SceneTokenDistance {
  /** Округлённое расстояние между краями токенов (в единицах сцены) */
  distance: number;
  /** Единица измерения сцены */
  units: DistanceUnit;
  /** Короткая метка единицы измерения (для сообщений) */
  unitLabel: string;
}

/** Результат проверки дистанции каста заклинания */
export interface SpellRangeCheckResult {
  /** Разрешён ли каст по дистанции */
  allowed: boolean;
  /** Предел дистанции заклинания в единицах сцены (null — без ограничений) */
  maxRange: number | null;
  /** Расстояние до цели */
  distance: number;
  /** Метка единицы измерения */
  unitLabel: string;
}

/**
 * Измеряет расстояние между токеном атакующего актора и токеном-целью
 * на текущей сцене.
 *
 * Общая обвязка для проверок дистанции оружия (`dnd5eMacros.ts`),
 * действий существ (`useCreatureRangeCheck.ts`) и заклинаний.
 *
 * Токенов у атакующего может быть несколько: мастер ставит одно существо на
 * сцену несколько раз, и у всех копий общий id. Какая из них атакует, лист не
 * знает, поэтому мерить надо от ближайшей к цели. Раньше брался первый
 * попавшийся токен — атака «дальнего» гоблина давала помеху за дистанцию или
 * «цель вне досягаемости», хотя бил тот, что стоит рядом.
 *
 * Цель — единственная фишка самого атакующего: расстояние 0. Применение «на
 * цель» с дальностью допускает получателем самого применившего.
 *
 * @param attackerActorId - ID актора-атакующего (ищутся его токены)
 * @param targetTokenId - ID токена-цели
 * @returns расстояние и единицы измерения, либо null (нет сцены / токенов)
 */
export function measureTokenDistanceOnScene(
  attackerActorId: string,
  targetTokenId: string,
): SceneTokenDistance | null {
  const worldStore = useWorldStore();
  const scene = worldStore.currentScene;

  if (!scene?.tokens) {
    return null;
  }

  const targetToken = scene.tokens.find(
    (token: Token) => token.id === targetTokenId,
  );

  if (!targetToken) {
    return null;
  }

  const targetBounds = {
    ...targetToken,
    scale: resolveTokenScale(worldStore.currentWorld, targetToken),
  };

  // Сама цель в кандидаты не входит: гоблин может целиться в другую копию
  // того же существа, и тогда «ближайший» оказался бы самой целью
  const distances = scene.tokens
    .filter(
      (token: Token) =>
        token.actorId === attackerActorId && token.id !== targetTokenId,
    )
    .map((token: Token) =>
      getTokenEdgeDistance(
        {
          ...token,
          scale: resolveTokenScale(worldStore.currentWorld, token),
        },
        targetBounds,
        scene.gridSettings,
      ),
    );

  // Других фишек у атакующего нет, а цель — его собственная: до себя 0.
  // Иначе выбрать себя получателем (выпить своё зелье) было бы нельзя
  const isSelfTarget =
    distances.length === 0 && targetToken.actorId === attackerActorId;

  if (distances.length === 0 && !isSelfTarget) {
    return null;
  }

  const units = scene.gridSettings.units ?? 'ft';

  return {
    distance: isSelfTarget ? 0 : Math.round(Math.min(...distances)),
    units,
    unitLabel: DISTANCE_UNIT_SHORT[units] ?? units,
  };
}

/**
 * Проверяет дистанцию каста заклинания до токена-цели на текущей сцене.
 *
 * @param spell - заклинание
 * @param casterActorId - ID актора-заклинателя
 * @param targetTokenId - ID токена-цели
 * @returns результат проверки или null (нет сцены / токенов)
 */
export function checkSpellRangeOnScene(
  spell: Spell,
  casterActorId: string,
  targetTokenId: string,
): SpellRangeCheckResult | null {
  const measurement = measureTokenDistanceOnScene(casterActorId, targetTokenId);

  if (!measurement) {
    return null;
  }

  const rangeResult = checkSpellRange(
    spell,
    measurement.distance,
    measurement.units,
  );

  return {
    ...rangeResult,
    distance: measurement.distance,
    unitLabel: measurement.unitLabel,
  };
}

/**
 * Предел дистанции каста заклинания в единицах текущей сцены.
 *
 * Используется для ограничения точки размещения AoE-шаблона радиусом
 * дистанции каста от токена заклинателя.
 *
 * @param spell - заклинание
 * @returns предел дистанции в единицах сцены (null — без ограничения
 *   или нет открытой сцены)
 */
export function getSpellMaxRangeOnScene(spell: Spell): number | null {
  const scene = useWorldStore().currentScene;

  if (!scene) {
    return null;
  }

  return getSpellMaxRange(spell, scene.gridSettings.units ?? 'ft');
}

/**
 * Гейт по дистанции для конкретного токена-цели: если цель вне дистанции
 * заклинания — отправляет ⛔-сообщение в чат и блокирует действие.
 *
 * Используется и для одиночной цели (`isSpellCastBlockedByRange`),
 * и per-target при распределении снарядов (`projectileStore`).
 *
 * @param spell - заклинание
 * @param casterActorId - ID актора-заклинателя
 * @param targetTokenId - ID токена-цели
 * @returns true, если действие заблокировано (цель вне дистанции)
 */
export function isSpellTargetBlockedByRange(
  spell: Spell,
  casterActorId: string,
  targetTokenId: string,
): boolean {
  const rangeCheck = checkSpellRangeOnScene(
    spell,
    casterActorId,
    targetTokenId,
  );

  if (!rangeCheck || rangeCheck.allowed) {
    return false;
  }

  // Предел показываем явно, чтобы расстояние до цели не читалось как требование
  const maxRangeSuffix =
    rangeCheck.maxRange === null
      ? ''
      : `${OUT_OF_RANGE_LABELS.spellRangePrefix}${rangeCheck.maxRange} ${rangeCheck.unitLabel}`;

  useChatStore().sendMessage(
    `${OUT_OF_RANGE_LABELS.prefix}${spell.name}${OUT_OF_RANGE_LABELS.outOfSpellRange}${rangeCheck.distance} ${rangeCheck.unitLabel}${maxRangeSuffix}${OUT_OF_RANGE_LABELS.close}`,
    'text',
  );

  return true;
}

/**
 * Удар оружием или действие существа не достаёт до цели: строка в чат. Одна
 * на оба пути — вкладку снаряжения, лист существа и горячую панель.
 *
 * @param sourceName - чем бьют
 * @param measurement - расстояние до цели
 * @param measurement.distance - расстояние
 * @param measurement.unitLabel - единица
 */
export function announceOutOfReach(
  sourceName: string,
  measurement: { distance: number; unitLabel: string },
): void {
  useChatStore().sendMessage(
    `${OUT_OF_RANGE_LABELS.prefix}${sourceName}${OUT_OF_RANGE_LABELS.outOfReach}${measurement.distance} ${measurement.unitLabel}${OUT_OF_RANGE_LABELS.close}`,
    'text',
  );
}

/**
 * Гейт каста по дистанции: если выбрана цель и она вне дистанции заклинания —
 * отправляет ⛔-сообщение в чат и блокирует каст.
 *
 * Зеркалирует поведение оружейной атаки (`weapon-attack` в `dnd5eMacros.ts`):
 * без выбранной цели каст не блокируется. AoE-заклинания ограничиваются
 * точкой размещения шаблона, снаряды — per-target проверкой при назначении.
 *
 * @param spell - заклинание
 * @param casterActorId - ID актора-заклинателя
 * @returns true, если каст заблокирован (цель вне дистанции)
 */
export function isSpellCastBlockedByRange(
  spell: Spell,
  casterActorId: string,
): boolean {
  const targetStore = useTargetStore();

  if (!targetStore.targetTokenId) {
    return false;
  }

  return isSpellTargetBlockedByRange(
    spell,
    casterActorId,
    targetStore.targetTokenId,
  );
}
