import * as React from 'react';

import { BackToTop } from '@atoms';
import { BaseLayout } from '@templates';
import { PostContent } from '@organisms';
import { PostPageQuery } from '@gql-types';

export interface Props extends React.ComponentProps<typeof BaseLayout> {
  data: PostPageQuery;
  pageContext: {
    limit: number;
    skip: number;
    numPages: number;
    currentPage: number;
  };
}

const Post: React.FC<Props> = ({ data, ...props }) => (
  <BaseLayout {...props}>
    <PostContent>{data.mdx!.body}</PostContent>
    <BackToTop />
  </BaseLayout>
);

export default Post;
