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

import type { DnDActor } from './dndEntities.js';

import { isRecord } from '@vtt/shared';

import {
  ABILITY_KEYS,
  ABILITY_SCORE_MAX,
  ABILITY_SCORE_MIN,
} from './consts.js';
import { resolveMaxHitPointsDelta } from './effectPipeline.js';
import { isDndActorRecord } from './entityGuards.js';

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
 * Собирает из черновика ПОЛНЫЙ лист D&D — либо `undefined`, если он неполон.
 *
 * Строгость проверки (шесть характеристик и корневые коллекции) не
 * придирчивость: по этой записи считается прибавка эффектов к максимуму хитов,
 * а её дают в том числе предметы и черты из `equipment`/`features`. Половина
 * листа дала бы половину прибавки, и потолок вышел бы заниженным.
 *
 * Разбирается сырой записью (`isDndActorRecord`), а не сущностью сцены:
 * черновик ядро сущностью ещё не назвало, и выдать его за неё значило бы
 * соврать типу. `id` черновику при этом не нужен — при создании его выдаёт мир
 * уже после проверки, а расчёт эффектов на него не смотрит.
 *
 * @param draft - частичные данные актёра
 * @returns лист D&D, если черновик собран целиком
 */
function readCompleteActor(draft: Partial<BaseActor>): DnDActor | undefined {
  const candidate = { ...draft, id: draft.id ?? '' };

  return isDndActorRecord(candidate) ? candidate : undefined;
}

/**
 * Потолок текущих хитов черновика — запас листа С прибавкой активных эффектов
 * (`hitPoints.max`), тот же, по которому лечат и рисуют плитку хитов.
 *
 * `undefined` — «сверять не с чем»: черновик неполон, и прибавку эффектов по
 * нему не посчитать. Зажимать в таком случае по записи листа НЕЛЬЗЯ: у
 * персонажа с «Крепким» текущие хиты законно выше записанного максимума, а
 * частичные обновления приходят без эффектов (трата ячейки заклинания шлёт
 * только `system`) — и хиты срезались бы до запаса листа молча.
 *
 * Занизить потолок эффект тоже не может: берётся большее из записи и итога.
 * Проверка формы ловит бессмыслицу вроде «900 хитов при максимуме 20», а
 * правила потолка держит пайплайн — у него для этого есть весь лист.
 *
 * Расчёт обёрнут в `try`: сюда приходят записи старых миров, и споткнувшийся на
 * испорченном эффекте пайплайн не должен запирать сохранение листа — потолок
 * просто остаётся неизвестным, а поломка уходит в лог мира.
 *
 * @param draft - частичные данные актёра
 * @param max - записанный в черновике максимум хитов
 * @returns потолок текущих хитов либо `undefined`, если он неизвестен
 */
function resolveHitPointsCeiling(
  draft: Partial<BaseActor>,
  max: number,
): number | undefined {
  const actor = readCompleteActor(draft);

  if (!actor) {
    return undefined;
  }

  try {
    return Math.max(max, max + resolveMaxHitPointsDelta(actor));
  } catch (error) {
    console.warn(
      `[dnd5e] Лист «${actor.name}» (${actor.id}): максимум хитов с эффектами `
        + `не посчитался (${String(error)}) — текущие хиты `
        + 'не проверяются по потолку',
    );

    return undefined;
  }
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

    // Сверяем не с записью листа, а с потолком: эффект «Крепкого» поднимает
    // максимум поверх записанного, и вылеченный до показанного числа персонаж
    // не должен ловить отказ в сохранении.
    //
    // Потолок считается ТОЛЬКО когда запись уже превышена: считает его пайплайн
    // эффектов целиком, а обычному сохранению — с хитами в пределах записи —
    // он не нужен, там ответ известен и без него.
    if (current !== undefined && max !== undefined && current > max) {
      const ceiling = resolveHitPointsCeiling(actor, max);

      if (ceiling !== undefined && current > ceiling) {
        throw new Error('Текущее здоровье не может превышать максимальное');
      }
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
 * текущие хиты не превышают потолок (см. {@link resolveHitPointsCeiling}).
 *
 * Потолок неизвестен — текущие хиты только поднимаются с минуса, но НЕ
 * срезаются: обновление без эффектов на руках не может отличить законные 34
 * хита «Крепкого» от испорченных данных, а молчаливый срез стоил бы игроку
 * вылеченных хитов.
 *
 * @param value - сырое значение раздела `hitPoints`
 * @param draft - весь черновик: по нему считается потолок с эффектами
 * @returns исправленный раздел либо `undefined`, если его нет
 */
function normalizeHitPoints(
  value: unknown,
  draft: Partial<BaseActor>,
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
    const recordedMax = max === undefined ? undefined : Math.max(max, 0);

    // Потолок с эффектами поднимают только тем, кто уже выше записи листа:
    // остальных он всё равно не тронет, а стоит целого прохода пайплайна
    const ceiling =
      recordedMax !== undefined && current > recordedMax
        ? resolveHitPointsCeiling(draft, recordedMax)
        : recordedMax;

    hitPoints.current =
      ceiling !== undefined ? clamp(current, 0, ceiling) : Math.max(current, 0);
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

  const hitPoints = normalizeHitPoints(system.hitPoints, actor);

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
