/**
 * Подписи действия «вырваться»: вопросы «кто действует» и «каким навыком»,
 * строка чата об уроне при провале, поля блока в окне эффекта и предложения
 * помощи соседям.
 */

import type {
  EffectEscapeRole,
  EffectEscapeRollMode,
} from '@vtt/shared/system/dnd.js';

import {
  DEFAULT_REACH_FEET,
  EFFECT_ESCAPE_ROLES,
  EFFECT_ESCAPE_ROLL_MODE_LABELS,
  EFFECT_ESCAPE_ROLL_MODES,
} from '@vtt/shared/system/dnd.js';

/** Подписи вопросов и отказов действия «вырваться» */
export const EFFECT_ESCAPE_PROMPT_LABELS = {
  actorQuestion: 'Кто действует?',
  skillQuestion: 'Каким навыком?',
  selfSuffix: ' — сам',
  helperSuffix: ' — помогает рядом',
  modifierPrefix: ' (бросок ',
  modifierSuffix: ')',
  noActor: 'этим существом управляете не вы',
  noHelper: `рядом (в ${DEFAULT_REACH_FEET} фт) нет вашего существа, которое может помочь`,
  /** Строка чата: «Капкан: провал — Гримли получает урон: 1» */
  failDamageMiddle: ': провал — ',
  failDamageSuffix: ' получает урон: ',
} as const;

/** Подписи блока помощи соседям на вкладке «Эффекты» */
export const EFFECT_ESCAPE_HELP_LABELS = {
  title: 'Помочь рядом',
  hint: `Эффекты существ в ${DEFAULT_REACH_FEET} футах, из которых им можно помочь выбраться`,
  icon: 'tabler:hand-grab',
} as const;

/** Значение «обычный бросок» в выборе режима проверки */
export const ESCAPE_ROLL_MODE_NORMAL = 'normal';

/** Значение «всем, кто может действовать» в выборе роли навыка */
export const ESCAPE_SKILL_ROLE_ANY = 'any';

/** Режим проверки «вырваться» — вариантами выбора в окне эффекта */
export const ESCAPE_ROLL_MODE_OPTIONS: Array<{
  value: EffectEscapeRollMode | typeof ESCAPE_ROLL_MODE_NORMAL;
  label: string;
}> = [
  { value: ESCAPE_ROLL_MODE_NORMAL, label: 'Обычный бросок' },
  ...EFFECT_ESCAPE_ROLL_MODES.map((mode) => ({
    value: mode,
    label: EFFECT_ESCAPE_ROLL_MODE_LABELS[mode],
  })),
];

/** Подписи роли, которой доступен навык */
const ESCAPE_SKILL_ROLE_LABELS: Record<EffectEscapeRole, string> = {
  self: 'Только носителю',
  adjacent: 'Только существу рядом',
};

/** Кому доступен навык — вариантами выбора в окне эффекта */
export const ESCAPE_SKILL_ROLE_OPTIONS: Array<{
  value: EffectEscapeRole | typeof ESCAPE_SKILL_ROLE_ANY;
  label: string;
}> = [
  { value: ESCAPE_SKILL_ROLE_ANY, label: 'Всем, кто действует' },
  ...EFFECT_ESCAPE_ROLES.map((role) => ({
    value: role,
    label: ESCAPE_SKILL_ROLE_LABELS[role],
  })),
];

/** Иконки строки навыка */
export const ESCAPE_SKILL_ROW_ICONS = {
  add: 'tabler:plus',
  remove: 'tabler:trash',
} as const;

/** Подписи новых полей блока «вырваться» в окне эффекта */
export const EFFECT_ESCAPE_FIELD_LABELS = {
  skills: 'Навыки на выбор',
  skillsHint:
    'Вырывающийся выбирает один из навыков: правило захвата 2024 — «Атлетика или Акробатика». Своя Сл — если у навыка она другая (кандалы: Ловкость рук 20, Атлетика 25).',
  addSkill: 'Добавить навык',
  removeSkill: 'Убрать навык',
  removeFailDamage: 'Убрать урон',
  skillDc: 'Своя Сл',
  skillDcPlaceholder: 'Как у проверки',
  skillRole: 'Кому доступен',
  skillLabel: 'Пометка',
  skillLabelPlaceholder: 'воровскими инструментами',
  mode: 'Режим броска',
  modeHint:
    'Преимущество или помеха самой проверки: «проверки для освобождения — с помехой». Складывается с флагами бросающего.',
  onSuccessApply: 'После освобождения',
  onSuccessApplyNone: 'Ничего',
  onSuccessApplyHint:
    'Состояние, которое носитель получает, вырвавшись: «…и получает состояние лежащий ничком».',
  onFailDamage: 'Урон при провале проверки',
  onFailDamageHint:
    'Урон носителю за каждую неудачную проверку: «каждая неудачная проверка наносит пойманному 1 колющий урон».',
  onFailDamageFormula: 'Формула',
  onFailDamageType: 'Тип',
  addFailDamage: 'Добавить урон',
} as const;

/** Значение «ничего» в выборе состояния после освобождения */
export const NO_ESCAPE_AFTERMATH = '';

/** Новая часть урона за неудачную попытку: единица, как у капкана */
export const NEW_ESCAPE_FAIL_DAMAGE = { formula: '1' } as const;
