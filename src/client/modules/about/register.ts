/**
 * Под-модуль системы D&D 5e: О СИСТЕМЕ.
 *
 * Показывает название и версию установленной системы в панели настроек мира,
 * рядом с версией самого приложения — чтобы узнать, что стоит в мире, не
 * выходя из него. Хост даёт для этого слот `settings:about`; сам блок «О
 * проекте» принадлежит хосту, и дописывать в него строки система не может.
 *
 * Название и версия берутся из `system.json`: номер в нём поднимает хук
 * коммита вместе с движком, так что это версия именно загруженного кода.
 *
 * @module systems/dnd5e/modules/about
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import { registerExtension } from '@/core/extensionRegistry';

import { id } from '../../../../system.json';
import { SETTINGS_ABOUT_SLOT } from '../../ui/about/constants';
import SystemAboutSection from '../../ui/about/SystemAboutSection.vue';

/** Добавляет блок с названием и версией системы в панель настроек мира. */
export function register(_api: ClientSystemAPI): void {
  registerExtension({
    moduleId: id,
    slotName: SETTINGS_ABOUT_SLOT,
    component: SystemAboutSection,
    // Раньше блоков модулей: версия системы — справка того же рода, что
    // версия приложения над ним
    order: 0,
  });
}
