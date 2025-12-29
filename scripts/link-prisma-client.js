const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const prismaDir = path.join(root, "node_modules", ".prisma");
const clientDir = path.join(root, "node_modules", "@prisma", "client");
const targetDir = path.join(clientDir, ".prisma");

function hasDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (error) {
    return false;
  }
}

if (!hasDir(prismaDir) || !hasDir(clientDir)) {
  process.exit(0);
}

try {
  fs.rmSync(targetDir, { recursive: true, force: true });
} catch (error) {
  console.warn("Skipping Prisma client cleanup:", error.message);
  process.exit(0);
}

try {
  fs.cpSync(prismaDir, targetDir, { recursive: true });
} catch (error) {
  console.warn("Failed to copy Prisma client folder:", error.message);
}
