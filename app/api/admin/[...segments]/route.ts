import { handleMonitorRequest } from '@/lib/server/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handleMonitorRequest
export const POST = handleMonitorRequest
export const PUT = handleMonitorRequest
export const DELETE = handleMonitorRequest

export const HEAD = handleMonitorRequest
export const OPTIONS = handleMonitorRequest
export const PATCH = handleMonitorRequest
