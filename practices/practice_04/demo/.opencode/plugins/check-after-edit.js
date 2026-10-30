import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

const execFileAsync = promisify(execFile)

export default {
  id: "parcelbot.check-after-edit",

  async setup(ctx) {
    const demo = ctx.location.directory
    const files = [
      path.join(demo, "service.py"),
      path.join(demo, "test_service.py"),
    ]
    const runner = path.join(demo, "scripts", "check.sh")

    // Снимок содержимого файлов
    async function fingerprint(file) {
      try {
        const content = await readFile(file)
        return createHash("sha256").update(content).digest("hex")
      } catch (error) {
        if (error.code === "ENOENT") return null
        throw error
      }
    }

    async function snapshot() {
      return Promise.all(files.map(fingerprint))
    }

    let previous = await snapshot()
    let running = false

    async function check() {
      try {
        const { stdout, stderr } = await execFileAsync(
          "bash",
          [runner],
          {
            cwd: demo,
            timeout: 120000,
            maxBuffer: 4 * 1024 * 1024,
          },
        )

        return `[ParcelBot hook] PASS\n${stdout}\n${stderr}`
      } catch (error) {
        return [
          "[ParcelBot hook] FAIL",
          error.stdout || "",
          error.stderr || "",
          error.message || "",
        ].join("\n")
      }
    }

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed" || running) return

      try {
        const current = await snapshot()
        const changed = current.some(
          (value, index) => value !== previous[index],
        )

        previous = current
        if (!changed) return

        running = true
        const report = await check()

        // Добавляем отчёт в результат исходного инструмента
        const result = event.result

        if (typeof result?.content === "string") {
          event.result = {
            ...result,
            content: `${result.content}\n\n${report}`,
          }
        } else if (typeof result?.output === "string") {
          event.result = {
            ...result,
            output: `${result.output}\n\n${report}`,
          }
        } else if (Array.isArray(result?.content)) {
          event.result = {
            ...result,
            content: [
              ...result.content,
              { type: "text", text: report },
            ],
          }
        } else {
          console.error(
            "[ParcelBot hook] Unsupported result format",
            report,
          )
        }
      } catch (error) {
        console.error("[ParcelBot hook] Error:", error)
      } finally {
        running = false
      }
    })
  },
}
