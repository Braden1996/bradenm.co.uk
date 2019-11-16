import * as React from 'react';
import { Link } from 'gatsby';

import { BaseLayout } from '@templates';
import { HomePageQuery } from '@gql-types';

export interface Props extends React.ComponentProps<typeof BaseLayout> {
  data: HomePageQuery;
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
        {data.allMarkdownRemark.edges.map(post => (
          <Link key={post.node.fields!.slug || ''} to={post.node.fields!.slug!}>
            <li>{post.node.frontmatter!.title}</li>
          </Link>
        ))}
        {Array(100).fill(0).map((_, i) => <li key={i as any}>Test line {i}</li>)}
      </ol>
    </main>
  </BaseLayout>
);

export default Home;
