import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import semanticRelease from "semantic-release";

const [configPath, cwd, output] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, "utf8"));
const analysisPlugins = new Set([
  "@semantic-release/commit-analyzer",
  "@semantic-release/release-notes-generator",
]);

const plugins = config.plugins.flatMap((plugin) => {
  const [name, options] = Array.isArray(plugin) ? plugin : [plugin];
  if (!analysisPlugins.has(name)) return [];
  const path = fileURLToPath(import.meta.resolve(name));
  return [options ? [path, options] : path];
});

const result = await semanticRelease(
  {
    ...config,
    repositoryUrl: process.env.RELEASE_REPOSITORY,
    plugins,
    dryRun: true,
    ci: false,
  },
  {
    cwd,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${process.env.PREVIEW_REMOTE}.insteadOf`,
      GIT_CONFIG_VALUE_0: process.env.RELEASE_REPOSITORY,
    },
  },
);

const body = result
  ? `### Proposed release ${result.nextRelease.version}\n\n${result.nextRelease.notes}`
  : "### Release preview\n\nNo version bump for these commits.";

await writeFile(output, body);
