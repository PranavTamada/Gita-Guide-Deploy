import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";


function findProjectRoot() {
  let dir;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch (e) {
    dir = process.cwd();
  }
  
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, "data", "verses.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();

export { projectRoot };

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

export function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readVerses() {
  return loadJson(path.join(projectRoot, "data", "verses.json"), []);
}
