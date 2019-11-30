import { Link } from 'gatsby';
import Img, { FluidObject } from 'gatsby-image';
import * as React from 'react';
import { transparentize, math } from 'polished';

import styled from '@styled';
import { HomePageQuery } from '@gql-types';
import { useTagKindMap } from '@utils';
import { Tags } from '@molecules';

const Container = styled.article`
  display: flex;
  flex-direction: column;
  background-color: ${p => p.theme.colors.use.background.primary};
  border-radius: ${p => p.theme.dimensions.use.borderRadius.normal};
  box-shadow: ${p => transparentize(0.2, p.theme.colors.base.charade)} 0px 6px 9px 0px;
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
  padding: ${p => p.theme.dimensions.use.screen};
  padding-top: ${p => p.theme.dimensions.use.margin};
`;

const Title = styled.h2`
  margin-top: 0;
`;

const Excerpt = styled.section`
  & > p {
    margin-bottom: 0;
  }
`;

const Meta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${p => math(`0.5 * ${p.theme.dimensions.use.margin}`)};
`;

const ReadingTime = styled.span`
  color: ${p => p.theme.colors.use.text.tertiary};
  text-transform: uppercase;
  text-align: right;
`;

export interface Props {
  post: HomePageQuery['allMarkdownRemark']['edges'][0]['node'];
  className?: string;
}

const PostCard: React.FC<Props> = ({ post, className }) => {
  const tagColors = useTagKindMap();

  const tags = post.frontmatter!.tags!;
  const tagItems = React.useMemo(() => tags.map(label => ({
    label: label!,
    kind: label ? tagColors[label] : undefined,
  })), [tags, tagColors]);

  return (
    <Container className={className}>
      <CardLink to={post.fields!.slug!}>
        {post.frontmatter!.image && (
          <ImageContainer>
            <Image>
              {post.frontmatter!.image &&
                post.frontmatter!.image.childImageSharp &&
                post.frontmatter!.image.childImageSharp.fluid && (
                <Img
                  alt={`${post.frontmatter!.title} cover image`}
                  style={{ height: '100%' }}
                  fluid={post.frontmatter!.image.childImageSharp.fluid as FluidObject}
                />
              )}
            </Image>
          </ImageContainer>
        )}
        <Content>
          <header>
            <Meta>
              {tagItems && <Tags tags={tagItems} />}
              <ReadingTime>{post.timeToRead} min read</ReadingTime>
            </Meta>
            <Title>{post.frontmatter!.title}</Title>
          </header>
          <Excerpt>
            <p>{post.excerpt}</p>
          </Excerpt>
        </Content>
      </CardLink>
    </Container>
  );
};

export default PostCard;
