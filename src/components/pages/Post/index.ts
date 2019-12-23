import { graphql } from 'gatsby';

import Post from './Post.component';

export default Post;

export const pageQuery = graphql`
  query postPage($slug: String) {
    mdx(fields: { slug: { eq: $slug } }) {
      body
    }
  }
`;
