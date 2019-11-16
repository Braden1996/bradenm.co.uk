import * as React from 'react';

import { BaseLayout } from '@templates';
import { BlogPageQuery } from '@gql-types';

export interface Props extends React.ComponentProps<typeof BaseLayout> {
  data: BlogPageQuery;
  pageContext: {
    limit: number;
    skip: number;
    numPages: number;
    currentPage: number;
  };
}

const Home: React.FC<Props> = ({ data, pageContext, ...props }) => (
  <BaseLayout {...props}>
    <header >
      <h1>Blog</h1>
    </header>
    <main id="site-main">
      <ol>
        {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion */}
        {data.allMarkdownRemark.edges.map(post => <li key={post.node.fields!.slug!}>{post.node.frontmatter!.title}</li>)}
        {Array(100).fill(0).map((_, i) => <li key={i as any}>Test line {i}</li>)}
      </ol>
    </main>
    {props.children}

  </BaseLayout>
);

export default Home;
