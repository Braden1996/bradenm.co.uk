import { graphql } from 'gatsby';
import * as React from 'react';
import Helmet from 'react-helmet';

import IndexLayout, { Props as LayoutProps } from '../layouts';
import config from '../website-config';
import { BlogPageQueryQuery } from '../../types/graphql';

export const pageQuery = graphql`
  query blogPageQuery($skip: Int!, $limit: Int!) {
    logo: file(relativePath: { eq: "img/ghost-logo.png" }) {
      childImageSharp {
        # Specify the image processing specifications right in the query.
        # Makes it trivial to update as your page's design changes.
        fixed {
          ...GatsbyImageSharpFixed
        }
      }
    }
    header: file(relativePath: { eq: "img/blog-cover.jpg" }) {
      childImageSharp {
        # Specify the image processing specifications right in the query.
        # Makes it trivial to update as your page's design changes.
        fluid(maxWidth: 2000) {
          ...GatsbyImageSharpFluid
        }
      }
    }
    allMarkdownRemark(
      sort: { fields: [frontmatter___date], order: DESC },
      filter: { frontmatter: { draft: { ne: true } } },
      limit: $limit,
      skip: $skip
    ) {
      edges {
        node {
          timeToRead
          frontmatter {
            title
            date
            tags
            draft
            image {
              childImageSharp {
                fluid(maxWidth: 3720) {
                  ...GatsbyImageSharpFluid
                }
              }
            }
          }
          excerpt
          fields {
            layout
            slug
          }
        }
      }
    }
  }
`;

export interface Props extends LayoutProps {
  data: BlogPageQueryQuery;
  pageContext: {
    limit: number;
    skip: number;
    numPages: number;
    currentPage: number;
  };
}

const IndexPage: React.FC<Props> = ({ data, pageContext, ...props }) => (
  <IndexLayout {...props}>
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
  </IndexLayout>
);

export default IndexPage;
