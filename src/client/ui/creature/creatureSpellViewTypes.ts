/**
 * Готовые к показу строки вкладки заклинаний существа.
 *
 * Собирает их вкладка (`CreatureSpellsBlock`): подписи и плитки зависят от
 * характеристик существа, справочников мира и режима группы, и считать их из
 * шаблона значило бы пересчитывать на каждую перерисовку. Карточка блока
 * (`CreatureSpellBlockCard`) готовое только рисует.
 */

// Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

import type {
  CreatureSpellcastingBlock,
  CreatureSpellGroup,
  CreatureSpellRef,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { SheetRowStat } from '../actor/sheetRowTypes';

/** Ячейка плитки блока — та же форма, что принимает `SheetStatTile` */
export interface CreatureSpellTileCell {
  label: string;
  value: string;
  hint?: string;
}

/** Строка заклинания внутри группы */
export interface CreatureSpellRowView {
  spell: Spell;
  /** Ссылка группы: круг наложения и оговорка заклинания */
  spellRef?: CreatureSpellRef;
  /** Подпись под названием: школа магии, а следом оговорка статблока */
  subtitle: string;
  stats: SheetRowStat[];
  menuItems: DropdownMenuItem[][];
}

/** Группа блока со строками, уже прошедшими отбор */
export interface CreatureSpellGroupView {
  group: CreatureSpellGroup;
  /** Заголовок группы: свой либо собранный из ограничения применений */
  title: string;
  /** Общий счётчик применений группы («1/2»); пусто — счётчика у неё нет */
  usesLabel?: string;
  /** Счётчик группы пуст — заклинания группы ждут отдыха */
  isExhausted: boolean;
  /** Короткая подпись перезарядки и её расшифровка */
  rechargeLabel?: string;
  rechargeHint?: string;
  rows: CreatureSpellRowView[];
}

/** Блок заклинаний со своими числами и группами */
export interface CreatureSpellBlockView {
  block: CreatureSpellcastingBlock;
  title: string;
  cells: CreatureSpellTileCell[];
  /** Условие блока текстом */
  note?: string;
  /** Строка «Компоненты не требуются: …»; пусто — блоку нужны все */
  componentsLabel?: string;
  groupCount: number;
  spellCount: number;
  groups: CreatureSpellGroupView[];
}
