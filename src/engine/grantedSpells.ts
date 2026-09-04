/**
 * Утилиты заклинаний, автоматически предоставляемых умениями (granted spells).
 *
 * Умения классов, видов, предысторий и черт могут содержать поле
 * `grantedSpells` — список ID заклинаний компендиума, которые персонаж
 * получает автоматически (напр. «Избранный враг» следопыта даёт
 * «Метку охотника»). Такие заклинания всегда подготовлены и не тратят
 * лимит ручного выбора заклинаний.
 */

import type { AbilityType } from '@vtt/shared';

import type { Spell } from './dndEntities.js';
import type { GrantedSpellRef } from './speciesTypes.js';

import { generateId } from '@vtt/shared';

// ── Типы ──────────────────────────────────────────────────────

/** Минимальная форма умения, способного предоставлять заклинания */
export interface FeatureWithGrantedSpells {
  /** Название умения (используется как источник в бейджах и при откате) */
  name: string;
  /** ID заклинаний компендиума, предоставляемых умением */
  grantedSpells?: string[];
}

/** Связь «заклинание компендиума → умение-источник» */
export interface GrantedSpellSource {
  /** ID заклинания в компендиуме */
  spellId: string;
  /** Название умения, предоставившего заклинание */
  featureName: string;
  /** Предпочтённый пак-компендиум (id манифеста); откат — любой пак по `spellId`. */
  packId?: string;
  /**
   * Заклинание не нужно готовить. По умолчанию (`undefined`) — нужно: так устроены
   * заклинания черт, где выдача занимает подготовку. У врождённых заклинаний вида
   * источник ставит флаг явно.
   */
  alwaysPrepared?: boolean;
  /**
   * Заклинательная характеристика умения-источника. Не задана — берётся общая
   * характеристика листа (класс-заклинатель).
   */
  castingAbility?: AbilityType;
}

/**
 * Запрос «выдать весь список класса» — уже с проверенным уровнем и посчитанным
 * кругом.
 *
 * Отдельно от {@link GrantedSpellSource}: там связь с конкретной записью, а здесь
 * правило, по которому записи ещё предстоит найти. Разворачивает его
 * {@link expandClassSpellRequests} — там, где загружен компендиум.
 */
export interface ClassSpellListRequest {
  /** Ключи классов, чьи списки выдаются (сверяются со `Spell.classKeys`) */
  classKeys: string[];
  /** Название умения-источника: с ним заклинание ложится на лист и им же снимается */
  featureName: string;
  /** Паки, из которых брать заклинания; пусто — из всех доступных */
  spellPackIds?: string[];
  /** Ровно этот круг; пусто — круг сверху не ограничен */
  level?: number;
  /**
   * Не выше этого круга; пусто — верхней границы нет. У группы «по ячейкам» сюда уже
   * подставлен наибольший круг, который персонаж способен наложить.
   */
  maxLevel?: number;
  /** Заклинание не нужно готовить (см. {@link GrantedSpellSource.alwaysPrepared}) */
  alwaysPrepared?: boolean;
  /** Заклинательная характеристика умения-источника */
  castingAbility?: AbilityType;
}

/** Заклинания одного пака — вход разворота списков классов. */
export interface ClassSpellPack {
  packId: string;
  spells: Spell[];
}

/** Заклинание компендиума, сопоставленное с умением-источником */
export interface ResolvedGrantedSpell {
  /** Полные данные заклинания из компендиума */
  spell: Spell;
  /** Название умения, предоставившего заклинание */
  featureName: string;
  /** Заклинание не нужно готовить (см. {@link GrantedSpellSource.alwaysPrepared}) */
  alwaysPrepared?: boolean;
  /** Заклинательная характеристика умения-источника */
  castingAbility?: AbilityType;
}

// ── Утилиты ───────────────────────────────────────────────────

/**
 * Собирает связи «заклинание → умение-источник» из списка умений.
 *
 * @param features - умения (класса, вида, черты), возможно с `grantedSpells`
 * @returns плоский список связей без дубликатов по ID заклинания
 */
export function collectGrantedSpellSources(
  features: ReadonlyArray<FeatureWithGrantedSpells>,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  for (const feature of features) {
    for (const spellId of feature.grantedSpells ?? []) {
      if (seenSpellIds.has(spellId)) {
        continue;
      }

      seenSpellIds.add(spellId);
      sources.push({ spellId, featureName: feature.name });
    }
  }

  return sources;
}

/**
 * Умение класса с поуровневой выдачей заклинаний.
 *
 * Расширяет {@link FeatureWithGrantedSpells} уровнем получения умения
 * и картой «уровень класса → ID заклинаний» для списков, выдаваемых
 * частями (домены жреца, клятвы паладина, покровители колдуна).
 */
export interface LeveledFeatureWithGrantedSpells extends FeatureWithGrantedSpells {
  /** Уровень класса, на котором умение получается */
  level?: number;
  /** Поуровневая выдача: ключ — уровень класса (строка «1»–«20») */
  grantedSpellsByLevel?: Record<string, string[]>;
  /**
   * Блоб даров умения: в полях записи заклинание лежит одним id, а характеристику
   * и подготовку задаёт группа выдачи — они уезжают вместе со ссылкой в блоб.
   * Отсюда они и берутся, чтобы поля записи и блоб не разошлись.
   */
  featData?: { grantedSpells?: GrantedSpellRef[] };
}

/**
 * Собирает granted-заклинания, получаемые ровно на указанном уровне класса.
 *
 * Учитываются два источника:
 * - `grantedSpells` умений, получаемых именно на этом уровне;
 * - `grantedSpellsByLevel[level]` всех умений, полученных не позже этого
 *   уровня (поуровневые списки доменов/клятв/покровителей).
 *
 * @param features - все умения класса и активного подкласса
 * @param classLevel - получаемый уровень класса
 * @returns плоский список связей без дубликатов по ID заклинания
 */
export function collectGrantedSpellSourcesForClassLevel(
  features: ReadonlyArray<LeveledFeatureWithGrantedSpells>,
  classLevel: number,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  for (const feature of features) {
    const gainedAtLevel = feature.level ?? 1;

    if (gainedAtLevel > classLevel) {
      continue;
    }

    const spellIds: string[] = [];

    if (gainedAtLevel === classLevel) {
      spellIds.push(...(feature.grantedSpells ?? []));
    }

    spellIds.push(
      ...(feature.grantedSpellsByLevel?.[String(classLevel)] ?? []),
    );

    const groupBySpellId = new Map(
      (feature.featData?.grantedSpells ?? [])
        .filter((ref): ref is GrantedSpellRef & { spellId: string } =>
          Boolean(ref.spellId),
        )
        .map((ref) => [ref.spellId, ref]),
    );

    for (const spellId of spellIds) {
      if (seenSpellIds.has(spellId)) {
        continue;
      }

      seenSpellIds.add(spellId);

      const group = groupBySpellId.get(spellId);

      sources.push({
        spellId,
        featureName: feature.name,
        alwaysPrepared: group?.alwaysPrepared,
        castingAbility: group?.spellcastingAbility,
      });
    }
  }

  return sources;
}

/**
 * Разворачивает запросы «весь список класса» в связи «заклинание → умение-источник».
 *
 * Разворот здесь, а не у сборщика запросов: каталог загружается лениво и только тем,
 * кто действительно выдаёт заклинания, — а сборщик работает и без компендиума, в
 * мастерах и на дропе.
 *
 * Круг проверяется тем же кодом, что и у выбора заклинаний
 * (`matchesFeatSpellFilter`), — здесь он повторён своим сравнением ради того, чтобы
 * движок выдачи не зависел от модуля выборов; правило одно: «ровно круг» либо «не
 * выше круга».
 *
 * @param requests - запросы, собранные {@link collectFeatGrantedClassSpellRequests}
 * @param packs - заклинания компендиума по пакам (плюс заклинания самого мира)
 * @returns связи без дубликатов по id заклинания
 */
export function expandClassSpellRequests(
  requests: ReadonlyArray<ClassSpellListRequest>,
  packs: ReadonlyArray<ClassSpellPack>,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  for (const request of requests) {
    if (request.classKeys.length === 0) {
      continue;
    }

    const allowedPacks = request.spellPackIds?.length
      ? packs.filter((pack) => request.spellPackIds?.includes(pack.packId))
      : packs;

    for (const pack of allowedPacks) {
      for (const spell of pack.spells) {
        if (
          seenSpellIds.has(spell.id)
          || !matchesClassSpellRequest(spell, request)
        ) {
          continue;
        }

        seenSpellIds.add(spell.id);

        sources.push({
          spellId: spell.id,
          featureName: request.featureName,
          packId: pack.packId,
          alwaysPrepared: request.alwaysPrepared,
          castingAbility: request.castingAbility,
        });
      }
    }
  }

  return sources;
}

/**
 * Подходит ли заклинание под запрос: и по классу, и по кругу.
 *
 * @param spell - заклинание компендиума
 * @param request - запрос списка класса
 */
function matchesClassSpellRequest(
  spell: Spell,
  request: ClassSpellListRequest,
): boolean {
  const spellClasses = spell.classKeys ?? [];

  if (!spellClasses.some((key) => request.classKeys.includes(key))) {
    return false;
  }

  if (request.level !== undefined && spell.level !== request.level) {
    return false;
  }

  return request.maxLevel === undefined || spell.level <= request.maxLevel;
}

/**
 * Нормализует название заклинания для сравнения на дубликаты.
 *
 * @param name - название заклинания
 * @returns название без крайних пробелов в нижнем регистре
 */
export function normalizeSpellName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Добавляет granted-заклинания в список заклинаний актора.
 *
 * Дубликаты отсеиваются по нормализованному названию (при добавлении в лист
 * персонажа заклинанию выдаётся новый id, поэтому id компендиума с ним
 * никогда не совпадает). Каждое добавленное заклинание получает
 * `grantedByFeature` с названием умения-источника.
 *
 * Подготовка берётся у источника: врождённые заклинания вида готовить не нужно,
 * а черта решает сама — по умолчанию заклинание ложится в книгу наравне с
 * остальными и подготовку занимает. Заклинательная характеристика источника, если
 * она задана, проставляется заклинанию и потому меняет его атаку и сложность
 * спасброска.
 *
 * @param existingSpells - текущий список заклинаний актора
 * @param grantedSpells - granted-заклинания с умениями-источниками
 * @returns новый список заклинаний (исходный не мутируется)
 */
export function appendGrantedSpells(
  existingSpells: Spell[],
  grantedSpells: ResolvedGrantedSpell[],
): Spell[] {
  const result = [...existingSpells];

  const existingNames = new Set(
    result.map((spell) => normalizeSpellName(spell.name)),
  );

  for (const granted of grantedSpells) {
    const normalizedName = normalizeSpellName(granted.spell.name);

    if (existingNames.has(normalizedName)) {
      continue;
    }

    existingNames.add(normalizedName);

    // Умолчание — «готовить не нужно»: так выдают заклинания вид и класс, и так лист
    // вёл себя всегда. Черта может сказать обратное, но только явно — иначе уже
    // собранные персонажи разом потеряли бы подготовку выданных заклинаний
    const alwaysPrepared = granted.alwaysPrepared ?? true;

    result.push({
      ...granted.spell,
      id: generateId('spell'),
      prepared: alwaysPrepared,
      alwaysPrepared,
      ...(granted.castingAbility
        ? { attackAbility: granted.castingAbility }
        : {}),
      grantedByFeature: granted.featureName,
    });
  }

  return result;
}

/**
 * Удаляет granted-заклинания, выданные указанными умениями.
 *
 * Используется при откате источника (смена вида, замена черты предыстории):
 * заклинания, у которых `grantedByFeature` совпадает с одним из названий
 * умений, исключаются из списка.
 *
 * @param spells - текущий список заклинаний актора
 * @param featureNames - названия умений, чьи заклинания нужно убрать
 * @returns новый список заклинаний (исходный не мутируется)
 */
export function removeGrantedSpellsByFeatureNames(
  spells: Spell[],
  featureNames: ReadonlyArray<string>,
): Spell[] {
  const namesToRemove = new Set(featureNames);

  return spells.filter(
    (spell) =>
      !spell.grantedByFeature || !namesToRemove.has(spell.grantedByFeature),
  );
}
