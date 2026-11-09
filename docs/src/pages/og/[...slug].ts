import { getCollection } from 'astro:content';
import { OGImageRoute } from 'astro-og-canvas';

// One 1200x630 social card per docs page and devlog post, at /og/<id>.png.
const entries = await getCollection('docs');
const pages = Object.fromEntries(entries.map(({ id, data }) => [id, data]));

export const { getStaticPaths, GET } = await OGImageRoute({
  param: 'slug',
  pages,
  getImageOptions: (_path, page: (typeof pages)[string]) => ({
    title: page.title,
    description: page.description ?? page.excerpt,
    logo: { path: './src/assets/og-logo.png', size: [96] },
    bgGradient: [
      [0, 4, 77],
      [0, 12, 222],
    ],
    border: { color: [208, 251, 7], width: 14, side: 'inline-start' },
    padding: 72,
    fonts: ['./public/fonts/instrument-sans.woff2'],
    font: {
      title: { color: [247, 248, 250], size: 68, lineHeight: 1.1, weight: 'Bold', families: ['Instrument Sans'] },
      description: { color: [195, 201, 255], size: 34, lineHeight: 1.35, families: ['Instrument Sans'] },
    },
  }),
});
