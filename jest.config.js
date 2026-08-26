module.exports = {
  preset: 'jest-expo',
  // Jest owns the mobile app only. Deno tests (supabase/functions), the Vite
  // app (admin-web) and the Vitest backend suite (backend/) run in their own
  // CI jobs, not here.
  testPathIgnorePatterns: ['/node_modules/', '/supabase/', '/admin-web/', '/backend/', '/tests/smoke/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|native-base|react-native-svg)',
  ],
};
