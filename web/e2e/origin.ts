// The origin of the server the e2e uses: the usual `wrangler dev` on 8787, or another (another worktree, another port)
// through `E2E_ORIGEM`. Routes that change something check the request's origin, so `page.request` sends this header.
export const ORIGIN_E2_AND = process.env.E2E_ORIGEM ?? "http://localhost:8787";
