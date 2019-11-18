import * as React from 'react';

import styled from '@styled';
import { BaseLayout } from '@templates';
import { HomePageQuery } from '@gql-types';
import { PostCard } from '@organisms';

export interface Props extends React.ComponentProps<typeof BaseLayout> {
  data: HomePageQuery;
  pageContext: {
    limit: number;
    skip: number;
    numPages: number;
    currentPage: number;
  };
}

const PostCardList = styled.ol`
  padding-left: 0;
`;

const Home: React.FC<Props> = ({ data, pageContext, ...props }) => (
  <BaseLayout {...props}>
    <main id="site-main">
      <PostCardList>
        {data.allMarkdownRemark.edges.map(({ node }) => <PostCard key={node.fields!.slug || ''} post={node} />)}
      </PostCardList>
    </main>
  </BaseLayout>
);

export default Home;
