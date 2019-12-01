import * as React from 'react';
import GithubCorner from 'react-github-corner';

import { Footer, Header } from '@organisms';
import config from '@config';
import styled, { media } from '@styled';

import Base from '../Base';

const StyledHeader = styled(Header)<{ size: number }>`
  ${p => media.lessThan('default')`
    margin-left: ${p.size}px;
    margin-right: ${p.size}px;
  `}
`;

const StyledGithubCorner = styled(GithubCorner).attrs(p => ({
  bannerColor: p.theme.colors.use.background.secondary,
  octoColor: p.theme.colors.use.background.tertiary,
}))`
  opacity: 0.6;
  transition: opacity 200ms linear;

  &:hover {
    opacity: 1;
  }
`;

const Container = styled.article`
  width: 100%;
  max-width: ${p => p.theme.dimensions.use.breakpoints.default};
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const Content = styled.main`
  width: 100%;
  flex: 1;
`;

const BaseLayout: React.FC<React.ComponentProps<typeof Base>> = props => {
  const githubCornerSize = 65;
  return (
    <Base {...props}>
      <Container>
        <StyledHeader size={githubCornerSize} />
        <Content>{props.children}</Content>
        <Footer />
      </Container>
      <StyledGithubCorner
        href={config.site.publicGithubRepo}
        size={githubCornerSize}
      />
    </Base>
  );
};

export default BaseLayout;
