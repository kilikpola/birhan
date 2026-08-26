// getSentryExpoConfig wraps Expo's default Metro config to emit the source maps
// Sentry needs for readable stack traces. It is a drop-in replacement for
// getDefaultConfig and is a no-op at runtime when Sentry isn't configured.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

config.resolver.assetExts.push("db", "wasm");

module.exports = config;
