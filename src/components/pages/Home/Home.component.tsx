import * as React from 'react';
import Helmet from 'react-helmet';

import { Base } from '@templates';
import config from '@config';
import { BlogPageQuery } from '@gql-types';

export interface Props extends React.ComponentProps<typeof Base> {
  data: BlogPageQuery;
  pageContext: {
    limit: number;
    skip: number;
    numPages: number;
    currentPage: number;
  };
}

const Home: React.FC<Props> = ({ data, pageContext, ...props }) => (
  <Base {...props}>
    <Helmet>
      <html lang={config.lang} />
      <title>{config.title}</title>
      <meta name="description" content={config.description} />
      <meta property="og:site_name" content={config.title} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={config.title} />
      <meta property="og:description" content={config.description} />
      <meta property="og:url" content={config.siteUrl} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={config.title} />
      <meta name="twitter:description" content={config.description} />
      <meta name="twitter:url" content={config.siteUrl} />
      {config.twitter && (
        <meta
          name="twitter:site"
          content={`@${config.twitter.split('https://twitter.com/')[1]}`}
        />
      )}
    </Helmet>
    <header >
      <h1>{config.title}</h1>
    </header>
    <main id="site-main">
      <ol>
        {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion */}
        {data.allMarkdownRemark.edges.map(post => <li key={post.node.fields!.slug!}>{post.node.frontmatter!.title}</li>)}
      </ol>
    </main>
    {props.children}

  </Base>
);

export default Home;
