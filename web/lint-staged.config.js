import path from 'node:path';

const generatedMigrationsDirectory = path.resolve(process.cwd(), 'server/db/migrations');

const isGeneratedMigrationPath = (filePath) => {
  const relativePath = path.relative(generatedMigrationsDirectory, path.resolve(filePath));

  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
};

const quoteShellArgument = (filePath) => `'${filePath.replaceAll("'", "'\\''")}'`;

export default {
  '*.{js,mjs,cjs,ts,mts,cts,vue}': [
    'oxlint --fix --config .oxlintrc.jsonc',
    'eslint --fix',
    'oxfmt --write',
  ],
  '*.{json,jsonc,css,scss,md,yaml,yml}': (files) => {
    const formatableFiles = files.filter((filePath) => !isGeneratedMigrationPath(filePath));

    return formatableFiles.length > 0
      ? `oxfmt --write ${formatableFiles.map(quoteShellArgument).join(' ')}`
      : [];
  },
};
