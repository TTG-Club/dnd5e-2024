/**
 * Валидация и нормализация данных актёра D&D 5e (форма создания/редактирования).
 *
 * Логика системо-зависима (характеристики, ХП, опыт, границы `ABILITY_SCORE_*`),
 * поэтому живёт в системе D&D и вызывается Ядром через контракт `VttSystem`
 * (`validateActorData` / `normalizeActorData`), а не напрямую из клиентских сторов.
 *
 * На вход приходит ЧЕРНОВИК формы в нейтральной форме ядра: `system` там —
 * непрозрачная запись, заполненная наполовину. Поэтому каждое поле читается
 * как `unknown` и проверяется по отдельности: незаполненное поле черновика —
 * норма, а не повод отказать в проверке.
 *
 * @module system/dnd/actorValidation
 */

import type { BaseActor } from '@vtt/shared';

import { isRecord } from '@vtt/shared';

import {
  ABILITY_KEYS,
  ABILITY_SCORE_MAX,
  ABILITY_SCORE_MIN,
} from './consts.js';

/**
 * Читает раздел `system` черновика свободной записью.
 *
 * @param actor - частичные данные актёра
 * @returns раздел `system` либо `undefined`, если его нет
 */
function readSystem(
  actor: Partial<BaseActor>,
): Record<string, unknown> | undefined {
  return isRecord(actor.system) ? actor.system : undefined;
}

/**
 * Читает число из черновика: незаполненное поле формы даёт `undefined`, и это
 * не ошибка — проверять и зажимать в границы нечего.
 *
 * @param value - сырое значение поля
 * @returns число поля либо `undefined`
 */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Зажимает число в границы.
 *
 * @param value - исходное число
 * @param min - нижняя граница
 * @param max - верхняя граница
 * @returns число в границах
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Валидирует данные актора D&D 5e перед сохранением.
 *
 * @param actor - частичные данные актора
 * @throws Error если данные невалидны
 */
export function validateActorData(actor: Partial<BaseActor>): void {
  // Проверка имени
  if (actor.name !== undefined && actor.name.trim() === '') {
    throw new Error('Имя персонажа обязательно');
  }

  const system = readSystem(actor);

  if (!system) {
    return;
  }

  // Проверка характеристик (ability scores)
  const abilities = isRecord(system.abilities) ? system.abilities : undefined;

  if (abilities) {
    for (const ability of ABILITY_KEYS) {
      const value = readNumber(abilities[ability]);

      if (value !== undefined) {
        if (value < ABILITY_SCORE_MIN || value > ABILITY_SCORE_MAX) {
          throw new Error(
            `Значение характеристики должно быть от ${ABILITY_SCORE_MIN} до ${ABILITY_SCORE_MAX}`,
          );
        }
      }
    }
  }

  // Проверка здоровья
  const hitPoints = isRecord(system.hitPoints) ? system.hitPoints : undefined;

  if (hitPoints) {
    const current = readNumber(hitPoints.current);
    const max = readNumber(hitPoints.max);

    if (current !== undefined && current < 0) {
      throw new Error('Текущее здоровье не может быть отрицательным');
    }

    if (max !== undefined && max < 0) {
      throw new Error('Максимальное здоровье не может быть отрицательным');
    }

    if (current !== undefined && max !== undefined && current > max) {
      throw new Error('Текущее здоровье не может превышать максимальное');
    }
  }

  // Проверка опыта
  const experience = readNumber(system.experience);

  if (experience !== undefined && experience < 0) {
    throw new Error('Опыт не может быть отрицательным');
  }
}

/**
 * Нормализует характеристики черновика: значения вне границ зажимаются,
 * незаполненные и нечисловые остаются как есть — их правит не форма.
 *
 * @param value - сырое значение раздела `abilities`
 * @returns исправленный раздел либо `undefined`, если его нет
 */
function normalizeAbilities(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const abilities: Record<string, unknown> = { ...value };

  for (const ability of ABILITY_KEYS) {
    const score = readNumber(abilities[ability]);

    if (score !== undefined) {
      abilities[ability] = clamp(score, ABILITY_SCORE_MIN, ABILITY_SCORE_MAX);
    }
  }

  return abilities;
}

/**
 * Нормализует хиты черновика: отрицательные значения поднимаются до нуля, а
 * текущие хиты не превышают максимум.
 *
 * @param value - сырое значение раздела `hitPoints`
 * @returns исправленный раздел либо `undefined`, если его нет
 */
function normalizeHitPoints(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const hitPoints: Record<string, unknown> = { ...value };

  const current = readNumber(hitPoints.current);
  const max = readNumber(hitPoints.max);

  if (max !== undefined && max < 0) {
    hitPoints.max = 0;
  }

  if (current !== undefined) {
    const clampedMax = max !== undefined ? Math.max(max, 0) : undefined;

    hitPoints.current =
      clampedMax !== undefined
        ? clamp(current, 0, clampedMax)
        : Math.max(current, 0);
  }

  return hitPoints;
}

/**
 * Нормализует данные актора D&D 5e (исправляет некорректные значения).
 *
 * @param actor - частичные данные актора
 * @returns нормализованные данные актора
 */
export function normalizeActorData(
  actor: Partial<BaseActor>,
): Partial<BaseActor> {
  const normalized = { ...actor };
  const source = readSystem(normalized);

  if (!source) {
    return normalized;
  }

  const system: Record<string, unknown> = { ...source };

  const abilities = normalizeAbilities(system.abilities);

  if (abilities) {
    system.abilities = abilities;
  }

  const hitPoints = normalizeHitPoints(system.hitPoints);

  if (hitPoints) {
    system.hitPoints = hitPoints;
  }

  const experience = readNumber(system.experience);

  if (experience !== undefined && experience < 0) {
    system.experience = 0;
  }

  normalized.system = system;

  return normalized;
}
