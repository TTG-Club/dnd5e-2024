/**
 * Запись СОСТОЯНИЯ в мире: разбор строки «Мастерской» в определение состояния и
 * обратная сборка записи из формы.
 *
 * Состояние хранится обычной записью мира (`items.type = 'condition'`):
 * оформление — в обобщённых колонках (`name`/`name_en`/`description`/`image`),
 * эффект — в `active_effects[0]`, ключ и мелочи вида значка — в `system_data`.
 * Своей таблицы не заводим: у записи мира уже есть и права, и рассылка по WS, и
 * копирование между мирами.
 *
 * @module engine/conditionRecord
 */

import type { BaseGameItem } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { ConditionRef } from './conditionKeys.js';
import type { WorldConditionDefinition } from './conditionRegistry.js';
import type { DnDGameItem } from './dndEntities.js';

import { z } from 'zod';

import { generateId, isRecord } from '@vtt/shared';

import { ActiveEffectSchema } from './activeEffectTypes.js';
import {
  buildConditionActiveEffect,
  getRuntimeCondition,
} from './conditionTemplates.js';
import { slugify } from './slugify.js';

/** Тип записи мира, которой хранится состояние. */
export const CONDITION_ITEM_TYPE = 'condition';

/**
 * Системные данные записи состояния: то, чему нет обобщённой колонки.
 *
 * `conditionKey` чеканится ОДИН раз при создании и при переименовании не
 * меняется: по нему эффект на актёре опознаёт своё состояние, и смена ключа
 * оборвала бы эту связь у всех, на ком состояние уже висит.
 */
const ConditionSystemDataSchema = z.object({
  conditionKey: z.string().min(1),
  icon: z.string().min(1).optional(),
  overlay: z.boolean().optional(),
});

/** Системные данные записи состояния. */
export type ConditionSystemData = z.infer<typeof ConditionSystemDataSchema>;

/**
 * Читает системные данные записи состояния.
 *
 * @param item - запись мира или пресет системы
 * @returns системные данные или `null`, если запись не состояние
 */
export function readConditionSystemData(
  item: unknown,
): ConditionSystemData | null {
  if (!isRecord(item) || item.type !== CONDITION_ITEM_TYPE) {
    return null;
  }

  const parsed = ConditionSystemDataSchema.safeParse(item.systemData);

  return parsed.success ? parsed.data : null;
}

/**
 * Запись мира — состояние?
 *
 * @param item - запись мира
 * @returns `true`, если запись хранит состояние
 */
export function isConditionItem(item: { type?: string } | null): boolean {
  return item?.type === CONDITION_ITEM_TYPE;
}

/**
 * Разбирает запись мира в определение состояния.
 *
 * Данные внешние (правились в мире и приехали по WS), поэтому разбор через Zod,
 * а негодная запись просто отбрасывается: сорвать весь справочник состояний
 * из-за одной битой строки нельзя — вместе с ним пропали бы значки на токенах.
 *
 * @param item - запись мира
 * @returns определение состояния или `null`, если запись не годится
 */
export function parseConditionRecord(
  item: unknown,
): WorldConditionDefinition | null {
  if (!isRecord(item) || item.type !== CONDITION_ITEM_TYPE) {
    return null;
  }

  const systemData = readConditionSystemData(item);

  if (!systemData) {
    return null;
  }

  const nameRu = typeof item.name === 'string' ? item.name.trim() : '';

  if (nameRu.length === 0) {
    return null;
  }

  const nameEn = typeof item.nameEn === 'string' ? item.nameEn.trim() : '';
  const image = typeof item.image === 'string' ? item.image.trim() : '';

  const description =
    typeof item.description === 'string' ? item.description : '';

  return {
    key: systemData.conditionKey,
    nameRu,
    nameEn: nameEn.length > 0 ? nameEn : undefined,
    icon: systemData.icon,
    customImage: image.length > 0 ? image : undefined,
    description,
    overlay: systemData.overlay,
    template: parseConditionTemplate(item.activeEffects),
  };
}

/**
 * Достаёт шаблон эффекта из эффектов записи: состояние несёт РОВНО ОДИН эффект —
 * тот, что висит на сущности, пока состояние активно.
 *
 * @param activeEffects - эффекты записи
 * @returns шаблон эффекта (пустой, если эффекта нет или он не разобрался)
 */
function parseConditionTemplate(
  activeEffects: unknown,
): WorldConditionDefinition['template'] {
  const first = Array.isArray(activeEffects) ? activeEffects[0] : undefined;
  const parsed = ActiveEffectSchema.safeParse(first);

  if (!parsed.success) {
    return { changes: [], flags: [] };
  }

  const effect = parsed.data;

  return {
    changes: effect.changes,
    flags: effect.flags,
    conditionImmunities:
      effect.conditionImmunities && effect.conditionImmunities.length > 0
        ? effect.conditionImmunities
        : undefined,
  };
}

/** Исходные данные записи состояния, собранные формой. */
export interface ConditionRecordInput {
  /** Идентификатор записи (новой — сгенерированный) */
  id: string;
  /** Ключ состояния (канонный у правки канона, слаг у своего состояния) */
  conditionKey: string;
  /** Название на русском */
  name: string;
  /** Название на английском */
  nameEn?: string;
  /** Описание состояния */
  description: string;
  /** Картинка-значок (адрес ассета) */
  image?: string;
  /** Иконка коллекции — берётся, когда картинки нет */
  icon?: string;
  /** Рисовать значок крупно поверх всей фишки */
  overlay?: boolean;
  /** Эффект состояния (без эффекта состояние — чистая метка) */
  effect: ActiveEffect | null;
}

/**
 * Собирает запись мира из данных формы состояния.
 *
 * Единственное место, где известна раскладка состояния по полям записи, — иначе
 * форма и разбор разошлись бы полями.
 *
 * @param input - данные формы
 * @returns запись мира, готовая к сохранению
 */
export function buildConditionRecord(input: ConditionRecordInput): DnDGameItem {
  const effect = input.effect
    ? { ...input.effect, conditionKey: input.conditionKey }
    : null;

  return {
    id: input.id,
    name: input.name.trim(),
    nameEn: input.nameEn?.trim() || undefined,
    description: input.description,
    image: input.image?.trim() || undefined,
    type: CONDITION_ITEM_TYPE,
    // Состояние — не предмет склада: количество, вес, стоимость и надетость к
    // нему неприменимы, но конверт записи мира их требует.
    quantity: 1,
    weight: 0,
    cost: '',
    rarity: 'common',
    equipped: false,
    isReadOnly: false,
    activeEffects: effect ? [effect] : [],
    systemData: {
      conditionKey: input.conditionKey,
      icon: input.icon,
      overlay: input.overlay,
    },
  };
}

/**
 * Собирает запись состояния из РЕЕСТРА — по ключу, без обращения к миру.
 *
 * Нужна там, где состояние показывают карточкой, а строки мира у него может и не
 * быть: карточка состояния с листа персонажа и заполнение формы канонным
 * пресетом. Обе точки обязаны показывать одно и то же, поэтому сборка одна.
 *
 * @param conditionKey - ключ состояния
 * @returns запись состояния или `null`, если ключ неизвестен
 */
export function buildRuntimeConditionRecord(
  conditionKey: ConditionRef,
): DnDGameItem | null {
  const condition = getRuntimeCondition(conditionKey);

  if (!condition) {
    return null;
  }

  return buildConditionRecord({
    id: `${CONDITION_ITEM_TYPE}:${condition.entry.key}`,
    conditionKey: condition.entry.key,
    name: condition.entry.nameRu,
    nameEn: condition.entry.nameEn,
    description: condition.entry.description,
    image: condition.entry.customImage,
    icon: condition.entry.icon,
    overlay: condition.entry.overlay,
    effect: buildConditionActiveEffect(condition.entry.key),
  });
}

/**
 * Чеканит ключ нового состояния стола.
 *
 * Суффикс со случайной частью нужен, чтобы ключ не столкнулся ни с канонным
 * («Отравленный» своего сочинения не должен подменять PHB-канон), ни с ключом
 * состояния, заведённого раньше с тем же названием.
 *
 * @param name - название на русском
 * @param nameEn - название на английском
 * @returns ключ состояния
 */
export function mintConditionKey(name: string, nameEn?: string): string {
  const base = slugify(nameEn ?? '') || slugify(name);
  const suffix = generateId('w').split('_')[2] ?? 'x';

  return `${base || 'condition'}-${suffix}`;
}

/**
 * Ключ состояния, который хранит запись мира.
 *
 * @param item - запись мира
 * @returns ключ состояния или `undefined`, если запись не состояние
 */
export function getConditionRecordKey(
  item: BaseGameItem | null,
): string | undefined {
  return readConditionSystemData(item)?.conditionKey;
}
