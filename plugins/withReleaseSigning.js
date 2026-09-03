const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Teaches `expo prebuild` how this app is signed for release.
 *
 * The signing config used to be hand-edited into android/app/build.gradle,
 * and the keystore itself lived inside android/. That directory is generated:
 * `prebuild --clean` deletes it. So the project was one prebuild away from
 * losing both the config and the signing identity — and losing the identity is
 * unrecoverable, because Android refuses an update signed by a different key.
 *
 * Now the credentials sit in credentials/ (gitignored, outside the generated
 * tree) and this plugin re-applies the Gradle wiring every time prebuild runs.
 *
 * Without credentials/keystore.properties present — a fresh clone, or CI —
 * release builds fall back to the debug keystore, exactly as before. That
 * produces an installable APK that is deliberately NOT update-compatible with
 * the published one, which is the honest outcome for a build that has no
 * access to the real key.
 */

const LOADER = `
// --- Birhan release signing (plugins/withReleaseSigning.js) ---
def birhanKeystoreProps = new Properties()
def birhanKeystoreFile = rootProject.file("../credentials/keystore.properties")
if (birhanKeystoreFile.exists()) {
    birhanKeystoreProps.load(new FileInputStream(birhanKeystoreFile))
}
`;

const SIGNING_CONFIG = `
        birhanRelease {
            if (birhanKeystoreFile.exists()) {
                storeFile rootProject.file("../credentials/" + birhanKeystoreProps['storeFile'])
                storePassword birhanKeystoreProps['storePassword']
                keyAlias birhanKeystoreProps['keyAlias']
                keyPassword birhanKeystoreProps['keyPassword']
            }
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    if (gradle.includes('birhanKeystoreProps')) return cfg;

    // The properties loader has to sit above the android {} block that uses it.
    gradle = gradle.replace(/\nandroid \{/, `${LOADER}\nandroid {`);

    // Add our config alongside the debug one Expo always writes.
    gradle = gradle.replace(
      /(signingConfigs \{)/,
      `$1\n${SIGNING_CONFIG}`,
    );

    // Point the release build type at it, keeping the debug fallback. Expo
    // emits a comment between `release {` and the signingConfig line, so this
    // has to skip over whatever sits in between rather than assume adjacency.
    const before = gradle;
    gradle = gradle.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig birhanKeystoreFile.exists() ? signingConfigs.birhanRelease : signingConfigs.debug`,
    );

    // Never fail quietly. A plugin that patches everything except the line that
    // chooses the key leaves release builds signed with the debug keystore —
    // installable, and permanently incompatible with what users already have.
    if (gradle === before) {
      throw new Error(
        'withReleaseSigning: could not point the release buildType at the ' +
          'release signing config. android/app/build.gradle does not look the ' +
          'way this plugin expects; fix the plugin rather than shipping a ' +
          'debug-signed release.',
      );
    }

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
