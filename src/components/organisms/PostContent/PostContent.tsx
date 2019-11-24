import * as React from 'react';
import RehypeReact from 'rehype-react';

import styled from '@styled';

import styles from './styles';

export const PostFullContent = styled.section`${styles}`;

const renderAst = new RehypeReact({
  createElement: React.createElement,
  // components: { 'interactive-counter': Counter },
  components: {},
}).Compiler;

const Ast = ({ ast, ...props }: any) => {
  ast.properties = props;
  return renderAst(ast);
};

export interface PostContentProps {
  htmlAst: any;
}

const PostContent: React.FC<PostContentProps> = ({ htmlAst }) => (
  <PostFullContent className="post-full-content">
    {/* TODO: this will apply the class when rehype-react is published https://github.com/rhysd/rehype-react/pull/11 */}
    <Ast className="post-content" ast={htmlAst} />
  </PostFullContent>
);

export default PostContent;
