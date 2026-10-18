/**
 * Блоки карточек боя в чате: бросок атаки и урон по целям.
 *
 * Ядро рисует блок (`ChatBlock`) — шапку (значок, название, цель) и строки
 * итогов в рамках; что в нём написано, решает система. Здесь блоки собираются
 * из итогов правил: попал ли бросок, каким уроном и сколько хитов снято.
 *
 * Раскладка одна на все карточки. Шапка называет действие; плашку исхода
 * ядро ставит в строку итога броска («Попадание = 30»). Урон — строками: вид
 * урона и снятые хиты, формула и защиты цели — в свёрнутых подробностях.
 * Единственную цель называет шапка, и строки её не повторяют; несколько
 * целей называют строки, а шапка — нет; без цели имени нет нигде.
 * Хиты цели до и после («HP: 47 → 42») — тоже в подробностях строки урона,
 * но видят их все, только если хиты цели открыты игрокам; иначе строка
 * уходит в подробности для мастера (`gmDetail`), которые сервер игрокам не
 * присылает.
 * Текстовая подпись броска (`label`) остаётся рядом — её показывают
 * всплывающие сообщения и ядро, которое блоков ещё не знает.
 *
 * @module system/dnd/attackChatBlocks
 */

import type { ChatBadge, ChatBlock, ChatBlockRow } from '@vtt/shared';

import type {
  DamageDefenseOutcome,
  DndDamageApplyResult,
  HpChangeDetail,
} from './damageUtils.js';

import { resolveDamageTypeLabel } from './damageConstants.js';

/** Каким видом идёт атака — от него значок в шапке карточки */
export type AttackChatKind = 'melee' | 'ranged' | 'spell';

/** Исход броска атаки, достаточный для плашки в карточке */
export interface AttackChatOutcome {
  /** Критическое попадание */
  isCriticalHit: boolean;
  /** Критический промах */
  isCriticalMiss: boolean;
  /** Попадание */
  isHit: boolean;
  /** Цели нет: попал ли бросок, решает мастер — плашки исхода нет */
  isHitUnknown?: boolean;
}

/** Значок заклинания в шапке карточки: атака заклинанием и сводка его урона */
export const SPELL_CHAT_ICON = 'tabler:wand';

/** Значки атаки по её виду: оружие и естественные атаки, выстрел, заклинание */
const ATTACK_CHAT_ICONS: Readonly<Record<AttackChatKind, string>> = {
  melee: 'tabler:sword',
  ranged: 'tabler:bow',
  spell: SPELL_CHAT_ICON,
};

/** Плашки исхода броска атаки */
const ATTACK_OUTCOME_BADGES = {
  critical: { label: 'Крит', accent: 'primary' },
  criticalMiss: { label: 'Крит. промах', accent: 'error' },
  hit: { label: 'Попадание', accent: 'success' },
  miss: { label: 'Промах', accent: 'error' },
} as const satisfies Record<string, ChatBadge>;

/** Пометка под шапкой атаки с помехой на дальней дистанции */
const ATTACK_LONG_RANGE_NOTE = 'Помеха (дальняя дистанция)';

/** Подписи и значки строк урона и лечения */
const DAMAGE_CHAT_LABELS = {
  damage: 'Урон',
  damageIcon: 'tabler:swords',
  healing: 'Лечение',
  healingIcon: 'tabler:heart-plus',
  tempHp: 'Временные ХП',
  tempHpIcon: 'tabler:shield-plus',
  hpSuffix: ' HP',
  tempHpSuffix: ' врем. HP',
  tempAbsorbedPrefix: 'врем. −',
  typesSeparator: ' и ',
  detailSeparator: ' · ',
} as const;

/** Подписи строки «хиты до и после» в подробностях строки урона */
const HP_CHANGE_LABELS = {
  hp: 'HP: ',
  temp: 'врем. HP: ',
  arrow: ' → ',
} as const;

/** Знак «минус» в итогах урона: с дефисом «-6» читается хуже */
const MINUS_SIGN = '−';

/** Значки типов урона */
const DAMAGE_TYPE_ICONS: Readonly<Record<string, string>> = {
  slashing: 'tabler:slice',
  piercing: 'tabler:needle',
  bludgeoning: 'tabler:hammer',
  fire: 'tabler:flame',
  cold: 'tabler:snowflake',
  lightning: 'tabler:bolt',
  thunder: 'tabler:volume',
  poison: 'tabler:flask',
  acid: 'tabler:droplet',
  necrotic: 'tabler:skull',
  radiant: 'tabler:sun',
  force: 'tabler:sparkles',
  psychic: 'tabler:brain',
};

/** Пометки сработавшей защиты цели в подробностях строки урона */
const DAMAGE_DEFENSE_NOTES: Readonly<
  Partial<Record<DamageDefenseOutcome, string>>
> = {
  immunity: 'иммунитет',
  resistance: 'сопротивление',
  vulnerability: 'уязвимость',
};

/** Параметры блока броска атаки */
export interface AttackChatBlockParams {
  /** Чем атакуют: оружие, действие существа, заклинание */
  name: string;
  /** Имя цели; нет — цель не выбрана */
  targetName?: string;
  /** Исход броска */
  result: AttackChatOutcome;
  /** Вид атаки; не задан — рукопашная */
  attackKind?: AttackChatKind;
  /** Атака с помехой из-за дальней дистанции */
  isDisadvantage?: boolean;
  /** Своя пометка под шапкой («Снаряд 2/3») — вместо пометки о помехе */
  note?: string;
}

/**
 * Плашка исхода броска атаки: «Крит», «Попадание», «Промах».
 *
 * @param result - исход броска
 * @returns плашка блока: ядро ставит её в строку итога броска; нет — исход
 *   без цели решает мастер
 */
function resolveAttackBadge(result: AttackChatOutcome): ChatBadge | undefined {
  if (result.isCriticalHit) {
    return ATTACK_OUTCOME_BADGES.critical;
  }

  if (result.isCriticalMiss) {
    return ATTACK_OUTCOME_BADGES.criticalMiss;
  }

  if (result.isHitUnknown) {
    return undefined;
  }

  return result.isHit ? ATTACK_OUTCOME_BADGES.hit : ATTACK_OUTCOME_BADGES.miss;
}

/**
 * Пометка под шапкой атаки: своя либо о помехе на дальней дистанции.
 *
 * @param params - параметры блока атаки
 * @returns поле `note` блока или пусто
 */
function resolveAttackNote(
  params: AttackChatBlockParams,
): Pick<ChatBlock, 'note'> {
  if (params.note) {
    return { note: params.note };
  }

  return params.isDisadvantage ? { note: ATTACK_LONG_RANGE_NOTE } : {};
}

/**
 * Блок броска атаки: значок вида атаки, чем бьют и по кому — шапкой, плашка
 * исхода — в строке итога броска. Слова «Атака» в нём нет — её называет
 * значок.
 *
 * @param params - чем, по кому и с каким исходом
 * @returns блок для `DiceRollData.block`
 */
export function buildAttackChatBlock(params: AttackChatBlockParams): ChatBlock {
  const badge = resolveAttackBadge(params.result);

  return {
    icon: ATTACK_CHAT_ICONS[params.attackKind ?? 'melee'],
    title: params.name,
    ...(params.targetName ? { target: params.targetName } : {}),
    ...(badge ? { badge } : {}),
    ...resolveAttackNote(params),
  };
}

/** Шапка карточки: чем действовали и по кому */
export interface ActionChatHeaderParams {
  /** Чем действовали: оружие, действие существа, заклинание */
  name: string;
  /** Имена всех целей действия; единственную называет шапка */
  targetNames?: readonly string[];
  /** Значок действия; не задан — шапка без значка */
  icon?: string;
}

/**
 * Имя цели для шапки карточки: единственная цель называется в шапке, и строки
 * её не повторяют. Целей несколько или нет вовсе — шапка без цели.
 *
 * @param targetNames - имена всех целей действия
 * @returns имя единственной цели или `undefined`
 */
export function pickHeaderTargetName(
  targetNames: readonly string[],
): string | undefined {
  const [onlyName, ...rest] = targetNames;

  return rest.length === 0 ? onlyName : undefined;
}

/**
 * Имя цели для строки итога: строки называют цель, только когда целей
 * несколько, — единственную уже назвала шапка.
 *
 * @param targetName - имя цели строки
 * @param targetCount - сколько целей у действия
 * @returns имя цели или `undefined`, если строке оно не нужно
 */
export function pickRowTargetName(
  targetName: string,
  targetCount: number,
): string | undefined {
  return targetCount > 1 ? targetName : undefined;
}

/**
 * Шапка отдельной карточки урона или сводки: значок, чем действовали и
 * единственная цель. В карточке атаки её роль играет шапка броска.
 *
 * @param params - действие, его цели и значок
 * @returns поля шапки блока; без названия — пусто (блок останется строками)
 */
export function buildActionChatHeader(
  params: ActionChatHeaderParams,
): Pick<ChatBlock, 'icon' | 'title' | 'target'> {
  if (!params.name) {
    return {};
  }

  const target = pickHeaderTargetName(params.targetNames ?? []);

  return {
    ...(params.icon ? { icon: params.icon } : {}),
    title: params.name,
    ...(target ? { target } : {}),
  };
}

/** Вид части урона или лечения — от него значок и название её строки */
export interface DamageChatKind {
  /** Часть лечит */
  isHealing?: boolean;
  /** Лечение временными хитами */
  healTemp?: boolean;
  /** Типы урона части (у лечения не нужны) */
  types?: readonly string[];
}

/**
 * Начало строки урона или лечения: значок и название вида («Силовой урон»,
 * «Рубящий урон и Огненный урон», «Лечение»), а перед ними — имя цели, когда
 * целей несколько.
 *
 * @param kind - вид части
 * @param targetName - имя цели для строки (см. {@link pickRowTargetName})
 * @returns значок, название и цель строки блока
 */
export function buildDamageChatRowLabel(
  kind: DamageChatKind,
  targetName?: string,
): Pick<ChatBlockRow, 'icon' | 'name' | 'target'> {
  const target = targetName ? { target: targetName } : {};

  if (kind.isHealing) {
    return kind.healTemp
      ? {
          icon: DAMAGE_CHAT_LABELS.tempHpIcon,
          name: DAMAGE_CHAT_LABELS.tempHp,
          ...target,
        }
      : {
          icon: DAMAGE_CHAT_LABELS.healingIcon,
          name: DAMAGE_CHAT_LABELS.healing,
          ...target,
        };
  }

  const types = kind.types ?? [];
  const labels = types.flatMap((type) => resolveDamageTypeLabel(type) ?? []);
  const [firstType] = types;

  return {
    icon:
      (types.length === 1 && firstType
        ? DAMAGE_TYPE_ICONS[firstType]
        : undefined) ?? DAMAGE_CHAT_LABELS.damageIcon,
    name:
      labels.length > 0
        ? labels.join(DAMAGE_CHAT_LABELS.typesSeparator)
        : DAMAGE_CHAT_LABELS.damage,
    ...target,
  };
}

/**
 * Итог строки урона или лечения: «−6 HP», «+4 HP», «+5 врем. HP».
 *
 * @param amount - сколько хитов снято или возвращено
 * @param kind - вид части
 * @returns значение и его цвет для строки блока
 */
export function formatHpChangeValue(
  amount: number,
  kind: DamageChatKind = {},
): Pick<ChatBlockRow, 'value' | 'accent'> {
  if (kind.isHealing) {
    return {
      value: `+${amount}${kind.healTemp ? DAMAGE_CHAT_LABELS.tempHpSuffix : DAMAGE_CHAT_LABELS.hpSuffix}`,
      accent: 'success',
    };
  }

  return {
    value: `${MINUS_SIGN}${amount}${DAMAGE_CHAT_LABELS.hpSuffix}`,
    accent: 'error',
  };
}

/**
 * Собирает подробности строки из частей, пропуская пустые.
 *
 * @param parts - части подробностей по порядку
 * @returns подробности одной строкой или `undefined`, если писать нечего
 */
export function joinChatDetail(
  parts: ReadonlyArray<string | undefined>,
): string | undefined {
  const filled = parts.flatMap((part) => (part ? [part] : []));

  return filled.length > 0
    ? filled.join(DAMAGE_CHAT_LABELS.detailSeparator)
    : undefined;
}

/**
 * Пометка сработавшей защиты цели: «сопротивление», «иммунитет».
 *
 * @param outcome - сработавшая защита
 * @returns пометка или `undefined`, если защита не сработала
 */
export function formatDamageDefenseNote(
  outcome: DamageDefenseOutcome | undefined,
): string | undefined {
  return outcome ? DAMAGE_DEFENSE_NOTES[outcome] : undefined;
}

/**
 * Хиты цели до и после одной строкой: «HP: 47 → 42», а если изменились и
 * временные — «HP: 47 → 42 · врем. HP: 5 → 0».
 *
 * @param change - хиты до и после
 * @returns строка или `undefined`, если хиты не изменились
 */
export function formatHpChangeDetail(
  change: HpChangeDetail,
): string | undefined {
  const { arrow } = HP_CHANGE_LABELS;
  const hasHpChange = change.hpBefore !== change.hpAfter;
  const hasTempChange = change.tempBefore !== change.tempAfter;

  if (!hasHpChange && !hasTempChange) {
    return undefined;
  }

  return joinChatDetail([
    `${HP_CHANGE_LABELS.hp}${change.hpBefore}${arrow}${change.hpAfter}`,
    hasTempChange
      ? `${HP_CHANGE_LABELS.temp}${change.tempBefore}${arrow}${change.tempAfter}`
      : undefined,
  ]);
}

/**
 * Дописывает в подробности строки хиты цели до и после. Открытые игрокам —
 * отдельной строкой в общих подробностях; скрытые — в подробности для
 * мастера: сервер вырезает их у всех остальных.
 *
 * @param row - строка блока
 * @param change - хиты до и после; нет — строка остаётся как есть
 * @returns строка с хитами в подробностях
 */
export function withHpChangeDetail(
  row: ChatBlockRow,
  change: HpChangeDetail | undefined,
): ChatBlockRow {
  const hpDetail = change ? formatHpChangeDetail(change) : undefined;

  if (!change || !hpDetail) {
    return row;
  }

  return change.isPublic
    ? { ...row, detail: row.detail ? `${row.detail}\n${hpDetail}` : hpDetail }
    : { ...row, gmDetail: hpDetail };
}

/** Где в блоках сводки стоит строка, итогом которой стали хиты цели */
export interface HpChangeRowPlacement {
  /** Номер блока в сводке */
  blockIndex: number;
  /** Номер строки в блоке */
  rowIndex: number;
  /** Хиты цели до и после */
  change: HpChangeDetail;
}

/**
 * Дописывает хиты целей до и после в названные строки сводки. Урон цели в
 * сводке разложен по частям, а хиты у неё одни — их называет последняя её
 * строка.
 *
 * @param blocks - блоки сводки
 * @param placements - какие строки и чьи хиты
 * @returns блоки с хитами в подробностях названных строк
 */
export function attachHpChangeDetails(
  blocks: readonly ChatBlock[],
  placements: readonly HpChangeRowPlacement[],
): ChatBlock[] {
  return blocks.map((block, blockIndex) => {
    const blockPlacements = placements.filter(
      (placement) => placement.blockIndex === blockIndex,
    );

    if (blockPlacements.length === 0 || !block.rows) {
      return block;
    }

    return {
      ...block,
      rows: block.rows.map((row, rowIndex) =>
        withHpChangeDetail(
          row,
          blockPlacements.find((placement) => placement.rowIndex === rowIndex)
            ?.change,
        ),
      ),
    };
  });
}

/** Чем дополнить строку урона одной цели */
export interface DamageChatRowOptions {
  /** Тип урона — от него значок и название строки */
  damageType?: string;
  /** Подробности перед пометками: формула и разбивка броска */
  detail?: string;
  /** Назвать цель в строке: целей у действия несколько */
  namesTarget?: boolean;
}

/**
 * Строка блока об уроне одной цели: вид урона и снятые хиты, а в подробностях
 * (в ленте они свёрнуты) — сколько поглотили временные хиты, какая защита
 * сработала и хиты цели до и после. Имя цели — только когда целей несколько.
 *
 * @param applyResult - итог применения урона к цели
 * @param options - тип урона, подробности броска и нужно ли имя цели
 * @returns строка блока
 */
export function buildDamageChatRow(
  applyResult: DndDamageApplyResult,
  options: DamageChatRowOptions = {},
): ChatBlockRow {
  const tempAbsorbed = applyResult.tempAbsorbed ?? 0;
  const totalDamage = applyResult.hpBefore - applyResult.hpAfter + tempAbsorbed;

  const rowDetail = joinChatDetail([
    options.detail,
    tempAbsorbed > 0
      ? `${DAMAGE_CHAT_LABELS.tempAbsorbedPrefix}${tempAbsorbed}`
      : undefined,
    formatDamageDefenseNote(applyResult.defenseOutcome),
  ]);

  return withHpChangeDetail(
    {
      ...buildDamageChatRowLabel(
        { types: options.damageType ? [options.damageType] : [] },
        options.namesTarget ? applyResult.actorName : undefined,
      ),
      ...formatHpChangeValue(totalDamage),
      ...(rowDetail ? { detail: rowDetail } : {}),
    },
    applyResult.hpChange,
  );
}

/**
 * Итог урона, который никому не достался: брошенное число в строке, а под
 * ним — свёрнутые подробности броска. Ни «цель не выбрана», ни строки «Без
 * цели» в карточке нет: что урон ушёл в пустоту, видно по самой строке.
 *
 * @param amount - брошенный урон
 * @param detail - формула и разбивка броска; нет — их покажет строка броска
 * @returns итог и подробности строки блока
 */
export function buildUnappliedDamageValue(
  amount: number,
  detail?: string,
): Pick<ChatBlockRow, 'value' | 'detail'> {
  return { value: `${amount}`, ...(detail ? { detail } : {}) };
}

/**
 * Блок броска урона одной формулой — одна строка без шапки: вид урона и
 * снятые хиты. Действие и цель называет шапка карточки: бросок атаки, в
 * карточку которого урон дописывается, либо {@link buildActionChatHeader} у
 * отдельной карточки. Без цели (урон никому не достался) — брошенное число.
 *
 * @param applyResult - итог применения урона; нет — урон никому не достался
 * @param damageType - тип урона
 * @param rolledTotal - брошенный урон: итог строки, когда цели нет
 * @returns блок для `DiceRollData.block`
 */
export function buildDamageChatBlock(
  applyResult?: DndDamageApplyResult | null,
  damageType?: string,
  rolledTotal?: number,
): ChatBlock {
  if (applyResult) {
    return { rows: [buildDamageChatRow(applyResult, { damageType })] };
  }

  return {
    rows: [
      {
        ...buildDamageChatRowLabel({ types: damageType ? [damageType] : [] }),
        ...(rolledTotal === undefined
          ? {}
          : buildUnappliedDamageValue(rolledTotal)),
      },
    ],
  };
}

/**
 * Блоки отдельной карточки: шапка (чем действовали и по кому) встаёт над
 * первым блоком строк. В карточке атаки она не нужна — действие названо
 * шапкой броска, — поэтому сами строки урона в обоих случаях одни и те же.
 *
 * @param header - шапка карточки (см. {@link buildActionChatHeader})
 * @param blocks - блоки урона, лечения и эффектов
 * @returns блоки для отдельного сообщения; без блоков — одна шапка
 */
export function headChatBlocks(
  header: Pick<ChatBlock, 'icon' | 'title' | 'target' | 'note'>,
  blocks: readonly ChatBlock[],
): ChatBlock[] {
  const [first, ...rest] = blocks;

  return first ? [{ ...first, ...header }, ...rest] : [{ ...header }];
}
