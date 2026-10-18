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

import { SYSTEM_ID } from '@vtt/shared/system/dnd.js';

import { registerClientSystem } from './clientSystem';

import './system.css';

globalThis.VTTSystems.register(SYSTEM_ID, (api: ClientSystemAPI) => {
  registerClientSystem(api);
});

// Режим разработки (`npm run dev:hot`). В сборке `import.meta.hot` нет, и весь блок
// вместе с подгружаемым модулем из `client.js` вырезается.
if (import.meta.hot) {
  // Правка этого файла или модуля, который он импортирует (кроме `.vue` — их
  // подменяет сам Vue), исполняет файл заново. Повторный `VTTSystems.register`
  // приложение понимает как «перерегистрировать систему» — без перезагрузки
  // страницы.
  //
  // ⚠️ Вызов обязан быть записан именно так, целиком: dev-сервер ищет его в
  // тексте файла. Через переменную (`const hot = import.meta.hot`) он его не
  // находит и на любую правку перезагружает страницу.
  import.meta.hot.accept();

  const hot = import.meta.hot;

  void import('./systemDevMode').then(({ setupSystemDevMode }) => {
    setupSystemDevMode(hot);
  });
}
