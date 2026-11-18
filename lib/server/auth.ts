import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { MonitorDatabase } from './database.ts'
import { MonitorError } from './errors.ts'
import { passwordInput } from './validation.ts'

const keyLength = 64
const saltLength = 32
const defaultSessionMs = 12 * 60 * 60 * 1000
const attemptWindowMs = 60_000
const maxAttempts = 10
const tokenPattern = /^[A-Za-z0-9_-]{43}$/

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength)
  const key = await derive(password, salt)
  return ['scrypt', salt.toString('hex'), key.toString('hex')].join(':')
}

async function verifyPassword(password: string, hash?: string): Promise<boolean> {
  const [scheme, saltHex = '', keyHex = ''] = hash?.split(':') ?? []
  const salt = Buffer.from(saltHex, 'hex')
  const key = Buffer.from(keyHex, 'hex')
  const valid = scheme === 'scrypt' && salt.length === saltLength && key.length === keyLength
  const derived = await derive(password, valid ? salt : Buffer.alloc(saltLength))
  const equal = timingSafeEqual(derived, valid ? key : Buffer.alloc(keyLength))
  return valid && equal
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function badCredentials(): never {
  throw new MonitorError(401, 'invalid_credentials', '密码不正确。')
}

export class MonitorAuth {
  private readonly db: MonitorDatabase
  private readonly clock: () => number
  private readonly sessionMs: number
  private attempts: number[] = []

  constructor(db: MonitorDatabase, options: { now?: () => number; sessionMs?: number } = {}) {
    this.db = db
    this.clock = options.now ?? Date.now
    this.sessionMs = options.sessionMs ?? defaultSessionMs
  }

  private throttle(): void {
    const now = this.clock()
    this.attempts = this.attempts.filter((attempt) => now - attempt < attemptWindowMs)
    if (this.attempts.length >= maxAttempts) throw new MonitorError(429, 'rate_limited', '尝试次数过多，请稍后再试。')
    this.attempts.push(now)
  }

  async bootstrap(rawPassword: unknown): Promise<void> {
    const password = passwordInput(rawPassword, 'password', true)
    const created = this.db.createAdministrator(await hashPassword(password))
    if (!created) throw new MonitorError(409, 'admin_exists', '管理员已初始化。')
  }

  async login(rawPassword: unknown): Promise<{ token: string; expiresAt: number }> {
    const password = passwordInput(rawPassword, 'password')
    this.throttle()
    const hash = this.db.administratorHash()
    if (!await verifyPassword(password, hash) || !hash) badCredentials()
    const token = randomBytes(32).toString('base64url')
    const now = this.clock()
    const expiresAt = now + this.sessionMs
    if (!this.db.createSession(tokenHash(token), expiresAt, now, hash)) badCredentials()
    return { token, expiresAt }
  }

  session(token?: string): { expiresAt: number } | undefined {
    if (!token || !tokenPattern.test(token)) return
    const expiresAt = this.db.sessionExpiration(tokenHash(token), this.clock())
    if (expiresAt !== undefined) return { expiresAt }
  }

  logout(token: string): void {
    if (tokenPattern.test(token)) this.db.deleteSession(tokenHash(token))
  }

  async changePassword(token: string, rawCurrent: unknown, rawNext: unknown): Promise<void> {
    const current = passwordInput(rawCurrent, 'currentPassword')
    const next = passwordInput(rawNext, 'newPassword', true)
    this.throttle()
    const originalHash = this.db.administratorHash()
    if (!await verifyPassword(current, originalHash) || !originalHash) badCredentials()
    const nextHash = await hashPassword(next)
    if (!this.db.updatePassword(originalHash, nextHash, tokenHash(token), this.clock())) {
      throw new MonitorError(401, 'unauthorized', '请重新登录。')
    }
  }
}
