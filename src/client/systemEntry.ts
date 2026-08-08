/**
 * Точка входа САМОДОСТАТОЧНОГО клиентского бандла системы D&D 5e (Фаза 5, S6).
 *
 * Собирается `vite.system.config.ts` в один IIFE-файл `dist/systems/dnd5e/client.js`
 * (+ `client.css`). Приложение-внутренние модули (`@/*`, `pinia`, `@nuxt/ui`,
 * `@vtt/shared`-корень…) в бандл НЕ инлайнятся — они помечены external и в рантайме
 * резолвятся из `globalThis.__VTTHost` (общие синглтоны хоста), а `vue` — из
 * `globalThis.Vue`. Инлайнятся только код `systems/dnd5e/**` и движок правил
 * `@vtt/shared/system/dnd.js`.
 *
 * При загрузке через `<script>` (рантайм-путь `/system-assets/dnd5e/client.js`) файл
 * самрегистрируется — ровно как пользовательская система. Так встроенная dnd5e
 * становится копируемой папкой (index.js + client.js + client.css + system.json +
 * data/), не отличаясь по механике от galaxy-saga.
 *
 * @module systems/dnd5e/systemEntry
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import { registerClientSystem } from './clientSystem';

import './system.css';

globalThis.VTTSystems.register('dnd5e-2024', (api: ClientSystemAPI) => {
  registerClientSystem(api);
});
