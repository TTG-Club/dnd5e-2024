/**
 * Заклинания существа блоками и группами (D&D 2024).
 *
 * Блок — набор заклинаний с общей заклинательной характеристикой, сложностью
 * спасброска и бонусом атаки: у зелёной карги «Магия шабаша» считается от
 * Интеллекта со Сл 11, а собственное «Использование заклинаний» — от Мудрости
 * со Сл 12. Поэтому числа живут у блока, а не у существа целиком.
 *
 * Внутри блока заклинания разложены группами — списками под одним ограничением
 * применений. Смыслы «каждое» и «на весь список» путать нельзя: «1/день каждое»
 * даёт по применению КАЖДОМУ заклинанию группы, «1/день» — одно применение на
 * ВСЮ группу.
 *
 * Устройство повторяет редактор бестиария сайта: те же режимы и те же поля.
 * Иначе выгрузка компендиума не легла бы в запись существа без догадок.
 *
 * Заклинания хранятся по-прежнему в `Creature.spells` — группа только ссылается
 * на них по `id`. Так каст, хотбар и отдых работают одним кодом и с блоками, и
 * без них.
 */

import type { AbilityType } from '@vtt/shared';

import type { CreatureRecharge } from './creatureTypes.js';
import type { DnDCreature, Spell, SpellUsesRecovery } from './dndEntities.js';

import { generateId, isRecord } from '@vtt/shared';

import { isAbilityType } from './consts.js';

// ── Типы ────────────────────────────────────────────────────────────────────

/**
 * Чем ограничены применения группы.
 *
 * Существо редакции 2024 ячеек не тратит: у него либо заклинание «по желанию»,
 * либо счётчик применений. Отдых, перезарядка и постоянное действие встречаются
 * у одиночных записей («Щит (1/отдых)», «Очарование (перезарядка 5–6)») и
 * заводятся тем же блоком.
 */
export type CreatureSpellUsageMode =
  | 'atWill'
  | 'perDayEach'
  | 'perDayPool'
  | 'perRestEach'
  | 'perRestPool'
  | 'recharge'
  | 'constant';

/**
 * Какой отдых возвращает применения группы. Значения общие со способом отката
 * заклинания ({@link SpellUsesRecovery}): группа задаёт заряды своих заклинаний,
 * и разойтись эти два набора не должны.
 */
export type CreatureSpellRestKind = 'shortRest' | 'longRest';

/** Заклинание группы: ссылка на запись `Creature.spells` и оговорки статблока. */
export interface CreatureSpellRef {
  /** `id` заклинания в `Creature.spells` */
  spellId: string;
  /**
   * Круг, которым существо накладывает заклинание: «Воображаемый убийца
   * (версия 6 уровня)». Пусто — заклинание идёт своим кругом.
   */
  castLevel?: number;
  /** Оговорка статблока: «только на себя», «длительностью 24 часа» */
  note?: string;
}

/** Применения группы, общие на весь её список (пуловые режимы) */
export interface CreatureSpellGroupUses {
  max: number;
  current: number;
}

/** Группа блока: список заклинаний под одним ограничением применений */
export interface CreatureSpellGroup {
  /**
   * Свой ключ группы. Названия для этого мало: у существа бывают две группы с
   * одинаковой подписью, а окну правки и счётчику применений нужно за что-то
   * держаться при перестановке.
   */
  id: string;
  mode: CreatureSpellUsageMode;
  /** Число применений; смысл задаёт режим — на каждое заклинание или на список */
  count?: number;
  /** Какой отдых возвращает применения; только у режимов «за отдых» */
  rest?: CreatureSpellRestKind;
  /** Условие перезарядки; только у режима перезарядки (подписью, как у действий) */
  recharge?: CreatureRecharge;
  /** Своя подпись группы вместо выведенной из режима */
  label?: string;
  /**
   * Общий счётчик применений — только у пуловых режимов. У «каждого» счётчики
   * лежат на самих заклинаниях (`Spell.uses`), и второго места для них нет.
   */
  uses?: CreatureSpellGroupUses;
  spells: CreatureSpellRef[];
}

/** Отметки «компонент блоку не требуется» */
export interface CreatureSpellIgnoredComponents {
  verbal: boolean;
  somatic: boolean;
  material: boolean;
}

/** Блок заклинаний существа: одни числа заклинательства и набор групп */
export interface CreatureSpellcastingBlock {
  id: string;
  name: string;
  /**
   * Условие блока текстом: «находясь в пределах 30 футов от как минимум двух
   * союзных карг». Числами такое не выразить, а терять его нельзя.
   */
  note?: string;
  ability?: AbilityType;
  /** Сложность спасброска блока; пусто — берутся числа существа */
  saveDC?: number;
  /** Бонус атаки заклинанием блока; пусто — берутся числа существа */
  attackBonus?: number;
  ignoredComponents?: CreatureSpellIgnoredComponents;
  groups: CreatureSpellGroup[];
}

/** Где в блоках существа лежит заклинание */
export interface CreatureSpellPlacement {
  block: CreatureSpellcastingBlock;
  group: CreatureSpellGroup;
  ref: CreatureSpellRef;
}

// ── Режимы ──────────────────────────────────────────────────────────────────

/** Режимы, у которых спрашивается число применений */
const COUNTED_MODES: ReadonlySet<CreatureSpellUsageMode> = new Set([
  'perDayEach',
  'perDayPool',
  'perRestEach',
  'perRestPool',
]);

/** Режимы, у которых спрашивается вид отдыха */
const REST_MODES: ReadonlySet<CreatureSpellUsageMode> = new Set([
  'perRestEach',
  'perRestPool',
]);

/** Режимы, у которых счётчик один на всю группу */
const POOL_MODES: ReadonlySet<CreatureSpellUsageMode> = new Set([
  'perDayPool',
  'perRestPool',
]);

/** Режимы, у которых свой счётчик у каждого заклинания группы */
const EACH_MODES: ReadonlySet<CreatureSpellUsageMode> = new Set([
  'perDayEach',
  'perRestEach',
]);

/** Наименьшее число применений: ноль применений — это их отсутствие */
export const MIN_CREATURE_SPELL_COUNT = 1;

/**
 * Отдых, который подставляется группе «за отдых». Продолжительный: короткий
 * отдых в статблоках 2024 встречается единично.
 */
export const DEFAULT_CREATURE_SPELL_REST: CreatureSpellRestKind = 'longRest';

/**
 * Число применений спрашивается у этой группы.
 *
 * @param mode - режим группы
 * @returns `true` — поле количества показывается
 */
export function isCreatureSpellCountMode(
  mode: CreatureSpellUsageMode,
): boolean {
  return COUNTED_MODES.has(mode);
}

/**
 * Вид отдыха спрашивается у этой группы.
 *
 * @param mode - режим группы
 * @returns `true` — поле отдыха показывается
 */
export function isCreatureSpellRestMode(mode: CreatureSpellUsageMode): boolean {
  return REST_MODES.has(mode);
}

/**
 * Счётчик группы один на весь её список.
 *
 * @param mode - режим группы
 * @returns `true` — применения считаются группой, а не заклинаниями
 */
export function isCreatureSpellPoolMode(mode: CreatureSpellUsageMode): boolean {
  return POOL_MODES.has(mode);
}

/**
 * У каждого заклинания группы свой счётчик применений.
 *
 * @param mode - режим группы
 * @returns `true` — заряды лежат на самих заклинаниях
 */
export function isCreatureSpellEachMode(mode: CreatureSpellUsageMode): boolean {
  return EACH_MODES.has(mode);
}

/**
 * Способ отката группы: чем возвращаются её применения.
 *
 * «В день» в редакции 2024 — это рассвет; ближайший к нему отдых у нас
 * продолжительный. У режимов без счётчика отката нет — они «по желанию».
 *
 * @param group - группа
 * @returns способ отката для зарядов заклинаний группы
 */
export function getCreatureSpellGroupRecovery(
  group: CreatureSpellGroup,
): SpellUsesRecovery {
  if (isCreatureSpellRestMode(group.mode)) {
    return group.rest ?? DEFAULT_CREATURE_SPELL_REST;
  }

  return isCreatureSpellCountMode(group.mode) ? 'longRest' : 'atWill';
}

// ── Заготовки ───────────────────────────────────────────────────────────────

/**
 * Пустая группа: по умолчанию «по желанию» — самый частый режим в книгах.
 *
 * @returns новая группа без заклинаний
 */
export function createEmptyCreatureSpellGroup(): CreatureSpellGroup {
  return {
    id: generateId('spellgroup'),
    mode: 'atWill',
    spells: [],
  };
}

/**
 * Пустой блок заклинаний. Название подставлено книжное: так называется запись
 * в большинстве статблоков, и переписывать его приходится редко.
 *
 * @returns новый блок без групп
 */
export function createEmptyCreatureSpellcastingBlock(): CreatureSpellcastingBlock {
  return {
    id: generateId('spellblock'),
    name: 'Использование заклинаний',
    ignoredComponents: { verbal: false, somatic: false, material: false },
    groups: [],
  };
}

// ── Счёт и поиск ────────────────────────────────────────────────────────────

/**
 * Сколько заклинаний заведено в блоке — число для бейджа свёрнутой строки.
 *
 * @param block - блок заклинаний
 * @returns количество ссылок на заклинания во всех группах блока
 */
export function getCreatureSpellcastingSpellCount(
  block: CreatureSpellcastingBlock,
): number {
  return block.groups.reduce((total, group) => total + group.spells.length, 0);
}

/**
 * Ищет, в какой группе какого блока лежит заклинание.
 *
 * Нужен там, где строки списка нет: хотбару и макросам приезжает только `id`
 * заклинания, а числа каста и круг наложения задаёт блок с группой.
 *
 * @param blocks - блоки заклинаний существа
 * @param spellId - `id` заклинания
 * @returns блок, группа и ссылка либо `undefined`, если заклинания у него нет
 */
export function findCreatureSpellPlacement(
  blocks: readonly CreatureSpellcastingBlock[] | undefined,
  spellId: string,
): CreatureSpellPlacement | undefined {
  for (const block of blocks ?? []) {
    for (const group of block.groups) {
      const ref = group.spells.find((entry) => entry.spellId === spellId);

      if (ref) {
        return { block, group, ref };
      }
    }
  }

  return undefined;
}

/**
 * `id` заклинаний, разложенных по группам.
 *
 * @param blocks - блоки заклинаний существа
 * @returns набор `id` заклинаний, разложенных по группам
 */
export function collectCreatureSpellIdsInBlocks(
  blocks: readonly CreatureSpellcastingBlock[] | undefined,
): Set<string> {
  const ids = new Set<string>();

  for (const block of blocks ?? []) {
    for (const group of block.groups) {
      for (const ref of group.spells) {
        ids.add(ref.spellId);
      }
    }
  }

  return ids;
}

/**
 * Ограничение применений, которым описываются заряды заклинания.
 *
 * Нужно, когда заклинание надо положить в группу, а группы у него ещё нет:
 * заряды записи — единственное, что о его ограничении известно.
 *
 * @param spell - заклинание
 * @returns режим, число применений и вид отдыха для группы
 */
function describeSpellUsage(spell: Spell): {
  mode: CreatureSpellUsageMode;
  count?: number;
  rest?: CreatureSpellRestKind;
} {
  const uses = spell.uses;

  if (!uses || uses.recovery === 'atWill') {
    return { mode: 'atWill' };
  }

  const count = Math.max(MIN_CREATURE_SPELL_COUNT, Math.round(uses.max));

  if (uses.recovery === 'shortRest') {
    return { mode: 'perRestEach', count, rest: 'shortRest' };
  }

  return { mode: 'perDayEach', count };
}

/**
 * Раскладывает по группам заклинания, которые ни в одну не попали.
 *
 * Заклинание существа вне блока не живёт: блок задаёт, чем существо колдует,
 * и заклинание без блока не знало бы ни Сл спасброска, ни бонуса атаки. Такие
 * заклинания появляются у записей, заведённых до групп, и у перетащенных на
 * лист — их надо не показывать отдельным списком, а положить в группу.
 *
 * Группа подбирается по зарядам записи: без зарядов — «по желанию», с зарядами
 * — «N в день каждое» либо «N за короткий отдых каждое». Подходящая группа
 * первого блока переиспользуется, а если её нет — заводится рядом.
 *
 * @param spells - заклинания существа
 * @param blocks - блоки заклинаний
 * @param targetBlockId - блок, в который класть: на него бросили заклинание.
 *   Без него берётся первый блок существа
 * @returns блоки, в которых лежат все заклинания существа
 */
export function ensureCreatureSpellsInBlocks(
  spells: readonly Spell[],
  blocks: readonly CreatureSpellcastingBlock[],
  targetBlockId?: string,
): CreatureSpellcastingBlock[] {
  const assigned = collectCreatureSpellIdsInBlocks(blocks);

  const orphans = spells.filter((spell) => !assigned.has(spell.id));

  if (!orphans.length) {
    return [...blocks];
  }

  const nextBlocks = blocks.map((block) => ({
    ...block,
    groups: block.groups.map((group) => ({ ...group })),
  }));

  // Названный блок — тот, на который заклинание бросили; без него первый: он
  // же и единственный у подавляющего большинства существ, и раскладка не
  // расползается по концу списка
  let target =
    (targetBlockId
      ? nextBlocks.find((block) => block.id === targetBlockId)
      : undefined) ?? nextBlocks[0];

  if (!target) {
    target = createEmptyCreatureSpellcastingBlock();
    nextBlocks.push(target);
  }

  for (const spell of orphans) {
    const usage = describeSpellUsage(spell);

    const group = target.groups.find(
      (entry) =>
        entry.mode === usage.mode
        && entry.count === usage.count
        && entry.rest === usage.rest
        && !entry.recharge,
    );

    if (group) {
      group.spells = [...group.spells, { spellId: spell.id }];

      continue;
    }

    target.groups.push({
      ...createEmptyCreatureSpellGroup(),
      ...usage,
      spells: [{ spellId: spell.id }],
    });
  }

  return nextBlocks;
}

/**
 * Блоки заклинаний существа — пустой список, если их нет.
 *
 * @param creature - существо
 * @returns блоки заклинаний
 */
export function getCreatureSpellcastingBlocks(
  creature: DnDCreature,
): CreatureSpellcastingBlock[] {
  return creature.system.spellcastingBlocks ?? [];
}

// ── Применения ──────────────────────────────────────────────────────────────

/**
 * Подрезает текущее число применений к отрезку `0…max`.
 *
 * @param current - текущее число применений (может отсутствовать)
 * @param max - максимум применений
 * @returns число в границах
 */
function clampUses(current: number | undefined, max: number): number {
  if (current === undefined || !Number.isFinite(current)) {
    return max;
  }

  return Math.min(Math.max(Math.round(current), 0), max);
}

/**
 * Максимум применений группы: меньше одного применения не бывает.
 *
 * @param group - группа
 * @returns максимум применений
 */
function getGroupMax(group: CreatureSpellGroup): number {
  return Math.max(MIN_CREATURE_SPELL_COUNT, Math.round(group.count ?? 1));
}

/**
 * Снимает заряды с заклинания, не трогая остальную запись.
 *
 * @param spell - заклинание
 * @returns заклинание без поля зарядов
 */
function withoutSpellUses(spell: Spell): Spell {
  if (!spell.uses) {
    return spell;
  }

  const { uses: _uses, ...rest } = spell;

  return rest;
}

/**
 * Снимает общий счётчик с группы, не трогая остальные её поля.
 *
 * @param group - группа
 * @returns группа без общего счётчика
 */
function withoutGroupUses(group: CreatureSpellGroup): CreatureSpellGroup {
  if (!group.uses) {
    return group;
  }

  const { uses: _uses, ...rest } = group;

  return rest;
}

/**
 * Приводит заряды группы и её заклинаний к выбранному режиму.
 *
 * Режим — источник истины: он задаёт и максимум применений, и способ отката.
 * Текущее число применений сохраняется и подрезается по новому максимуму —
 * иначе смена «2 в день» на «1 в день» оставила бы существу два применения.
 *
 * Заклинания, выпавшие из группы, эта функция не трогает: их заряды сняла бы
 * та группа, в которую их положили, а эта о них уже ничего не знает.
 *
 * @param spells - заклинания существа
 * @param group - группа после правки
 * @returns заклинания и группа с приведёнными зарядами
 */
export function syncCreatureSpellGroupUses(
  spells: readonly Spell[],
  group: CreatureSpellGroup,
): { spells: Spell[]; group: CreatureSpellGroup } {
  const memberIds = new Set(group.spells.map((ref) => ref.spellId));

  if (isCreatureSpellEachMode(group.mode)) {
    const max = getGroupMax(group);
    const recovery = getCreatureSpellGroupRecovery(group);

    return {
      spells: spells.map((spell) =>
        memberIds.has(spell.id)
          ? {
              ...spell,
              uses: {
                max,
                current: clampUses(spell.uses?.current, max),
                recovery,
              },
            }
          : spell,
      ),
      group: withoutGroupUses(group),
    };
  }

  const clearedSpells = spells.map((spell) =>
    memberIds.has(spell.id) ? withoutSpellUses(spell) : spell,
  );

  if (isCreatureSpellPoolMode(group.mode)) {
    const max = getGroupMax(group);

    return {
      spells: clearedSpells,
      group: {
        ...group,
        uses: { max, current: clampUses(group.uses?.current, max) },
      },
    };
  }

  return { spells: clearedSpells, group: withoutGroupUses(group) };
}

/**
 * Приводит заряды всех групп блоков разом.
 *
 * Нужен там, где правка задела сразу многое: заклинание убрали из одной группы
 * и добавили в другую, блок удалили целиком.
 *
 * @param spells - заклинания существа
 * @param blocks - блоки заклинаний
 * @returns заклинания и блоки с приведёнными зарядами
 */
export function syncCreatureSpellcastingUses(
  spells: readonly Spell[],
  blocks: readonly CreatureSpellcastingBlock[],
): { spells: Spell[]; blocks: CreatureSpellcastingBlock[] } {
  let nextSpells: Spell[] = [...spells];

  const nextBlocks = blocks.map((block) => ({
    ...block,
    groups: block.groups.map((group) => {
      const synced = syncCreatureSpellGroupUses(nextSpells, group);

      nextSpells = synced.spells;

      return synced.group;
    }),
  }));

  return { spells: nextSpells, blocks: nextBlocks };
}

/**
 * Есть ли у группы с общим счётчиком нерастраченные применения.
 *
 * @param group - группа
 * @returns `false` — счётчик пуст и заклинание группы применить нельзя
 */
export function hasCreatureSpellGroupUsesLeft(
  group: CreatureSpellGroup,
): boolean {
  if (!isCreatureSpellPoolMode(group.mode) || !group.uses) {
    return true;
  }

  return group.uses.current > 0;
}

/**
 * Остались ли применения у заклинания существа: и у группы, из которой оно
 * кастуется, и у него самого. Правило одно на лист и на макрос хотбара — иначе
 * заклинание, кончившееся на листе, из хотбара кастовалось бы дальше.
 *
 * @param spell - заклинание существа
 * @param placement - место заклинания в блоках; без него считается только своё
 * @returns `true`, если каст возможен
 */
export function hasCreatureSpellUsesLeft(
  spell: Spell,
  placement: CreatureSpellPlacement | undefined,
): boolean {
  if (placement && !hasCreatureSpellGroupUsesLeft(placement.group)) {
    return false;
  }

  return (
    !spell.uses || spell.uses.recovery === 'atWill' || spell.uses.current > 0
  );
}

/**
 * Списывает одно применение общего счётчика группы.
 *
 * @param blocks - блоки заклинаний существа
 * @param groupId - ключ группы
 * @returns блоки со списанным применением
 */
export function consumeCreatureSpellGroupUse(
  blocks: readonly CreatureSpellcastingBlock[],
  groupId: string,
): CreatureSpellcastingBlock[] {
  return blocks.map((block) => ({
    ...block,
    groups: block.groups.map((group) =>
      group.id === groupId && group.uses
        ? {
            ...group,
            uses: {
              ...group.uses,
              current: Math.max(0, group.uses.current - 1),
            },
          }
        : group,
    ),
  }));
}

/**
 * Восстанавливает общие счётчики групп на отдыхе.
 *
 * Короткий отдых возвращает только группы «за короткий отдых»; продолжительный
 * возвращает всё — он включает в себя короткий, как и у зарядов заклинаний.
 *
 * @param blocks - блоки заклинаний существа
 * @param restType - вид отдыха
 * @returns блоки с восстановленными счётчиками
 */
export function restoreCreatureSpellGroupUses(
  blocks: readonly CreatureSpellcastingBlock[],
  restType: 'short' | 'long',
): CreatureSpellcastingBlock[] {
  return blocks.map((block) => ({
    ...block,
    groups: block.groups.map((group) => {
      if (!group.uses) {
        return group;
      }

      const recovery = getCreatureSpellGroupRecovery(group);

      const restored =
        restType === 'long'
          ? recovery === 'shortRest' || recovery === 'longRest'
          : recovery === 'shortRest';

      return restored
        ? { ...group, uses: { ...group.uses, current: group.uses.max } }
        : group;
    }),
  }));
}

// ── Разбор приехавшей записи ────────────────────────────────────────────────

/**
 * Написания режимов на стороне сайта. Выгрузка компендиума собирается из формы
 * бестиария, а там перечисления заглавные (`AT_WILL`); принимаем оба написания,
 * иначе приехавшая группа молча стала бы «по желанию».
 */
const RAW_USAGE_MODES: Record<string, CreatureSpellUsageMode> = {
  AT_WILL: 'atWill',
  PER_DAY_EACH: 'perDayEach',
  PER_DAY_POOL: 'perDayPool',
  PER_REST_EACH: 'perRestEach',
  PER_REST_POOL: 'perRestPool',
  RECHARGE: 'recharge',
  CONSTANT: 'constant',
  atWill: 'atWill',
  perDayEach: 'perDayEach',
  perDayPool: 'perDayPool',
  perRestEach: 'perRestEach',
  perRestPool: 'perRestPool',
  recharge: 'recharge',
  constant: 'constant',
};

/** Написания вида отдыха на стороне сайта */
const RAW_REST_KINDS: Record<string, CreatureSpellRestKind> = {
  SHORT: 'shortRest',
  LONG: 'longRest',
  short: 'shortRest',
  long: 'longRest',
  shortRest: 'shortRest',
  longRest: 'longRest',
};

/** Условия перезарядки — те же ключи, что у действий существа */
const RECHARGE_KEYS: readonly CreatureRecharge[] = [
  'd3',
  'd4',
  'd5',
  'd6',
  'slr',
  'lr',
];

/**
 * Целое число из «сырого» значения.
 *
 * @param value - «сырое» значение
 * @returns число либо `undefined`
 */
function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;

  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.round(parsed)
    : undefined;
}

/**
 * Непустая строка из «сырого» значения.
 *
 * @param value - «сырое» значение
 * @returns строка либо `undefined`
 */
function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Разбирает ссылку на заклинание группы.
 *
 * Ключ заклинания понимается тремя написаниями: `spellId` пишет мир, `id` —
 * выгрузка компендиума (там это слаг карточки, и он же становится `id` записи
 * заклинания), `url` — форма бестиария на сайте.
 *
 * @param raw - «сырая» ссылка
 * @returns ссылка на заклинание либо `undefined`
 */
function readSpellRef(raw: unknown): CreatureSpellRef | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const spellId =
    readText(raw.spellId) ?? readText(raw.id) ?? readText(raw.url);

  if (!spellId) {
    return undefined;
  }

  return {
    spellId,
    castLevel: readNumber(raw.castLevel),
    note: readText(raw.note),
  };
}

/**
 * Разбирает группу блока.
 *
 * @param raw - «сырая» группа
 * @returns группа либо `undefined`
 */
function readGroup(raw: unknown): CreatureSpellGroup | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const rawSpells = Array.isArray(raw.spells) ? raw.spells : [];

  const rawRecharge = readText(raw.recharge)?.toLowerCase();

  const group: CreatureSpellGroup = {
    id: readText(raw.id) ?? generateId('spellgroup'),
    mode: RAW_USAGE_MODES[String(raw.mode)] ?? 'atWill',
    count: readNumber(raw.count),
    rest: RAW_REST_KINDS[String(raw.rest)],
    recharge: RECHARGE_KEYS.find((key) => key === rawRecharge),
    label: readText(raw.label),
    spells: rawSpells
      .map(readSpellRef)
      .filter((ref): ref is CreatureSpellRef => ref !== undefined),
  };

  if (isRecord(raw.uses)) {
    const max = readNumber(raw.uses.max);

    if (max !== undefined) {
      group.uses = {
        max,
        current: clampUses(readNumber(raw.uses.current), max),
      };
    }
  }

  return group;
}

/**
 * Разбирает блоки заклинаний приехавшей записи.
 *
 * Разбором, а не приведением типа: запись приезжает и из мира, и из выгрузки
 * сайта, где написания перечислений свои. Ссылки на заклинания, которых у
 * существа нет, выбрасываются — строка без записи всё равно ничего не покажет
 * и не скастуется. Повторная ссылка на то же заклинание тоже: оно остаётся в
 * той группе, где встретилось первым.
 *
 * Заряды здесь не приводятся: их задаёт режим группы, и вместе с блоками
 * меняются сами заклинания — это делает {@link syncCreatureSpellcastingUses},
 * которому есть куда вернуть и то, и другое.
 *
 * @param raw - значение поля `spellcastingBlocks`
 * @param spells - заклинания существа
 * @returns разобранные блоки заклинаний
 */
export function normalizeCreatureSpellcastingBlocks(
  raw: unknown,
  spells: readonly Spell[],
): CreatureSpellcastingBlock[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const knownIds = new Set(spells.map((spell) => spell.id));

  // Заклинания, уже разложенные по группам: на листе существа запись одна, и
  // счётчик у неё один — вторая ссылка на то же заклинание спорила бы с первой
  // за его заряды, а каст брал бы числа не того блока. В выгрузке такое бывает:
  // на сайте одно заклинание разрешено завести в двух группах, а запись
  // справочника оттуда приезжает одна — по первой группе, где оно встретилось
  const taken = new Set<string>();

  /**
   * Ссылки группы, годные к показу: заклинание у существа есть и ни в какую
   * группу до этой не попало.
   *
   * @param group - разобранная группа
   * @returns ссылки, которые остаются за этой группой
   */
  function pickRefs(group: CreatureSpellGroup): CreatureSpellRef[] {
    const result: CreatureSpellRef[] = [];

    for (const ref of group.spells) {
      if (!knownIds.has(ref.spellId) || taken.has(ref.spellId)) {
        continue;
      }

      taken.add(ref.spellId);
      result.push(ref);
    }

    return result;
  }

  const blocks: CreatureSpellcastingBlock[] = [];

  for (const rawBlock of raw) {
    if (!isRecord(rawBlock)) {
      continue;
    }

    const rawGroups = Array.isArray(rawBlock.groups) ? rawBlock.groups : [];

    const rawAbility = readText(rawBlock.ability);

    const components = isRecord(rawBlock.ignoredComponents)
      ? rawBlock.ignoredComponents
      : undefined;

    blocks.push({
      id: readText(rawBlock.id) ?? generateId('spellblock'),
      name: readText(rawBlock.name) ?? 'Использование заклинаний',
      note: readText(rawBlock.note),
      ability: isAbilityType(rawAbility) ? rawAbility : undefined,
      saveDC: readNumber(rawBlock.saveDC) ?? readNumber(rawBlock.saveDc),
      attackBonus: readNumber(rawBlock.attackBonus),
      ignoredComponents: {
        verbal: components?.verbal === true,
        somatic: components?.somatic === true,
        material: components?.material === true,
      },
      groups: rawGroups
        .map(readGroup)
        .filter((group): group is CreatureSpellGroup => group !== undefined)
        .map((group) => ({ ...group, spells: pickRefs(group) })),
    });
  }

  return blocks;
}
