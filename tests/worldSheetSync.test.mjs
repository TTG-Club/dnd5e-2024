import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { loadEntityWrites } from './helpers/combatWrite.mjs';
import { loadEngineBundle, systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import { createCreature, engine } from './scenarios/_fixtures.mjs';

/**
 * Каждый раздел, который система пишет в мир во время игры, подтягивает из
 * мира каждый, кто держит свою копию сущности и сохраняет её целиком.
 *
 * Лист существа синхронизировал `system`, эффекты и инвентарь, а заклинания —
 * нет. Заряд «N/день», списанный кастом через мир, на открытом листе не
 * уменьшался, а следующая правка листа отправляла черновик целиком и
 * возвращала заряд на сервер.
 */

// Модуль разделов без Vue: собирается тем же загрузчиком, что и движок

const sections = await loadEngineBundle(
  "export * from './src/client/composables/worldSheetSections.ts';",
);

const SHEET_WRITE_PATH = 'src/client/composables/entitySheetWrite.ts';
const CREATURE_CAST_PATH = 'src/client/composables/creatureSpellCast.ts';

/** Листы с черновиком: правят глубокую копию и сохраняют её целиком */
const DRAFT_SHEET_FILES = [
  'src/client/ui/actor/Dnd5eActorSheet.vue',
  'src/client/ui/creature/CreatureSheet.vue',
];

/** Быстрые панели: копия всей сущности на каждое изменение мира */
const QUICK_PANEL_FILES = [
  'src/client/ui/actor/QuickEquipmentModal.vue',
  'src/client/ui/actor/QuickSpellsModal.vue',
  'src/client/ui/creature/QuickCreatureActionsModal.vue',
];

/** Общий помощник синхронизации черновика с миром */
const SHEET_SYNC_CALL = /\buseWorldSheetSync\(\{/u;

/** Свой наблюдатель листа за разделом сущности мира */
const OWN_SECTION_WATCH =
  /\(\)\s*=>\s*store(?:Actor|Creature)\.value\?\.(?:system|equipment|spells|activeEffects)\b/u;

/** Панель копирует сущность мира целиком и глубоко следит за ней */
const WHOLE_ENTITY_SYNC =
  /watch\(\s*store(?:Entity|Creature),\s*\(new\w+\)\s*=>\s*\{\s*if\s*\(new\w+\)\s*\{\s*local\w+\.value\s*=\s*JSON\.parse\(JSON\.stringify\(new\w+\)\);\s*\}\s*\},\s*\{\s*immediate:\s*true,\s*deep:\s*true\s*\}/u;

/**
 * Исходник от корня системы.
 *
 * @param {string} path - путь от корня
 * @returns {string} текст
 */
function readSource(path) {
  return readFileSync(join(systemRoot, path), 'utf8');
}

describe('разделы мира: кто пишет и кто синхронизирует', () => {
  it('всё, что пишут помощники записи, входит в список синхронизации', () => {
    for (const section of [
      ...sections.SHEET_WRITE_SECTIONS,
      ...sections.COMBAT_STATE_SECTIONS,
    ]) {
      assert.ok(
        sections.WORLD_SHEET_SECTIONS.includes(section),
        `раздел «${section}» не синхронизируется`,
      );
    }

    assert.deepEqual([...sections.WORLD_SHEET_SECTIONS].sort(), [
      'activeEffects',
      'equipment',
      'spells',
      'system',
    ]);
  });

  it('помощник записи листа кладёт в стор ровно разделы из списка', () => {
    const source = readSource(SHEET_WRITE_PATH);

    const literal = source.slice(
      source.indexOf('const sections: Pick<DnDSceneEntity, SheetWriteSection>'),
    );

    const written = [
      ...literal
        .slice(0, literal.indexOf('};'))
        .matchAll(/^\s+(\w+): stored\.\1,$/gmu),
    ].map((match) => match[1]);

    assert.deepEqual(written.sort(), [...sections.SHEET_WRITE_SECTIONS].sort());
  });

  it('листы с черновиком синхронизируют его общим помощником, своих наблюдателей за разделами нет', () => {
    for (const path of DRAFT_SHEET_FILES) {
      const source = readSource(path);

      assert.match(source, SHEET_SYNC_CALL, `${path}: нет useWorldSheetSync`);

      assert.doesNotMatch(
        source,
        OWN_SECTION_WATCH,
        `${path}: свой наблюдатель за разделом мира`,
      );
    }
  });

  it('быстрые панели копируют сущность мира целиком', () => {
    for (const path of QUICK_PANEL_FILES) {
      assert.match(
        readSource(path),
        WHOLE_ENTITY_SYNC,
        `${path}: панель не следит за всей сущностью`,
      );
    }
  });

  it('общий помощник следит за каждым разделом списка и молчит в режиме правки', () => {
    const source = readSource('src/client/composables/useWorldSheetSync.ts');

    assert.match(source, /for \(const section of WORLD_SHEET_SECTIONS\) \{/u);
    assert.match(source, /!options\.isPaused\(\)/u);
  });
});

describe('заряд заклинания существа доходит до открытого листа', () => {
  /** Заклинание «1/день» */
  const FEAR = {
    id: 'spell_fear',
    name: 'Страх',
    level: 3,
    uses: { max: 1, current: 1, recovery: 'longRest' },
  };

  it('списание через мир попадает в черновик, и правка листа его не возвращает', async () => {
    const hag = createCreature({ spells: [structuredClone(FEAR)] });
    const world = new Map([[hag.id, structuredClone(hag)]]);
    const { changeEntitySheet, updated } = await loadEntityWrites({ world });

    // Лист открыт: черновик — копия на момент открытия
    const draft = structuredClone(world.get(hag.id));

    const spendCreatureSpellUse = await loadHandler(
      CREATURE_CAST_PATH,
      'spendCreatureSpellUse',
      {
        changeEntitySheet,
        isCreatureSpellPoolMode: engine.isCreatureSpellPoolMode,
        isDndCreature: engine.isDndCreature,
        consumeCreatureSpellGroupUse: engine.consumeCreatureSpellGroupUse,
        withSpentSpellUse: engine.withSpentSpellUse,
      },
    );

    spendCreatureSpellUse(hag.id, FEAR, undefined);

    assert.equal(updated.length, 1);
    assert.equal(world.get(hag.id).spells[0].uses.current, 0);

    // Проверка «остались ли заряды» идёт по миру, а не по строке листа
    assert.equal(engine.hasCreatureSpellUsesLeft(draft.spells[0]), true);

    assert.equal(
      engine.hasLiveCreatureSpellUsesLeft(
        world.get(hag.id),
        draft.spells[0],
        undefined,
      ),
      false,
      'заряда нет — каст не идёт, какой бы ни была строка листа',
    );

    // Синхронизация листа: раздел заклинаний приходит из мира
    for (const section of sections.WORLD_SHEET_SECTIONS) {
      sections.copyWorldSection(draft, world.get(hag.id), section);
    }

    assert.equal(draft.spells[0].uses.current, 0, 'лист показывает списанное');

    assert.notEqual(
      draft.spells,
      world.get(hag.id).spells,
      'черновик — своя копия, а не запись стора',
    );

    // Следующая правка листа шлёт черновик целиком — заряд остаётся списан
    draft.system = { ...draft.system, languages: ['Общий'] };

    assert.equal(draft.spells[0].uses.current, 0);
  });

  it('заряды заклинания берутся с листа мира, собранное на лету идёт как пришло', () => {
    const stale = structuredClone(FEAR);
    const spent = [{ ...FEAR, uses: { ...FEAR.uses, current: 0 } }];

    assert.equal(engine.withLiveSpellUses(spent, stale).uses.current, 0);

    // На листе заклинания нет или оно зарядов не ведёт — решает вход
    assert.equal(engine.withLiveSpellUses([], stale), stale);

    assert.equal(
      engine.withLiveSpellUses([{ ...FEAR, uses: undefined }], stale),
      stale,
    );

    // Без своих зарядов заряды листа не появляются
    const plain = { ...FEAR, uses: undefined };

    assert.equal(engine.withLiveSpellUses(spent, plain), plain);
  });

  it('общий счётчик группы проверяется по миру', () => {
    const group = {
      id: 'group_pool',
      mode: 'perDayPool',
      uses: { max: 2, current: 1 },
      spells: [{ spellId: FEAR.id }],
    };

    const block = { id: 'block', name: 'Колдовство', groups: [group] };
    const placement = { block, group, ref: group.spells[0] };

    const spent = createCreature({
      spells: [{ ...FEAR, uses: undefined }],
      system: {
        ...createCreature().system,
        spellcastingBlocks: [
          {
            ...block,
            groups: [{ ...group, uses: { max: 2, current: 0 } }],
          },
        ],
      },
    });

    assert.equal(
      engine.hasLiveCreatureSpellUsesLeft(spent, spent.spells[0], placement),
      false,
    );

    assert.equal(
      engine.hasLiveCreatureSpellUsesLeft(
        createCreature({ spells: [], system: createCreature().system }),
        spent.spells[0],
        placement,
      ),
      true,
      'нет в мире ни заклинания, ни группы — решает то, что принёс вход',
    );
  });
});
