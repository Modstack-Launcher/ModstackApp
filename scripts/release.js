import fs from "fs"
import path from "path"
import crypto from "crypto"
import { execSync } from "child_process"
import 'dotenv/config'

const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"))
const version = config.version
const githubRepository = process.env.GITHUB_REPOSITORY || "Modstack-Launcher/ModstackApp"

const basePath = `target/release/bundle/nsis`

const currentName = `Modstack App_${version}_x64-setup.exe`
const original = path.join(basePath, currentName)
const renamed = path.join(basePath, "modstack-setup.exe")

fs.readdirSync(basePath).forEach(file => {
  if (
    file.startsWith("Modstack App_") &&
    file.endsWith(".exe") &&
    file !== currentName
  ) {
    fs.unlinkSync(path.join(basePath, file))
  }

  if (file.endsWith(".sig")) {
    fs.unlinkSync(path.join(basePath, file))
  }
})

console.log("📦 Archivo esperado:", original)
console.log("📁 Existe?", fs.existsSync(original))

if (!fs.existsSync(original)) {
  console.error("❌ No se encontró el .exe generado por Tauri")
  process.exit(1)
}

if (fs.existsSync(renamed)) {
  fs.unlinkSync(renamed)
}

console.log("📁 Renombrando...")
fs.renameSync(original, renamed)

console.log("🔐 Firmando...")
execSync(`tauri signer sign "${renamed}"`, { stdio: "inherit" })

const sigPath = `${renamed}.sig`
if (!fs.existsSync(sigPath)) {
  console.error("❌ No se generó la firma (.sig)")
  process.exit(1)
}

const signature = fs.readFileSync(sigPath, "utf-8").trim()
const releaseDate = new Date().toISOString()

const url = `https://github.com/${githubRepository}/releases/download/v${version}/modstack-setup.exe`

const update = {
  version,
  notes: "Auto update",
  pub_date: releaseDate,
  platforms: {
    "windows-x86_64": {
      url,
      signature
    }
  }
}

const outputJson = path.join(basePath, "update.json")
fs.writeFileSync(outputJson, JSON.stringify(update, null, 2))

try {
  const exeBuffer = fs.readFileSync(renamed)
  const sha512 = crypto.createHash("sha512").update(exeBuffer).digest("base64")
  const fileSize = fs.statSync(renamed).size

  const latestYml = `version: ${version}
files:
  - url: modstack-setup.exe
    sha512: >-
      ${sha512}
    size: ${fileSize}
path: modstack-setup.exe
sha512: >-
  ${sha512}
releaseDate: '${releaseDate}'
`

  const outputYml = path.join(basePath, "latest.yml")
  fs.writeFileSync(outputYml, latestYml)
  console.log("✅ latest.yml generado")
} catch (err) {
  console.error("❌ Error generando latest.yml:", err)
}

console.log("✅ Release listo!")
console.log(`   📄 update.json`)
console.log(`   📄 latest.yml`)
