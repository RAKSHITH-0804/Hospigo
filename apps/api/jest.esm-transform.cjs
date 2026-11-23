/**
 * Jest transformer for the ES-module-only Nest 12 packages (see jest.config.js).
 *
 * It wraps ts-jest and rewrites `import.meta.url`, which does not exist once a file is compiled to
 * CommonJS, into the file's own URL. Everything else is left to ts-jest. Used for node_modules
 * files only (the transformIgnorePatterns in jest.config.js decide which packages).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS Jest transformer file
const tsJest = require('ts-jest').default;

function patch(source) {
  if (!source.includes('import.meta')) {
    return source;
  }
  return (
    source
      // "const require = createRequire(import.meta.url)": a CommonJS file already has `require`.
      .replace(
        /\b(?:const|let|var)\s+require\s*=\s*createRequire\(\s*import\.meta\.url\s*\)\s*;?/g,
        '',
      )
      .replace(/import\.meta\.url/g, "require('node:url').pathToFileURL(__filename).href")
  );
}

module.exports = {
  createTransformer(options) {
    const inner = tsJest.createTransformer(options);
    return {
      process(source, filename, transformOptions) {
        return inner.process(patch(source), filename, transformOptions);
      },
      getCacheKey(source, filename, transformOptions) {
        return `esm-patch:${inner.getCacheKey(patch(source), filename, transformOptions)}`;
      },
    };
  },
};
