import { verifyToken, fetchAccessToken, jsonResponse, errorResponse, type Env } from '../_lib'

interface ReqContext {
	request: Request
	env: Env
}

export async function onRequestPost({ request, env }: ReqContext): Promise<Response> {
	let user: { uid: string; email: string | null }
	try {
		user = await verifyToken(request, env)
	} catch (e) {
		return errorResponse((e as Error).message, 401)
	}

	const body = (await request.json().catch(() => ({}))) as { confirm?: string }
	if (body.confirm !== 'DELETE') {
		return errorResponse('Confirmation field required: { "confirm": "DELETE" }', 400)
	}

	const accessToken = await fetchAccessToken(env)
	const project = env.PUBLIC_FIREBASE_PROJECT_ID

	// 1. Delete user doc (Firestore doesn't recursively delete subcollections via REST —
	//    we delete top-level fields; subcollections are orphaned and reachable only by uid
	//    which is now gone. Acceptable for v0.)
	const docUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/${user.uid}`
	await fetch(docUrl, {
		method: 'DELETE',
		headers: { authorization: `Bearer ${accessToken}` },
	})

	// 2. Delete the Firebase Auth user
	const authDel = await fetch(
		`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:delete`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${accessToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ localId: user.uid }),
		}
	)
	if (!authDel.ok) {
		return errorResponse(`auth.deleteUser failed: ${await authDel.text()}`, 500)
	}

	// 3. Best-effort send confirmation email via Resend if configured
	if (env.RESEND_API_KEY && user.email) {
		try {
			await fetch('https://api.resend.com/emails', {
				method: 'POST',
				headers: {
					authorization: `Bearer ${env.RESEND_API_KEY}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					from: 'oriz <noreply@oriz.in>',
					to: [user.email],
					subject: 'Your oriz account has been deleted',
					text: `Your oriz account has been permanently deleted as of ${new Date().toISOString()}.

If this was a mistake, you can sign up again at https://account.oriz.in/sign-in/ — but your previous data is unrecoverable.

— oriz`,
				}),
			})
		} catch {
			/* best-effort; don't fail the delete on email send */
		}
	}

	return jsonResponse({ ok: true })
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
