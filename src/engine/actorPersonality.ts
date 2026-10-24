/**
 * Личность персонажа: мировоззрение, приметы и подробное описание.
 *
 * Правил за этими полями нет — игрок пишет о персонаже сам. Модуль только
 * разбирает записанное (у актёров старых миров поля нет вовсе, а мир может
 * прислать что угодно) и даёт листу список мировоззрений персонажа.
 *
 * @module system/dnd/actorPersonality
 */

import type { CreatureAlignment } from './creatureTypes.js';
import type { DnDActorPersonality } from './types.js';

import { z } from 'zod';

import { CREATURE_ALIGNMENTS } from './consts.js';

/**
 * Предел длины приметы. Примета — пара слов; всё, что длиннее, на плитке не
 * помещается и относится к подробному описанию.
 */
export const PERSONALITY_FIELD_MAX_LENGTH = 40;

/** Приметы — свободные короткие поля личности (всё, кроме мировоззрения) */
export type PersonalityTextFieldKey = Exclude<
  keyof DnDActorPersonality,
  'alignment' | 'description'
>;

/** Поле примет: мировоззрение или одна из свободных примет */
export type PersonalityFieldKey = 'alignment' | PersonalityTextFieldKey;

/** Порядок примет на листе */
export const PERSONALITY_TEXT_FIELD_KEYS: readonly PersonalityTextFieldKey[] = [
  'age',
  'height',
  'weight',
  'eyes',
  'hair',
  'skin',
];

/** Пустая личность: у актёра ещё ничего не записано */
export const EMPTY_ACTOR_PERSONALITY: DnDActorPersonality = {
  alignment: '',
  age: '',
  height: '',
  weight: '',
  eyes: '',
  hair: '',
  skin: '',
  description: '',
};

/** Поле личности: строка или пусто, если пришло что-то другое */
const personalityStringSchema = z.string().catch('');

const actorPersonalitySchema = z
  .object({
    alignment: personalityStringSchema,
    age: personalityStringSchema,
    height: personalityStringSchema,
    weight: personalityStringSchema,
    eyes: personalityStringSchema,
    hair: personalityStringSchema,
    skin: personalityStringSchema,
    description: personalityStringSchema,
  })
  .partial();

/**
 * Читает личность персонажа из блока `system`. Нет поля или оно битое — пустая
 * личность: лист показывает прочерки, а не падает.
 *
 * @param personality - значение `system.personality` как оно пришло из мира
 * @returns личность со всеми полями
 */
export function readActorPersonality(
  personality: unknown,
): DnDActorPersonality {
  const parsed = actorPersonalitySchema.safeParse(personality);

  return parsed.success
    ? { ...EMPTY_ACTOR_PERSONALITY, ...parsed.data }
    : { ...EMPTY_ACTOR_PERSONALITY };
}

/**
 * Мировоззрения, которые может выбрать персонаж. «Любое мировоззрение» — запись
 * справочника существ («может быть любым»), у конкретного героя его не бывает.
 */
const CHARACTER_ALIGNMENT_KEYS: readonly CreatureAlignment[] = [
  'lawful-good',
  'neutral-good',
  'chaotic-good',
  'lawful-neutral',
  'true-neutral',
  'chaotic-neutral',
  'lawful-evil',
  'neutral-evil',
  'chaotic-evil',
  'unaligned',
];

/** Опции мировоззрения персонажа для выбора на листе */
export const CHARACTER_ALIGNMENT_OPTIONS = CHARACTER_ALIGNMENT_KEYS.map(
  (alignment) => ({ value: alignment, label: CREATURE_ALIGNMENTS[alignment] }),
);
