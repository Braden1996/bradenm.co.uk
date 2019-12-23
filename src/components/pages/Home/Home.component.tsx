import * as React from 'react';
import { math } from 'polished';

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
  margin-left: 0;
  margin-bottom: 0;

  & > *:not(:last-child) {
    margin-bottom: ${p => math(`2 * ${p.theme.dimensions.use.margin}`)};
  }
`;

const Home: React.FC<Props> = ({ data, pageContext, ...props }) => (
  <BaseLayout {...props}>
    <PostCardList>
      {data.allMdx!.nodes!.map(node => <PostCard key={node.fields!.slug || ''} post={node} />)}
    </PostCardList>
  </BaseLayout>
);

export default Home;
