/**
 * envEditor.js
 * Read and write .env files using a simple KEY=VALUE parser.
 * Preserves comments and blank lines on round-trips where possible.
 */

"use strict";

const fs = require("fs/promises");
const path = require("path");

/**
 * Read a .env file and return an array of { key, value } objects.
 * Lines starting with '#' or blank lines are skipped.
 *
 * @param {string} absolutePath  Absolute path to the .env file
 * @returns {Promise<Array<{id: string, key: string, value: string}>>}
 */
async function readEnvFile(absolutePath) {
  let content;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return []; // File doesn't exist yet — return empty
    throw err;
  }

  const vars = [];
  let idx = 0;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqPos = line.indexOf("=");
    if (eqPos === -1) continue;

    const key = line.slice(0, eqPos).trim();
    let value = line.slice(eqPos + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      vars.push({ id: String(++idx), key, value });
    }
  }
  return vars;
}

/**
 * Write an array of { key, value } objects back to a .env file.
 * Writes atomically by writing to a temp file then renaming.
 *
 * @param {string} absolutePath  Absolute path to the .env file
 * @param {Array<{key: string, value: string}>} vars
 */
async function writeEnvFile(absolutePath, vars) {
  const header = `# Managed by DevHub — ${new Date().toISOString()}\n`;
  const body = vars
    .filter((v) => v.key && v.key.trim())
    .map(({ key, value }) => {
      // Quote values that contain spaces or special chars
      const needsQuotes = /[\s"'\\#]/.test(value);
      const escaped = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
      return `${key.trim()}=${escaped}`;
    })
    .join("\n");

  const content = header + body + "\n";

  // Atomic write: temp file → rename
  const dir = path.dirname(absolutePath);
  const tmpPath = path.join(dir, `.env.devhub-tmp-${process.pid}`);

  // Make sure the directory exists
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, absolutePath);
}

module.exports = { readEnvFile, writeEnvFile };
