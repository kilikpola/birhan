const path = require('path');

/**
 * `expo-modules-core` is a dependency of `expo`, not of this project, and npm
 * currently nests it under `node_modules/expo/node_modules/` rather than
 * hoisting it (a top-level install resolves to 57.0.14, whose peer range
 * rejects the installed react-native-worklets). Metro resolves it fine from
 * `expo/`, but jest-expo's own setup does a bare `require('expo-modules-core')`
 * from `node_modules/jest-expo/`, where node resolution never reaches the
 * nested copy — so every suite died with "Cannot find module".
 *
 * Resolve it the way node would from expo's own directory, so this keeps
 * working whether npm hoists it or not.
 */
const expoModulesCore = path.dirname(
  require.resolve('expo-modules-core/package.json', {
    paths: [path.dirname(require.resolve('expo/package.json'))],
  }),
);

module.exports = {
  preset: 'jest-expo',
  // Jest owns the mobile app only. Deno tests (supabase/functions), the Vite
  // app (admin-web) and the Vitest backend suite (backend/) run in their own
  // CI jobs, not here.
  testPathIgnorePatterns: ['/node_modules/', '/supabase/', '/admin-web/', '/backend/', '/tests/smoke/'],
  moduleNameMapper: {
    '^expo-modules-core$': expoModulesCore,
    '^expo-modules-core/(.*)$': path.join(expoModulesCore, '$1'),
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|react-native-svg)',
  ],
};
