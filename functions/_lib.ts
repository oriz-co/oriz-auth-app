/**
 * Shared helpers for /dashboard Pages Functions.
 * Verifies Firebase ID tokens + provides Firestore REST helpers.
 *
 * No `firebase-admin` package — too heavy for Workers. We use the
 * Firebase Auth REST API + a JWT minted with WebCrypto from the
 * service account.
 */

export interface Env {
	FIREBASE_SERVICE_ACCOUNT_JSON: string
	PUBLIC_FIREBASE_PROJECT_ID: string
	RAZORPAY_KEY_ID?: string
	RAZORPAY_KEY_SECRET?: string
	RESEND_API_KEY?: string
}

type ServiceAccount = {
	project_id: string
	client_email: string
	private_key: string
	token_uri: string
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null

function b64url(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function pemToDer(pem: string): ArrayBuffer {
	const b64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '')
	const bin = atob(b64)
	const buf = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
	return buf.buffer
}

async function getServiceAccountAccessToken(env: Env): Promise<string> {
	if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
		return cachedAccessToken.token
	}
	const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount
	const now = Math.floor(Date.now() / 1000)
	const header = { alg: 'RS256', typ: 'JWT' }
	const claim = {
		iss: sa.client_email,
		scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/identitytoolkit',
		aud: sa.token_uri,
		exp: now + 3600,
		iat: now,
	}
	const headB64 = b64url(new TextEncoder().encode(JSON.stringify(header)))
	const claimB64 = b64url(new TextEncoder().encode(JSON.stringify(claim)))
	const toSign = `${headB64}.${claimB64}`
	const key = await crypto.subtle.importKey(
		'pkcs8',
		pemToDer(sa.private_key),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	)
	const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign))
	const jwt = `${toSign}.${b64url(sig)}`
	const r = await fetch(sa.token_uri, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	})
	if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`)
	const data = (await r.json()) as { access_token: string; expires_in: number }
	cachedAccessToken = {
		token: data.access_token,
		expiresAt: Date.now() + data.expires_in * 1000,
	}
	return data.access_token
}

/**
 * Verify a Firebase ID token from the Authorization header.
 * Uses Firebase Auth's verifyIdToken endpoint via service account.
 * Returns user info or throws.
 */
export async function verifyToken(request: Request, env: Env): Promise<{ uid: string; email: string | null }> {
	const auth = request.headers.get('authorization') ?? ''
	const token = auth.replace(/^Bearer\s+/i, '').trim()
	if (!token) throw new Error('Missing Authorization Bearer token')

	const apiKey = (env as unknown as { PUBLIC_FIREBASE_API_KEY: string }).PUBLIC_FIREBASE_API_KEY
	if (apiKey) {
		// Faster path: use Identity Toolkit accounts:lookup with the user's own token
		const r = await fetch(
			`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ idToken: token }),
			}
		)
		if (r.ok) {
			const data = (await r.json()) as { users: Array<{ localId: string; email?: string }> }
			const u = data.users?.[0]
			if (u) return { uid: u.localId, email: u.email ?? null }
		}
	}

	// Fallback: use service account-minted access token
	const accessToken = await getServiceAccountAccessToken(env)
	const r2 = await fetch(
		`https://identitytoolkit.googleapis.com/v1/projects/${env.PUBLIC_FIREBASE_PROJECT_ID}/accounts:lookup`,
		{
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({ idToken: token }),
		}
	)
	if (!r2.ok) throw new Error(`token verify ${r2.status}: ${await r2.text()}`)
	const data = (await r2.json()) as { users: Array<{ localId: string; email?: string }> }
	const u = data.users?.[0]
	if (!u) throw new Error('Token resolved to no user')
	return { uid: u.localId, email: u.email ?? null }
}

export async function fetchAccessToken(env: Env): Promise<string> {
	return getServiceAccountAccessToken(env)
}

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json',
			'access-control-allow-origin': 'https://account.oriz.in',
			'access-control-allow-credentials': 'true',
		},
	})
}

export function errorResponse(message: string, status = 400): Response {
	return jsonResponse({ error: message }, status)
}
