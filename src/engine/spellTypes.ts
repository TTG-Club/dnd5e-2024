/**
 * Константы системы заклинаний D&D 5.5e (PHB 2024)
 *
 * Содержит локализованные лейблы школ магии, времени сотворения,
 * длительности, форм областей и утилиты маппинга.
 */

import type {
  SpellAreaShape,
  SpellCastingTimeUnit,
  SpellDurationUnit,
  SpellSaveType,
  SpellSchool,
  SpellTargetType,
} from '@vtt/shared';

// ── Школы магии ──────────────────────────────────────────────

/** Локализованные названия школ магии */
export const SPELL_SCHOOL_LABELS: Record<SpellSchool, string> = {
  abjuration: 'Ограждение',
  conjuration: 'Вызов',
  divination: 'Прорицание',
  enchantment: 'Очарование',
  evocation: 'Воплощение',
  illusion: 'Иллюзия',
  necromancy: 'Некромантия',
  transmutation: 'Преобразование',
};

/** Школы магии в порядке показа */
const SPELL_SCHOOL_KEYS: readonly SpellSchool[] = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
];

/** Школы магии для UI-селектов */
export const SPELL_SCHOOL_OPTIONS: ReadonlyArray<{
  value: SpellSchool;
  label: string;
}> = SPELL_SCHOOL_KEYS.map((value) => ({
  value,
  label: SPELL_SCHOOL_LABELS[value],
}));

// ── Время сотворения ─────────────────────────────────────────

/** Локализованные названия единиц времени сотворения */
export const CASTING_TIME_LABELS: Record<SpellCastingTimeUnit, string> = {
  'action': 'Действие',
  'bonus-action': 'Бонусное действие',
  'bonus-action-after-hit':
    'Бонусное действие, которое вы совершаете сразу после попадания по существу рукопашным оружием или безоружным ударом.',
  'reaction': 'Реакция',
  'minute': 'Минута',
  'hour': 'Час',
};

/** Единицы времени сотворения в порядке показа */
const CASTING_TIME_KEYS: readonly SpellCastingTimeUnit[] = [
  'action',
  'bonus-action',
  'bonus-action-after-hit',
  'reaction',
  'minute',
  'hour',
];

/**
 * «Ритуал» в фильтре времени накладывания у выбора заклинания черты.
 *
 * Не единица времени, а признак самого заклинания ({@link Spell.ritual}): «Ритуальный
 * заклинатель» берёт только ритуалы. Ключ живёт рядом с единицами времени, потому что
 * стоит в том же поле фильтра и разбирается вместе с ними.
 */
export const RITUAL_CASTING_TIME = 'ritual';

/** Единицы времени сотворения для UI-селектов */
export const CASTING_TIME_OPTIONS: ReadonlyArray<{
  value: SpellCastingTimeUnit;
  label: string;
}> = CASTING_TIME_KEYS.map((value) => ({
  value,
  label: CASTING_TIME_LABELS[value],
}));

// ── Длительность ─────────────────────────────────────────────

/** Локализованные названия единиц длительности */
export const DURATION_UNIT_LABELS: Record<SpellDurationUnit, string> = {
  'instantaneous': 'Мгновенное',
  'round': 'Раунд',
  'minute': 'Минута',
  'hour': 'Час',
  'day': 'День',
  'special': 'Особая',
  'until-dispelled': 'Пока не рассеется',
};

/** Единицы длительности в порядке показа */
const DURATION_UNIT_KEYS: readonly SpellDurationUnit[] = [
  'instantaneous',
  'round',
  'minute',
  'hour',
  'day',
  'special',
  'until-dispelled',
];

/** Единицы длительности для UI-селектов */
export const DURATION_UNIT_OPTIONS: ReadonlyArray<{
  value: SpellDurationUnit;
  label: string;
}> = DURATION_UNIT_KEYS.map((value) => ({
  value,
  label: DURATION_UNIT_LABELS[value],
}));

// ── Тип цели ─────────────────────────────────────────────────

/** Локализованные названия типов целей */
export const TARGET_TYPE_LABELS: Record<SpellTargetType, string> = {
  creature: 'Существо',
  object: 'Предмет',
  point: 'Точка',
  self: 'На себя',
  area: 'Область',
  none: 'Нет цели',
};

/** Типы целей в порядке показа */
const TARGET_TYPE_KEYS: readonly SpellTargetType[] = [
  'creature',
  'object',
  'point',
  'self',
  'area',
  'none',
];

/** Типы целей для UI-селектов */
export const TARGET_TYPE_OPTIONS: ReadonlyArray<{
  value: SpellTargetType;
  label: string;
}> = TARGET_TYPE_KEYS.map((value) => ({
  value,
  label: TARGET_TYPE_LABELS[value],
}));

// ── Распределение снарядов по целям ──────────────────────────

/**
 * Режимы распределения снарядов для UI-радио. Значение `'any'` — форменный
 * дефолт «свободно», в `Spell.projectiles.targetDistribution` НЕ пишется
 * (поле остаётся пустым).
 */
export const PROJECTILE_DISTRIBUTION_OPTIONS = [
  {
    value: 'any' as const,
    label: 'Свободно',
    description: 'В одну цель или в несколько — решается при касте',
  },
  {
    value: 'single' as const,
    label: 'Только одна цель',
    description: 'Выбирается одна цель, все снаряды летят в неё',
  },
  {
    value: 'distinct' as const,
    label: 'Каждый снаряд в свою цель',
    description: 'Нельзя направить два снаряда в одну цель',
  },
] as const;

// ── Форма области ────────────────────────────────────────────

/** Локализованные названия форм областей */
export const AREA_SHAPE_LABELS: Record<SpellAreaShape, string> = {
  cone: 'Конус',
  circle: 'Сфера',
  ray: 'Линия',
  rect: 'Куб',
  cylinder: 'Цилиндр',
};

/** Формы областей в порядке показа */
const AREA_SHAPE_KEYS: readonly SpellAreaShape[] = [
  'cone',
  'circle',
  'ray',
  'rect',
  'cylinder',
];

/** Формы областей для UI-селектов */
export const AREA_SHAPE_OPTIONS: ReadonlyArray<{
  value: SpellAreaShape;
  label: string;
}> = AREA_SHAPE_KEYS.map((value) => ({
  value,
  label: AREA_SHAPE_LABELS[value],
}));

/** Формы области, размер которых задаётся радиусом (круг, цилиндр) */
const RADIUS_AREA_SHAPES: ReadonlySet<SpellAreaShape> = new Set([
  'circle',
  'cylinder',
]);

/** Формы области, требующие отдельного указания ширины (линия, прямоугольник) */
const WIDTH_AREA_SHAPES: ReadonlySet<SpellAreaShape> = new Set(['ray', 'rect']);

/**
 * Использует ли форма области радиус вместо линейного размера стороны.
 *
 * @param shape - форма области
 * @returns `true` для круга и цилиндра
 */
export function isRadiusAreaShape(shape: SpellAreaShape): boolean {
  return RADIUS_AREA_SHAPES.has(shape);
}

/**
 * Подпись поля основного размера области (радиус либо размер стороны).
 *
 * @param shape - форма области
 * @returns локализованная подпись поля
 */
export function getAreaSizeLabel(shape: SpellAreaShape): string {
  return isRadiusAreaShape(shape) ? 'Радиус' : 'Размер';
}

/**
 * Требует ли форма области отдельного указания ширины.
 *
 * @param shape - форма области
 * @returns `true` для линии и прямоугольника
 */
export function areaShapeUsesWidth(shape: SpellAreaShape): boolean {
  return WIDTH_AREA_SHAPES.has(shape);
}

/**
 * Требует ли форма области отдельного указания высоты.
 *
 * @param shape - форма области
 * @returns `true` только для цилиндра
 */
export function areaShapeUsesHeight(shape: SpellAreaShape): boolean {
  return shape === 'cylinder';
}

// ── Спасбросок ───────────────────────────────────────────────

/** Локализованные названия типов спасбросков */
export const SAVE_TYPE_LABELS: Record<SpellSaveType, string> = {
  none: 'Нет',
  strength: 'Сила',
  dexterity: 'Ловкость',
  constitution: 'Телосложение',
  intelligence: 'Интеллект',
  wisdom: 'Мудрость',
  charisma: 'Харизма',
};

/** Типы спасбросков в порядке показа */
const SAVE_TYPE_KEYS: readonly SpellSaveType[] = [
  'none',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/** Типы спасбросков для UI-селектов */
export const SAVE_TYPE_OPTIONS: ReadonlyArray<{
  value: SpellSaveType;
  label: string;
}> = SAVE_TYPE_KEYS.map((value) => ({
  value,
  label: SAVE_TYPE_LABELS[value],
}));

// ── Тип совершения ───────────────────────────────────────────

/** Типы совершения для UI-селектов */
export const DELIVERY_TYPE_OPTIONS = [
  { value: 'ranged' as const, label: 'Дальнобойная атака' },
  { value: 'melee' as const, label: 'Рукопашная атака' },
  { value: 'self' as const, label: 'На себя' },
  { value: 'touch' as const, label: 'Касание' },
  { value: 'sight' as const, label: 'Зрение' },
  { value: 'none' as const, label: 'Нет' },
] as const;

// ── Круги заклинаний ─────────────────────────────────────────

/**
 * Круг заговора. Заговоры не занимают ячеек и не требуют подготовки — проверка
 * «это заговор» встречается всюду, где считаются ячейки и подготовка.
 */
export const CANTRIP_SPELL_LEVEL = 0;

/** Круги заклинаний для UI-селектов */
export const SPELL_LEVEL_OPTIONS = [
  { value: 0, label: 'Заговор' },
  { value: 1, label: '1-й круг' },
  { value: 2, label: '2-й круг' },
  { value: 3, label: '3-й круг' },
  { value: 4, label: '4-й круг' },
  { value: 5, label: '5-й круг' },
  { value: 6, label: '6-й круг' },
  { value: 7, label: '7-й круг' },
  { value: 8, label: '8-й круг' },
  { value: 9, label: '9-й круг' },
] as const;

/** Локализованные названия кругов заклинаний (производные от SPELL_LEVEL_OPTIONS) */
export const SPELL_LEVEL_LABELS: Record<number, string> = Object.fromEntries(
  SPELL_LEVEL_OPTIONS.map((option) => [option.value, option.label]),
);

/** Эффект спасброска для UI */
export const SAVE_EFFECT_OPTIONS = [
  { value: 'half' as const, label: 'Половина урона' },
  { value: 'none' as const, label: 'Нет урона' },
  { value: 'special' as const, label: 'Особый' },
] as const;

// ── Маппинг форм на шаблоны ─────────────────────────────────

/** Цвета шаблонов по типу урона заклинания */
export const SPELL_DAMAGE_TEMPLATE_COLORS: Record<string, number> = {
  fire: 0xff4400,
  cold: 0x44aaff,
  lightning: 0xffff44,
  thunder: 0x8844ff,
  poison: 0x44ff44,
  acid: 0x88ff00,
  necrotic: 0x884488,
  radiant: 0xffffaa,
  force: 0xbb44ff,
  psychic: 0xff44aa,
  slashing: 0xcccccc,
  piercing: 0xcccccc,
  bludgeoning: 0xcccccc,
};

/** Цвет шаблона по умолчанию (если тип урона неизвестен) */
export const SPELL_TEMPLATE_DEFAULT_COLOR = 0x6644ff;
