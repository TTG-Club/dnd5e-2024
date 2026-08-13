/**
 * Маппинг редкости предмета на CSS-класс рамки карточки.
 * Используется в EquipmentCardContent и ToolCardContent.
 */
export const RARITY_BORDER_CLASSES: Record<string, string> = {
  'common': 'border-accented/50',
  'uncommon': 'border-success/40',
  'rare': 'border-info/40',
  'very-rare': 'border-primary/40',
  'legendary': 'border-warning/40',
  'artifact': 'border-error/40',
};

/** Класс рамки по умолчанию (нет редкости или «none») */
export const RARITY_BORDER_DEFAULT = 'border-accented/50';

/**
 * Замена латинской записи кости на русскую: «2d6» → «2к6». Карточки чата
 * показывают формулу игроку, а движок хранит её в исходной записи источника.
 */
export const DICE_LETTER_REPLACEMENT = '$1к$2';

/** Подписи карточки заклинания в чате */
export const SPELL_CARD_LABELS = {
  /** Значок концентрации — буквой, ряд от него не растёт */
  concentrationBadge: 'К',
  /** Значок ритуала */
  ritualBadge: 'Р',
  /** Приставка длительности, когда заклинание требует концентрации */
  concentrationPrefix: 'Концентрация, ',
  /** Компоненты по-русски: вербальный, соматический, материальный */
  componentVerbal: 'В',
  componentSomatic: 'С',
  componentMaterial: 'М',
  castingTimePrefix: 'Время:',
  durationPrefix: 'Длительность:',
  componentsPrefix: 'Компоненты:',
  damagePrefix: 'Урон:',
  higherLevelsPrefix: 'На высших кругах:',
  error: 'Ошибка отображения карточки заклинания',
} as const;
