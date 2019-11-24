import { Link } from 'gatsby';
import Img from 'gatsby-image';
import * as React from 'react';

import styled from '@styled';

const Container = styled.article`
  flex: 1 1 300px;
  display: flex;
  flex-direction: column;
  margin: 0 20px 40px;
  min-height: 300px;
  background-color: ${p => p.theme.colors.use.background.primary};
  border-radius: 5px;
  box-shadow: rgba(15, 17, 21, 0.35) 0px 6px 9px 0px;
  transition: all 0.5s ease;
  :hover {
    transition: all 0.4s ease;
    transform: translate3D(0, -1px, 0) scale(1.02);
  }
`;

const CardLink = styled(Link)`
  color: inherit;
  flex-grow: 1;

  /* Reset Typography theme */
  background-image: none;
`;

const ImageContainer = styled.div`
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: ${p => p.theme.dimensions.use.borderRadius.normal} ${p => p.theme.dimensions.use.borderRadius.normal} 0 0;
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
  padding: ${p => p.theme.dimensions.use.margin};
`;

const Tags = styled.span`
  display: block;
  margin-bottom: 4px;
  color: ${p => p.theme.colors.use.text.tertiary};
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
`;

const ReadingTime = styled.span`
  flex-shrink: 0;
  margin-left: 20px;
  color: ${p => p.theme.colors.use.text.tertiary};
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
    <CardLink to={post.fields.slug}>
      {post.frontmatter.image && (
        <ImageContainer>
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
        </ImageContainer>
      )}
      <Content>
        <header>
          {post.frontmatter.tags && <Tags>{post.frontmatter.tags[0]}</Tags>}
          <Title>{post.frontmatter.title}</Title>
        </header>
        <Excerpt>
          <p>{post.excerpt}</p>
        </Excerpt>
        <Meta>
          <ReadingTime>{post.timeToRead} min read</ReadingTime>
        </Meta>
      </Content>

    </CardLink>
  </Container>
);

export default PostCard;
