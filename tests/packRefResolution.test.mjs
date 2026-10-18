import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Ссылка записи одного пака на запись другого: черта DnD.su выдаёт
 * `fireball-phb`, а такой ключ лежит и в TTG Club. Ошибка здесь тихая — игрок
 * получит чужую версию заклинания и не узнает об этом.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
`);

const { classifyRefInPacks } = engine;

/** Ключ записи — её id */
const idOf = (entry) => entry.id;

const ttgFireball = { id: 'fireball-phb', name: 'Огненный шар (TTG)' };
const dndsuFireball = { id: 'fireball-phb', name: 'Огненный шар (DnD.su)' };
const otherFireball = { id: 'fireball-phb', name: 'Огненный шар (чужой)' };

const ttg = {
  packId: 'ttg-club',
  packName: 'TTG Club',
  entries: [ttgFireball],
};

const dndsu = { packId: 'dndsu', packName: 'DnD.su', entries: [dndsuFireball] };
const other = { packId: 'other', packName: 'Чужой', entries: [otherFireball] };
const emptyOwn = { packId: 'homebrew', packName: 'Свой', entries: [] };

describe('classifyRefInPacks', () => {
  it('берёт запись из своего пака, даже если она есть в других', () => {
    const result = classifyRefInPacks(
      [ttg, dndsu],
      'fireball-phb',
      idOf,
      'dndsu',
    );

    assert.equal(result.kind, 'found');
    assert.equal(result.candidate.entry, dndsuFireball);
    assert.equal(result.candidate.packId, 'dndsu');
  });

  it('своего нет, есть ровно в одном другом паке — берёт его без выбора', () => {
    const result = classifyRefInPacks(
      [emptyOwn, ttg],
      'fireball-phb',
      idOf,
      'homebrew',
    );

    assert.equal(result.kind, 'found');
    assert.equal(result.candidate.entry, ttgFireball);
  });

  it('своего нет, есть в нескольких — отдаёт всех кандидатов в порядке паков', () => {
    const result = classifyRefInPacks(
      [ttg, emptyOwn, dndsu, other],
      'fireball-phb',
      idOf,
      'homebrew',
    );

    assert.equal(result.kind, 'ambiguous');

    assert.deepEqual(
      result.candidates.map((candidate) => candidate.packId),
      ['ttg-club', 'dndsu', 'other'],
    );

    assert.equal(result.candidates[1].packName, 'DnD.su');
  });

  it('нет нигде — missing', () => {
    const result = classifyRefInPacks(
      [emptyOwn],
      'fireball-phb',
      idOf,
      'homebrew',
    );

    assert.deepEqual(result, { kind: 'missing' });
  });

  it('без своего пака (старый лист) — сразу правило «один или выбор»', () => {
    assert.equal(classifyRefInPacks([ttg], 'fireball-phb', idOf).kind, 'found');

    assert.equal(
      classifyRefInPacks([ttg, dndsu], 'fireball-phb', idOf).kind,
      'ambiguous',
    );
  });

  it('свой пак удалён из мира — как без своего пака', () => {
    const result = classifyRefInPacks(
      [ttg, dndsu],
      'fireball-phb',
      idOf,
      'removed',
    );

    assert.equal(result.kind, 'ambiguous');
  });
});

describe('resolveGrantedSpellSourcesInPacks', () => {
  const { resolveGrantedSpellSourcesInPacks } = engine;

  const asSpellPack = (pack) => ({
    packId: pack.packId,
    packName: pack.packName,
    spells: pack.entries,
  });

  it('раскладывает выдачу на найденные, спорные и ненайденные', () => {
    const result = resolveGrantedSpellSourcesInPacks(
      [ttg, dndsu].map(asSpellPack),
      [
        {
          spellId: 'fireball-phb',
          featureName: 'Черта DnD.su',
          packId: 'dndsu',
        },
        {
          spellId: 'fireball-phb',
          featureName: 'Своя черта',
          packId: 'homebrew',
        },
        { spellId: 'wish-phb', featureName: 'Своя черта', packId: 'homebrew' },
      ],
    );

    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].spell, dndsuFireball);
    assert.equal(result.resolved[0].featureName, 'Черта DnD.su');
    assert.equal(result.ambiguous.length, 1);
    assert.equal(result.ambiguous[0].candidates.length, 2);

    assert.deepEqual(
      result.missing.map((source) => source.spellId),
      ['wish-phb'],
    );
  });
});
