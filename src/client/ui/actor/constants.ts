/**
 * Единый файл констант для DnD 5e актёра.
 *
 * Локализации характеристик, навыков, типов существ, размеров,
 * типов заклинателей и владений вынесены сюда,
 * чтобы избежать дублирования в компонентах.
 */

// Реэкспорт из единого shared-источника (производные от ABILITY_OPTIONS и SKILLS_LIST)
export {
  ABILITY_LABELS,
  CREATURE_SIZE_LABELS,
  CREATURE_TYPE_LABELS,
  SKILLS_LABELS as SKILL_LABELS,
} from '@vtt/shared/system/dnd.js';

// ============================================================
// MIME-типы для drag-and-drop сущностей
// ============================================================
/** MIME-тип для предысторий */
export const BACKGROUND_DEFINITION_MIME = 'application/background-definition';
/** MIME-тип для видов */
export const SPECIES_DEFINITION_MIME = 'application/species-definition';
/** MIME-тип для классов */
export const CLASS_DEFINITION_MIME = 'application/class-definition';
/** MIME-тип для заклинаний (drag-and-drop) */
export const SPELL_MIME = 'application/spell-item';
/** MIME-тип для предметов снаряжения (drag-and-drop) */
export const GAME_ITEM_MIME = 'application/game-item';
/** MIME-тип для черт и особенностей (drag-and-drop) */
export const GAME_FEATURE_MIME = 'application/game-feature';
/** Re-export: определение перенесено в core/mimeTypes.ts */
export { GAME_ITEM_TRANSFER_MIME } from '@/core/mimeTypes';

// ============================================================
// Незаполненные разделы шапки листа персонажа
// ============================================================

/** Раздел шапки листа, который заполняется переносом записи из компендиума */
export interface MissingSheetSection {
  /** Текст-плейсхолдер, например «Вид не выбран» */
  label: string;
  /** Подсказка: откуда взять недостающие данные */
  hint: string;
}

/** Разделы шапки листа, у которых есть подсказка при незаполненном значении */
export type MissingSheetSectionKey = 'species' | 'class' | 'background';

/**
 * Плейсхолдеры и подсказки для незаполненных разделов шапки листа.
 *
 * Вид, класс и предыстория попадают на лист только переносом из компендиума —
 * подсказка объясняет это тем, кто не знает про drag-and-drop.
 */
export const MISSING_SHEET_SECTIONS: Record<
  MissingSheetSectionKey,
  MissingSheetSection
> = {
  species: {
    label: 'Вид не выбран',
    hint: 'Чтобы добавить вид, перетащите его из компендиума на лист персонажа',
  },
  class: {
    label: 'Класс не выбран',
    hint: 'Чтобы добавить класс, перетащите его из компендиума на лист персонажа',
  },
  background: {
    label: 'Предыстория не выбрана',
    hint: 'Чтобы добавить предысторию, перетащите её из компендиума на лист персонажа',
  },
};

/** Локализация типов владения доспехами */
export const ARMOR_PROF_LABELS: Record<string, string> = {
  light: 'Лёгкое снаряжение',
  medium: 'Среднее снаряжение',
  heavy: 'Тяжёлое снаряжение',
  shield: 'Щиты',
};

/** Короткие названия доспехов (для компактных таблиц) */
export const ARMOR_PROF_SHORT_LABELS: Record<string, string> = {
  light: 'Лёгкие',
  medium: 'Средние',
  heavy: 'Тяжёлые',
  shield: 'Щиты',
};

/** Локализация типов владения оружием */
export const WEAPON_PROF_LABELS: Record<string, string> = {
  'simple': 'Простое оружие',
  'martial': 'Воинское оружие',
  'hand-crossbow': 'Ручной арбалет',
  'crossbow-hand': 'Ручной арбалет',
  'longsword': 'Длинный меч',
  'rapier': 'Рапира',
  'shortsword': 'Короткий меч',
  'scimitar': 'Ятаган',
};

/** Короткие названия оружия (для компактных таблиц) */
export const WEAPON_PROF_SHORT_LABELS: Record<string, string> = {
  'simple': 'Простое',
  'martial': 'Воинское',
  'hand-crossbow': 'Руч. арбалет',
  'crossbow-hand': 'Руч. арбалет',
  'longsword': 'Длинный меч',
  'rapier': 'Рапира',
  'shortsword': 'Короткий меч',
  'scimitar': 'Ятаган',
};

/** Локализация владения инструментами */
export const TOOL_PROF_LABELS: Record<string, string> = {
  'thieves-tools': 'Воровские инструменты',
  'three-musical-instruments': 'Три музыкальных инструмента',
  'herbalism-kit': 'Набор травника',
};

/**
 * Короткие аббревиатуры характеристик (для таблиц навыков и способностей)
 *
 * Используется в `SkillItem`, `CreatureAbilities`, `CreatureSkillsModal`.
 */
export const ABILITY_SHORT_LABELS: Record<string, string> = {
  strength: 'СИЛ',
  dexterity: 'ЛОВ',
  constitution: 'ТЕЛ',
  intelligence: 'ИНТ',
  wisdom: 'МУД',
  charisma: 'ХАР',
};

/**
 * Запас по бокам названия в шапке блока характеристики (px):
 * горизонтальные отступы `legend` плюс место до скруглений рамки.
 *
 * Если полное название вместе с этим запасом не влезает в ширину блока,
 * `AbilityScore` показывает аббревиатуру из `ABILITY_SHORT_LABELS`.
 */
export const ABILITY_LABEL_SIDE_SPACE = 20;

/**
 * Формат числовых полей своего бонуса в модалках листа: знак виден и у плюса,
 * иначе поле читается количеством, а не поправкой.
 */
export const BONUS_INPUT_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  signDisplay: 'exceptZero',
};

/** Локализованные названия типов заклинателей */
export const CASTER_TYPE_LABELS: Record<string, string> = {
  full: 'Полный',
  half: 'Половинный',
  third: 'Третичный',
  pact: 'Пакт',
  none: 'Нет',
};
