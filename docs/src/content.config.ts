import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { blogSchema } from 'starlight-blog/schema';

// One collection holds the docs and the devlog. The blog plugin's schema adds
// the post fields (date, tags, excerpt, authors, draft, cover) and makes the
// build fail on a post that leaves out a required one.
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: (context) => blogSchema(context) }),
  }),
};
