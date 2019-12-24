import * as React from 'react';
import { MDXProvider } from '@mdx-js/react';
import { MDXRenderer } from 'gatsby-plugin-mdx';

import * as atoms from '@atoms';
import * as molecules from '@molecules';
import styled from '@styled';

import styles from './styles';

export const PostFullContent = styled.section`${styles}`;

export interface PostContentProps {
  children: string;
}

const shortCodes = { ...atoms, ...molecules };

const PostContent: React.FC<PostContentProps> = ({ children }) => (
  <PostFullContent>
    <MDXProvider components={shortCodes}>
      <MDXRenderer>{children}</MDXRenderer>
    </MDXProvider>
  </PostFullContent>
);

export default PostContent;
