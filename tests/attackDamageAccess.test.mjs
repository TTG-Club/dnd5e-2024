import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Кто вправе менять урон атаки из карточки чата: «Половина» и «Крит» под
 * нанесённым уроном доступны автору атаки, отмена и повторный урон — мастеру
 * и автору с правом роли «Отмена урона из чата».
 */

/** Игрок — автор атаки без права отмены, урон нанесён */
const AUTHOR = {
  isGM: false,
  isAuthor: true,
  isApplied: true,
  canRevertDamage: false,
};

/** Тот же игрок, которому мастер выдал право отмены */
const TRUSTED_AUTHOR = { ...AUTHOR, canRevertDamage: true };

describe('действия над уроном: каким нужно право отмены', () => {
  it('«Половина» и «Крит» под нанесённым уроном права не требуют', () => {
    assert.equal(engine.isAttackDamageRevertAction('modes', true), false);
  });

  it('отмена и повторный урон требуют права', () => {
    assert.equal(engine.isAttackDamageRevertAction('revert', true), true);
    assert.equal(engine.isAttackDamageRevertAction('reapply', false), true);
  });

  it('над отменённым уроном «Половина» и «Крит» наносят его заново — требуют права', () => {
    assert.equal(engine.isAttackDamageRevertAction('modes', false), true);
  });
});

describe('действие над уроном: отказ в самом действии', () => {
  it('мастеру разрешено всё', () => {
    for (const action of ['revert', 'reapply', 'modes']) {
      for (const isApplied of [true, false]) {
        assert.equal(
          engine.resolveAttackDamageActionRefusal({
            action,
            isGM: true,
            isAuthor: false,
            isApplied,
            canRevertDamage: false,
          }),
          null,
        );
      }
    }
  });

  it('автор атаки переключает половину и крит под нанесённым уроном', () => {
    assert.equal(
      engine.resolveAttackDamageActionRefusal({ ...AUTHOR, action: 'modes' }),
      null,
    );
  });

  it('без права автору атаки отмена и повторный урон не даются', () => {
    assert.equal(
      engine.resolveAttackDamageActionRefusal({ ...AUTHOR, action: 'revert' }),
      'revertForbidden',
    );

    assert.equal(
      engine.resolveAttackDamageActionRefusal({
        ...AUTHOR,
        action: 'reapply',
        isApplied: false,
      }),
      'revertForbidden',
    );
  });

  it('без права над отменённым уроном автору не даются и половина с критом', () => {
    assert.equal(
      engine.resolveAttackDamageActionRefusal({
        ...AUTHOR,
        action: 'modes',
        isApplied: false,
      }),
      'revertForbidden',
    );
  });

  it('с правом автор отменяет урон, наносит его заново и меняет режим отменённого', () => {
    assert.equal(
      engine.resolveAttackDamageActionRefusal({
        ...TRUSTED_AUTHOR,
        action: 'revert',
      }),
      null,
    );

    for (const action of ['reapply', 'modes']) {
      assert.equal(
        engine.resolveAttackDamageActionRefusal({
          ...TRUSTED_AUTHOR,
          action,
          isApplied: false,
        }),
        null,
      );
    }
  });

  it('чужой игрок не меняет урон даже с правом отмены', () => {
    for (const action of ['revert', 'modes']) {
      assert.equal(
        engine.resolveAttackDamageActionRefusal({
          ...TRUSTED_AUTHOR,
          action,
          isAuthor: false,
        }),
        'authorOnly',
      );
    }
  });
});
