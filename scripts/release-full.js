import fs from "fs"
import path from "path"
import crypto from "crypto"
import { execSync } from "child_process"
import 'dotenv/config'

const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"))
const version = config.version
const pub_date = new Date().toISOString()
const githubRepository = process.env.GITHUB_REPOSITORY || "Modstack-Launcher/ModstackApp"
const releaseBaseUrl = `https://github.com/${githubRepository}/releases/download/v${version}`

fs.mkdirSync("release", { recursive: true })

function sha512b64(filePath) {
  return crypto.createHash("sha512").update(fs.readFileSync(filePath)).digest("base64")
}

function sign(filePath) {
  const sigPath = `${filePath}.sig`
  if (fs.existsSync(sigPath)) fs.unlinkSync(sigPath)
  execSync(`npx tauri signer sign "${filePath}"`, { stdio: "inherit" })
  if (!fs.existsSync(sigPath)) {
    console.error(`❌ No se generó .sig para ${filePath}`)
    process.exit(1)
  }
  return fs.readFileSync(sigPath, "utf-8").trim()
}

function findFirst(dir, suffix) {
  if (!fs.existsSync(dir)) return null
  const f = fs.readdirSync(dir).find(x => x.endsWith(suffix) && !x.endsWith(".sig"))
  return f ? path.join(dir, f) : null
}

const p = process.platform
const platforms = {}

if (p === "win32") {
  const dir = "target/release/bundle/nsis"

  // Limpiar versiones antiguas y .sig sueltos
  fs.readdirSync(dir).forEach(file => {
    if (file.startsWith("Modstack App_") && file.endsWith(".exe") && file !== `Modstack App_${version}_x64-setup.exe`) {
      fs.unlinkSync(path.join(dir, file))
    }
    if (file.endsWith(".sig") && file !== "modstack-setup.exe.sig") {
      fs.unlinkSync(path.join(dir, file))
    }
  })

  const src = path.join(dir, `Modstack App_${version}_x64-setup.exe`)
  if (!fs.existsSync(src)) {
    console.error(`❌ No se encontró: ${src}`)
    process.exit(1)
  }

  const dest = "release/modstack-setup.exe"
  if (fs.existsSync(dest)) fs.unlinkSync(dest)
  fs.copyFileSync(src, dest)

  console.log("🔐 Firmando exe...")
  const signature = sign(dest)

  const hash = sha512b64(dest)
  const size = fs.statSync(dest).size

  platforms["windows-x86_64"] = { url: `${releaseBaseUrl}/modstack-setup.exe`, signature }

  fs.writeFileSync(
    "release/latest.yml",
    `version: ${version}\nfiles:\n  - url: modstack-setup.exe\n    sha512: >-\n      ${hash}\n    size: ${size}\npath: modstack-setup.exe\nsha512: >-\n  ${hash}\nreleaseDate: '${pub_date}'\n`
  )
  console.log("✅ latest.yml generado")

} else if (p === "linux") {
  // AppImage — único target soportado por el updater en Linux
  const appSrc = findFirst("target/release/bundle/appimage", ".AppImage")
  if (!appSrc) {
    console.error("❌ AppImage no encontrado en target/release/bundle/appimage")
    process.exit(1)
  }

  const appDest = "release/modstack.AppImage"
  if (fs.existsSync(appDest)) fs.unlinkSync(appDest)
  fs.copyFileSync(appSrc, appDest)

  console.log("🔐 Firmando AppImage...")
  const signature = sign(appDest)

  platforms["linux-x86_64"] = { url: `${releaseBaseUrl}/modstack.AppImage`, signature }

  // DEB y RPM: solo distribución, el updater de Tauri no los soporta
  const debSrc = findFirst("target/release/bundle/deb", ".deb")
  if (debSrc) { fs.copyFileSync(debSrc, "release/modstack.deb"); console.log("✅ DEB copiado") }

  const rpmSrc = findFirst("target/release/bundle/rpm", ".rpm")
  if (rpmSrc) { fs.copyFileSync(rpmSrc, "release/modstack.rpm"); console.log("✅ RPM copiado") }

} else if (p === "darwin") {
  // Preferir build universal si existe
  const universalDir = "target/universal-apple-darwin/release/bundle/dmg"
  const regularDir = "target/release/bundle/dmg"
  const dmgDir = fs.existsSync(universalDir) ? universalDir : regularDir

  const dmgSrc = findFirst(dmgDir, ".dmg")
  if (!dmgSrc) {
    console.error(`❌ DMG no encontrado en ${dmgDir}`)
    process.exit(1)
  }

  const dmgDest = "release/modstack.dmg"
  if (fs.existsSync(dmgDest)) fs.unlinkSync(dmgDest)
  fs.copyFileSync(dmgSrc, dmgDest)

  console.log("🔐 Firmando DMG...")
  const signature = sign(dmgDest)

  // El build universal cubre ambas arquitecturas con el mismo artefacto
  platforms["darwin-x86_64"] = { url: `${releaseBaseUrl}/modstack.dmg`, signature }
  platforms["darwin-aarch64"] = { url: `${releaseBaseUrl}/modstack.dmg`, signature }

} else {
  console.error(`❌ Plataforma no soportada: ${p}`)
  process.exit(1)
}

// Fragmento de esta plataforma — el workflow CI los une en un update.json final
const fragment = { version, notes: "Auto update", pub_date, platforms }
fs.writeFileSync("release/update-fragment.json", JSON.stringify(fragment, null, 2))

const names = Object.keys(platforms).join(", ")
console.log(`✅ Release listo! (${names})`)
console.log("   📁 release/")
