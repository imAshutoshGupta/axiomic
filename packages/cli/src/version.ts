/**
 * The CLI's version.
 * The build (scripts/build.mjs) replaces __AXIOMIC_VERSION__ with the version from package.json.
 * When tests run the source directly, nothing replaces it, so we fall back to a clear placeholder.
 */
declare const __AXIOMIC_VERSION__: string | undefined;

export const VERSION: string = typeof __AXIOMIC_VERSION__ === "string" ? __AXIOMIC_VERSION__ : "0.0.0-source";
