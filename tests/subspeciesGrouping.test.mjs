import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const { groupSubspeciesByParent, subspeciesGroupKey } = await loadEngineBundle(`
  export {
    groupSubspeciesByParent,
    subspeciesGroupKey,
  } from './src/engine/speciesLineage.ts';
`);

/** Минимальная запись вида: раскладке нужны только ключи и название */
function species(key, name, extra = {}) {
  return { type: 'species', key, name, features: [], ...extra };
}

/** Ключи подвидов вида из раскладки */
function childKeys(children, packId, parentKey) {
  return (children.get(subspeciesGroupKey(packId, parentKey)) ?? []).map(
    (record) => record.key,
  );
}

const elf = species('elf', 'Эльф');
const highElf = species('high-elf', 'Высший эльф', { parentKey: 'elf' });
const woodElf = species('wood-elf', 'Лесной эльф', { parentKey: 'elf' });
const human = species('human', 'Человек');

it('подвиды встают под вид своего пака, по алфавиту', () => {
  const { children, nested } = groupSubspeciesByParent([
    { packId: 'prod', entries: [woodElf, elf, highElf, human] },
  ]);

  assert.deepEqual(childKeys(children, 'prod', 'elf'), [
    'high-elf',
    'wood-elf',
  ]);

  assert.deepEqual(childKeys(children, 'prod', 'human'), []);
  assert.equal(nested.has(highElf), true);
  assert.equal(nested.has(elf), false);
});

it('подвид без родителя в своём паке к соседнему не цепляется', () => {
  const orphan = species('drow', 'Дроу', { parentKey: 'elf' });

  const { children, nested } = groupSubspeciesByParent([
    { packId: 'prod', entries: [elf] },
    { packId: 'dev', entries: [orphan] },
  ]);

  assert.equal(children.size, 0);
  // Родителя нет — подвид остаётся в общем списке, а не пропадает
  assert.equal(nested.has(orphan), false);
});

it('подвид мира с паком родителя встаёт под вид этого пака', () => {
  const copy = species('my-elf', 'Мой эльф', {
    parentKey: 'elf',
    parentPackId: 'prod',
  });

  const { children, nested } = groupSubspeciesByParent([
    { packId: 'prod', entries: [elf] },
    { packId: 'dev', entries: [species('elf', 'Эльф')] },
    { packId: 'world', entries: [copy] },
  ]);

  assert.deepEqual(childKeys(children, 'prod', 'elf'), ['my-elf']);
  assert.deepEqual(childKeys(children, 'dev', 'elf'), []);
  assert.equal(nested.has(copy), true);
});

it('свой вид мира с подвидом мира раскладывается так же', () => {
  const homebrew = species('my-folk', 'Мой народ');
  const branch = species('my-branch', 'Ветвь', { parentKey: 'my-folk' });

  const { children } = groupSubspeciesByParent([
    { packId: 'world', entries: [homebrew, branch] },
  ]);

  assert.deepEqual(childKeys(children, 'world', 'my-folk'), ['my-branch']);
});
