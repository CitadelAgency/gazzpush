// The Reels Container (Cloudflare Containers): the container/reels/ image (HyperFrames + headless Chrome + FFmpeg)
// behind a Durable Object. The Worker calls `getContainer(env.REELS, pecaId).fetch(...)` (src/lib/reels.ts); the
// instance starts on the first call and sleeps 2 min after the last. No internet: the composition arrives whole in the
// request (fonts, art and logo as data URIs; GSAP and music written alongside by the container's server).
import { Container } from '@cloudflare/containers';
import type { Env } from './env';

export class ReelsContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '2m';
  enableInternet = false;
}
