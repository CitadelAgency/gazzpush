// O Container do Reels (Cloudflare Containers): a imagem de container/reels/ (HyperFrames + Chrome sem tela + FFmpeg)
// atrás de um Durable Object. O Worker chama `getContainer(env.REELS, pecaId).fetch(...)` (src/lib/reels.ts); a
// instância sobe na primeira chamada e dorme 2 min depois da última. Sem internet: a composição chega inteira no
// pedido (fontes, arte e logo em data URI; GSAP e música gravados ao lado pelo servidor do container).
import { Container } from '@cloudflare/containers';
import type { Env } from './env';

export class ReelsContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '2m';
  enableInternet = false;
}
