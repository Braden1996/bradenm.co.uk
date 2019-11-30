import * as React from 'react';
import GithubCorner from 'react-github-corner';

import { Footer, Header } from '@organisms';
import config from '@config';
import styled from '@styled';

import Base from '../Base';

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
  max-width: 960px;
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const Content = styled.main`
  width: 100%;
  flex: 1;
`;

const BaseLayout: React.FC<React.ComponentProps<typeof Base>> = props => (
  <Base {...props}>
    <Container>
      <Header />
      <Content>{props.children}</Content>
      <Footer />
    </Container>
    <StyledGithubCorner href={config.site.publicGithubRepo} />
  </Base>
);

export default BaseLayout;
