/**
 * Проверки собранного `dist/client.js`.
 *
 * Все дефекты, которые здесь ловятся, проявляются ТОЛЬКО в браузере, асинхронно и
 * с сообщениями, по которым причину не угадать. Поэтому проверка стоит в сборке —
 * и в релизной (`scripts/build.mjs`), и в watch-режиме (`scripts/dev.mjs`): в dev
 * она особенно важна, потому что негодный бандл нельзя подкладывать в приложение
 * молча — иначе вместо ошибки сборки получишь пустое окно и час в devtools.
 */

/**
 * Разбирает клиентский бандл: что он просит у приложения и годен ли вообще.
 *
 * @param bundle - содержимое `dist/client.js`
 * @returns `{ problems, hostModules }` — список претензий (пустой = годен) и
 *   спецификаторы, которые бандл резолвит из `globalThis.__VTTHost`
 */
export function inspectClientBundle(bundle) {
  /** Что именно бандл просит у приложения через реестр модулей хоста. */
  const hostModules = [
    ...new Set(
      [...bundle.matchAll(/__VTTHost\["([^"]+)"\]/g)].map((match) => match[1]),
    ),
  ];

  const problems = [];

  if (/process\.env/.test(bundle)) {
    problems.push(
      'в бандле остались обращения к process.env — в браузере это ReferenceError '
        + 'ещё до регистрации системы (нужен define в vite.config.ts)',
    );
  }

  if (!/VTTSystems\.register/.test(bundle)) {
    problems.push(
      'бандл не вызывает VTTSystems.register — система не поднимется',
    );
  }

  if (/reka-ui/.test(bundle)) {
    problems.push(
      'в бандл попала вторая копия reka-ui — окна приложения будут падать в setup '
        + '(нужен components.exclude у плагина ui())',
    );
  }

  const brokenDynamicImports = [
    ...new Set(
      [...bundle.matchAll(/import\("(@[^"]+)"\)/g)].map((match) => match[1]),
    ),
  ];

  if (brokenDynamicImports.length > 0) {
    problems.push(
      `динамические import() модулей приложения не переписаны: ${brokenDynamicImports.join(', ')}`
        + ' — в браузере они падают асинхронно (см. renderDynamicImport)',
    );
  }

  // Ассеты приложения — это ССЫЛКИ, а не модули: попав в реестр хоста, они
  // резолвятся в undefined и роняют отрисовку.
  const assetsInHostRegistry = hostModules.filter((id) => id.startsWith('/'));

  if (assetsInHostRegistry.length > 0) {
    problems.push(
      `в реестр модулей хоста попали ассеты: ${assetsInHostRegistry.join(', ')}`
        + ' — приложение их не отдаёт, будет «Cannot read properties of undefined»',
    );
  }

  return { problems, hostModules };
}
