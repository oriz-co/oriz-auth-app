import { verifyToken, fetchAccessToken, jsonResponse, errorResponse, type Env } from '../_lib'

interface ReqContext {
	request: Request
	env: Env
}

export async function onRequestPost({ request, env }: ReqContext): Promise<Response> {
	let user: { uid: string }
	try {
		user = await verifyToken(request, env)
	} catch (e) {
		return errorResponse((e as Error).message, 401)
	}

	if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
		return errorResponse('Razorpay not configured', 500)
	}

	// Read subscription_id from user doc
	const accessToken = await fetchAccessToken(env)
	const docUrl = `https://firestore.googleapis.com/v1/projects/${env.PUBLIC_FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user.uid}`
	const userDoc = await fetch(docUrl, {
		headers: { authorization: `Bearer ${accessToken}` },
	})
	if (!userDoc.ok) return errorResponse('User doc not found', 404)
	const doc = (await userDoc.json()) as {
		fields?: { subscription_id?: { stringValue?: string } }
	}
	const subId = doc.fields?.subscription_id?.stringValue
	if (!subId) return errorResponse('No active subscription on file', 404)

	// Cancel via Razorpay API
	const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)
	const r = await fetch(`https://api.razorpay.com/v1/subscriptions/${subId}/cancel`, {
		method: 'POST',
		headers: {
			authorization: `Basic ${auth}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ cancel_at_cycle_end: 1 }),
	})
	if (!r.ok) {
		return errorResponse(`Razorpay error: ${await r.text()}`, r.status)
	}
	const sub = (await r.json()) as { id: string; status: string }

	// Mirror status back into Firestore
	await fetch(`${docUrl}?updateMask.fieldPaths=subscription_status`, {
		method: 'PATCH',
		headers: {
			authorization: `Bearer ${accessToken}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			fields: { subscription_status: { stringValue: sub.status } },
		}),
	})

	return jsonResponse({ ok: true, status: sub.status })
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
