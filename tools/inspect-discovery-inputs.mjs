#!/usr/bin/env node
import { inspectDiscoveryInputs, stableJson } from "./discovery-evidence-inputs.mjs";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    if (!new Set(["spec", "mode"]).has(name)) throw new Error(`Unknown argument: --${name}`);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: --${name}`);
    const value = equals === -1 ? argv[++index] : argument.slice(equals + 1);
    if (!value || (equals === -1 && value.startsWith("--"))) throw new Error(`--${name} requires a value`);
    values[name] = value;
  }
  if (!values.spec) throw new Error("Missing required argument: --spec");
  if (!values.mode) throw new Error("Missing required argument: --mode");
  return values;
}

try {
  const { spec, mode } = parseArgs(process.argv.slice(2));
  process.stdout.write(stableJson(await inspectDiscoveryInputs(spec, mode)));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
