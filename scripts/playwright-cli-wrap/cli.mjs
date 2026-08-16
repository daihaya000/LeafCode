import { runWrappedCli } from "../lib/playwright-cli-wrap.mjs";

const code = await runWrappedCli({ argv: process.argv.slice(2) });
process.exit(code);
