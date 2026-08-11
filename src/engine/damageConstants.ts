/**
 * Константы типов урона D&D 5e.
 *
 * Выделены в отдельный «листовой» модуль (зависит только от `types/base`),
 * чтобы их могли использовать и `activeEffectTypes`, и `consts` без
 * образования циклических зависимостей.
 */

import type {
  DamagePartTarget,
  DamageType,
  DefensibleDamageType,
} from '@vtt/shared';

/**
 * Все типы урона, к которым применимы защиты (сопротивление, иммунитет,
 * уязвимость). Единый источник правды для рантайма: используется при
 * разборе защит сущностей и при генерации флагов активных эффектов.
 */
export const DEFENSIBLE_DAMAGE_TYPES = [
  'slashing',
  'piercing',
  'bludgeoning',
  'fire',
  'cold',
  'lightning',
  'thunder',
  'poison',
  'acid',
  'necrotic',
  'radiant',
  'force',
  'psychic',
] as const satisfies readonly DefensibleDamageType[];

/**
 * Все типы урона, включая служебный `choice` (выбор стихии игроком), к
 * которому защиты неприменимы. Рантайм-зеркало типа `DamageType` — нужно
 * Zod-схемам, валидирующим `DamagePart.type` у внешних данных.
 */
/**
 * Служебный «тип урона»: стихию выбирает игрок при броске. Защиты к нему
 * неприменимы, и в списках выбора типа его не показывают.
 */
export const CHOICE_DAMAGE_TYPE = 'choice';

export const DAMAGE_TYPES = [
  ...DEFENSIBLE_DAMAGE_TYPES,
  CHOICE_DAMAGE_TYPE,
] as const satisfies readonly DamageType[];

/** Набор известных типов урона для быстрой проверки строки */
const DAMAGE_TYPE_SET: ReadonlySet<string> = new Set(DAMAGE_TYPES);

/**
 * Проверяет, что строка — известный тип урона.
 *
 * Нужна там, где тип приходит извне: справочники мира, компендиумы, формы. Без
 * проверки чужой ключ уехал бы в расчёт урона и молча выпал бы из защит.
 *
 * @param value - произвольная строка (ключ из справочника, поле формы)
 * @returns `true`, если это тип урона системы
 */
export function isDamageType(value: string): value is DamageType {
  return DAMAGE_TYPE_SET.has(value);
}

/** Набор типов урона, к которым применимы защиты */
const DEFENSIBLE_DAMAGE_TYPE_SET: ReadonlySet<string> = new Set(
  DEFENSIBLE_DAMAGE_TYPES,
);

/**
 * Проверяет, что строка — тип урона, к которому применимы защиты.
 *
 * Отдельно от {@link isDamageType}: служебный `choice` — тоже тип урона, но у
 * него нет ни подписи, ни защит, и в справочники по типам он не индексируется.
 *
 * @param value - произвольная строка (ключ из справочника, поле формы)
 * @returns `true`, если к этому типу урона применимы защиты
 */
export function isDefensibleDamageType(
  value: string,
): value is DefensibleDamageType {
  return DEFENSIBLE_DAMAGE_TYPE_SET.has(value);
}

/**
 * Возможные цели части урона/лечения. Рантайм-зеркало `DamagePartTarget`:
 * сам тип живёт в нейтральном ядре (`@vtt/shared`), а оно вендорное и
 * значений не отдаёт.
 */
export const DAMAGE_PART_TARGETS = [
  'selected',
  'self',
  'choose',
] as const satisfies readonly DamagePartTarget[];

/**
 * Локализованные русские названия типов урона.
 *
 * Используется как единый источник подписей для статических меток
 * (флаги защит активных эффектов и т.п.). Динамические подписи из БД
 * (`DamageTypeDefinition`) — отдельный, загружаемый механизм.
 */
export const DAMAGE_TYPE_LABELS: Record<DefensibleDamageType, string> = {
  slashing: 'Рубящий урон',
  piercing: 'Колющий урон',
  bludgeoning: 'Дробящий урон',
  fire: 'Огненный урон',
  cold: 'Урон холодом',
  lightning: 'Урон молнией',
  thunder: 'Урон звуком (гром)',
  poison: 'Урон ядом',
  acid: 'Урон кислотой',
  necrotic: 'Некротический урон',
  radiant: 'Урон излучением',
  force: 'Силовой урон',
  psychic: 'Психический урон',
};

/**
 * Вид защиты от урона по типу: сопротивление (×0.5), иммунитет (×0) или
 * уязвимость (×2). Единый список для грантов вида и редактора.
 */
export type DamageDefenseKind = 'resistance' | 'immunity' | 'vulnerability';

/** Локализованные названия видов защиты от урона (для UI). */
export const DAMAGE_DEFENSE_KIND_LABELS: Record<DamageDefenseKind, string> = {
  resistance: 'Сопротивление',
  immunity: 'Иммунитет',
  vulnerability: 'Уязвимость',
};

/**
 * Возвращает краткое локализованное название типа урона в нижнем регистре.
 */
export function getShortDamageTypeLabel(damageType: string): string {
  // Тип приходит строкой из формул и записей мира: у неизвестного показываем
  // саму строку, как и раньше
  const label = isDefensibleDamageType(damageType)
    ? DAMAGE_TYPE_LABELS[damageType]
    : damageType;

  return label
    .replace(/урон\s*|^\s*урон\s*/gi, '')
    .trim()
    .toLowerCase();
}
