import * as React from 'react';

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
    <PostContent htmlAst={data.markdownRemark!.htmlAst} />
  </BaseLayout>
);

export default Post;
