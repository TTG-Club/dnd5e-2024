/**
 * Разбор владения инструментами, пришедшего человекочитаемым текстом.
 *
 * Компендиум TTG Club хранит владение инструментами прозой («Инструменты
 * каллиграфа», «Один музыкальный инструмент на ваш выбор»), а лист персонажа
 * держит `proficiencies.tools` списком ИДЕНТИФИКАТОРОВ из словаря системы. Пока
 * текст клали на актёра как есть, владение выглядело правильным, но при
 * следующем открытии окна выбора инструментов молча пропадало: окно оставляет
 * только знакомые ключи. Здесь текст сопоставляется со словарём — точное
 * совпадение превращается в ключ, «на выбор» в группу, а незнакомое возвращается
 * отдельно, чтобы UI предложил завести инструмент, а не выдавал ложное владение.
 *
 * Предыстории приходят не только паками TTG Club: источник может отдать позицию
 * разметкой описания — `[Набор для фальсификации](https://…)`. Разметка снимается
 * перед сопоставлением, поэтому такая позиция становится обычным владением, а не
 * ссылкой в тексте на листе персонажа.
 *
 * @module system/dnd/toolProficiency
 */

import type { ToolCategory } from '@vtt/shared';

import { TOOLS_LABELS, TOOLS_LIST } from './consts.js';

/** Позиция словаря инструментов: ключ владения и его название. */
export interface ToolVocabularyEntry {
  key: string;
  label: string;
}

/** Ключи обобщённых групп «инструмент на выбор». */
export const TOOL_GROUP_KEYS = {
  artisan: 'artisans-tools',
  gaming: 'gaming-set',
  musical: 'musical-instrument',
} as const;

/**
 * Категория {@link TOOLS_LIST}, из которой выбирают для каждой группы «на выбор».
 * Живёт рядом с ключами групп: одна и та же связь нужна и разбору текста, и UI
 * выбора, разъезжаться им нельзя.
 */
export const TOOL_GROUP_CATEGORY: Record<string, ToolCategory> = {
  [TOOL_GROUP_KEYS.artisan]: 'artisan',
  [TOOL_GROUP_KEYS.gaming]: 'gaming',
  [TOOL_GROUP_KEYS.musical]: 'musical',
};

/** Результат разбора одной позиции владения. */
export type ResolvedToolProficiency =
  /** Конкретный инструмент словаря — ставится сразу. */
  | { kind: 'tool'; key: string; label: string; source: string }
  /** Группа «на выбор» — игрок выбирает `count` инструментов категории. */
  | { kind: 'group'; key: string; count: number; source: string }
  /** Ничего не подошло — текст показывается как есть, ключа для него нет. */
  | { kind: 'unknown'; source: string };

/**
 * Признаки групп «на выбор» — основы слов, а не целые фразы: компендиум пишет их
 * в разных падежах и числах («музыкальный инструмент», «2 музыкальных
 * инструмента»). Группа засчитывается, когда в тексте есть ВСЕ основы. Ищутся
 * ПОСЛЕ точных совпадений, поэтому конкретная «Флейта» группой не станет.
 */
const GROUP_STEMS: Array<{ key: string; stems: string[] }> = [
  { key: TOOL_GROUP_KEYS.artisan, stems: ['инструмент', 'ремесленник'] },
  { key: TOOL_GROUP_KEYS.gaming, stems: ['игров', 'набор'] },
  { key: TOOL_GROUP_KEYS.musical, stems: ['музыкальн', 'инструмент'] },
];

/**
 * Разметка ссылки: `[Набор для фальсификации](https://new.ttg.club/items/…)`.
 * Так владение приходит из источников, отдающих предысторию не компендиумом
 * TTG Club, а разметкой описания — адресу на листе персонажа делать нечего,
 * смысл несёт только подпись ссылки.
 */
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;

/** Парные выделения `**жирным**`, `*курсивом*`, `__…__`, `_…_`, `` `код` ``. */
const MARKDOWN_EMPHASIS = [
  /\*\*([^*]+)\*\*/g,
  /\*([^*]+)\*/g,
  /__([^_]+)__/g,
  /_([^_]+)_/g,
  /`([^`]+)`/g,
];

/**
 * Оставляет от позиции владения читаемое название: подпись вместо ссылки,
 * текст вместо выделений. Применяется ПЕРЕД сопоставлением со словарём —
 * иначе «[Набор для фальсификации](…)» не узнаётся и уходит в `unknown`,
 * хотя такой инструмент в словаре есть.
 *
 * @param source - позиция владения, как её прислал источник
 */
function toolProficiencyText(source: string): string {
  let result = source.replace(MARKDOWN_LINK, '$1');

  for (const pattern of MARKDOWN_EMPHASIS) {
    result = result.replace(pattern, '$1');
  }

  return result.replace(/\s+/g, ' ').trim();
}

/** Хвосты вида «(на ваш выбор)», «любой», «одного вида» — на смысл не влияют. */
const NOISE_PATTERNS = [
  /\([^)]*\)/g,
  /\bна ваш выбор\b/g,
  /\bна выбор\b/g,
  /\bпо вашему выбору\b/g,
  /\bлюбой\b/g,
  /\bлюбые\b/g,
  /\bлюбого вида\b/g,
];

/**
 * Приводит фразу к виду, пригодному для сравнения: нижний регистр, «ё» → «е»,
 * без служебных хвостов, знаков препинания и лишних пробелов.
 *
 * @param value - исходная фраза
 */
function normalize(value: string): string {
  let result = value.toLowerCase().replace(/ё/g, 'е');

  for (const pattern of NOISE_PATTERNS) {
    result = result.replace(pattern, ' ');
  }

  return result
    .replace(/[«»"'.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ведущее количество: «2 музыкальных инструмента» → 2. Без числа — 1.
 *
 * @param value - нормализованная фраза
 */
function leadingCount(value: string): number {
  const match = /^(\d+)\s/.exec(value);

  if (!match) {
    return 1;
  }

  const count = Number.parseInt(match[1], 10);

  return Number.isFinite(count) && count > 0 ? count : 1;
}

/**
 * Разбирает ОДНУ позицию владения инструментами.
 *
 * @param source - текст позиции («Инструменты каллиграфа») либо уже готовый ключ
 * @param vocabulary - словарь владений (системный список плюс заведённые в мире)
 */
export function resolveToolProficiency(
  source: string,
  vocabulary: ToolVocabularyEntry[] = TOOLS_LIST,
): ResolvedToolProficiency {
  // Разметку снимаем сразу: дальше и сопоставление, и показ идут по названию.
  const trimmed = toolProficiencyText(source);

  if (!trimmed) {
    return { kind: 'unknown', source: source.trim() };
  }

  // Уже ключ (данные модулей и homebrew хранят владения идентификаторами).
  const byKey = vocabulary.find((entry) => entry.key === trimmed);

  if (byKey) {
    return {
      kind: 'tool',
      key: byKey.key,
      label: byKey.label,
      source: trimmed,
    };
  }

  // Ключ обобщённой группы: так «инструмент на выбор» кладёт форма предыстории
  // из панели «Предметы» — её список владений собран из `TOOLS_LABELS`, где
  // группы стоят наравне с инструментами. Без этой ветки такая позиция уходила
  // в `unknown`, и мастер предлагал завести инструмент с именем `artisans-tools`
  // вместо выбора из категории.
  if (TOOL_GROUP_CATEGORY[trimmed]) {
    return {
      kind: 'group',
      key: trimmed,
      count: 1,
      source: TOOLS_LABELS[trimmed],
    };
  }

  const normalized = normalize(trimmed);

  if (!normalized) {
    return { kind: 'unknown', source: trimmed };
  }

  const byLabel = vocabulary.find(
    (entry) => normalize(entry.label) === normalized,
  );

  if (byLabel) {
    return {
      kind: 'tool',
      key: byLabel.key,
      label: byLabel.label,
      source: trimmed,
    };
  }

  const group = GROUP_STEMS.find((candidate) =>
    candidate.stems.every((stem) => normalized.includes(stem)),
  );

  if (group) {
    return {
      kind: 'group',
      key: group.key,
      count: leadingCount(normalized),
      source: trimmed,
    };
  }

  return { kind: 'unknown', source: trimmed };
}

/**
 * Разбирает список позиций владения. Позиция, которая целиком не опозналась,
 * дополнительно делится по запятым и союзу «и» — компендиум нередко пишет
 * несколько инструментов одной строкой. Части, не опознанные и после деления,
 * возвращаются как `unknown` каждая сама по себе.
 *
 * @param sources - позиции владения из определения класса или предыстории
 * @param vocabulary - словарь владений (системный список плюс заведённые в мире)
 */
export function resolveToolProficiencies(
  sources: string[],
  vocabulary: ToolVocabularyEntry[] = TOOLS_LIST,
): ResolvedToolProficiency[] {
  const resolved: ResolvedToolProficiency[] = [];

  for (const source of sources) {
    const whole = resolveToolProficiency(source, vocabulary);

    if (whole.kind !== 'unknown') {
      resolved.push(whole);

      continue;
    }

    // Делим уже очищенный текст: запятая внутри адреса ссылки разрезала бы
    // позицию по живому.
    const parts = toolProficiencyText(source)
      .split(/,| и /i)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 2) {
      resolved.push(whole);

      continue;
    }

    for (const part of parts) {
      resolved.push(resolveToolProficiency(part, vocabulary));
    }
  }

  return dedupe(resolved);
}

/**
 * Название позиции владения для показа: название словаря, если позиция узнана,
 * иначе — текст без разметки. Нужен всем местам, где владение только
 * показывается (карточки класса и предыстории, обзорный шаг мастера): там
 * ключей словаря ждать нельзя, а показывать `[Название](адрес)` тем более.
 *
 * @param source - позиция владения, как её прислал источник
 * @param vocabulary - словарь владений (системный список плюс заведённые в мире)
 */
export function toolProficiencyLabel(
  source: string,
  vocabulary: ToolVocabularyEntry[] = TOOLS_LIST,
): string {
  // Обобщённые группы («artisans-tools») живут только в подписях, в словаре
  // инструментов их нет — их название берём напрямую.
  const known = TOOLS_LABELS[source.trim()];

  if (known) {
    return known;
  }

  const resolved = resolveToolProficiency(source, vocabulary);

  return resolved.kind === 'tool' ? resolved.label : resolved.source;
}

/** Убирает повторы: один и тот же инструмент мог прийти и от класса, и от фона. */
function dedupe(
  resolved: ResolvedToolProficiency[],
): ResolvedToolProficiency[] {
  const seen = new Set<string>();

  return resolved.filter((entry) => {
    const id =
      entry.kind === 'unknown'
        ? `unknown:${entry.source.toLowerCase()}`
        : `${entry.kind}:${entry.key}`;

    if (seen.has(id)) {
      return false;
    }

    seen.add(id);

    return true;
  });
}
