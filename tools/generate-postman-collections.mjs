import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "postman", "collections");
const npmCommand = "npm";

const collectionDefinitions = [
  {
    name: "Defender",
    spec: "specifications/nodoc-defender-xdr/specification/openapi.yml",
    output: "postman/collections/defender.collection.json",
  },
  {
    name: "M365 Admin",
    spec: "specifications/nodoc-m365-admin/specification/openapi.yml",
    output: "postman/collections/m365-admin.collection.json",
  },
  {
    name: "M365 Apps Config",
    spec: "specifications/nodoc-m365-apps-config/specification/openapi.yml",
    output: "postman/collections/m365-apps-config.collection.json",
  },
  {
    name: "M365 Apps Services",
    spec: "specifications/nodoc-m365-apps-services/specification/openapi.yml",
    output: "postman/collections/m365-apps-services.collection.json",
  },
  {
    name: "M365 Apps Inventory",
    spec: "specifications/nodoc-m365-apps-inventory/specification/openapi.yml",
    output: "postman/collections/m365-apps-inventory.collection.json",
  },
  {
    name: "Purview",
    spec: "specifications/nodoc-purview/specification/openapi.yml",
    output: "postman/collections/purview.collection.json",
  },
  {
    name: "Entra IAM",
    spec: "specifications/nodoc-ibiza-iam/specification/openapi.yml",
    output: "postman/collections/entra-iam.collection.json",
  },
  {
    name: "Entra PIM",
    spec: "specifications/nodoc-entra-pim/specification/openapi.yml",
    output: "postman/collections/entra-pim.collection.json",
  },
  {
    name: "Entra IGA",
    spec: "specifications/nodoc-entra-iga/specification/openapi.yml",
    output: "postman/collections/entra-iga.collection.json",
  },
  {
    name: "Entra IDGov",
    spec: "specifications/nodoc-entra-idgov/specification/openapi.yml",
    output: "postman/collections/entra-idgov.collection.json",
  },
  {
    name: "Entra B2C",
    spec: "specifications/nodoc-entra-b2c/specification/openapi.yml",
    output: "postman/collections/entra-b2c.collection.json",
  },
];

function run(command, args) {
  const commandLine = [command, ...args.map((arg) => {
    if (/[\s"]/u.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }

    return arg;
  })].join(" ");

  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

mkdirSync(outputDir, { recursive: true });

const tempDir = mkdtempSync(path.join(os.tmpdir(), "nodoc-postman-"));

try {
  for (const definition of collectionDefinitions) {
    const bundledPath = path.join(
      tempDir,
      `${path.basename(definition.output, ".json")}.bundled.yaml`,
    );

    console.log(`\n==> Generating ${definition.name}`);

    run(npmCommand, [
      "exec",
      "--yes",
      "--package=@redocly/cli@latest",
      "--",
      "redocly",
      "bundle",
      definition.spec,
      "-o",
      bundledPath,
    ]);

    run(npmCommand, [
      "exec",
      "--yes",
      "--package=openapi-to-postmanv2@6.0.0",
      "--",
      "openapi2postmanv2",
      "-s",
      bundledPath,
      "-o",
      definition.output,
      "-p",
      "-c",
      "postman_to_openapi.json",
    ]);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
