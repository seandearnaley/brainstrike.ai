import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { getCollection } from 'astro:content';

// Pages with a generated card at /og/<id>.png (see src/pages/og/[...slug].ts).
// Routes the blog plugin generates (the post list, tag pages) have no content
// entry, so they share the site-wide card.
const withCard = new Set((await getCollection('docs')).map((entry) => entry.id));

export const onRequest = defineRouteMiddleware((context) => {
  const { entry, head } = context.locals.starlightRoute;

  const image = new URL(withCard.has(entry.id) ? `/og/${entry.id}.png` : '/og.png', context.site);
  head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: image.href } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image.href } }
  );

  // A devlog post writes its summary once, as `excerpt`. Use it as the page
  // description too, so search results and link previews do not fall back to
  // the site-wide description.
  const { description, excerpt } = entry.data;
  if (!description && typeof excerpt === 'string') {
    for (const { attrs } of head) {
      if (attrs?.name === 'description' || attrs?.property === 'og:description') attrs.content = excerpt;
    }
  }
});
