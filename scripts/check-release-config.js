import fs from "fs"

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"))
const tauriConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"))
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8")
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const versions = {
  "package.json": packageJson.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion,
}

if (new Set(Object.values(versions)).size !== 1 || Object.values(versions).includes(undefined)) {
  console.error("Release versions are not synchronized:")
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "missing"}`)
  }
  process.exit(1)
}

const expectedEndpoint = "https://github.com/Modstack-Launcher/ModstackApp/releases/latest/download/update.json"
const endpoints = tauriConfig.plugins?.updater?.endpoints ?? []

if (!endpoints.includes(expectedEndpoint)) {
  console.error(`Missing GitHub updater endpoint: ${expectedEndpoint}`)
  process.exit(1)
}

console.log(`Release configuration valid for v${packageJson.version}`)
