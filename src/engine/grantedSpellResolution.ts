/**
 * Поиск выдаваемых заклинаний среди паков мира по правилу
 * {@link classifyRefInPacks}: свой пак → единственный другой → выбор игрока →
 * не выдаётся.
 *
 * Здесь только разбор на три группы. Спросить игрока (окно выбора пака) и
 * предупредить о ненайденном — дело клиента: движок не знает ни окон, ни
 * уведомлений.
 */

import type { Spell } from './dndEntities.js';
import type {
  GrantedSpellSource,
  ResolvedGrantedSpell,
} from './grantedSpells.js';
import type { RefCandidate } from './packRefResolution.js';

import { classifyRefInPacks } from './packRefResolution.js';

/** Заклинания одного пака вместе с его подписью — её видит игрок при выборе */
export interface GrantedSpellPack {
  packId: string;
  packName: string;
  spells: Spell[];
}

/** Выдаваемое заклинание, которое лежит в нескольких чужих паках */
export interface AmbiguousGrantedSpell {
  source: GrantedSpellSource;
  candidates: RefCandidate<Spell>[];
}

/** Выдаваемые заклинания, разобранные по итогу поиска */
export interface GrantedSpellResolution {
  /** Нашлись однозначно — кладутся на лист как есть */
  resolved: ResolvedGrantedSpell[];
  /** Нужен выбор пака */
  ambiguous: AmbiguousGrantedSpell[];
  /** Не нашлись ни в одном паке мира */
  missing: GrantedSpellSource[];
}

/**
 * Связывает источник выдачи с найденным заклинанием: всё, что источник знает о
 * выдаче, едет вместе с записью.
 *
 * @param source - связь «заклинание → умение-источник»
 * @param spell - запись заклинания из выбранного пака
 * @returns заклинание, готовое лечь на лист
 */
export function toResolvedGrantedSpell(
  source: GrantedSpellSource,
  spell: Spell,
): ResolvedGrantedSpell {
  return {
    spell,
    featureName: source.featureName,
    alwaysPrepared: source.alwaysPrepared,
    castingAbility: source.castingAbility,
    grantKind: source.grantKind,
    featureKey: source.featureKey,
    ...(source.chosenByPlayer ? { chosenByPlayer: true } : {}),
  };
}

/**
 * Не выше ли круг записи границы источника (`source.maxLevel`). Заговор проходит
 * всегда и без отдельной проверки: граница — наибольший круг ячеек листа, а он не
 * меньше нуля.
 *
 * @param source - связь «заклинание → умение-источник»
 * @param spell - найденная запись заклинания
 */
function isWithinSourceMaxLevel(
  source: GrantedSpellSource,
  spell: Spell,
): boolean {
  return source.maxLevel === undefined || spell.level <= source.maxLevel;
}

/**
 * Ищет каждое выдаваемое заклинание среди паков. Свой пак источника —
 * `source.packId`.
 *
 * Источник с границей круга (`maxLevel`, выдача «при ячейке круга») отдаёт
 * заклинание, только если круг найденной записи её не превышает. Отсеянное — не
 * «ненайденное»: оно придёт само, когда у персонажа появится нужная ячейка.
 *
 * @param packs - заклинания мира по пакам (компендиумы и записи мира)
 * @param sources - что выдаётся и кем
 * @returns нашедшиеся, требующие выбора и ненайденные
 */
export function resolveGrantedSpellSourcesInPacks(
  packs: ReadonlyArray<GrantedSpellPack>,
  sources: ReadonlyArray<GrantedSpellSource>,
): GrantedSpellResolution {
  const searchPacks = packs.map((pack) => ({
    packId: pack.packId,
    packName: pack.packName,
    entries: pack.spells,
  }));

  const result: GrantedSpellResolution = {
    resolved: [],
    ambiguous: [],
    missing: [],
  };

  for (const source of sources) {
    const resolution = classifyRefInPacks(
      searchPacks,
      source.spellId,
      (spell) => spell.id,
      source.packId,
    );

    if (resolution.kind === 'found') {
      if (isWithinSourceMaxLevel(source, resolution.candidate.entry)) {
        result.resolved.push(
          toResolvedGrantedSpell(source, resolution.candidate.entry),
        );
      }
    } else if (resolution.kind === 'ambiguous') {
      // Копии в разных паках могут разойтись кругом — спрашивается только о тех,
      // что проходят границу; не прошла ни одна — спрашивать не о чем
      const candidates = resolution.candidates.filter((candidate) =>
        isWithinSourceMaxLevel(source, candidate.entry),
      );

      if (candidates.length > 0) {
        result.ambiguous.push({ source, candidates });
      }
    } else {
      result.missing.push(source);
    }
  }

  return result;
}
