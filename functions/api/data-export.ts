import { verifyToken, fetchAccessToken, jsonResponse, errorResponse, type Env } from '../_lib'

interface ReqContext {
	request: Request
	env: Env
}

/**
 * Queue a data export. For now: read user's data inline + return a JSON blob.
 * A future version moves this to a queue + email-with-link.
 */
export async function onRequestPost({ request, env }: ReqContext): Promise<Response> {
	let user: { uid: string; email: string | null }
	try {
		user = await verifyToken(request, env)
	} catch (e) {
		return errorResponse((e as Error).message, 401)
	}

	const accessToken = await fetchAccessToken(env)
	const project = env.PUBLIC_FIREBASE_PROJECT_ID
	const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`

	// Inline export: user doc + all subcollections we know about
	const out: {
		exported_at: string
		uid: string
		email: string | null
		user_doc?: unknown
		payments?: unknown
		habits?: unknown
		activity?: unknown
	} = {
		exported_at: new Date().toISOString(),
		uid: user.uid,
		email: user.email,
	}

	const fetchDoc = async (path: string) => {
		const r = await fetch(`${base}/${path}`, {
			headers: { authorization: `Bearer ${accessToken}` },
		})
		return r.ok ? r.json() : null
	}
	const fetchCol = async (path: string) => {
		const r = await fetch(`${base}/${path}?pageSize=500`, {
			headers: { authorization: `Bearer ${accessToken}` },
		})
		if (!r.ok) return []
		const data = (await r.json()) as { documents?: unknown[] }
		return data.documents ?? []
	}

	out.user_doc = await fetchDoc(`users/${user.uid}`)
	out.payments = await fetchCol(`users/${user.uid}/payments`)
	out.habits = await fetchCol(`users/${user.uid}/habits`)
	out.activity = await fetchCol(`users/${user.uid}/activity`)

	return new Response(JSON.stringify(out, null, 2), {
		status: 200,
		headers: {
			'content-type': 'application/json',
			'content-disposition': `attachment; filename="oriz-data-${user.uid}-${Date.now()}.json"`,
			'access-control-allow-origin': 'https://account.oriz.in',
			'access-control-allow-credentials': 'true',
		},
	})
}

export async function onRequestOptions(): Promise<Response> {
	return new Response(null, {
		status: 204,
		headers: {
			'access-control-allow-origin': 'https://account.oriz.in',
			'access-control-allow-methods': 'POST, OPTIONS',
			'access-control-allow-headers': 'authorization, content-type',
		},
	})
}
