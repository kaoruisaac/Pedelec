#!/usr/bin/env node

// node bin/sync-version.mjs 0.1.1
// node bin/sync-version.mjs --check 0.1.1
// node bin/sync-version.mjs --help

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const binDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(binDir);

const jsonTargets = [
  {
    file: "sdk/package.json",
    getVersions: (data) => [getJsonVersionEntry(data, "version")],
    update: (data, version) => setJsonVersion(data, "version", version),
  },
  {
    file: "sdk/package-lock.json",
    getVersions: (data) => [
      getJsonVersionEntry(data, "version"),
      getPackageLockRootVersionEntry(data),
    ],
    update: (data, version) => {
      setJsonVersion(data, "version", version);
      setPackageLockRootVersion(data, version);
    },
  },
  {
    file: "desktop/package.json",
    getVersions: (data) => [getJsonVersionEntry(data, "version")],
    update: (data, version) => setJsonVersion(data, "version", version),
  },
  {
    file: "desktop/package-lock.json",
    getVersions: (data) => [
      getJsonVersionEntry(data, "version"),
      getPackageLockRootVersionEntry(data),
    ],
    update: (data, version) => {
      setJsonVersion(data, "version", version);
      setPackageLockRootVersion(data, version);
    },
  },
  {
    file: "extension/manifest.json",
    getVersions: (data) => [getJsonVersionEntry(data, "version")],
    update: (data, version) => setJsonVersion(data, "version", version),
  },
  {
    file: "desktop/tauri/tauri.conf.json",
    getVersions: (data) => [getJsonVersionEntry(data, "version")],
    update: (data, version) => setJsonVersion(data, "version", version),
  },
];

const targets = [
  ...jsonTargets.map((target) => ({ ...target, type: "json" })),
  {
    file: "desktop/tauri/Cargo.toml",
    type: "toml",
  },
];

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const command = parseArgs(process.argv.slice(2));

  if (command.help) {
    printHelp();
    return;
  }

  if (command.version && !VERSION_PATTERN.test(command.version)) {
    throw new Error(
      `Invalid version "${command.version}". Expected MAJOR.MINOR.PATCH, for example 0.1.1.`,
    );
  }

  const files = await readVersionFiles();

  if (command.check) {
    checkVersions(files, command.version);
    return;
  }

  const updates = prepareUpdates(files, command.version);
  console.log(`Syncing version: ${command.version}`);
  console.log("");

  for (const update of updates) {
    if (update.changed) {
      await writeFile(update.absolutePath, update.nextContent, "utf8");
    }
    console.log(`${update.changed ? "updated" : "unchanged"} ${update.file}`);
  }

  console.log("");
  console.log("Done.");
}

function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) {
    if (args.length > 1) {
      throw new Error("The help flag cannot be combined with other arguments.");
    }
    return { help: true };
  }

  if (args[0] === "--check") {
    if (args.length > 2) {
      throw new Error("Usage: node bin/sync-version.mjs --check [version]");
    }
    return { check: true, version: args[1] };
  }

  if (args.length !== 1 || args[0].startsWith("-")) {
    throw new Error("Usage: node bin/sync-version.mjs <version>");
  }

  return { check: false, version: args[0] };
}

function printHelp() {
  console.log(`Usage:
  node bin/sync-version.mjs <version>
  node bin/sync-version.mjs --check [version]
  node bin/sync-version.mjs --help

Version must use MAJOR.MINOR.PATCH, for example 0.1.1.`);
}

async function readVersionFiles() {
  const files = [];

  for (const target of targets) {
    const absolutePath = path.join(repoRoot, target.file);
    let content;

    try {
      content = await readFile(absolutePath, "utf8");
    } catch (error) {
      throw new Error(`Failed to read ${target.file}: ${error.message}`);
    }

    if (target.type === "json") {
      files.push(readJsonTarget(target, absolutePath, content));
    } else {
      files.push(readCargoTarget(target, absolutePath, content));
    }
  }

  return files;
}

function readJsonTarget(target, absolutePath, content) {
  let data;
  let versionEntries;

  try {
    data = JSON.parse(content);
    versionEntries = target.getVersions(data);
  } catch (error) {
    throw new Error(`Failed to read ${target.file}: ${error.message}`);
  }

  return {
    ...target,
    absolutePath,
    content,
    data,
    version: versionEntries[0].version,
    versionEntries: versionEntries.map((entry) => ({
      ...entry,
      file: target.file,
    })),
  };
}

function readCargoTarget(target, absolutePath, content) {
  return {
    ...target,
    absolutePath,
    content,
    version: getCargoPackageVersion(content, target.file),
    versionEntries: [
      {
        file: target.file,
        field: "[package].version",
        version: getCargoPackageVersion(content, target.file),
      },
    ],
  };
}

function getJsonVersionEntry(data, key) {
  return {
    field: key,
    version: getJsonVersion(data, key),
  };
}

function getJsonVersion(data, key) {
  if (!Object.hasOwn(data, key) || typeof data[key] !== "string") {
    throw new Error(`Missing string field "${key}".`);
  }

  return data[key];
}

function setJsonVersion(data, key, version) {
  getJsonVersion(data, key);
  data[key] = version;
}

function setPackageLockRootVersion(data, version) {
  getPackageLockRootVersionEntry(data);
  data.packages[""].version = version;
}

function getPackageLockRootVersionEntry(data) {
  if (
    !data.packages ||
    typeof data.packages !== "object" ||
    !data.packages[""] ||
    typeof data.packages[""] !== "object"
  ) {
    throw new Error('Missing package-lock field packages[""].');
  }

  return {
    field: 'packages[""].version',
    version: getJsonVersion(data.packages[""], "version"),
  };
}

function getCargoPackageVersion(content, file) {
  return findCargoPackageVersionLine(content, file).version;
}

function updateCargoPackageVersion(content, version, file) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const result = findCargoPackageVersionLine(content, file);
  lines[result.index] = result.line.replace(
    /^(\s*version\s*=\s*)"[^"]*"(.*)$/,
    `$1"${version}"$2`,
  );

  return lines.join(newline);
}

function findCargoPackageVersionLine(content, file) {
  const lines = content.split(/\r?\n/);
  let inPackageSection = false;

  for (const [index, line] of lines.entries()) {
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      continue;
    }

    if (inPackageSection && /^\s*\[/.test(line)) {
      break;
    }

    if (inPackageSection) {
      const match = line.match(/^\s*version\s*=\s*"([^"]*)"/);
      if (match) {
        return { index, line, version: match[1] };
      }
    }
  }

  throw new Error(`Missing [package] version in ${file}.`);
}

function checkVersions(files, expectedVersion) {
  const versionEntries = files.flatMap((file) => file.versionEntries);
  const expected = expectedVersion ?? versionEntries[0]?.version;
  const mismatches = versionEntries.filter((entry) => entry.version !== expected);

  if (mismatches.length === 0) {
    console.log(`All version files are in sync: ${expected}`);
    return;
  }

  console.log("Version mismatch:");
  console.log("");

  for (const entry of versionEntries) {
    console.log(`${entry.version}  ${entry.file} ${entry.field}`);
  }

  process.exitCode = 1;
}

function prepareUpdates(files, version) {
  return files.map((file) => {
    const nextContent =
      file.type === "json"
        ? updateJsonContent(file, version)
        : updateCargoPackageVersion(file.content, version, file.file);

    return {
      file: file.file,
      absolutePath: file.absolutePath,
      nextContent,
      changed: nextContent !== file.content,
    };
  });
}

function updateJsonContent(file, version) {
  file.update(file.data, version);
  return `${JSON.stringify(file.data, null, 2)}\n`;
}
