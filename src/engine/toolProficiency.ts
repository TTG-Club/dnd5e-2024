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
 * Одна позиция не равна одному владению. Компендиум перечисляет несколько
 * владений одной строкой («Воровские инструменты, Инструменты ремонтника и один
 * тип Ремесленных инструментов на ваш выбор» у изобретателя) и предлагает выбор
 * между категориями («Выберите инструменты ремесленника или музыкальный
 * инструмент» у монаха). Перечисление делится на части, а выбор между
 * категориями остаётся ОДНИМ выбором сразу из нескольких групп — иначе монах
 * получал бы два инструмента вместо одного.
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
  /**
   * Выбор «на выбор»: игрок берёт `count` инструментов из групп `keys`.
   * Групп больше одной, когда позиция предлагает выбор между категориями
   * («инструменты ремесленника ИЛИ музыкальный инструмент») — выбор при этом
   * остаётся один, меняется лишь набор вариантов.
   */
  | { kind: 'group'; keys: string[]; count: number; source: string }
  /** Ничего не подошло — текст показывается как есть, ключа для него нет. */
  | { kind: 'unknown'; source: string };

/**
 * Признаки групп «на выбор» — основы слов, а не целые фразы: компендиум пишет их
 * в разных падежах и числах («музыкальный инструмент», «2 музыкальных
 * инструмента», «тип Ремесленных инструментов»). Группа засчитывается, когда в
 * тексте есть ВСЕ её основы. Ищутся ПОСЛЕ точных совпадений, поэтому конкретная
 * «Флейта» группой не станет.
 */
const GROUP_STEMS: Array<{ key: string; stems: string[] }> = [
  { key: TOOL_GROUP_KEYS.artisan, stems: ['инструмент', 'ремеслен'] },
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

/** Скобочное уточнение «(на ваш выбор)» — смысла позиции не меняет. */
const PARENTHESES = /\([^)]*\)/g;

/**
 * Служебные хвосты: на то, ЧТО за владение, они не влияют.
 *
 * Слова целиком, а сравнение идёт по пробелам вокруг них. Раньше здесь стояли
 * выражения с `\b`, и они не работали вовсе: границей слова `\b` считает
 * латиницу с цифрами, а с кириллицей её нет ни с одной стороны. Хвосты
 * оставались в тексте, и «Инструменты каллиграфа на ваш выбор» не совпадало со
 * своей же позицией словаря.
 */
const NOISE_WORDS = [
  'на ваш выбор',
  'на выбор',
  'по вашему выбору',
  'любого вида',
  'любой',
  'любые',
];

/**
 * Приводит фразу к виду, пригодному для сравнения: нижний регистр, «ё» → «е»,
 * без служебных хвостов, знаков препинания и лишних пробелов.
 *
 * @param value - исходная фраза
 */
function normalize(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(PARENTHESES, ' ')
    .replace(/[«»"'.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Пробелы по краям — чтобы хвост в начале и в конце фразы тоже оказался
  // окружён пробелами и отделялся так же, как хвост в середине.
  let result = ` ${cleaned} `;

  for (const noise of NOISE_WORDS) {
    result = result.replaceAll(` ${noise} `, ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Числительные словами. Компендиум пишет количество и цифрой, и словом («Три
 * музыкальных инструмента»), и в разных падежах — падежные формы перечислены
 * рядом с начальной. «Ё» здесь не бывает: {@link normalize} заменяет её на «е»
 * раньше сравнения.
 */
const COUNT_WORDS: Record<string, number> = {
  один: 1,
  одно: 1,
  одного: 1,
  одним: 1,
  одну: 1,
  два: 2,
  две: 2,
  двух: 2,
  двумя: 2,
  три: 3,
  трех: 3,
  тремя: 3,
  четыре: 4,
  четырех: 4,
  четырьмя: 4,
  пять: 5,
  пяти: 5,
  пятью: 5,
};

/**
 * Количество инструментов во фразе: «2 музыкальных инструмента» → 2, «Выберите
 * 3 музыкальных инструмента» → 3, «Три музыкальных инструмента» → 3. Без числа
 * — 1.
 *
 * Число ищется по всей фразе, а не только в начале: компендиум ставит его после
 * глагола («Выберите 3 …»), и с проверкой одного начала бард получал право на
 * один инструмент вместо трёх при подписи про три.
 *
 * @param value - нормализованная фраза
 */
function phraseCount(value: string): number {
  const words = value.split(' ');

  for (const word of words) {
    if (/^\d+$/.test(word)) {
      const count = Number.parseInt(word, 10);

      if (Number.isFinite(count) && count > 0) {
        return count;
      }
    }

    const spelled = COUNT_WORDS[word];

    if (spelled) {
      return spelled;
    }
  }

  return 1;
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
      keys: [trimmed],
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

  // Берём ВСЕ подошедшие группы: «инструменты ремесленника или музыкальный
  // инструмент» — это один выбор с вариантами из двух категорий. Перечисление
  // через запятую и «и» сюда не доходит: его делит `resolveToolProficiencies`.
  const keys = GROUP_STEMS.filter((candidate) =>
    candidate.stems.every((stem) => normalized.includes(stem)),
  ).map((candidate) => candidate.key);

  if (keys.length > 0) {
    return {
      kind: 'group',
      keys,
      count: phraseCount(normalized),
      source: trimmed,
    };
  }

  return { kind: 'unknown', source: trimmed };
}

/**
 * Делит позицию, перечисляющую несколько владений одной строкой («Воровские
 * инструменты, Инструменты ремонтника и один тип Ремесленных инструментов на
 * ваш выбор»).
 *
 * Деление принимается, только когда КАЖДАЯ часть несёт название: запятая
 * встречается и внутри цельной фразы («Один музыкальный инструмент, на ваш
 * выбор»), а такую строку делить нельзя — вторая половина осталась бы без
 * смысла и просилась бы завести инструмент с именем «на ваш выбор».
 *
 * @param source - позиция владения, как её прислал источник
 * @returns части перечисления либо пустой список, если позиция цельная
 */
function splitEnumeration(source: string): string[] {
  // Делим уже очищенный текст: запятая внутри адреса ссылки разрезала бы
  // позицию по живому.
  const parts = toolProficiencyText(source)
    .split(/,| и /i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return [];
  }

  return parts.every((part) => normalize(part)) ? parts : [];
}

/**
 * Разбирает список позиций владения. Позиция-перечисление делится на части, и
 * каждая разбирается сама по себе: иначе строка изобретателя опозналась бы
 * одной группой «инструменты ремесленника», а названные в ней воровские
 * инструменты и инструменты ремонтника пропали бы.
 *
 * Позиция, совпавшая со словарём целиком, не делится: название инструмента —
 * это одно владение, чем бы оно ни было разделено внутри.
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

    if (whole.kind === 'tool') {
      resolved.push(whole);

      continue;
    }

    const parts = splitEnumeration(source);

    if (parts.length === 0) {
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
 * Опознаёт выбор по набору его групп: позиция предлагает варианты сразу из
 * нескольких категорий, и различает такие выборы именно набор. Общий и для
 * отсева повторов, и для показа — разъезжаться им нельзя, иначе один и тот же
 * выбор считался бы в разных местах разным.
 *
 * @param keys - группы, из которых идёт выбор
 */
export function toolChoiceGroupId(keys: string[]): string {
  return keys.join('+');
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

/** Опознаёт позицию для сравнения на повтор. */
function dedupeId(entry: ResolvedToolProficiency): string {
  switch (entry.kind) {
    case 'tool':
      return `tool:${entry.key}`;
    case 'group':
      return `group:${toolChoiceGroupId(entry.keys)}`;
    default:
      // `unknown`: ключа у позиции нет, различаем такие позиции по тексту
      return `unknown:${entry.source.toLowerCase()}`;
  }
}

/** Убирает повторы: один и тот же инструмент мог прийти и от класса, и от фона. */
function dedupe(
  resolved: ResolvedToolProficiency[],
): ResolvedToolProficiency[] {
  const seen = new Set<string>();

  return resolved.filter((entry) => {
    const id = dedupeId(entry);

    if (seen.has(id)) {
      return false;
    }

    seen.add(id);

    return true;
  });
}
