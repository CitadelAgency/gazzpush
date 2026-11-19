// Streaming read of the Instagram archive: the zip can be gigabytes, and none of it leaves the browser whole. It runs
// twice over the file: the first pass only reads the JSON, because folder order in the zip is not guaranteed; the second
// only reads the media.
import { Unzip, UnzipInflate } from 'fflate';
import { findPosts, type PostFile } from './xray';

interface Input { nome: string; bytes: Uint8Array }

async function walk(stream: ReadableStream<Uint8Array>, wants: (name: string) => boolean, use: (e: Input) => Promise<void>, saw?: (name: string) => void) {
  const ready: Input[] = [];
  let error: Error | null = null;
  const uz = new Unzip((file) => {
    saw?.(file.name);
    if (!wants(file.name)) return;
    const parts: Uint8Array[] = [];
    file.ondata = (e, data, end) => {
      if (e) { error = e; return; }
      parts.push(data);
      if (!end) return;
      const bytes = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let i = 0;
      for (const p of parts) { bytes.set(p, i); i += p.byteLength; }
      ready.push({ nome: file.name, bytes });
    };
    file.start();
  });
  uz.register(UnzipInflate);
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    uz.push(value);
    if (error) throw error;
    while (ready.length) await use(ready.shift()!);
  }
  uz.push(new Uint8Array(0), true);
  if (error) throw error;
  while (ready.length) await use(ready.shift()!);
}

const decode = new TextDecoder();

/** The archive's posts. `html`: an HTML export, which cannot be read. Private messages are left out. */
export async function readPostsZip(stream: ReadableStream<Uint8Array>): Promise<{ posts: PostFile[]; html: boolean }> {
  const perUri = new Map<string, PostFile>();
  let sawHtml = false;
  await walk(stream, (name) => /\.json$/i.test(name) && !/(^|\/)messages\//i.test(name), async ({ bytes }) => {
    try {
      for (const p of findPosts(JSON.parse(decode.decode(bytes)))) if (!perUri.has(p.uri)) perUri.set(p.uri, p);
    } catch { /* broken JSON does not stop reading the others */ }
  }, (name) => { if (/\.html?$/i.test(name)) sawHtml = true; });
  return { posts: [...perUri.values()].sort((a, b) => b.data.localeCompare(a.data)), html: sawHtml && perUri.size === 0 };
}

/** Hands over each media file of `posts`, resolving `uri` from the zip root, which may have an extra folder in front. */
export async function readMediaZip(stream: ReadableStream<Uint8Array>, posts: PostFile[], use: (post: PostFile, bytes: Uint8Array) => Promise<void>) {
  const perEnd = new Map(posts.map((p) => [p.uri.split('/').pop()!, p]));
  const find = (name: string) => {
    const p = perEnd.get(name.split('/').pop()!);
    return p && (name === p.uri || name.endsWith(`/${p.uri}`)) ? p : null;
  };
  await walk(stream, (name) => !!find(name), async ({ nome: name, bytes }) => { await use(find(name)!, bytes); });
}
