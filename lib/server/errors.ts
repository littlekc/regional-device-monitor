export class MonitorError extends Error {
  readonly status: number
  readonly code: string
  readonly field?: string

  constructor(status: number, code: string, message: string, field?: string) {
    super(message)
    this.name = 'MonitorError'
    this.status = status
    this.code = code
    this.field = field
  }
}

export function invalid(field: string, message = '字段值无效。'): never {
  throw new MonitorError(400, 'invalid_input', message, field)
}
