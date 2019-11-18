import { Link } from 'gatsby';
import Img from 'gatsby-image';
import * as React from 'react';

import styled from '@styled';

const Container = styled.article`
  flex: 1 1 300px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0 20px 40px;
  min-height: 300px;
  background: #fff center center;
  background-size: cover;
  border-radius: 5px;
  box-shadow: rgba(39, 44, 49, 0.06) 8px 14px 38px, rgba(39, 44, 49, 0.03) 1px 3px 8px;
  transition: all 0.5s ease;
  :hover {
    box-shadow: rgba(39, 44, 49, 0.07) 8px 28px 50px, rgba(39, 44, 49, 0.04) 1px 6px 12px;
    transition: all 0.4s ease;
    transform: translate3D(0, -1px, 0) scale(1.02);
  }
`;

const ImageLink = styled(Link)`
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: 5px 5px 0 0;
`;

const Image = styled.div`
  width: auto;
  height: 200px;
  background: ${p => p.theme.colors.use.background.secondary} no-repeat center center;
  background-size: cover;
`;

const Content = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;

const ContentLink = styled(Link)`
  position: relative;
  flex-grow: 1;
  display: block;
  padding: 25px 25px 0;
  color: ${p => p.theme.colors.use.text.blackPrimary};
  :hover {
    text-decoration: none;
  }
`;

const Tags = styled.span`
  display: block;
  margin-bottom: 4px;
  color: ${p => p.theme.colors.use.text.blackTertiary};
  font-size: 1.2rem;
  line-height: 1.15em;
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
`;

const Title = styled.h2`
  margin-top: 0;
`;

const Excerpt = styled.section`
  font-family: Georgia, serif;
`;

const Meta = styled.footer`
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding: 0 25px 25px;
`;

const ReadingTime = styled.span`
  flex-shrink: 0;
  margin-left: 20px;
  color: ${p => p.theme.colors.use.text.blackTertiary};
  font-size: 1.2rem;
  line-height: 33px;
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
`;

export interface Props {
  post: any;
}

const PostCard: React.FC<Props> = ({ post }) => (
  <Container className={`post-card ${post.frontmatter.image ? '' : 'no-image'}`}>
    {post.frontmatter.image && (
      <ImageLink to={post.fields.slug}>
        <Image>
          {post.frontmatter.image &&
            post.frontmatter.image.childImageSharp &&
            post.frontmatter.image.childImageSharp.fluid && (
            <Img
              alt={`${post.frontmatter.title} cover image`}
              style={{ height: '100%' }}
              fluid={post.frontmatter.image.childImageSharp.fluid}
            />
          )}
        </Image>
      </ImageLink>
    )}
    <Content>
      <ContentLink to={post.fields.slug}>
        <header>
          {post.frontmatter.tags && <Tags>{post.frontmatter.tags[0]}</Tags>}
          <Title>{post.frontmatter.title}</Title>
        </header>
        <Excerpt>
          <p>{post.excerpt}</p>
        </Excerpt>
      </ContentLink>
      <Meta>
        <ReadingTime>{post.timeToRead} min read</ReadingTime>
      </Meta>
    </Content>
  </Container>
);

export default PostCard;
