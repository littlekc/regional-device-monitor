// Run on the server as the application user; supply private JSON via stdin, never argv.
import { MonitorDatabase } from '../lib/server/database.ts'
let text = ''
for await (const chunk of process.stdin) {
  text += chunk
  if (text.length > 32768) throw Error('Configuration input too large.')
}
const db = new MonitorDatabase()
try {
  const input = JSON.parse(text)
  const config = db.configureIkuai(input.version, input.connection)
  console.log(JSON.stringify({ version: config.version, configured: true }))
} catch {
  console.error('iKuai configuration rejected; check version, URL and project bindings.')
  process.exitCode = 1
} finally { db.close() }
